"""Environment-driven configuration for the background-removal API.

Every tunable lives here so that no module reads os.environ directly and so the
production safety checks live in exactly one place.

Design rule: defaults are safe for local development, and `Config.validate()`
refuses to start in production when a development-only default would silently
weaken security (open CORS, per-process rate limiting).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


class ConfigError(RuntimeError):
    """Raised when the process is misconfigured for the environment it runs in."""


@dataclass(frozen=True)
class Config:
    # ---- environment -------------------------------------------------------
    env: str = os.environ.get("APP_ENV", "development").strip().lower()
    log_level: str = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    port: int = _env_int("PORT", 5001)

    # ---- CORS --------------------------------------------------------------
    # Exact origins only (scheme + host + port). Browsers enforce this; native
    # mobile clients are unaffected because they are not subject to CORS.
    allowed_origins: list[str] = field(default_factory=lambda: _env_list("ALLOWED_ORIGINS"))

    # ---- authentication ----------------------------------------------------
    require_auth: bool = _env_bool("REQUIRE_AUTH", False)
    supabase_project_ref: str = os.environ.get("SUPABASE_PROJECT_REF", "").strip()
    # Explicit override; otherwise derived from the project ref.
    supabase_url: str = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    supabase_anon_key: str = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    jwt_leeway_seconds: int = _env_int("JWT_LEEWAY_SECONDS", 10)

    # ---- rate limiting -----------------------------------------------------
    # memory:// is per-process. Under Gunicorn with N workers the effective
    # limit becomes N x the configured value, so production must use Redis.
    ratelimit_storage_uri: str = os.environ.get("RATELIMIT_STORAGE_URI", "memory://").strip()
    rate_limit_default: str = os.environ.get("RATE_LIMIT_DEFAULT", "120 per hour").strip()
    rate_limit_authenticated: str = os.environ.get(
        "RATE_LIMIT_AUTHENTICATED", "30 per hour"
    ).strip()
    rate_limit_anonymous: str = os.environ.get("RATE_LIMIT_ANONYMOUS", "5 per hour").strip()

    # ---- image intake limits ----------------------------------------------
    max_upload_bytes: int = _env_int("MAX_UPLOAD_BYTES", 8 * 1024 * 1024)
    max_image_pixels: int = _env_int("MAX_IMAGE_PIXELS", 16_000_000)
    max_image_dimension: int = _env_int("MAX_IMAGE_DIMENSION", 6000)
    process_timeout_seconds: int = _env_int("PROCESS_TIMEOUT_SECONDS", 25)

    @property
    def is_production(self) -> bool:
        return self.env in {"production", "prod"}

    @property
    def auth_base_url(self) -> str:
        """Base URL of the Supabase Auth server, or '' when unconfigured."""
        if self.supabase_url:
            return self.supabase_url
        if self.supabase_project_ref:
            return f"https://{self.supabase_project_ref}.supabase.co"
        return ""

    @property
    def jwks_url(self) -> str:
        base = self.auth_base_url
        return f"{base}/auth/v1/.well-known/jwks.json" if base else ""

    @property
    def issuer(self) -> str:
        base = self.auth_base_url
        return f"{base}/auth/v1" if base else ""

    def validate(self) -> None:
        """Fail fast on configurations that are unsafe for production.

        Raising here is deliberate: a server that boots with open CORS or
        per-worker rate limiting looks healthy while providing none of the
        protection it is supposed to provide.
        """
        if not self.is_production:
            return

        problems: list[str] = []

        if not self.allowed_origins:
            problems.append(
                "ALLOWED_ORIGINS is empty. Set the exact browser origins that may "
                "call this API (native apps do not need an entry)."
            )

        if any(origin == "*" for origin in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS contains '*', which is not allowed in production.")

        if self.ratelimit_storage_uri.startswith("memory://"):
            problems.append(
                "RATELIMIT_STORAGE_URI is memory://, which is per-worker and does not "
                "limit anything across a multi-worker deployment. Point it at Redis."
            )

        if self.require_auth and not self.auth_base_url:
            problems.append(
                "REQUIRE_AUTH is on but neither SUPABASE_PROJECT_REF nor SUPABASE_URL is set, "
                "so access tokens cannot be verified."
            )

        if problems:
            raise ConfigError(
                "Refusing to start in production:\n  - " + "\n  - ".join(problems)
            )


config = Config()
