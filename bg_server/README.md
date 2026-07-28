# Background Removal Server

Flask API that strips the background from a tattoo photo. Two paths: a fast
brightness threshold for black ink on light paper, and `rembg` (u2net) for
everything else.

## Layout

| File | Role |
| --- | --- |
| `config.py` | All environment configuration + production safety checks |
| `security.py` | Supabase access-token verification (JWKS, or introspection for legacy HS256 projects) |
| `imaging.py` | Image intake validation, background removal, metadata stripping |
| `app.py` | Flask app factory: CORS, rate limiting, routes, error handlers |
| `wsgi.py` | Gunicorn entrypoint (production) |
| `server.py` | Local development entrypoint only |
| `tests/` | pytest suite — mostly adversarial input tests |

## Local development

```bash
cd bg_server
python -m venv .venv && . .venv/Scripts/activate   # Windows
pip install -r requirements-dev.txt

export ALLOWED_ORIGINS=http://localhost:8081
python server.py
```

Listens on `http://127.0.0.1:5001`. Set `DEV_HOST=0.0.0.0` to reach it from a
phone on the same network.

```bash
python -m pytest tests/ -q
```

The tests deliberately avoid the `rembg` path (a ~200 MB install) by using
light-background fixtures, so they run in under a second.

## Production

Gunicorn, from the Dockerfile — **never** `python server.py`. `server.py`
refuses to start when `APP_ENV=production`.

```bash
gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 2 --timeout 60 wsgi:app
```

With `APP_ENV=production`, the process **will not start** unless:

- `ALLOWED_ORIGINS` is set and contains no `*`, and
- `RATELIMIT_STORAGE_URI` points at Redis rather than `memory://`.

That is intentional. A per-worker in-memory limiter and open CORS make the
service look healthy while providing none of the protection they imply.

Full deployment steps: [`../docs/PRODUCTION_SECURITY_CHECKLIST.md`](../docs/PRODUCTION_SECURITY_CHECKLIST.md).

## Configuration

Every variable, its default and its meaning is documented in
[`../.env.example`](../.env.example) under "SERVER ONLY". Set them in Railway's
Variables tab, never in a committed file.

## API

### `GET /health`

```json
{ "status": "ok" }
```

Deliberately minimal — it is unauthenticated and public, so anything it reports
is reconnaissance. Exempt from rate limiting.

### `POST /remove-bg`

```jsonc
// Request
{ "image": "data:image/png;base64,..." }   // bare base64 also accepted

// 200
{ "image": "data:image/png;base64,..." }

// Error — never a Python exception string
{ "code": "invalid_base64", "request_id": "9f2c..." }
```

Send `Authorization: Bearer <supabase access token>` when signed in. Required
when `REQUIRE_AUTH=true`; otherwise it still upgrades the caller from the
anonymous rate-limit bucket to the authenticated one.

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `invalid_request` | 400 / 415 | Body is not JSON, or `image` is missing/not a string |
| `invalid_base64` | 400 | `image` is not valid base64 |
| `invalid_image` | 400 | Decodes, but is not a readable image |
| `unsupported_format` | 415 | Not PNG/JPEG/WebP, or multi-frame |
| `payload_too_large` | 413 | Body or decoded image exceeds the limit |
| `image_too_large` | 413 | Too many pixels or too many px per side |
| `unauthorized` | 401 | `REQUIRE_AUTH=true` and no valid token |
| `origin_not_allowed` | 403 | Browser `Origin` is not in `ALLOWED_ORIGINS` |
| `rate_limited` | 429 | Budget exhausted |
| `processing_timeout` | 504 | Removal exceeded `PROCESS_TIMEOUT_SECONDS` |
| `processing_failed` | 500 / 502 | Unexpected server-side failure |

`app/removebg.tsx` maps these codes to user-facing text.

## Security notes

- **CORS** is an allowlist scoped to `/remove-bg` only, read from
  `ALLOWED_ORIGINS`. Native mobile clients are not subject to CORS and need no
  entry.
- **Rate limiting** keys on the verified user id when authenticated and the IP
  otherwise, so rotating IPs does not reset an account's budget and users behind
  one NAT do not share a bucket. Tokens are never used as keys. The limiter is
  configured with `swallow_errors=False`: if Redis goes down, requests fail
  rather than silently becoming unlimited.
- **Image intake** bounds the base64 string before decoding, decodes strictly,
  promotes Pillow's decompression-bomb warning to an error, allowlists
  PNG/JPEG/WebP, rejects multi-frame files, and caps dimensions and total
  pixels.
- **Metadata** — output is rebuilt from raw pixels, dropping EXIF (including
  GPS), XMP, ICC and comments. See [`../PRIVACY.md`](../PRIVACY.md).
- **No disk writes.** Images live in memory for the request and are then
  garbage collected.
- **Errors** return a stable `code` and a `request_id`. Tracebacks go to the
  server log only.
- **Logs** never contain image data, tokens, `Authorization` headers, cookies,
  or environment values.
- **Container** runs as uid 10001, not root.
