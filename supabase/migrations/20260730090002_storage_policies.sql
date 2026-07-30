-- =============================================================================
-- 20260730090002_storage_policies.sql
-- Access control for the public `tattoo-images` bucket.
--
-- Written against the LIVE configuration of project bntoeowrvvhuaypddxnl,
-- inspected read-only on 2026-07-30. Supersedes the draft
-- 20260728000002_storage_policies.sql.
--
-- THREE THINGS THE DRAFT GOT WRONG
-- --------------------------------
-- 1. It dropped policies by names that do not exist here. The five real names
--    are dropped below; they were read out of pg_policies, not guessed. The
--    important one is `storage_insert_authenticated`, whose entire condition is
--    `bucket_id = 'tattoo-images'` -- any signed-in user could upload anywhere
--    in the bucket, including inside another manager's folder. Because
--    permissive policies are ORed, leaving it in place would have made every
--    restriction below decorative.
-- 2. It ran `alter table storage.objects enable row level security`.
--    storage.objects is owned by supabase_storage_admin; postgres is not a
--    member and supautils.reserved_memberships forbids becoming one. That
--    statement raises `must be owner of table objects` and rolls back the whole
--    file. supautils.policy_grants does grant postgres POLICY management on
--    storage.objects, which is why the drops and creates below work. RLS is
--    already enabled there by Supabase, so nothing needs enabling.
--    The storage schema is Supabase-managed: use policies, never DDL.
-- 3. It created a broad SELECT policy. The bucket is public, and public-bucket
--    object reads (`/storage/v1/object/public/...`) do not consult RLS at all,
--    so a SELECT policy buys nothing for `getPublicUrl()` -- it only enables
--    bucket LISTING, which the app never does and which the Supabase advisor
--    flags. No SELECT policy is created here.
--
-- OBJECT LAYOUT
-- -------------
-- app/manager/index.tsx writes exactly:  tattoo-images/<auth.uid()>/<file>
-- and reads back via getPublicUrl(). The first path segment being the uploader's
-- user id is what makes per-owner policies possible. All 3 existing objects were
-- verified to match this layout (depth 1, owner set, owner = folder segment,
-- no traversal sequences), so none of them is orphaned by these rules.
--
-- NOTHING HERE TOUCHES OBJECT DATA. No insert, update or delete against
-- storage.objects rows; only policies, plus the bucket's configuration row.
-- Actual file operations continue to go through the Storage API.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Preconditions — fail closed
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'precondition failed: storage.objects does not exist';
  end if;
  if to_regclass('storage.buckets') is null then
    raise exception 'precondition failed: storage.buckets does not exist';
  end if;
  if not exists (select 1 from storage.buckets where id = 'tattoo-images') then
    raise exception 'precondition failed: bucket tattoo-images does not exist';
  end if;

  -- RLS must already be on; this migration deliberately cannot turn it on.
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'precondition failed: RLS is not enabled on storage.objects and this migration cannot enable it (table is owned by supabase_storage_admin)';
  end if;

  -- Proves migration ...0001 ran first.
  if to_regprocedure('public.owns_shop(uuid)') is null then
    raise exception 'precondition failed: public.owns_shop(uuid) is missing -- apply 20260730090001_rls_core.sql first';
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'storage' and p.proname = 'foldername') then
    raise exception 'precondition failed: storage.foldername() is missing';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. "Is the caller a manager at all?"
-- -----------------------------------------------------------------------------
-- Storage policies need "owns SOME shop", where the table policies need "owns
-- THIS shop". SECURITY DEFINER with an empty search_path for the same reasons as
-- public.owns_shop: it must not be re-routed through a caller-controlled schema,
-- and it must keep working if the shops read policy is ever narrowed.
create or replace function public.is_shop_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shops s
    where s.owner_user_id = (select auth.uid())
  );
$$;

comment on function public.is_shop_manager() is
  'True when the current user owns at least one shop. Used by the tattoo-images storage policies to stop non-managers using the bucket as file hosting.';

revoke all on function public.is_shop_manager() from public;
revoke all on function public.is_shop_manager() from anon;
grant execute on function public.is_shop_manager() to authenticated;
grant execute on function public.is_shop_manager() to service_role;

-- -----------------------------------------------------------------------------
-- 2. Bucket configuration
-- -----------------------------------------------------------------------------
-- public = true is deliberate: the gallery, detail and try-on screens render
-- published tattoo images from getPublicUrl(). "Public" here means "anyone with
-- the URL may READ"; it says nothing about who may write.
--
-- The MIME allowlist is the security-critical part. A public-read bucket that
-- accepts image/svg+xml, text/html, application/xml or application/javascript is
-- a stored-XSS vector: the file is served from the Supabase origin and can
-- script against it. Only the three raster types the app actually produces are
-- permitted, so every active-content format is rejected by omission.
update storage.buckets
set
  public = true,
  file_size_limit = 8388608,  -- 8 MiB, matches MAX_UPLOAD_BYTES in bg_server
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'tattoo-images';

-- -----------------------------------------------------------------------------
-- 3. Object policies
-- -----------------------------------------------------------------------------
-- Legacy policies confirmed present on the live database 2026-07-30.
drop policy if exists storage_select_all           on storage.objects;
drop policy if exists storage_insert_authenticated on storage.objects;
drop policy if exists tattoo_images_public_read    on storage.objects;
drop policy if exists tattoo_images_auth_insert    on storage.objects;
drop policy if exists tattoo_images_owner_delete   on storage.objects;
-- This migration's own policies, so re-running is safe.
drop policy if exists "tattoo-images: owner upload" on storage.objects;
drop policy if exists "tattoo-images: owner update" on storage.objects;
drop policy if exists "tattoo-images: owner delete" on storage.objects;

-- No SELECT policy is created. Public object URLs bypass RLS, so reads keep
-- working; bucket listing stops working, which is intended. If a manager
-- "browse my uploads" screen is added later, add a SELECT policy scoped to
-- (storage.foldername(name))[1] = auth.uid()::text -- never a bucket-wide one.

-- Writing requires ALL of:
--   * the caller owns a shop (not just any signed-up account);
--   * the object sits in a folder named after the caller's own user id;
--   * exactly one folder level, i.e. <uid>/<file> and nothing deeper;
--   * a non-empty filename;
--   * no '.'/'..' segment, no empty segment, no leading slash, no backslash;
--   * the row's owner column is the caller, so ownership cannot be forged.
create policy "tattoo-images: owner upload"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'tattoo-images'
    and owner = (select auth.uid())
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) <> ''
    and name !~ '(^|/)[.]{1,2}(/|$)'
    and name !~ '//'
    and name !~ '^/'
    and name !~ '\\'
    and public.is_shop_manager()
  );

-- Replacing or moving an object is as destructive as deleting one, so USING and
-- WITH CHECK carry the same requirements. USING pins the row you may touch to
-- your own folder; WITH CHECK pins the result, which is what stops a rename out
-- of your folder into someone else's and stops handing ownership away.
create policy "tattoo-images: owner update"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'tattoo-images'
    and owner = (select auth.uid())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'tattoo-images'
    and owner = (select auth.uid())
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) <> ''
    and name !~ '(^|/)[.]{1,2}(/|$)'
    and name !~ '//'
    and name !~ '^/'
    and name !~ '\\'
  );

create policy "tattoo-images: owner delete"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'tattoo-images'
    and owner = (select auth.uid())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Anonymous callers get no write verb at all: with no anon INSERT/UPDATE/DELETE
-- policy, every such request fails closed regardless of their table grants.

-- -----------------------------------------------------------------------------
-- 4. Postconditions — assert policy set and bucket configuration
-- -----------------------------------------------------------------------------
do $$
declare
  got  text;
  b    record;
begin
  select coalesce(string_agg(policyname, ', ' order by policyname), '(none)')
    into got
  from pg_policies where schemaname = 'storage' and tablename = 'objects';
  if got <> 'tattoo-images: owner delete, tattoo-images: owner update, tattoo-images: owner upload' then
    raise exception 'postcondition failed: unexpected policy set on storage.objects -> %', got;
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT') then
    raise exception 'postcondition failed: a SELECT/listing policy survived on storage.objects';
  end if;

  select public, file_size_limit, allowed_mime_types into b
  from storage.buckets where id = 'tattoo-images';

  if b.public is not true then
    raise exception 'postcondition failed: bucket tattoo-images is not public';
  end if;
  if b.file_size_limit is distinct from 8388608 then
    raise exception 'postcondition failed: file_size_limit is %, expected 8388608', b.file_size_limit;
  end if;
  if b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp'] then
    raise exception 'postcondition failed: allowed_mime_types is %, expected {image/jpeg,image/png,image/webp}', b.allowed_mime_types;
  end if;
end $$;

commit;
