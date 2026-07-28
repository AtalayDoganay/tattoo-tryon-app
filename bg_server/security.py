"""Caller authentication for the background-removal API.

Verifies Supabase user access tokens. Two verification paths are supported
because Supabase projects sign tokens differently depending on age:

  * Asymmetric (ES256 / RS256) -- current default. The signature is checked
    against the project's published JWKS. No secret is needed on this server,
    and after the first fetch there is no per-request network call.

  * Symmetric (HS256) -- legacy projects. Verifying locally would require
    SUPABASE_JWT_SECRET, a credential that can mint any user's session. Rather
    than hold it, the token is introspected against Supabase's own
    /auth/v1/user endpoint, which is an official server-side check.

In both cases the signature, issuer and expiry are validated. A token is never
merely decoded and trusted.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

import jwt
import requests
from jwt import PyJWKClient

from config import config

logger = logging.getLogger(__name__)

# Supabase mints user tokens with aud="authenticated".
EXPECTED_AUDIENCE = "authenticated"
_ASYMMETRIC_ALGS = {"ES256", "RS256", "EdDSA"}
_INTROSPECT_TIMEOUT = 5
_INTROSPECT_CACHE_TTL = 60


@dataclass(frozen=True)
class Principal:
    """An authenticated caller. `user_id` is the Supabase auth uid (JWT `sub`)."""

    user_id: str


class _JwksCache:
    """Lazily-built PyJWKClient. PyJWKClient does its own key caching."""

    def __init__(self) -> None:
        self._client: PyJWKClient | None = None
        self._lock = threading.Lock()

    def client(self) -> PyJWKClient | None:
        if not config.jwks_url:
            return None
        with self._lock:
            if self._client is None:
                self._client = PyJWKClient(config.jwks_url, cache_keys=True)
            return self._client


_jwks = _JwksCache()

# token -> (user_id, expires_at). Bounds the number of introspection calls for
# the legacy HS256 path. Only successful verifications are cached, and only for
# a minute, so a revoked session stops working quickly.
_introspect_cache: dict[str, tuple[str, float]] = {}
_introspect_lock = threading.Lock()


def _verify_asymmetric(token: str) -> Principal | None:
    client = _jwks.client()
    if client is None:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=sorted(_ASYMMETRIC_ALGS),
            audience=EXPECTED_AUDIENCE,
            issuer=config.issuer,
            leeway=config.jwt_leeway_seconds,
            options={"require": ["exp", "sub"]},
        )
    except Exception as exc:  # noqa: BLE001 - any failure means "not authenticated"
        # Log the failure class only. The token itself is a bearer credential
        # and must never be written to a log.
        logger.info("jwt_verification_failed", extra={"reason": type(exc).__name__})
        return None

    sub = claims.get("sub")
    return Principal(user_id=str(sub)) if sub else None


def _verify_by_introspection(token: str) -> Principal | None:
    base = config.auth_base_url
    if not base or not config.supabase_anon_key:
        return None

    now = time.monotonic()
    with _introspect_lock:
        cached = _introspect_cache.get(token)
        if cached and cached[1] > now:
            return Principal(user_id=cached[0])

    try:
        response = requests.get(
            f"{base}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": config.supabase_anon_key,
            },
            timeout=_INTROSPECT_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.warning("introspection_unavailable", extra={"reason": type(exc).__name__})
        return None

    if response.status_code != 200:
        return None

    try:
        user_id = response.json().get("id")
    except ValueError:
        return None
    if not user_id:
        return None

    with _introspect_lock:
        # Simple bound so a flood of distinct tokens cannot grow this without limit.
        if len(_introspect_cache) > 1024:
            _introspect_cache.clear()
        _introspect_cache[token] = (str(user_id), now + _INTROSPECT_CACHE_TTL)

    return Principal(user_id=str(user_id))


def extract_bearer_token(authorization_header: str | None) -> str | None:
    """Pulls the token out of an `Authorization: Bearer <token>` header."""
    if not authorization_header:
        return None
    parts = authorization_header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def authenticate(authorization_header: str | None) -> Principal | None:
    """Returns the verified caller, or None when the request is not authenticated.

    Never raises: an unverifiable token is simply not authenticated.
    """
    token = extract_bearer_token(authorization_header)
    if not token:
        return None

    try:
        header = jwt.get_unverified_header(token)
    except Exception:  # noqa: BLE001 - malformed token
        return None

    # The algorithm is read from the untrusted header only to choose which
    # verifier to run. Each verifier then pins its own accepted algorithms, so
    # an attacker cannot downgrade to "none" or swap ES256 for HS256.
    alg = header.get("alg")
    if alg in _ASYMMETRIC_ALGS:
        return _verify_asymmetric(token)
    if alg == "HS256":
        return _verify_by_introspection(token)
    return None
