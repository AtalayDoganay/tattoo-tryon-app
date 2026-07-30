-- =============================================================================
-- ROLLBACK SNAPSHOT — state of project bntoeowrvvhuaypddxnl immediately BEFORE
-- the corrected hardening migrations were applied.
--
-- Captured: 2026-07-30T09:16Z, read-only, from pg_policies / pg_class.relacl /
--           pg_proc.proacl / storage.buckets.
--
-- Contains: policy definitions, grants, RLS flags, bucket configuration,
--           function EXECUTE privileges.
-- Contains NO api keys, passwords, tokens, JWTs, connection strings, user
-- UUIDs, or storage object paths. Nothing here is a credential.
--
-- SAFETY: every statement below is a policy / privilege / flag operation.
--   * No DELETE, TRUNCATE, DROP TABLE, or DROP COLUMN on application data.
--   * No storage object is created, moved, or removed.
--   * Restoring this file changes WHO MAY ACT, never WHAT EXISTS.
--   Verified: 1 shop row, 3 tattoo rows, 3 storage objects are untouched by
--   every statement in this file.
-- =============================================================================


-- =============================================================================
-- SECTION A — CAPTURED STATE (reference only, not executable)
-- =============================================================================
--
-- A1. RLS flags
--   public.shops      relrowsecurity=true   relforcerowsecurity=false  owner=postgres
--   public.tattoos    relrowsecurity=true   relforcerowsecurity=false  owner=postgres
--   storage.objects   relrowsecurity=true   relforcerowsecurity=false  owner=supabase_storage_admin
--   storage.buckets   relrowsecurity=true   relforcerowsecurity=false  owner=supabase_storage_admin
--
-- A2. Table grants (relacl; a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE
--     x=REFERENCES t=TRIGGER m=MAINTAIN)
--   public.shops     postgres=arwdDxtm  anon=rDxtm  authenticated=arwdDxtm  service_role=Dxtm
--   public.tattoos   postgres=arwdDxtm  anon=rDxtm  authenticated=arwdDxtm  service_role=Dxtm
--   storage.objects  granted by supabase_storage_admin: anon=arwdDxtm authenticated=arwdDxtm
--                    service_role=arwdDxtm; plus a duplicate authenticated=arwdDxtm granted
--                    by postgres. NOT restorable from a postgres session in full — see D3.
--
-- A3. Bucket configuration
--   tattoo-images    public=true  file_size_limit=NULL  allowed_mime_types=NULL  type=STANDARD
--
-- A4. Function privileges
--   public.rls_auto_enable()  SECURITY DEFINER, owner=postgres,
--                             SET search_path='pg_catalog',
--                             acl: PUBLIC=X, postgres=X, anon=X, authenticated=X, service_role=X
--
-- A5. Event triggers (unchanged by the hardening work, listed for completeness)
--   ensure_rls -> public.rls_auto_enable()  (ddl_command_end, owner postgres, enabled)
--
-- A6. Non-internal triggers in public: NONE.
--     Views / materialised views in public: NONE.
--
-- A7. Constraints relied upon by policies and by the app
--   shops_pkey                PRIMARY KEY (id)
--   shops_slug_key            UNIQUE (slug)
--   shops_owner_user_id_fkey  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
--   tattoos_pkey              PRIMARY KEY (id)
--   tattoos_shop_id_fkey      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE


-- =============================================================================
-- SECTION B — RESTORE public.shops AND public.tattoos  (undoes migration 0001)
-- =============================================================================

begin;

-- Remove the hardened policies.
drop policy if exists "shops: public read"      on public.shops;
drop policy if exists "shops: owner update"     on public.shops;
drop policy if exists "tattoos: public read"    on public.tattoos;
drop policy if exists "tattoos: owner read drafts" on public.tattoos;
drop policy if exists "tattoos: owner insert"   on public.tattoos;
drop policy if exists "tattoos: owner update"   on public.tattoos;
drop policy if exists "tattoos: owner delete"   on public.tattoos;

-- FORCE was added by the hardening migration; it was OFF before.
alter table public.shops   no force row level security;
alter table public.tattoos no force row level security;

-- Recreate the exact legacy policies, verbatim from pg_policies.
create policy shops_select_public on public.shops
  as permissive for select to public
  using (true);

create policy shops_update_owner on public.shops
  as permissive for update to public
  using (owner_user_id = auth.uid());

create policy shops_delete_owner on public.shops
  as permissive for delete to public
  using (owner_user_id = auth.uid());

create policy tattoos_select_public on public.tattoos
  as permissive for select to public
  using (true);

create policy tattoos_insert_owner on public.tattoos
  as permissive for insert to public
  with check (exists (
    select 1 from public.shops
    where shops.id = tattoos.shop_id and shops.owner_user_id = auth.uid()));

create policy tattoos_update_owner on public.tattoos
  as permissive for update to public
  using (exists (
    select 1 from public.shops
    where shops.id = tattoos.shop_id and shops.owner_user_id = auth.uid()));

create policy tattoos_delete_owner on public.tattoos
  as permissive for delete to public
  using (exists (
    select 1 from public.shops
    where shops.id = tattoos.shop_id and shops.owner_user_id = auth.uid()));

-- Restore the exact legacy grants.
revoke all on public.shops   from anon, authenticated, service_role;
revoke all on public.tattoos from anon, authenticated, service_role;

grant select, truncate, references, trigger, maintain
  on public.shops, public.tattoos to anon;

grant insert, select, update, delete, truncate, references, trigger, maintain
  on public.shops, public.tattoos to authenticated;

grant truncate, references, trigger, maintain
  on public.shops, public.tattoos to service_role;

-- The helper function did not exist before migration 0001.
drop function if exists public.owns_shop(uuid);

commit;


-- =============================================================================
-- SECTION C — RESTORE storage policies AND bucket config  (undoes migration 0002)
-- =============================================================================
--
-- WARNING: running this section re-opens two findings from the divergence
-- report — unrestricted uploads by any signed-in user (4.1) and an unrestricted
-- MIME/size bucket (4.2). Prefer widening the allowlist over reverting it.
--
-- No storage object is touched. Only storage.objects POLICIES and the
-- storage.buckets CONFIG ROW change.

begin;

drop policy if exists "tattoo-images: owner upload" on storage.objects;
drop policy if exists "tattoo-images: owner update" on storage.objects;
drop policy if exists "tattoo-images: owner delete" on storage.objects;

create policy storage_select_all on storage.objects
  as permissive for select to public
  using (bucket_id = 'tattoo-images');

create policy tattoo_images_public_read on storage.objects
  as permissive for select to public
  using (bucket_id = 'tattoo-images');

create policy storage_insert_authenticated on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'tattoo-images');

create policy tattoo_images_auth_insert on storage.objects
  as permissive for insert to public
  with check (bucket_id = 'tattoo-images' and auth.uid() is not null);

create policy tattoo_images_owner_delete on storage.objects
  as permissive for delete to public
  using (bucket_id = 'tattoo-images'
         and (auth.uid())::text = (storage.foldername(name))[1]);

update storage.buckets
set file_size_limit = null,
    allowed_mime_types = null
where id = 'tattoo-images';

commit;


-- =============================================================================
-- SECTION D — RESTORE the published/draft feature state  (undoes migration 0003)
-- =============================================================================
--
-- D1. Policy-only rollback (RECOMMENDED — loses nothing).
--     Leaves the `published` column in place. Section B already recreates
--     tattoos_select_public with USING (true), which makes every row publicly
--     readable again regardless of the column's value.
--
-- D2. Column removal (OPTIONAL — DESTRUCTIVE TO PUBLICATION STATE ONLY).
--     This drops which rows were drafts. It deletes NO tattoo rows and NO
--     storage objects. Only run it if you are abandoning the feature outright,
--     and only after Section B has restored the permissive read policy.
--
--     alter table public.tattoos drop column if exists published;
--     drop index if exists public.tattoos_published_idx;
--
-- D3. NOT ROLLED BACK: the duplicate storage.objects grants made by
--     supabase_storage_admin cannot be reproduced from a postgres session
--     (postgres is not a member of that role and supautils.reserved_memberships
--     forbids becoming one). The hardening migrations deliberately never revoke
--     them, so no restore is required.


-- =============================================================================
-- SECTION E — RESTORE function privileges  (undoes migration 0004)
-- =============================================================================

begin;

grant execute on function public.rls_auto_enable() to public;
grant execute on function public.rls_auto_enable() to anon;
grant execute on function public.rls_auto_enable() to authenticated;
grant execute on function public.rls_auto_enable() to service_role;

commit;


-- =============================================================================
-- SECTION F — VERIFY A ROLLBACK
-- =============================================================================
-- select schemaname, tablename, policyname, roles::text, cmd, qual, with_check
--   from pg_policies where schemaname in ('public','storage') order by 1,2,3;
--
-- select relnamespace::regnamespace||'.'||relname as rel, relrowsecurity,
--        relforcerowsecurity, array_to_string(relacl::text[], ' , ') as acl
--   from pg_class
--  where oid in ('public.shops'::regclass, 'public.tattoos'::regclass);
--
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--
-- select count(*) from public.shops;    -- expect 1
-- select count(*) from public.tattoos;  -- expect 3 (+ any real rows added since)
-- select count(*) from storage.objects where bucket_id='tattoo-images';  -- expect 3
-- =============================================================================
