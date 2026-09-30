import io
import unittest
from unittest.mock import patch

from PIL import Image, features

from thumbnail import make_thumbnail, make_thumbnails, InvalidImage
from metrics import REGISTRY


class ThumbnailTests(unittest.TestCase):
    def test_generation_latency_by_size_includes_shared_decode_but_not_other_variants(self):
        data = self.jpeg((800, 600))
        metric = "lolcatz_thumbnail_generation_duration_seconds"
        sizes = (256, 512, 1024)
        def sample(size, suffix):
            return REGISTRY.get_sample_value(metric + suffix, {"size": str(size)}) or 0
        before = {size: (sample(size, "_count"), sample(size, "_sum")) for size in sizes}
        # 200ms shared preparation, then 100ms, 300ms and 400ms per variant.
        with patch("thumbnail.perf_counter", side_effect=[10, 10.2, 11, 11.1, 12, 12.3, 13, 13.4]):
            make_thumbnails(data, sizes)
        for size, elapsed in zip(sizes, (.3, .5, .6)):
            self.assertEqual(sample(size, "_count") - before[size][0], 1)
            self.assertAlmostEqual(sample(size, "_sum") - before[size][1], elapsed)

    def jpeg(self, size=(4000, 3000), orientation=None, mode="RGB"):
        image = Image.new(mode, size, 100 if mode == "L" else "red")
        exif = Image.Exif()
        if orientation:
            exif[274] = orientation
        output = io.BytesIO()
        image.save(output, "JPEG", exif=exif)
        return output.getvalue()

    def test_scaled_dct_decode_keeps_ycbcr_and_makes_both_squares(self):
        self.assertTrue(features.check_feature("libjpeg_turbo"))
        results = make_thumbnails(self.jpeg(), (256, 512))
        for size, (encoded, dims) in results.items():
            self.assertEqual(dims["decoded"], (1000, 750))
            self.assertEqual(dims["mode"], "YCbCr")
            with Image.open(io.BytesIO(encoded)) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertEqual(image.size, (size, size))
                r, g, b = image.getpixel((size // 2, size // 2))
                self.assertGreater(r, 240)
                self.assertLess(g + b, 20)

    def test_detail_preview_is_uncropped_and_bounded(self):
        encoded, dims = make_thumbnail(self.jpeg(), 1024)
        self.assertEqual(dims["output"], (1000, 750))
        with Image.open(io.BytesIO(encoded)) as image:
            self.assertEqual(image.size, (1000, 750))

    def test_applies_orientation_and_strips_exif(self):
        source = Image.new("RGB", (800, 800), "red")
        source.paste("blue", (0, 400, 800, 800))
        exif = Image.Exif()
        exif[274] = 6
        data = io.BytesIO()
        source.save(data, "JPEG", exif=exif)
        encoded, _ = make_thumbnail(data.getvalue(), 256)
        with Image.open(io.BytesIO(encoded)) as image:
            self.assertEqual(dict(image.getexif()), {})
            self.assertGreater(image.getpixel((32, 128))[2], 240)
            self.assertGreater(image.getpixel((224, 128))[0], 240)

    def test_small_and_skinny_images_never_upscale(self):
        for original, expected in [((100, 50), (48, 48)), ((6000, 4000), (496, 496))]:
            _, dims = make_thumbnail(self.jpeg(original), 512)
            self.assertEqual(dims["output"], expected)
            self.assertLessEqual(max(dims["decoded"]), 1024)

    def test_center_crop(self):
        source = Image.new("RGB", (768, 256), "red")
        source.paste("blue", (256, 0, 512, 256))
        data = io.BytesIO()
        source.save(data, "JPEG")
        encoded, _ = make_thumbnail(data.getvalue(), 256)
        with Image.open(io.BytesIO(encoded)) as image:
            self.assertGreater(image.getpixel((128, 128))[2], 240)
            self.assertGreater(image.getpixel((16, 128))[2], 240)

    def test_grayscale_stays_grayscale(self):
        encoded, dims = make_thumbnail(self.jpeg(mode="L"), 256)
        self.assertEqual(dims["mode"], "L")
        with Image.open(io.BytesIO(encoded)) as image:
            self.assertEqual(image.mode, "L")

    def test_transparency_is_composited_on_white(self):
        data = io.BytesIO()
        Image.new("RGBA", (32, 16), (0, 0, 0, 0)).save(data, "PNG")
        encoded, _ = make_thumbnail(data.getvalue(), 256)
        with Image.open(io.BytesIO(encoded)) as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_invalid_input_and_sizes_are_rejected(self):
        with self.assertRaises(ValueError):
            make_thumbnail(self.jpeg(), 999)
        with self.assertRaises(InvalidImage):
            make_thumbnail(b"not an image", 256)


if __name__ == "__main__":
    unittest.main()
