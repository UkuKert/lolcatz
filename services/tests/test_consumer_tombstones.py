"""Test actual consumer handlers without importing ML or OCR dependencies."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, MagicMock, patch

from ocr import ocr
from tagger import tagger


class TombstoneTests(unittest.TestCase):
    def handler(self, service):
        module = tagger if service == "tagger" else ocr
        read_image = Mock(side_effect=OSError("storage reached"))
        if service == "tagger":
            self.enterContext(patch.object(module, "read_image", read_image))
        db, s3, producer = MagicMock(), Mock(), Mock()
        db.cursor.return_value.__enter__.return_value.fetchone.return_value = ("b",)
        s3.get_object.side_effect = OSError("storage reached")
        args = [db, s3, "images"]
        args += [Mock(), .4, producer, "tags"] if service == "tagger" else ["eng"]
        return module.process_message, args, [db, s3, producer, read_image]

    def test_tombstones_skip_storage_and_tagger_forwards_deletion(self):
        for service in ("ocr", "tagger"):
            with self.subTest(service=service):
                handler, args, dependencies = self.handler(service)
                handler(SimpleNamespace(value=lambda: None, key=lambda: b"image"), *args)
                db, s3, producer, read_image = dependencies
                for dependency in (db, s3, read_image):
                    self.assertEqual(dependency.mock_calls, [])
                if service == "tagger":
                    producer.produce.assert_called_once_with("tags", key=b"image", value=None)
                else:
                    self.assertEqual(producer.mock_calls, [])

    def test_upload_events_still_reach_storage(self):
        for service in ("ocr", "tagger"):
            with self.subTest(service=service):
                handler, args, _ = self.handler(service)
                with self.assertRaisesRegex(OSError, "storage reached"):
                    handler(SimpleNamespace(value=lambda: b'{"id":"test","board":"b"}'), *args)

    def test_deleted_images_have_no_storage_or_publish_side_effects(self):
        for service in ("ocr", "tagger"):
            with self.subTest(service=service):
                handler, args, dependencies = self.handler(service)
                db, s3, producer, read_image = dependencies
                db.cursor.return_value.__enter__.return_value.fetchone.return_value = None
                handler(SimpleNamespace(value=lambda: b'{"id":"test","board":"b"}'), *args)
                for dependency in (s3, producer, read_image):
                    self.assertEqual(dependency.mock_calls, [])

    def test_empty_payload_is_not_a_tombstone(self):
        for service in ("ocr", "tagger"):
            with self.subTest(service=service):
                handler, args, _ = self.handler(service)
                with self.assertRaises(json.JSONDecodeError):
                    handler(SimpleNamespace(value=lambda: b""), *args)


if __name__ == "__main__":
    unittest.main()
