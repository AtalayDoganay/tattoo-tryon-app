# Security and Hardening

Source: https://github.com/addyosmani/agent-skills/tree/main/skills/security-and-hardening

## Three-Tier Boundary System

### Always Do
- Validate external input (user uploads, API responses, URL params)
- Parameterize queries (Supabase client handles this; never string-interpolate SQL)
- Use HTTPS for all external calls
- Hash passwords — never store plain text (Supabase Auth handles this)
- Keep secrets out of version control — use `.env`, gitignored
- Scope Supabase queries to the authenticated user

### Ask First (requires human approval)
- Changes to authentication flow
- New external integrations (new APIs, OAuth providers)
- CORS policy changes
- File upload permission changes
- Any new data stored about users

### Never Do
- Commit API keys, service role keys, or secrets to git
- Log user PII (emails, phone numbers, auth tokens)
- Trust client-side validation as a security boundary
- Use `eval()` or `innerHTML` with untrusted data
- Store auth tokens in `localStorage` (use Supabase's secure storage)
- Expose stack traces or internal errors to the UI

## Supabase-Specific Rules

```tsx
// WRONG — reads all rows (bypasses RLS intent in client)
const { data } = await supabase.from('tattoos').select('*');

// RIGHT — filter by auth user
const { data: { user } } = await supabase.auth.getUser();
const { data } = await supabase
  .from('tattoos')
  .select('*')
  .eq('user_id', user.id);
```

Enable RLS on every table. Default-deny. Grant only what's needed.

## Environment Variables

```
# Client-safe (bundled into app) — use EXPO_PUBLIC_ prefix
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_BG_SERVER_URL=...

# Server-only (never in Expo app)
SUPABASE_SERVICE_ROLE_KEY=...  # only in bg_server/.env
```

Never use `SUPABASE_SERVICE_ROLE_KEY` in the Expo app. It bypasses RLS.

## File Upload Security (Python Server)

```python
ALLOWED_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB

# Validate before processing
if content_type not in ALLOWED_TYPES:
    return jsonify({'error': 'Invalid file type'}), 400
if len(image_data) > MAX_SIZE_BYTES:
    return jsonify({'error': 'File too large'}), 400
```

## Input Validation (Expo App)

URL params from `useLocalSearchParams` are untrusted strings. Validate before use:
```tsx
const { tattooBase64 } = useLocalSearchParams<{ tattooBase64: string }>();
if (!tattooBase64?.startsWith('data:image/')) {
  // handle invalid input
}
```

## Secrets Checklist
- [ ] `.env` in `.gitignore` ✓
- [ ] `.env.example` committed with placeholder values ✓
- [ ] No service role key in Expo app code
- [ ] Supabase anon key used client-side (safe — RLS enforces security)
- [ ] Python server reads secrets from env, not hardcoded
- [ ] No auth tokens logged or displayed in UI

## Pre-Ship Security Review
- [ ] RLS enabled on all Supabase tables
- [ ] File uploads validated (type + size)
- [ ] URL params validated before use
- [ ] No secrets in source code (`git grep -r "eyJ"` to check for JWTs)
- [ ] Error messages don't expose internals to users
