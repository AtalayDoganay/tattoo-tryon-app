"""Shared pytest fixtures.

Environment variables are set BEFORE importing the application modules because
`config.Config` reads os.environ at class-definition time. Tests that need a
different configuration reimport the modules with a patched environment.
"""

from __future__ import annotations

import base64
import io
import os
import sys
from pathlib import Path

import pytest

# bg_server/ modules import each other by bare name ("from config import config"),
# matching how they run in the container.
BG_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(BG_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(BG_SERVER_ROOT))

# Test defaults: development mode, one known browser origin, generous limits so
# that only the tests which target rate limiting ever hit one.
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ALLOWED_ORIGINS", "https://allowed.example")
os.environ.setdefault("REQUIRE_AUTH", "false")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "1000 per hour")
os.environ.setdefault("RATE_LIMIT_ANONYMOUS", "1000 per hour")
os.environ.setdefault("RATE_LIMIT_AUTHENTICATED", "1000 per hour")
os.environ.setdefault("MAX_UPLOAD_BYTES", str(1024 * 1024))
os.environ.setdefault("MAX_IMAGE_DIMENSION", "2000")
os.environ.setdefault("MAX_IMAGE_PIXELS", "4000000")


@pytest.fixture()
def app():
    from app import create_app

    application = create_app()
    application.config.update(TESTING=True)
    return application


@pytest.fixture()
def client(app):
    return app.test_client()


def png_bytes(width: int = 32, height: int = 32, colour: str = "white") -> bytes:
    """A real PNG. `white` keeps the fast threshold path (no rembg needed)."""
    from PIL import Image

    image = Image.new("RGB", (width, height), colour)
    if colour == "white":
        # A dark mark so the threshold path produces a non-trivial alpha channel.
        for x in range(width // 4, width // 2):
            for y in range(height // 4, height // 2):
                image.putpixel((x, y), (0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def as_data_url(raw: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


@pytest.fixture()
def small_png() -> bytes:
    return png_bytes()
