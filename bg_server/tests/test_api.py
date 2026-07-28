"""Negative-path tests for the background-removal API.

Every test here asserts that a hostile or malformed request is refused, and
that the refusal says nothing about the server's internals. The one positive
test exists so a "reject everything" regression cannot pass the suite.
"""

from __future__ import annotations

import base64
import importlib
import io
import os

import pytest

from conftest import as_data_url, png_bytes

# Substrings that must never appear in a client-facing error body. If any of
# these leaks, an attacker learns the stack, the file layout, or the exception.
LEAK_MARKERS = [
    "Traceback",
    "File \"",
    "site-packages",
    "rembg",
    "PIL",
    "flask",
    "Exception",
    "/app/",
    "line ",
]


def assert_no_internals(response) -> None:
    body = response.get_data(as_text=True)
    for marker in LEAK_MARKERS:
        assert marker not in body, f"error response leaked {marker!r}: {body}"


def post_image(client, image_field, **kwargs):
    return client.post("/remove-bg", json={"image": image_field}, **kwargs)


# ---------------------------------------------------------------------------
# Request shape
# ---------------------------------------------------------------------------

def test_health_is_minimal(client):
    response = client.get("/health")
    assert response.status_code == 200
    # Exactly one key: no version, no config, no dependency status.
    assert response.get_json() == {"status": "ok"}


def test_invalid_json_body_is_rejected(client):
    response = client.post(
        "/remove-bg", data="{not json", content_type="application/json"
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_request"
    assert_no_internals(response)


def test_non_json_content_type_is_rejected(client):
    response = client.post("/remove-bg", data="image=abc",
                           content_type="application/x-www-form-urlencoded")
    assert response.status_code == 415
    assert_no_internals(response)


def test_missing_image_field_is_rejected(client):
    response = client.post("/remove-bg", json={})
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_request"


def test_wrongly_typed_image_field_is_rejected(client):
    response = client.post("/remove-bg", json={"image": 12345})
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_request"


def test_json_array_body_is_rejected(client):
    response = client.post("/remove-bg", json=[1, 2, 3])
    assert response.status_code == 400
    assert_no_internals(response)


# ---------------------------------------------------------------------------
# Payload / image validation
# ---------------------------------------------------------------------------

def test_invalid_base64_is_rejected(client):
    response = post_image(client, "!!!! not base64 !!!!")
    assert response.status_code == 400
    assert response.get_json()["code"] in {"invalid_base64", "invalid_request"}
    assert_no_internals(response)


def test_valid_base64_that_is_not_an_image_is_rejected(client):
    payload = base64.b64encode(b"this is plain text, not an image").decode()
    response = post_image(client, payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_image"
    assert_no_internals(response)


def test_oversized_payload_is_rejected_before_decoding(client):
    # Larger than MAX_UPLOAD_BYTES (1 MiB in the test config).
    oversized = "A" * (2 * 1024 * 1024)
    response = post_image(client, oversized)
    assert response.status_code == 413
    assert response.get_json()["code"] == "payload_too_large"
    assert_no_internals(response)


def test_excessive_dimensions_are_rejected(client):
    # 2500px exceeds MAX_IMAGE_DIMENSION (2000) but stays a small file.
    raw = png_bytes(width=2500, height=10)
    response = post_image(client, as_data_url(raw))
    assert response.status_code == 413
    assert response.get_json()["code"] == "image_too_large"


def test_unsupported_format_is_rejected(client):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), "white").save(buffer, format="BMP")
    response = post_image(client, as_data_url(buffer.getvalue(), "image/bmp"))
    assert response.status_code == 415
    assert response.get_json()["code"] == "unsupported_format"


def test_animated_multiframe_image_is_rejected(client):
    from PIL import Image

    frames = [Image.new("RGB", (16, 16), c) for c in ("white", "black")]
    buffer = io.BytesIO()
    frames[0].save(buffer, format="WEBP", save_all=True, append_images=frames[1:])
    response = post_image(client, as_data_url(buffer.getvalue(), "image/webp"))
    assert response.status_code == 415
    assert response.get_json()["code"] == "unsupported_format"


def test_svg_is_rejected(client):
    """SVG can carry script; a public-read pipeline must never accept it."""
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    response = post_image(client, as_data_url(svg, "image/svg+xml"))
    assert response.status_code in {400, 415}
    assert response.get_json()["code"] in {"unsupported_format", "invalid_image"}


def test_decompression_bomb_is_rejected(client):
    """A tiny file declaring an enormous canvas must not be decoded.

    Built by hand: a real 40000x40000 PNG cannot be generated in a test, which
    is exactly the asymmetry that makes decompression bombs dangerous.
    """
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", 40000, 40000, 8, 2, 0, 0, 0)
    bomb = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00" * 1024))
        + chunk(b"IEND", b"")
    )

    response = post_image(client, as_data_url(bomb))
    assert response.status_code in {400, 413}
    assert response.get_json()["code"] in {"image_too_large", "invalid_image"}
    assert_no_internals(response)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_valid_small_image_succeeds(client, small_png):
    response = post_image(client, as_data_url(small_png))
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["image"].startswith("data:image/png;base64,")
    # Private processing output must not be cached by a proxy or the browser.
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_output_carries_no_exif_or_gps(client):
    """Uploaded photos routinely carry GPS; the result must not."""
    from PIL import Image

    buffer = io.BytesIO()
    image = Image.new("RGB", (32, 32), "white")
    exif = Image.Exif()
    exif[0x010E] = "secret camera comment"
    image.save(buffer, format="JPEG", exif=exif)

    response = post_image(client, as_data_url(buffer.getvalue(), "image/jpeg"))
    assert response.status_code == 200

    encoded = response.get_json()["image"].split(",", 1)[1]
    result = Image.open(io.BytesIO(base64.b64decode(encoded)))
    assert not result.getexif()
    assert "exif" not in result.info
    assert b"secret camera comment" not in base64.b64decode(encoded)


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

def test_allowed_origin_is_echoed(client, small_png):
    response = post_image(
        client, as_data_url(small_png), headers={"Origin": "https://allowed.example"}
    )
    assert response.headers.get("Access-Control-Allow-Origin") == "https://allowed.example"


def test_disallowed_origin_is_rejected_outright(client, small_png):
    """No CORS grant, and the expensive work is never performed."""
    response = post_image(
        client, as_data_url(small_png), headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    assert response.get_json()["code"] == "origin_not_allowed"
    assert response.headers.get("Access-Control-Allow-Origin") not in {
        "*",
        "https://evil.example",
    }
    assert_no_internals(response)


def test_request_without_origin_still_works(client, small_png):
    """Native mobile clients send no Origin header and must not be blocked."""
    response = post_image(client, as_data_url(small_png))
    assert response.status_code == 200


def test_preflight_from_disallowed_origin_is_not_granted(client):
    response = client.options(
        "/remove-bg",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("Access-Control-Allow-Origin") != "*"
    assert response.headers.get("Access-Control-Allow-Origin") != "https://evil.example"


# ---------------------------------------------------------------------------
# Authentication (REQUIRE_AUTH=true)
# ---------------------------------------------------------------------------

@pytest.fixture()
def auth_client(monkeypatch):
    """An app instance built with REQUIRE_AUTH=true."""
    monkeypatch.setenv("REQUIRE_AUTH", "true")
    monkeypatch.setenv("SUPABASE_PROJECT_REF", "testref")

    import config as config_module
    importlib.reload(config_module)
    import security
    importlib.reload(security)
    import imaging
    importlib.reload(imaging)
    import app as app_module
    importlib.reload(app_module)

    application = app_module.create_app()
    application.config.update(TESTING=True)
    yield application.test_client()

    # Restore module state for the rest of the session.
    monkeypatch.delenv("REQUIRE_AUTH", raising=False)
    monkeypatch.delenv("SUPABASE_PROJECT_REF", raising=False)
    importlib.reload(config_module)
    importlib.reload(security)
    importlib.reload(imaging)
    importlib.reload(app_module)


def test_missing_token_is_unauthorized(auth_client, small_png):
    response = auth_client.post("/remove-bg", json={"image": as_data_url(small_png)})
    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"
    assert_no_internals(response)


def test_garbage_token_is_unauthorized(auth_client, small_png):
    response = auth_client.post(
        "/remove-bg",
        json={"image": as_data_url(small_png)},
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert response.status_code == 401


def test_unsigned_alg_none_token_is_rejected(auth_client, small_png):
    """The classic JWT downgrade: alg=none must never be accepted."""
    import jwt as pyjwt

    forged = pyjwt.encode({"sub": "attacker", "aud": "authenticated"}, key="", algorithm="none")
    response = auth_client.post(
        "/remove-bg",
        json={"image": as_data_url(small_png)},
        headers={"Authorization": f"Bearer {forged}"},
    )
    assert response.status_code == 401


def test_self_signed_token_is_rejected(auth_client, small_png):
    """A token signed with an attacker-chosen key must fail JWKS verification."""
    import jwt as pyjwt

    forged = pyjwt.encode(
        {"sub": "attacker", "aud": "authenticated", "exp": 9999999999},
        key="attacker-chosen-secret",
        algorithm="HS256",
    )
    response = auth_client.post(
        "/remove-bg",
        json={"image": as_data_url(small_png)},
        headers={"Authorization": f"Bearer {forged}"},
    )
    # HS256 routes to introspection, which fails against a non-existent project.
    assert response.status_code == 401


def test_malformed_authorization_scheme_is_rejected(auth_client, small_png):
    response = auth_client.post(
        "/remove-bg",
        json={"image": as_data_url(small_png)},
        headers={"Authorization": "Basic dXNlcjpwYXNz"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

@pytest.fixture()
def throttled_client(monkeypatch):
    """An app instance with a 2-request anonymous budget."""
    monkeypatch.setenv("RATE_LIMIT_ANONYMOUS", "2 per hour")
    monkeypatch.setenv("RATE_LIMIT_DEFAULT", "1000 per hour")

    import config as config_module
    importlib.reload(config_module)
    import security
    importlib.reload(security)
    import imaging
    importlib.reload(imaging)
    import app as app_module
    importlib.reload(app_module)

    application = app_module.create_app()
    application.config.update(TESTING=True)
    yield application.test_client()

    monkeypatch.delenv("RATE_LIMIT_ANONYMOUS", raising=False)
    importlib.reload(config_module)
    importlib.reload(security)
    importlib.reload(imaging)
    importlib.reload(app_module)


def test_rate_limit_returns_429_without_internals(throttled_client, small_png):
    payload = {"image": as_data_url(small_png)}
    statuses = [
        throttled_client.post("/remove-bg", json=payload).status_code for _ in range(4)
    ]
    assert 429 in statuses, f"rate limit never triggered: {statuses}"

    limited = throttled_client.post("/remove-bg", json=payload)
    assert limited.status_code == 429
    assert limited.get_json()["code"] == "rate_limited"
    assert_no_internals(limited)


def test_health_is_exempt_from_rate_limiting(throttled_client):
    for _ in range(6):
        assert throttled_client.get("/health").status_code == 200


# ---------------------------------------------------------------------------
# Production configuration guardrails
# ---------------------------------------------------------------------------

def test_production_refuses_wildcard_cors_and_memory_limiter(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    monkeypatch.setenv("RATELIMIT_STORAGE_URI", "memory://")

    import config as config_module
    importlib.reload(config_module)

    with pytest.raises(config_module.ConfigError) as excinfo:
        config_module.config.validate()

    message = str(excinfo.value)
    assert "ALLOWED_ORIGINS" in message
    assert "memory://" in message

    monkeypatch.setenv("APP_ENV", "development")
    importlib.reload(config_module)


def test_unknown_route_returns_generic_error(client):
    response = client.get("/../../etc/passwd")
    assert response.status_code in {308, 400, 404}
    assert_no_internals(response)
