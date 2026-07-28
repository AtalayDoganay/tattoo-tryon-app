"""Flask application factory for the background-removal API.

Public surface (unchanged response shape for the success case, so the existing
client keeps working):

    GET  /health      -> {"status": "ok"}
    POST /remove-bg   -> {"image": "data:image/png;base64,..."}

Errors changed shape deliberately: they now return a stable `code` plus a
`request_id` instead of a raw Python exception string. app/removebg.tsx maps
those codes to human text.
"""

from __future__ import annotations

import logging
import sys
import uuid

from flask import Flask, Response, g, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import config
from imaging import (
    ImageRejected,
    decode_base64_image,
    encode_png,
    load_validated_image,
    remove_background,
)
from security import authenticate

logger = logging.getLogger("bg_server")


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, config.log_level, logging.INFO))


def _rate_limit_key() -> str:
    """Rate-limit identity: the verified user when known, otherwise the IP.

    Keying on the user id stops one account from evading limits by rotating IPs,
    and stops everyone behind a shared NAT/CGNAT egress from sharing one bucket.
    The token itself is never used as a key -- keys end up in the storage
    backend and in logs, and a token is a live credential.
    """
    principal = getattr(g, "principal", None)
    if principal is not None:
        return f"user:{principal.user_id}"
    return f"ip:{get_remote_address()}"


def _dynamic_limit() -> str:
    """Anonymous callers get the stricter budget for this expensive endpoint."""
    return (
        config.rate_limit_authenticated
        if getattr(g, "principal", None) is not None
        else config.rate_limit_anonymous
    )


def _error(code: str, status: int) -> Response:
    response = jsonify({"code": code, "request_id": g.get("request_id", "")})
    response.status_code = status
    return response


def create_app() -> Flask:
    config.validate()
    _configure_logging()

    app = Flask(__name__)

    # Flask rejects a larger body before the view runs and before any of it is
    # buffered into memory.
    app.config["MAX_CONTENT_LENGTH"] = config.max_upload_bytes
    app.config["JSON_SORT_KEYS"] = False
    app.config["PROPAGATE_EXCEPTIONS"] = False

    # CORS is scoped to the one endpoint browsers call cross-origin. /health is
    # intentionally excluded: nothing needs to read it from a page.
    # supports_credentials stays False -- this API authenticates with a bearer
    # token, never with cookies, so credentialed CORS is unnecessary (and would
    # be forbidden alongside a wildcard origin anyway).
    CORS(
        app,
        resources={r"/remove-bg": {"origins": config.allowed_origins}},
        methods=["POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        supports_credentials=False,
        max_age=600,
    )

    # Registered BEFORE the limiter so that g.principal is populated by the time
    # the limiter evaluates its key function and per-role limit.
    @app.before_request
    def attach_request_context() -> None:
        g.request_id = uuid.uuid4().hex
        g.principal = authenticate(request.headers.get("Authorization"))

    limiter = Limiter(
        key_func=_rate_limit_key,
        default_limits=[config.rate_limit_default],
        storage_uri=config.ratelimit_storage_uri,
        strategy="fixed-window",
        # Fail closed. With swallow_errors=True a Redis outage would silently
        # turn every limit off, which is precisely when abuse is cheapest.
        swallow_errors=False,
        headers_enabled=True,
    )
    limiter.init_app(app)

    @app.after_request
    def set_security_headers(response: Response) -> Response:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers["Referrer-Policy"] = "no-referrer"
        # This is a JSON API; nothing here should ever be framed or render HTML.
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    # ---- routes ------------------------------------------------------------

    @app.get("/health")
    @limiter.exempt
    def health() -> Response:
        # Deliberately minimal: no version, no config, no dependency status.
        # A health endpoint is unauthenticated and public, so anything it
        # reports is reconnaissance.
        return jsonify({"status": "ok"})

    @app.post("/remove-bg")
    @limiter.limit(_dynamic_limit)
    def remove_bg() -> Response:
        # CORS is enforced by the browser, not the server: without this check a
        # hostile page could still make a visitor's browser trigger a full rembg
        # run and burn our CPU, even though the browser would refuse to hand it
        # the result. Rejecting up front makes that pointless.
        #
        # Only requests that actually carry an Origin are judged. Native mobile
        # clients send none, and must keep working.
        origin = request.headers.get("Origin")
        if origin and origin not in config.allowed_origins:
            return _error("origin_not_allowed", 403)

        if config.require_auth and g.principal is None:
            return _error("unauthorized", 401)

        if not request.is_json:
            return _error("invalid_request", 415)

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("invalid_request", 400)

        image_field = payload.get("image")
        if not isinstance(image_field, str):
            return _error("invalid_request", 400)

        try:
            raw = decode_base64_image(image_field)
            image = load_validated_image(raw)
            result = remove_background(image)
            return jsonify({"image": encode_png(result)})
        except ImageRejected as rejected:
            # Expected, client-caused outcome: log the code only, never the image.
            logger.info(
                "image_rejected code=%s request_id=%s", rejected.code, g.request_id
            )
            return _error(rejected.code, rejected.status)
        except Exception:
            # Unexpected: full traceback to the server log, nothing to the client.
            logger.exception("processing_failed request_id=%s", g.request_id)
            return _error("processing_failed", 500)

    # ---- error handlers ----------------------------------------------------

    @app.errorhandler(400)
    def handle_bad_request(_e: object) -> Response:
        return _error("invalid_request", 400)

    @app.errorhandler(404)
    def handle_not_found(_e: object) -> Response:
        return _error("not_found", 404)

    @app.errorhandler(405)
    def handle_method_not_allowed(_e: object) -> Response:
        return _error("method_not_allowed", 405)

    @app.errorhandler(413)
    def handle_payload_too_large(_e: object) -> Response:
        return _error("payload_too_large", 413)

    @app.errorhandler(429)
    def handle_rate_limited(_e: object) -> Response:
        return _error("rate_limited", 429)

    @app.errorhandler(500)
    def handle_internal_error(_e: object) -> Response:
        return _error("processing_failed", 500)

    return app
