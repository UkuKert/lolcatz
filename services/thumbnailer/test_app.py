import io
import os
import unittest
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError, EndpointConnectionError
from app import create_app
from cache import ThumbnailCache
from worker import process_message

IMAGE_ID = "a8decb1a-9caa-4489-8b7c-a832e4d9a862"


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.cache = MagicMock()
        self.cache.presign.return_value = "https://minio.example.test/bucket/thumbnail.jpg?signature=test"
        with patch("app.ThumbnailCache", return_value=self.cache):
            self.client = create_app().test_client()
        self.url = f"/api/thumbnails/v1/{IMAGE_ID}?size=256"

    def test_stable_url_redirects_to_cacheable_minio_object(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], self.cache.presign.return_value)
        self.assertEqual(response.headers["Cache-Control"], "public, max-age=86400, immutable")
        self.cache.ensure.assert_called_once_with(IMAGE_ID, (256,))
        self.cache.presign.assert_called_once_with(IMAGE_ID, 256)

    def test_preview_redirect_uses_requested_size(self):
        response = self.client.get(f"/api/thumbnails/v1/{IMAGE_ID}?size=1024")
        self.assertEqual(response.status_code, 302)
        self.cache.ensure.assert_called_once_with(IMAGE_ID, (1024,))
        self.cache.presign.assert_called_once_with(IMAGE_ID, 1024)

    def test_deleted_image_is_404(self):
        self.cache.ensure.return_value = False
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.cache.presign.assert_not_called()

    def test_storage_error_falls_back_without_caching(self):
        self.cache.ensure.side_effect = EndpointConnectionError(endpoint_url="http://storage")
        with self.assertLogs("app", level="ERROR"):
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], f"/api/browse/media/{IMAGE_ID}")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_programming_error_is_not_hidden_by_fallback(self):
        self.cache.ensure.side_effect = TypeError("programming error")
        self.client.application.config["TESTING"] = True
        with self.assertRaises(TypeError):
            self.client.get(self.url)

    def test_invalid_sizes_and_ids_do_not_reach_storage(self):
        for path in (f"{IMAGE_ID}?size=9999", "invalid?size=256"):
            self.assertEqual(self.client.get(f"/api/thumbnails/v1/{path}").status_code, 400)
        self.cache.ensure.assert_not_called()


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.s3, self.pool = MagicMock(), MagicMock()
        self.db = self.pool.getconn.return_value
        self.db.cursor.return_value.__enter__.return_value.fetchone.return_value = ("b",)
        env = {key: "test" for key in ("DATABASE_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET")}
        env.update(S3_ENDPOINT="minio.example.test", S3_USE_SSL="true")
        with patch.dict(os.environ, env), patch("cache.ThreadedConnectionPool", return_value=self.pool), patch("cache.boto3.client", return_value=self.s3):
            self.cache = ThumbnailCache()

    def test_ssl_flag_controls_storage_and_signed_url_scheme(self):
        from urllib.parse import urlparse
        for ssl, scheme in (("true", "https"), ("false", "http")):
            with self.subTest(ssl=ssl):
                env = dict(DATABASE_URL="test", S3_ACCESS_KEY="test", S3_SECRET_KEY="test",
                           S3_BUCKET="images", S3_REGION="test-region",
                           S3_ENDPOINT="storage.example.test:9000", S3_USE_SSL=ssl)
                with patch.dict(os.environ, env), patch("cache.ThreadedConnectionPool", return_value=self.pool):
                    cache = ThumbnailCache()
                self.assertEqual(cache.s3.meta.endpoint_url, f"{scheme}://storage.example.test:9000")
                signed = urlparse(cache.presign(IMAGE_ID, 1024))
                self.assertEqual(signed.scheme, scheme)
                self.assertEqual(signed.netloc, "storage.example.test:9000")
                self.assertIn("X-Amz-Signature=", signed.query)

    def test_cache_hit_does_not_download_or_decode_original(self):
        self.assertTrue(self.cache.ensure(IMAGE_ID))
        self.s3.get_object.assert_not_called()
        self.s3.put_object.assert_not_called()
        self.pool.putconn.assert_called_once_with(self.db)

    def test_signing_uses_public_host_and_cache_headers_without_downloading(self):
        # A real boto3 signer with dummy credentials needs no network access.
        import boto3
        from botocore.config import Config
        from urllib.parse import urlparse, parse_qs
        self.cache.s3 = boto3.client(
            "s3", endpoint_url="https://minio.example.test", region_name="test-region",
            aws_access_key_id="test", aws_secret_access_key="test",
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        url = urlparse(self.cache.presign(IMAGE_ID, 1024))
        query = parse_qs(url.query)
        self.assertEqual(url.netloc, "minio.example.test")
        self.assertEqual(url.path, f"/test/_thumbnails/v1/{IMAGE_ID}/preview.jpg")
        self.assertEqual(query["X-Amz-Expires"], ["604800"])
        self.assertEqual(query["response-cache-control"], ["public, max-age=31536000, immutable"])
        self.assertEqual(query["response-content-type"], ["image/jpeg"])
        self.assertIn("/test-region/s3/aws4_request", query["X-Amz-Credential"][0])
        self.s3.get_object.assert_not_called()

    def test_deleted_image_cannot_serve_cached_thumbnail(self):
        self.db.cursor.return_value.__enter__.return_value.fetchone.return_value = None
        self.assertFalse(self.cache.ensure(IMAGE_ID))
        self.s3.head_object.assert_not_called()

    def test_generation_stores_jpeg(self):
        self.s3.head_object.side_effect = ClientError({"Error": {"Code": "404"}}, "HeadObject")
        self.s3.get_object.return_value = {"ContentLength": 5, "Body": io.BytesIO(b"image")}
        with patch("cache.make_thumbnails", return_value={512: (b"jpeg", {})}) as generate:
            self.assertTrue(self.cache.ensure(IMAGE_ID, (512,)))
        generate.assert_called_once_with(b"image", [512])
        self.assertEqual(self.s3.put_object.call_args.kwargs["ContentType"], "image/jpeg")

    def test_kafka_and_http_share_cache(self):
        message = MagicMock()
        message.value.return_value = ('{"id":"' + IMAGE_ID + '"}').encode()
        process_message(message, self.cache)
        self.assertEqual(self.s3.head_object.call_count, 3)
        self.s3.get_object.assert_not_called()

    def test_tombstone_removes_all_variants(self):
        message = MagicMock()
        message.value.return_value = None
        message.key.return_value = IMAGE_ID.encode()
        process_message(message, self.cache)
        self.assertEqual(self.s3.delete_object.call_count, 3)

    def test_tombstone_does_not_hide_programming_errors(self):
        message = MagicMock()
        message.value.return_value = None
        message.key.return_value = IMAGE_ID.encode()
        self.cache.delete = MagicMock(side_effect=TypeError("broken deletion"))
        with self.assertRaisesRegex(TypeError, "broken deletion"):
            process_message(message, self.cache)

    def test_storage_failure_propagates(self):
        message = MagicMock()
        message.value.return_value = ('{"id":"' + IMAGE_ID + '"}').encode()
        self.s3.head_object.side_effect = EndpointConnectionError(endpoint_url="http://storage")
        with self.assertRaises(EndpointConnectionError):
            process_message(message, self.cache)


if __name__ == "__main__":
    unittest.main()
