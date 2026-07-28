# Supabase Security Checklist

> **Status: NOTHING IN THIS DOCUMENT HAS BEEN APPLIED.**
>
> During the hardening audit, the Supabase project `bntoeowrvvhuaypddxnl`
> ("TattoAPP") was **INACTIVE (paused)**. The live schema could not be read, so
> the SQL under `supabase/migrations/` is a **reviewed draft written from the
> application source only** — it has never run against your database.
>
> A paused project also makes the Supabase security advisor return an empty
> list. That empty list is **not** evidence that the database is secure; it is
> an artefact of the project being asleep. Do not read it as a pass.

---

## What the app actually touches

Everything below was derived by reading every Supabase call in the codebase.
Nothing was assumed, and no table or bucket name was invented.

| Object | Kind | Columns / paths used | Where |
| --- | --- | --- | --- |
| `public.shops` | table | `id`, `name`, `slug`, `owner_user_id` | `lib/tattoo-data.ts`, `app/manager/index.tsx`, `app/tattoo/[id].tsx` |
| `public.tattoos` | table | `id`, `shop_id`, `name`, `style`, `description`, `image_url`, `created_at` | `app/(tabs)/index.tsx`, `app/gallery.tsx`, `app/tattoo/[id].tsx`, `app/tryon/[id].tsx`, `app/manager/index.tsx` |
| `tattoo-images` | storage bucket | objects at `<auth.uid()>/<file>` | `app/manager/index.tsx` |

There are **no RPC / `.rpc()` calls**, no database functions called from the
client, and no other tables or buckets referenced anywhere in the app.

### There is no `published` column today

`lib/types.ts` declares `Tattoo.published`, but that interface types only the
hard-coded `placeholderTattoos` demo array. The real row type, `DbTattoo`, has
no such field; no query filters on it and the manager insert never sets it.

**So today every tattoo row is public.** Migration `...0003` adds the column and
narrows the read policy, but it is marked OPTIONAL because it also needs UI work
to be useful. Decide deliberately — do not assume drafts are already private.

---

## The authorization model

There is intentionally **no `role` or `is_manager` column**. "Manager" is
structural:

> You manage a shop **iff** `public.shops.owner_user_id = auth.uid()`.

This is what makes the "user promotes themselves to manager" attack
unrepresentable rather than merely blocked:

- no `INSERT` policy on `shops` for `anon` or `authenticated` → you cannot
  create a shop and become its owner;
- the `UPDATE` policy on `shops` has `USING (owner_user_id = auth.uid())` **and**
  `WITH CHECK (owner_user_id = auth.uid())` → you cannot repoint an existing
  shop at yourself, and you cannot give yours away;
- writes to `tattoos` require `public.owns_shop(shop_id)`.

Shop provisioning is deliberately an admin action (dashboard or `service_role`).

The React Native screens still check for a session — that is **UX only**. A
screen guard runs on the attacker's own device and can be bypassed by calling
PostgREST directly with the publishable key. RLS is the real boundary.

---

## Apply the migrations

### Step 1 — Wake the project

Dashboard → the project → **Restore / Resume**. A paused project cannot be
audited or secured.

### Step 2 — Look at what is there now

Run in **SQL Editor**. This is read-only.

```sql
-- Which tables have RLS enabled?
select relname,
       relrowsecurity  as rls_enabled,
       relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
order by relname;

-- Existing policies.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- What anon/authenticated can currently do, regardless of policies.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- Does the tattoos table have a published column?
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'tattoos'
order by ordinal_position;

-- Bucket configuration.
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
```

**Compare that output against the migration drafts before running anything.**
If your schema differs from the table above — extra columns, extra tables, an
existing policy set — reconcile first. The drafts drop policies by name; a
policy of yours with a different name would survive and remain in force
alongside the new one (policies are permissive and additive).

### Step 3 — Apply

Either with the CLI:

```bash
supabase link --project-ref bntoeowrvvhuaypddxnl
supabase db push        # applies everything in supabase/migrations/
```

…or by pasting each file into the SQL Editor **in order**:

1. `supabase/migrations/20260728000001_enable_rls_core.sql`
2. `supabase/migrations/20260728000002_storage_policies.sql`
3. `supabase/migrations/20260728000003_optional_published_flag.sql` — **only if
   you want drafts.** Read the header first.

### Step 4 — Prove it works

Open `supabase/tests/rls_negative_tests.sql`, fill in the three ids in the
CONFIGURE block, and run the whole file in the SQL Editor. It ends in
`ROLLBACK`, so it writes nothing.

It asserts that:

- anonymous visitors cannot insert, update, or delete;
- a signed-in non-manager cannot create a shop, take over a shop, or write into
  someone else's shop;
- anonymous storage uploads fail;
- a user cannot write into another user's storage folder;
- a non-manager cannot use the bucket as free file hosting;
- **and** that a real manager can still add, edit, and delete their own tattoos.

That last group matters: a policy set that denies everything would otherwise
look like a pass.

### Step 5 — Re-run the advisor

Dashboard → **Advisors** → **Security**. Now that the project is awake, the
result is meaningful. Expect zero "RLS disabled in public schema" findings.

---

## Dashboard settings to change by hand

These cannot be set from SQL.

### Authentication

| Setting | Where | Value | Why |
| --- | --- | --- | --- |
| Confirm email | Authentication → Sign In / Providers → Email | **On** | Stops sign-up with an address the registrant does not control. |
| Enable sign-ups | Authentication → Sign In / Providers | **Off** | Managers are provisioned by you. Nothing in this app needs public self-registration, and leaving it on lets anyone create an `authenticated` session to probe your policies with. |
| MFA | Authentication → Multi-Factor | Enrol every manager (TOTP) | A manager account can edit and delete all of a shop's content. |
| Password strength | Authentication → Policies | Minimum 10+, leaked-password protection **On** | Blocks credential stuffing with known-breached passwords. |
| Auth rate limits | Authentication → Rate Limits | Lower "Sign in / Sign up" from the default | Slows password guessing. `app/login.tsx` already renders 429s as "too many attempts". |
| JWT expiry | Authentication → Sessions | 3600 s access token; enable refresh-token rotation | Shortens the useful life of a stolen token. |
| Site URL / Redirect URLs | Authentication → URL Configuration | Exact production web URL + `tattootryonapp://` | An open redirect allowlist lets an attacker capture an auth code. |

### API keys

- **Never** issue the `service_role` / `sb_secret_*` key to the app, a browser,
  or CI logs. It bypasses every policy in this document.
- The publishable (anon) key is expected to be public. Rotating it is not a
  security fix; correct RLS is.

### Storage

Confirm on the `tattoo-images` bucket after migration `...0002`:

- Public: **on** (the gallery uses `getPublicUrl`)
- File size limit: **8 MB**
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp` — and **not**
  `image/svg+xml`. A public-read bucket that serves SVG is a stored-XSS vector
  on the Supabase origin.

### Edge Function

`supabase/functions/remove-background` has been hardened in this branch (origin
allowlist, token required, bounded input, generic errors). After deploying:

```bash
supabase secrets set HUGGINGFACE_TOKEN=...            # server-side only
supabase secrets set ALLOWED_ORIGINS=https://your-app.vercel.app
supabase functions deploy remove-background            # keeps verify_jwt on
```

Do **not** deploy it with `--no-verify-jwt`.

---

## Residual risk, stated plainly

| Risk | Status |
| --- | --- |
| Every tattoo row is readable by anyone | **Accepted by default.** The app has no draft concept. Apply migration `...0003` to change this. |
| `shops.owner_user_id` (a user UUID) is readable by anonymous visitors | **Accepted.** The home screen does `select('*')`; revoking the column would break it. A UUID is not a credential, but it does confirm that a given user id owns a shop. |
| Rate limiting on PostgREST reads | **Not addressed here.** Supabase applies platform-level limits; per-user API throttling would need an edge proxy. |
| These policies verified against the live database | **No.** Project was paused. Step 4 above is the verification, and it has not been run. |
