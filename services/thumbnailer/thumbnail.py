"""Square previews using libjpeg-turbo scaled IDCT, retaining YCbCr."""
import io
import math
from time import perf_counter
import warnings

from PIL import Image, ImageOps
from metrics import THUMBNAIL_GENERATION

SIZES = (256, 512, 1024)
VERSION = "v1"
Image.MAX_IMAGE_PIXELS = 50_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


class InvalidImage(ValueError):
    pass


def object_key(image_id, size):
    name = "preview" if size == 1024 else str(size)
    return f"_thumbnails/{VERSION}/{image_id}/{name}.jpg"


def make_thumbnails(data, sizes=SIZES):
    if not sizes or any(size not in SIZES for size in sizes):
        raise ValueError("unsupported thumbnail size")
    started = perf_counter()
    try:
        with Image.open(io.BytesIO(data)) as source:
            original_size = source.size
            divisor = 1
            while math.ceil(max(source.size) / divisor) > 1024 and divisor < 8:
                divisor *= 2
            # Must precede load/transpose/convert. Retain JPEG YCbCr (or L)
            # through crop, resize and encode, avoiding an RGB round trip.
            source.draft("YCbCr", tuple(max(1, d // divisor) for d in source.size))
            decoded_size = source.size
            image = ImageOps.exif_transpose(source)
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            if image.mode in ("RGBA", "LA", "P"):
                rgba = image.convert("RGBA")
                image = Image.new("RGB", rgba.size, "white")
                image.paste(rgba, mask=rgba.getchannel("A"))
            elif image.mode not in ("YCbCr", "L", "RGB"):
                image = image.convert("RGB")
            mode = image.mode
            # Strip EXIF/GPS, orientation and comments from derived files.
            icc = source.info.get("icc_profile") if source.mode != "CMYK" else None
            image.info.clear()
            preparation_seconds = perf_counter() - started
            results = {}
            for size in sizes:
                variant_started = perf_counter()
                if size == 1024:
                    crop = image.copy()  # Uncropped detail preview, already <= 1024px.
                else:
                    side = min(size, *image.size)
                    side = max(1, side - side % 8) if side >= 8 else side
                    crop = ImageOps.fit(image, (side, side), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                crop.save(output, "JPEG", quality=82, subsampling=2, icc_profile=icc)
                THUMBNAIL_GENERATION.labels(size=str(size)).observe(
                    preparation_seconds + perf_counter() - variant_started)
                results[size] = (output.getvalue(), {
                    "original": original_size, "decoded": decoded_size,
                    "output": crop.size, "mode": mode,
                })
            return results
    except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise InvalidImage(str(error)) from error


def make_thumbnail(data, size):
    return make_thumbnails(data, (size,))[size]
