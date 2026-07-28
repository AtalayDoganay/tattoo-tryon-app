"""Image intake validation and background removal.

Untrusted image bytes are the highest-risk input this service accepts, so the
decode path is deliberately conservative:

  1. Bound the base64 string BEFORE decoding, so a huge payload never becomes a
     huge allocation.
  2. Strict base64 decoding, so malformed input is rejected rather than
     silently truncated.
  3. Pillow's decompression-bomb guard is promoted from a warning to an error.
     A 40 KB PNG can otherwise declare 100000x100000 pixels and exhaust memory.
  4. verify() first, then reopen. Pillow requires this: verify() consumes the
     file object and the instance cannot be used afterwards.
  5. Format allowlist (PNG/JPEG/WebP) and per-side + total-pixel caps.
  6. Multi-frame files (animated GIF/WebP, multi-page TIFF) are rejected --
     nothing downstream expects more than one frame.
  7. Output is rebuilt from raw pixel data, which drops EXIF, GPS, XMP, ICC
     profiles and comments. Uploaded photos routinely carry GPS coordinates;
     returning them inside the "cleaned" image would leak the user's location.

Nothing is written to disk: every buffer stays in memory and is garbage
collected with the request.
"""

from __future__ import annotations

import base64
import binascii
import io
import warnings
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

import numpy as np
from PIL import Image

from config import config

# Formats we are willing to decode. SVG is absent on purpose: it is a document
# format that can carry script and remote references, not a raster image.
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}

# Promote Pillow's decompression-bomb warning to an exception, and cap the
# pixel count it will consider at all.
Image.MAX_IMAGE_PIXELS = config.max_image_pixels
warnings.simplefilter("error", Image.DecompressionBombWarning)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="bgremove")


class ImageRejected(Exception):
    """Input failed validation. `code` is the stable identifier sent to clients."""

    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def decode_base64_image(image_field: str) -> bytes:
    """Decodes a base64 (or data-URL) image field into bytes, with size bounds."""
    if not isinstance(image_field, str) or not image_field:
        raise ImageRejected("invalid_request")

    # Accept "data:image/png;base64,AAAA" as well as a bare payload.
    if "," in image_field[:128]:
        image_field = image_field.split(",", 1)[1]

    payload = "".join(image_field.split())

    # 4 base64 chars encode 3 bytes; check the string length first so an
    # oversized payload is refused without ever being decoded.
    max_b64_len = (config.max_upload_bytes * 4) // 3 + 8
    if len(payload) > max_b64_len:
        raise ImageRejected("payload_too_large", status=413)
    if not payload:
        raise ImageRejected("invalid_request")

    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageRejected("invalid_base64") from exc

    if not raw:
        raise ImageRejected("invalid_request")
    if len(raw) > config.max_upload_bytes:
        raise ImageRejected("payload_too_large", status=413)
    return raw


def _reject_oversized(image: Image.Image) -> None:
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ImageRejected("invalid_image")
    if width > config.max_image_dimension or height > config.max_image_dimension:
        raise ImageRejected("image_too_large", status=413)
    if width * height > config.max_image_pixels:
        raise ImageRejected("image_too_large", status=413)


def load_validated_image(raw: bytes) -> Image.Image:
    """Validates then returns a usable, metadata-free RGBA image."""
    # Pass 1: structural verification. verify() leaves the instance unusable,
    # which is why a second open follows.
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = probe.format
            if fmt not in ALLOWED_FORMATS:
                raise ImageRejected("unsupported_format", status=415)
            _reject_oversized(probe)
            if getattr(probe, "n_frames", 1) > 1:
                raise ImageRejected("unsupported_format", status=415)
            probe.verify()
    except ImageRejected:
        raise
    except Image.DecompressionBombWarning as exc:
        raise ImageRejected("image_too_large", status=413) from exc
    except Exception as exc:  # noqa: BLE001 - any decode failure is a bad image
        raise ImageRejected("invalid_image") from exc

    # Pass 2: real decode.
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            _reject_oversized(opened)
            # load() forces full decode here, inside our error handling, rather
            # than lazily somewhere downstream.
            opened.load()
            converted = opened.convert("RGBA")
    except ImageRejected:
        raise
    except Image.DecompressionBombWarning as exc:
        raise ImageRejected("image_too_large", status=413) from exc
    except Exception as exc:  # noqa: BLE001
        raise ImageRejected("invalid_image") from exc

    # Rebuild from the raw pixel buffer so no EXIF/GPS/XMP/ICC/comment block
    # survives: frombytes() produces an image whose `info` dict is empty.
    return Image.frombytes("RGBA", converted.size, converted.tobytes())


def _is_light_background(image: Image.Image) -> bool:
    rgb = image.convert("RGB")
    width, height = rgb.size
    corners = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((width - 1, 0)),
        rgb.getpixel((0, height - 1)),
        rgb.getpixel((width - 1, height - 1)),
        rgb.getpixel((width // 2, 0)),
        rgb.getpixel((width // 2, height - 1)),
    ]
    avg_brightness = sum(sum(c) / 3 for c in corners) / len(corners)
    return avg_brightness > 200


def _threshold_remove_bg(image: Image.Image) -> Image.Image:
    """Fast path for black ink on a light background (unchanged behaviour)."""
    data = np.array(image.convert("RGBA"))
    r, g, b = data[:, :, 0], data[:, :, 1], data[:, :, 2]
    brightness = (r.astype(int) + g.astype(int) + b.astype(int)) / 3

    data[:, :, 3] = np.where(brightness > 200, 0, 255).astype(np.uint8)

    mask = (brightness >= 128) & (brightness <= 200)
    data[:, :, 3][mask] = ((200 - brightness[mask]) / 72 * 255).astype(np.uint8)

    return Image.fromarray(data)


def _run_removal(image: Image.Image) -> Image.Image:
    if _is_light_background(image):
        return _threshold_remove_bg(image)
    # Imported lazily: rembg pulls in onnxruntime and the u2net model, which we
    # only want to touch when the AI path is actually taken.
    from rembg import remove

    return remove(image)


def remove_background(image: Image.Image) -> Image.Image:
    """Runs background removal under a soft timeout.

    The timeout returns control to the request handler so one pathological
    image cannot pin a worker indefinitely. It cannot forcibly kill the running
    thread -- Python has no safe way to do that -- so Gunicorn's --timeout
    remains the hard backstop that recycles a genuinely stuck worker.
    """
    future = _executor.submit(_run_removal, image)
    try:
        return future.result(timeout=config.process_timeout_seconds)
    except FutureTimeout as exc:
        raise ImageRejected("processing_timeout", status=504) from exc


def encode_png(image: Image.Image) -> str:
    """Serialises to a base64 PNG data URL, without metadata."""
    buffer = io.BytesIO()
    # pnginfo is omitted deliberately, so no text chunks are written.
    image.save(buffer, format="PNG", optimize=False)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
