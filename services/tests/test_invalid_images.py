import io
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from PIL import Image
from image_input import InvalidImage, decode_image, read_bytes
from ocr import ocr
from tagger import tagger
import worker_runtime


class InvalidImageTests(unittest.TestCase):
    def test_corrupt_image_is_committed_and_next_event_is_processed(self):
        for module in (ocr, tagger):
            with self.subTest(worker=module.__name__):
                db, s3, producer = MagicMock(), Mock(), Mock()
                # First image exists but is corrupt; second has been deleted.
                db.cursor.return_value.__enter__.return_value.fetchone.side_effect = [("b",), None]
                body = io.BytesIO(b"not an image")
                s3.get_object.return_value = {"Body": body}
                args = [db, s3, "images"]
                args += ["eng"] if module is ocr else [Mock(), .4, producer, "tags"]
                messages = [Mock(), Mock()]
                for index, message in enumerate(messages):
                    message.error.return_value = None
                    message.value.return_value = ('{"id":"image-%s"}' % index).encode()
                consumer = Mock()
                consumer.poll.side_effect = messages
                stopped = threading.Event()
                consumer.commit.side_effect = lambda **kw: stopped.set() if kw["message"] is messages[1] else None
                with patch.object(worker_runtime, "start_exporter", return_value=(Mock(), Mock())):
                    worker_runtime.consume(consumer, lambda message: module.process_message(message, *args), stopped)
                self.assertEqual(consumer.commit.call_count, 2)
                self.assertTrue(body.closed)
                producer.produce.assert_not_called()

    def test_storage_failure_remains_retryable(self):
        for module in (ocr, tagger):
            with self.subTest(worker=module.__name__):
                db, s3 = MagicMock(), Mock()
                db.cursor.return_value.__enter__.return_value.fetchone.return_value = ("b",)
                s3.get_object.side_effect = OSError("storage offline")
                args = [db, s3, "images"]
                args += ["eng"] if module is ocr else [Mock(), .4, Mock(), "tags"]
                with self.assertRaisesRegex(OSError, "storage offline"):
                    module.process_message(SimpleNamespace(value=lambda: b'{"id":"test"}'), *args)

    def test_image_limits_and_valid_decode(self):
        encoded = io.BytesIO()
        Image.new("RGB", (3, 2)).save(encoded, "PNG")
        with decode_image(encoded.getvalue()) as image:
            self.assertEqual(image.size, (3, 2))
        with patch("image_input.MAX_PIXELS", 5), self.assertRaises(InvalidImage):
            decode_image(encoded.getvalue())
        for length in (None, 10):
            body = io.BytesIO(b"0123456789")
            response = {"Body": body}
            if length is not None:
                response["ContentLength"] = length
            s3 = Mock()
            s3.get_object.return_value = response
            with patch("image_input.MAX_BYTES", 5), self.assertRaises(InvalidImage):
                read_bytes(s3, "bucket", "key")
            self.assertTrue(body.closed)
