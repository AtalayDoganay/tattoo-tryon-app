# Supabase Live Divergence Report

**Project:** `bntoeowrvvhuaypddxnl` ("TattoAPP") · Postgres 17.6 · us-east-1
**Inspected:** 2026-07-30, read-only, project resumed from `INACTIVE` → `ACTIVE_HEALTHY`
**Branch compared:** `security/production-hardening`
**Status:** **NOTHING WAS APPLIED.** No DDL, no policy change, no grant/revoke, no storage
change, no data modification. Every statement run was a `SELECT` against catalogs.

All keys, tokens, connection strings, user UUIDs and object paths are omitted from this
document by design. Where identity mattered it was compared inside SQL and only the
boolean/count result recorded.

---

## 1. Headline

The audit that produced `supabase/migrations/` assumed an unsecured database, because the
project was paused and could not be read. **That assumption is wrong.** RLS is already
enabled on both tables and twelve policies already exist.

Every one of those twelve policies has a **different name** from the ones the drafts drop.
`DROP POLICY IF EXISTS` matches on name only, so **all twelve survive**. Postgres ORs
permissive policies together, so applying the drafts as written adds stricter rules
*alongside* the existing looser ones and the looser ones keep winning.

For `public.shops` / `public.tattoos` the survivors are semantically redundant — no harm.
For `storage.objects` the survivors include a wide-open upload policy, and its survival
**cancels the entire security benefit of migration `...0002`.**

---

## 2. Live state

### 2.1 Tables and RLS

| Object | RLS enabled | RLS forced | Owner |
|---|---|---|---|
| `public.shops` | **yes** | no | `postgres` |
| `public.tattoos` | **yes** | no | `postgres` |
| `storage.objects` | yes | no | `supabase_storage_admin` |
| `storage.buckets` | yes | no | `supabase_storage_admin` |

No views, no materialised views, no custom triggers in `public`, and no `public.owns_shop`
function. The only non-Supabase function is `public.rls_auto_enable()` (§4.9).

### 2.2 Columns

`public.shops` — `id uuid pk default gen_random_uuid()`, `name text not null`,
`slug text not null unique`, `owner_user_id uuid **nullable**` → FK `auth.users(id)`,
`created_at timestamptz default now()`

`public.tattoos` — `id uuid pk default gen_random_uuid()`, `shop_id uuid **nullable**` →
FK `shops(id) **on delete cascade**`, `name text not null`, `style text`, `description text`,
`image_url text`, `created_at timestamptz default now()`

**There is no `published` column.** The checklist's claim here is confirmed against the live
schema.

### 2.3 Live policies

`public.shops`

| Name | Cmd | Roles | USING | WITH CHECK |
|---|---|---|---|---|
| `shops_select_public` | SELECT | `public` | `true` | — |
| `shops_update_owner` | UPDATE | `public` | `owner_user_id = auth.uid()` | *(none — see note)* |
| `shops_delete_owner` | DELETE | `public` | `owner_user_id = auth.uid()` | — |

`public.tattoos`

| Name | Cmd | Roles | USING | WITH CHECK |
|---|---|---|---|---|
| `tattoos_select_public` | SELECT | `public` | `true` | — |
| `tattoos_insert_owner` | INSERT | `public` | — | `EXISTS(shops where id=shop_id and owner_user_id=auth.uid())` |
| `tattoos_update_owner` | UPDATE | `public` | same EXISTS | *(none — see note)* |
| `tattoos_delete_owner` | DELETE | `public` | same EXISTS | — |

`storage.objects`

| Name | Cmd | Roles | Expression |
|---|---|---|---|
| `storage_select_all` | SELECT | `public` | `bucket_id = 'tattoo-images'` |
| `tattoo_images_public_read` | SELECT | `public` | `bucket_id = 'tattoo-images'` |
| `storage_insert_authenticated` | INSERT | `authenticated` | **`bucket_id = 'tattoo-images'`** |
| `tattoo_images_auth_insert` | INSERT | `public` | **`bucket_id = 'tattoo-images' AND auth.uid() IS NOT NULL`** |
| `tattoo_images_owner_delete` | DELETE | `public` | `bucket_id = 'tattoo-images' AND auth.uid()::text = (storage.foldername(name))[1]` |

> **Note on the missing WITH CHECK.** For `UPDATE`, when `WITH CHECK` is omitted Postgres
> reuses the `USING` expression as the check. So `shops_update_owner` and
> `tattoos_update_owner` *do* block repointing `owner_user_id` / `shop_id` at someone else.
> The drafts state both clauses explicitly, which is better practice, but this is **not** a
> live vulnerability.

> **Note on `roles = public`.** `public` here is the SQL pseudo-role (everyone), not "anonymous".
> For `anon`, `auth.uid()` is NULL, so every ownership predicate evaluates to NULL → no rows.
> Anonymous write is therefore blocked, but by expression rather than by role targeting.

There are **no policies at all** on `storage.buckets`, so RLS there is deny-all for
`anon`/`authenticated` despite their grants.

### 2.4 Grants (`relacl`)

| Relation | anon | authenticated | service_role |
|---|---|---|---|
| `public.shops` | SELECT, **TRUNCATE**, REFERENCES, TRIGGER, MAINTAIN | **ALL** (incl. INSERT/UPDATE/DELETE/TRUNCATE) | **TRUNCATE, REFERENCES, TRIGGER, MAINTAIN only** |
| `public.tattoos` | SELECT, **TRUNCATE**, REFERENCES, TRIGGER, MAINTAIN | **ALL** | **TRUNCATE, REFERENCES, TRIGGER, MAINTAIN only** |
| `storage.objects` | ALL | ALL (granted twice: by `supabase_storage_admin` **and** by `postgres`) | ALL |
| `storage.buckets` | ALL | ALL (twice) | ALL |

### 2.5 Storage bucket

| Field | Live value | Draft `...0002` target |
|---|---|---|
| `public` | `true` | `true` (unchanged) |
| `file_size_limit` | **`NULL`** (unlimited) | `8388608` |
| `allowed_mime_types` | **`NULL`** (anything) | `image/jpeg, image/png, image/webp` |

### 2.6 Data reality (compatibility check for the drafts)

| Check | Result |
|---|---|
| shops / tattoos / auth users | 1 / 3 / 1 |
| shops with `owner_user_id IS NULL` | 0 |
| tattoos with `shop_id IS NULL` | 0 |
| objects in `tattoo-images` | 3 |
| objects whose first path segment is a UUID | 3 / 3 |
| objects sitting in a **shop-owner's** folder | 3 / 3 |
| objects at bucket root | 0 |
| distinct MIME types present | `image/jpeg` only |
| objects over 8 MiB | 0 |
| `tattoos.image_url` pointing outside the bucket | 0 |

**Every existing object already satisfies the stricter storage policies in `...0002`.** No
data migration or backfill is needed, and no existing image will 404.

### 2.7 Migration history

`supabase_migrations.schema_migrations` is **empty** — the live schema was built by hand,
not by these files. `supabase db push` would therefore attempt **all three** migrations,
including the one marked OPTIONAL.

---

## 3. Surviving-policy analysis (requirement 4)

Draft `DROP POLICY IF EXISTS` names vs live names — **zero overlap in either direction**:

| Draft drops | Live policy that actually exists | Survives? |
|---|---|---|
| `"shops: public read"` | `shops_select_public` | **yes** |
| `"shops: owner update"` | `shops_update_owner` | **yes** |
| *(no draft drop)* | `shops_delete_owner` | **yes** |
| `"tattoos: public read"` | `tattoos_select_public` | **yes** |
| `"tattoos: manager insert"` | `tattoos_insert_owner` | **yes** |
| `"tattoos: manager update"` | `tattoos_update_owner` | **yes** |
| `"tattoos: manager delete"` | `tattoos_delete_owner` | **yes** |
| `"tattoo-images: public read"` | `storage_select_all`, `tattoo_images_public_read` | **yes (both)** |
| `"tattoo-images: manager upload"` | `storage_insert_authenticated`, `tattoo_images_auth_insert` | **yes (both)** |
| `"tattoo-images: manager update"` | *(none exists)* | n/a |
| `"tattoo-images: manager delete"` | `tattoo_images_owner_delete` | **yes** |

Post-apply policy counts if the drafts run unchanged: `shops` 5, `tattoos` 7,
`storage.objects` 9.

**Net effect per table**

- `public.shops` — harmless duplication. The new grant line (`revoke all` then
  `grant select, update`) removes the DELETE **privilege**, which makes the surviving
  `shops_delete_owner` policy unreachable. Shop deletion stops working, which matches the
  drafts' intent, but it happens via the grant, not the policy.
- `public.tattoos` — harmless duplication; old and new policies are semantically equivalent.
- `storage.objects` — **not harmless.** `storage_insert_authenticated` requires only
  `bucket_id = 'tattoo-images'`. The new `"tattoo-images: manager upload"` policy adds
  folder-ownership and shop-ownership conditions, but because permissive policies are ORed,
  any signed-in user still passes via the old policy. **Migration `...0002` delivers no
  upload hardening whatsoever until the legacy policies are dropped by their real names.**
- **If `...0003` is ever applied**, surviving `tattoos_select_public` (`USING true`) fully
  defeats the `published` filter. Drafts would appear to work while every draft row stays
  publicly readable.

---

## 4. Findings

### 4.1 CRITICAL — Any signed-in user can upload anywhere in the bucket

`storage_insert_authenticated` (`WITH CHECK bucket_id = 'tattoo-images'`) and
`tattoo_images_auth_insert` (`… AND auth.uid() IS NOT NULL`) impose no path constraint and
no shop-ownership constraint. Any account that can sign up can:

- write objects into another manager's `<uid>/` folder, and
- use the bucket as free public file hosting.

Not mitigated by applying the drafts (§3). Requires dropping both legacy policies.

### 4.2 CRITICAL — Public bucket accepts any MIME type and any size

`allowed_mime_types IS NULL` and `file_size_limit IS NULL` on a `public = true` bucket.
Combined with 4.1, any signed-in user can upload `image/svg+xml` or `text/html` and get it
served from the Supabase origin — stored XSS against that origin — plus unbounded storage
cost. Draft `...0002`'s `update storage.buckets` **does** fix this and is the one part of
that file that works regardless of policy names.

### 4.3 HIGH — Migration `...0002` will likely abort on `ALTER TABLE storage.objects`

Line 41 is `alter table storage.objects enable row level security;`. `storage.objects` is
owned by `supabase_storage_admin`; `postgres` is **not** a member and `supautils.reserved_memberships`
forbids becoming one. `supautils.policy_grants` grants `postgres` **policy** management on
`storage.objects`, but that does not extend to `ALTER TABLE`. Expect
`ERROR: must be owner of table objects`, which rolls back the whole file — including the
bucket fix in 4.2. RLS is already enabled there, so the line is redundant anyway.

### 4.4 HIGH — `service_role` cannot read or write `public.shops` / `public.tattoos`

Live ACL is `service_role=Dxtm` — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. No
SELECT/INSERT/UPDATE/DELETE. `rolbypassrls` is set but that bypasses *policies*, not
*privileges*. `service_role` is not a member of any role that would supply them.

The drafts and `SUPABASE_SECURITY_CHECKLIST.md` both designate `service_role` as the shop
provisioning path. **That path does not currently work**, and the drafts do not restore it.
Provisioning today only works from the SQL editor / dashboard as `postgres`.

### 4.5 MEDIUM — `anon` and `authenticated` hold `TRUNCATE` on both public tables

`TRUNCATE` bypasses RLS entirely. PostgREST never emits `TRUNCATE`, so this is not
reachable through the REST API today — it is a latent total-data-loss privilege, not an
active exploit. Draft `...0001`'s `revoke all … from anon, authenticated` removes it.

### 4.6 MEDIUM — `authenticated` holds INSERT/UPDATE/DELETE on `public.shops`

Self-provisioning is blocked today only by the *absence* of an INSERT policy. Add any
permissive INSERT policy later and the privilege is already there. Draft `...0001` fixes
this (`grant select, update` only).

### 4.7 MEDIUM — The `ALTER DEFAULT PRIVILEGES` line in `...0001` is only a half-fix

Two default-ACL entries exist for schema `public`:

| Grantor | anon / authenticated defaults on new tables |
|---|---|
| `postgres` | `Dxtm` (already narrowed) |
| **`supabase_admin`** | **`arwdDxtm` — full DML** |

`ALTER DEFAULT PRIVILEGES` run as `postgres` can only alter `postgres`'s entry. Any table
created by `supabase_admin` still lands fully writable by `anon`. This cannot be fixed from
the SQL editor; it needs the `rls_auto_enable` event trigger (which is present, §4.9) plus
an explicit `revoke` per new table.

### 4.8 MEDIUM — RLS is not FORCED on either public table

`relforcerowsecurity = false`, and the owner `postgres` also has `rolbypassrls`. Draft
`...0001` adds `FORCE`. Note this affects only owner-privileged connections, not the app.

### 4.9 LOW — `public.rls_auto_enable()` is SECURITY DEFINER with EXECUTE to PUBLIC

Owned by `postgres`, `SECURITY DEFINER`, `SET search_path = 'pg_catalog'`, `EXECUTE` granted
to `PUBLIC`, `anon`, `authenticated`, `service_role`. The Supabase advisor flags it twice as
callable via `/rest/v1/rpc/rls_auto_enable`.

Practical impact is limited: it returns `event_trigger`, and Postgres refuses to execute an
event-trigger function outside event-trigger context, so a call errors rather than escalating.
Its body only calls `pg_catalog` functions and `format()`s a fixed DDL string, so the
`pg_catalog` search_path is not exploitable. Still: the PUBLIC grant is unnecessary, and
leaving it means the checklist's "expect zero advisor findings" will not hold. The drafts do
not address it.

It backs event trigger `ensure_rls` (`ddl_command_end`), which auto-enables RLS on new tables
in `public` — a genuinely useful control that partially offsets 4.7.

### 4.10 LOW — Two broad SELECT policies allow listing the whole bucket

Advisor `public_bucket_allows_listing`. Draft `...0002` adds a **third** broad SELECT policy,
making it worse. The app only calls `.upload()` and `.getPublicUrl()` — never `.list()`,
`.download()` or `.createSignedUrl()`. Public-bucket object URLs are served without consulting
RLS, so **all** SELECT policies on this bucket can be dropped with no app impact.

### 4.11 LOW — Auth: leaked-password protection disabled

Advisor `auth_leaked_password_protection`. Dashboard-only setting; already covered in the
checklist.

### 4.12 INFO — Behavioural divergence: shop deletion

`shops_delete_owner` exists live and is not mentioned anywhere in the drafts or the checklist.
Because `tattoos.shop_id` is `ON DELETE CASCADE`, a manager deleting their shop silently
deletes all of that shop's tattoos. Applying `...0001` revokes the DELETE privilege and ends
this. Decide deliberately whether that is wanted.

### 4.13 INFO — Nullable columns

`shops.owner_user_id` is nullable. A NULL-owner shop is editable by nobody through the API
(`owner_user_id = auth.uid()` → NULL). Currently 0 such rows. `tattoos.shop_id` is likewise
nullable; a NULL-shop tattoo would be publicly readable but editable by nobody. Currently 0.
Consider `NOT NULL` constraints, out of scope for this pass.

---

## 5. Revised migration plan

Ordering principle: **drop the legacy policies inside the same transaction that creates the
replacements.** A separate "drop everything first" migration would leave a window in which
the tables are deny-all (or, worse, half-secured) between two pushes.

### Step 0 — Prerequisite

`supabase_migrations.schema_migrations` is empty, so `supabase db push` will run every file
in `supabase/migrations/`. **Move `20260728000003_optional_published_flag.sql` out of that
directory** (e.g. to `supabase/optional/`) unless you have decided to adopt drafts *and* done
the UI work. Otherwise `db push` applies it silently.

### Step 1 — Edit `20260728000001_enable_rls_core.sql`

Add, immediately after the existing `drop policy if exists` block for each table:

```sql
-- Legacy policies actually present on the live database (verified 2026-07-30).
-- These have different names from the ones above and would otherwise survive,
-- remaining in force alongside the new ones (permissive policies are ORed).
drop policy if exists shops_select_public on public.shops;
drop policy if exists shops_update_owner  on public.shops;
drop policy if exists shops_delete_owner  on public.shops;

drop policy if exists tattoos_select_public on public.tattoos;
drop policy if exists tattoos_insert_owner  on public.tattoos;
drop policy if exists tattoos_update_owner  on public.tattoos;
drop policy if exists tattoos_delete_owner  on public.tattoos;
```

Optionally also restore the documented admin path (§4.4):

```sql
grant select, insert, update, delete on public.shops   to service_role;
grant select, insert, update, delete on public.tattoos to service_role;
```

Everything else in this file is correct as written and compatible with the live schema.

### Step 2 — Edit `20260728000002_storage_policies.sql`

1. **Delete line 41** (`alter table storage.objects enable row level security;`) — it will
   abort the transaction (§4.3) and RLS is already on.
2. Add the real legacy names to the drop block:

```sql
drop policy if exists storage_select_all           on storage.objects;
drop policy if exists storage_insert_authenticated on storage.objects;
drop policy if exists tattoo_images_public_read    on storage.objects;
drop policy if exists tattoo_images_auth_insert    on storage.objects;
drop policy if exists tattoo_images_owner_delete   on storage.objects;
```

3. **Drop the `"tattoo-images: public read"` policy from the file entirely.** The bucket is
   public; `getPublicUrl()` does not consult RLS. Removing all SELECT policies clears the
   `public_bucket_allows_listing` advisor and removes bucket enumeration, with no app impact
   (verified: the app never calls `.list()` / `.download()` / `.createSignedUrl()`).
   *If you later add a manager "browse my uploads" screen, add a narrow SELECT policy scoped
   to `(storage.foldername(name))[1] = auth.uid()::text` at that point.*

The bucket `update` and the upload/update/delete policies are correct as written and match
all 3 existing objects (§2.6).

### Step 3 — Post-apply hygiene (new, small migration)

```sql
revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
```

Does not affect the `ensure_rls` event trigger, which runs as the trigger owner.

### Step 4 — Verify

Run `supabase/tests/rls_negative_tests.sql` (ends in `ROLLBACK`). Fill the CONFIGURE block
with real ids — note there is currently **only one auth user**, who owns the only shop, so
you must create a second throwaway user to populate `outsider_uid` before groups 2 and 3
are meaningful. Without it those tests cannot fail correctly.

Then re-run the security advisor. Expect `public_bucket_allows_listing` and both
`*_security_definer_function_executable` findings to be gone; `auth_leaked_password_protection`
remains until changed in the dashboard.

### Step 5 — Dashboard (unchanged from the existing checklist)

Sign-ups off, email confirmation on, MFA for managers, leaked-password protection on, JWT
expiry + refresh rotation, exact Site/Redirect URLs. Note that with sign-ups **off**, finding
4.1's "any signed-in user" shrinks to "any provisioned manager" — real defence in depth, but
not a substitute for fixing the policy.

---

## 6. Rollback

The DB is small (1 shop, 3 tattoos, 3 objects) and none of the plan touches row data, so
rollback is policy/grant restoration only.

**Before applying anything:**

```sql
-- Capture current policy definitions verbatim.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public','storage') order by 1,2,3;

-- Capture current grants.
select relnamespace::regnamespace||'.'||relname, relacl
from pg_class where oid in ('public.shops'::regclass,'public.tattoos'::regclass);

-- Capture bucket config.
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
```

Save that output. Also take a dashboard backup / PITR checkpoint before Step 1.

**To roll back Step 1 (public tables):**

```sql
begin;
drop policy if exists "shops: public read"     on public.shops;
drop policy if exists "shops: owner update"    on public.shops;
drop policy if exists "tattoos: public read"   on public.tattoos;
drop policy if exists "tattoos: manager insert" on public.tattoos;
drop policy if exists "tattoos: manager update" on public.tattoos;
drop policy if exists "tattoos: manager delete" on public.tattoos;

alter table public.shops   no force row level security;
alter table public.tattoos no force row level security;

create policy shops_select_public on public.shops for select using (true);
create policy shops_update_owner  on public.shops for update using (owner_user_id = auth.uid());
create policy shops_delete_owner  on public.shops for delete using (owner_user_id = auth.uid());

create policy tattoos_select_public on public.tattoos for select using (true);
create policy tattoos_insert_owner  on public.tattoos for insert
  with check (exists (select 1 from public.shops where shops.id = tattoos.shop_id and shops.owner_user_id = auth.uid()));
create policy tattoos_update_owner  on public.tattoos for update
  using (exists (select 1 from public.shops where shops.id = tattoos.shop_id and shops.owner_user_id = auth.uid()));
create policy tattoos_delete_owner  on public.tattoos for delete
  using (exists (select 1 from public.shops where shops.id = tattoos.shop_id and shops.owner_user_id = auth.uid()));

grant select, insert, update, delete, truncate, references, trigger on public.shops, public.tattoos to authenticated;
grant select, truncate, references, trigger on public.shops, public.tattoos to anon;
drop function if exists public.owns_shop(uuid);
commit;
```

Restoring `MAINTAIN` (Postgres 17) requires `grant maintain on … ;` if you want a byte-exact
ACL match — omit it unless the diff matters to you.

**To roll back Step 2 (storage):**

```sql
begin;
drop policy if exists "tattoo-images: manager upload" on storage.objects;
drop policy if exists "tattoo-images: manager update" on storage.objects;
drop policy if exists "tattoo-images: manager delete" on storage.objects;

create policy storage_select_all           on storage.objects for select using (bucket_id = 'tattoo-images');
create policy tattoo_images_public_read    on storage.objects for select using (bucket_id = 'tattoo-images');
create policy storage_insert_authenticated on storage.objects for insert to authenticated with check (bucket_id = 'tattoo-images');
create policy tattoo_images_auth_insert    on storage.objects for insert with check (bucket_id = 'tattoo-images' and auth.uid() is not null);
create policy tattoo_images_owner_delete   on storage.objects for delete using (bucket_id = 'tattoo-images' and auth.uid()::text = (storage.foldername(name))[1]);

update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'tattoo-images';
commit;
```

Rolling the bucket config back re-opens finding 4.2 — only do it if uploads are actually
broken, and prefer widening `allowed_mime_types` to reverting it to `NULL`.

**To roll back Step 3:** `grant execute on function public.rls_auto_enable() to public;`

---

## 7. Expected app behaviour after the revised plan

| Surface | Path | Before | After |
|---|---|---|---|
| Home shop list | `lib/tattoo-data.ts:14` `shops.select('*, tattoos(count)')` | works | **unchanged** — anon keeps SELECT on both tables; the embedded count needs the `tattoos_shop_id_fkey` FK, which is present and untouched |
| Home slideshow / gallery / detail / try-on | `tattoos.select('*')` anon | works | **unchanged** |
| Manager dashboard load | `shops.select('*').eq('owner_user_id', …)` then `tattoos.select('*')` | works | **unchanged** |
| Manager add tattoo — upload | `storage.upload('<uid>/<rand>.<ext>')` | works | **unchanged for the owning manager.** Now additionally requires the first path segment to equal `auth.uid()` (the app already does this, `app/manager/index.tsx:156`) and that the caller owns a shop |
| Manager add tattoo — insert row | `tattoos.insert({shop_id, …})` | works | **unchanged** |
| Manager delete tattoo | `tattoos.delete().eq('id', …)` | works | **unchanged** |
| Existing images render | `getPublicUrl` | works | **unchanged** — public bucket reads bypass RLS; all 3 objects verified compliant |
| Non-manager signed-in user uploading | **succeeds today** | — | **now fails** (`new row violates row-level security policy`) |
| Upload of SVG / HTML | **succeeds today** | — | **now fails** at the bucket MIME allowlist |
| Upload over 8 MiB | **succeeds today** | — | **now fails** at the bucket size limit |
| Shop deletion by its manager | possible today (cascades to tattoos) | — | **no longer possible** (DELETE privilege revoked) |
| Bucket listing by any client | possible today | — | **no longer possible** |
| Shop provisioning via `service_role` | **already broken** (§4.4) | — | works, *if* you include the optional grants in Step 1 |

**No user-visible regression is expected on any current screen.** The app's upload path
already writes `<auth.uid()>/…` and already restricts itself to jpeg/png/webp, so it satisfies
the stricter policies as written. Nothing in `app/` needs to change for Steps 1–3.

The one thing to watch after applying: `app/manager/index.tsx:207` collapses every failure to
"Upload failed. Please check your connection and try again." If a policy is wrong you will see
that generic string rather than the RLS error. Check the Supabase logs, not the UI, when
verifying.

---

## 8. What was NOT verified

- **The negative tests have still not been run.** They perform writes inside a transaction
  that ends in `ROLLBACK`; I did not run them, since that is still a write attempt against
  production. They need a second throwaway user first (§ Step 4).
- Dashboard-only auth settings (sign-ups, MFA, JWT expiry, redirect allowlist) are not
  readable over SQL and were not inspected.
- Edge Function `remove-background` deployment state and its secrets were not inspected;
  the branch's hardened source was reviewed but nothing was deployed.
