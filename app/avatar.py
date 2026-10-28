"""Profile photos: decode an uploaded image, crop it square and re-encode it as a small WebP.

Re-encoding (rather than storing what was sent) strips EXIF data such as GPS position, and means only a clean,
known-format image is ever served back. Photos are kept in the database (about 20-60 KB each), which is plenty
for a few thousand members; object storage (e.g. Cloudflare R2) only pays off far beyond that.
"""
from __future__ import annotations

import base64
import binascii
import io

from PIL import Image, ImageOps, UnidentifiedImageError

SIZE = 512                  # stored photos are SIZE x SIZE
MAX_UPLOAD = 2_000_000      # decoded bytes accepted (the client already shrinks photos to well under this)
MAX_PIXELS = 40_000_000     # refuse decompression bombs before decoding
FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}


class AvatarError(ValueError):
    pass


def decode_data_url(data: str) -> bytes:
    """Accept a data: URL or bare base64."""
    if data.startswith("data:"):
        _, _, data = data.partition(",")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise AvatarError("That photo could not be read.")
    if not raw:
        raise AvatarError("That photo is empty.")
    if len(raw) > MAX_UPLOAD:
        raise AvatarError("That photo is too large.")
    return raw


def process(raw: bytes) -> bytes:
    """Any JPEG / PNG / WebP / GIF in, a SIZE x SIZE WebP out (centre-cropped, EXIF orientation applied)."""
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.format not in FORMATS:
                raise AvatarError("Use a JPEG, PNG or WebP photo.")
            if im.width * im.height > MAX_PIXELS:
                raise AvatarError("That photo is too large.")
            im.seek(0)
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
            if im.mode == "RGBA":  # flatten transparency onto white
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.getchannel("A"))
                im = bg
            im = ImageOps.fit(im, (SIZE, SIZE), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            im.save(out, "WEBP", quality=82, method=4)
            return out.getvalue()
    except AvatarError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise AvatarError("That photo could not be read.")


def process_photo(raw: bytes, max_side: int = 1280) -> bytes:
    """A listing photo: any JPEG / PNG / WebP / GIF in, a WebP no larger than max_side out (aspect kept, EXIF
    orientation applied, metadata such as GPS dropped)."""
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.format not in FORMATS:
                raise AvatarError("Use a JPEG, PNG or WebP photo.")
            if im.width * im.height > MAX_PIXELS:
                raise AvatarError("That photo is too large.")
            im.seek(0)
            im = ImageOps.exif_transpose(im)
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.getchannel("A"))
                im = bg
            else:
                im = im.convert("RGB")
            im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            im.save(out, "WEBP", quality=80, method=4)
            return out.getvalue()
    except AvatarError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise AvatarError("That photo could not be read.")
