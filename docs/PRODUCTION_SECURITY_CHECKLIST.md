# Production Security Checklist

Everything here must be done **by hand** in a provider dashboard. None of it can
be committed to this repository, and none of it was done for you.

Supabase has its own document: [`SUPABASE_SECURITY_CHECKLIST.md`](../SUPABASE_SECURITY_CHECKLIST.md).

---

> ## ⚠️ Current state: section 1 is NOT deployed
>
> **The background-removal API is not running.** Its Railway host answers
> `404 Application not found` (`x-railway-fallback: true`), meaning no
> application is bound to that domain.
>
> Because of that, the feature is **deliberately disabled in the app**: the
> home-screen entry point is removed and `/removebg` shows
> "Background removal is temporarily unavailable." without contacting any
> backend. See the top of [`README.md`](../README.md).
>
> Everything in section 1 below therefore describes the **target** configuration
> to apply when the service is redeployed — none of it is currently in effect,
> and none of it has been verified against a live service. Do not treat section 1
> as passing.
>
> The rest of this document (Vercel, Supabase, and the app-level controls) **is**
> live and verified.

---

## 1. Railway — background-removal API *(not currently deployed — see note above)*

### 1.1 Environment variables

Railway → your service → **Variables**. These are read by `bg_server/config.py`.

| Variable | Value | Required |
| --- | --- | --- |
| `APP_ENV` | `production` | **Yes** — turns on the startup safety checks |
| `ALLOWED_ORIGINS` | `https://<your-app>.vercel.app` (comma-separate extras, no trailing slash, no `*`) | **Yes** |
| `RATELIMIT_STORAGE_URI` | `redis://...` from a Railway Redis service | **Yes** |
| `REQUIRE_AUTH` | `true` | Strongly recommended |
| `SUPABASE_PROJECT_REF` | `bntoeowrvvhuaypddxnl` | If `REQUIRE_AUTH=true` |
| `SUPABASE_ANON_KEY` | the publishable key | Only for legacy HS256 projects |
| `RATE_LIMIT_ANONYMOUS` | `5 per hour` | Optional |
| `RATE_LIMIT_AUTHENTICATED` | `30 per hour` | Optional |
| `MAX_UPLOAD_BYTES` | `8388608` | Optional |
| `LOG_LEVEL` | `INFO` | Optional |

> With `APP_ENV=production` the service **refuses to boot** if `ALLOWED_ORIGINS`
> is empty or `*`, or if `RATELIMIT_STORAGE_URI` is still `memory://`. That is
> deliberate: a server that starts with open CORS and per-worker rate limiting
> looks healthy while protecting nothing.

### 1.2 Add Redis

Railway → **New** → **Database** → **Redis**, then reference its connection URL
as `RATELIMIT_STORAGE_URI`.

Without it, each Gunicorn worker keeps its own counter, so the real limit is
`workers x configured limit` and resets on every deploy.

### 1.3 Verify the deployment

```bash
# 1. Health check works.
curl -i https://<your-service>.up.railway.app/health
# Expect: 200, body exactly {"status":"ok"} — no version, no config.

# 2. Gunicorn is serving, not Flask's dev server.
curl -sI https://<your-service>.up.railway.app/health | grep -i server
# Expect: gunicorn. If it says "Werkzeug", the Dockerfile CMD is being
# overridden — check that Railway's Start Command is EMPTY.

# 3. A disallowed browser origin gets no CORS grant.
curl -sI -X POST https://<your-service>.up.railway.app/remove-bg \
  -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  -d '{"image":"x"}' | grep -i access-control-allow-origin
# Expect: no output.

# 4. Errors carry no internals.
curl -s -X POST https://<your-service>.up.railway.app/remove-bg \
  -H 'Content-Type: application/json' -d '{"image":"!!!!"}'
# Expect: {"code":"invalid_base64","request_id":"..."} — no traceback.

# 5. Auth is enforced (when REQUIRE_AUTH=true).
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://<your-service>.up.railway.app/remove-bg \
  -H 'Content-Type: application/json' -d '{"image":"x"}'
# Expect: 401.

# 6. Rate limiting engages.
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST \
    https://<your-service>.up.railway.app/remove-bg \
    -H 'Content-Type: application/json' -d '{"image":"x"}'
done; echo
# Expect: 429 before the twelfth request.
```

**Important:** leave Railway's **Start Command** blank. The previous
`railway.json` set `python server.py`, which ran Flask's single-threaded
development server in production; that override has been removed so the
Dockerfile's Gunicorn `CMD` is used.

---

## 2. Vercel — web app

### 2.1 Environment variables

Vercel → Project → **Settings** → **Environment Variables**:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://bntoeowrvvhuaypddxnl.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** key |
| `EXPO_PUBLIC_BG_SERVER_URL` | `https://<your-service>.up.railway.app` |

Every `EXPO_PUBLIC_*` value is compiled into the JavaScript bundle and is
public. **Never add a `service_role` key, a JWT secret, or any provider token
to this list**, with or without the prefix — Vercel exposes build-time env to
the bundler.

### 2.2 Security headers

`vercel.json` now sets HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, a `Permissions-Policy` that still allows the camera, and two
CSP headers.

**The Content-Security-Policy is deliberately split:**

- **Enforced:** `frame-ancestors 'none'; object-src 'none'; base-uri 'self';
  form-action 'self'` — clickjacking, plugin and base-tag protection. These
  cannot break the app.
- **Report-Only:** the complete policy covering scripts, workers, WASM and
  connections.

It is Report-Only because this app genuinely needs `'unsafe-eval'`:
`lib/faceJeeliz.ts` and `app/tryon-webcam.tsx` both use
`new Function('u', 'return import(u)')` to load ES modules from a CDN in a way
Metro will not try to bundle. MediaPipe additionally needs `wasm-unsafe-eval`
and `blob:` workers. Enforcing a policy this permissive on `script-src` buys
little, and enforcing a stricter one would break the AR try-on outright.

**To promote it to enforced**, do this after deploying:

1. Open the deployed site, exercise **every** feature: home slideshow, gallery,
   tattoo detail, Sketchfab statue try-on, webcam body try-on, face try-on,
   background removal, manager sign-in and upload.
2. Watch the browser console for `Content Security Policy` report entries.
3. Add any missing origin to the Report-Only policy and redeploy.
4. Only when a full pass produces zero reports, rename the
   `Content-Security-Policy-Report-Only` key to `Content-Security-Policy` and
   merge it with the enforced entry.

Origins currently allowed (all verified as actually used):

| Origin | Used by |
| --- | --- |
| `cdn.jsdelivr.net` | MediaPipe Pose + tasks-vision, Three.js |
| `appstatic.jeeliz.com` | Jeeliz FaceFilter and its neural-net model |
| `storage.googleapis.com` | MediaPipe face landmarker `.task` model |
| `*.supabase.co` | database, auth, storage |
| `*.up.railway.app` | background-removal API |
| `sketchfab.com` | statue try-on iframe |
| `blob:` / `data:` | camera frames, canvas output, WASM workers |

If your Railway domain is custom, replace `*.up.railway.app` with it.

### 2.3 Verify

```bash
curl -sI https://<your-app>.vercel.app | grep -iE 'strict-transport|x-content-type|referrer-policy|permissions-policy|content-security'
```

---

## 3. GitHub — repository settings

`gh` was not installed on the audit machine, so none of this could be checked or
changed automatically. Do it in the web UI. All of it is free for public repos.

### 3.1 Security features

**Settings → Advanced Security** (or **Code security and analysis**):

| Feature | Set to | Why |
| --- | --- | --- |
| Secret scanning | **Enabled** | GitHub notifies you when a known credential format is pushed. |
| Push protection | **Enabled** | Blocks the push *before* the secret is public. This is the single highest-value setting here. |
| Dependabot alerts | **Enabled** | Vulnerability notifications. |
| Dependabot security updates | **Enabled** | Automatic fix PRs. |
| Private vulnerability reporting | **Enabled** | The intake channel `SECURITY.md` points at. |
| CodeQL | Leave to the workflow | `.github/workflows/codeql.yml` is committed; do not also enable Default Setup or the two will conflict. |

### 3.2 Branch protection for `main`

**Settings → Rules → Rulesets → New branch ruleset**, target `main`:

- Require a pull request before merging (1 approval, or 0 if you work solo —
  the value is that CI must pass first)
- Require status checks to pass:
  - `gitleaks`
  - `Analyze (javascript-typescript)`
  - `Analyze (python)`
  - `Lint, types, and hygiene`
  - `Background-removal API tests`
- Require branches to be up to date before merging
- Block force pushes
- Restrict deletions

On **"Allow administrators to bypass"**: leaving it on means you can push
straight to `main` and skip every check above — which is how an unreviewed
change reaches production at 2am. Leave it **off** unless you have a specific
reason, and understand that turning it on makes the ruleset advisory for you.

### 3.3 Actions hardening

**Settings → Actions → General**:

- Workflow permissions: **Read repository contents permission** (default
  read-only). Every workflow in this repo declares the scopes it needs.
- Uncheck "Allow GitHub Actions to create and approve pull requests".
- Fork pull request workflows: require approval for **all** outside
  collaborators.

The workflows in this branch already follow the rules the audit checked for:
every action is pinned to a full commit SHA with the version in a comment
beside it, no workflow uses `pull_request_target`, no workflow interpolates
issue or PR text into a shell command, and the gitleaks job uploads no artifact
(a public repo's artifacts are public, so a leak report would publish the leak).

---

## 4. Expo / EAS — before the first mobile build

Not yet configured (`eas.json` does not exist), listed so it is not forgotten:

- Store the Android keystore and iOS certificates in **EAS credentials**, never
  in the repo. `.gitignore` blocks `*.jks`, `*.p8`, `*.p12`, `*.keystore`, and
  `*.mobileprovision`.
- Set `EXPO_PUBLIC_*` values as EAS build environment variables.
- Never put `EXPO_TOKEN` in a committed workflow file; use a repository secret.

---

## 5. Ongoing

| Cadence | Task |
| --- | --- |
| Every PR | CI, CodeQL, and gitleaks must be green. |
| Weekly | Triage Dependabot PRs. |
| Monthly | Re-run the Supabase security advisor; re-run `supabase/tests/rls_negative_tests.sql`. |
| Quarterly | Rotate manager passwords; review who owns which shop; rebuild the Railway image so base-image patches land. |
| On any exposure | Rotate the credential **first**. See the incident section of `SECURITY.md`. |
