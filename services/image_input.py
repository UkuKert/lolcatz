"""Bound image inputs and distinguish invalid files from transport failures."""
import io
import warnings

MAX_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 50_000_000


class InvalidImage(ValueError):
    """This input cannot be processed by an image worker."""


def read_bytes(s3, bucket, key):
    response = s3.get_object(Bucket=bucket, Key=key)
    with response["Body"] as body:
        if response.get("ContentLength", 0) > MAX_BYTES:
            raise InvalidImage("image exceeds input limit")
        data = body.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise InvalidImage("image exceeds input limit")
    return data


def decode_image(data):
    from PIL import Image, ImageOps

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise InvalidImage("image exceeds pixel limit")
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.load()
                return image
    except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise InvalidImage(str(error)) from error
