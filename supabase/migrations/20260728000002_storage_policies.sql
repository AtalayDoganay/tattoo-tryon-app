-- =============================================================================
-- 20260728000002_storage_policies.sql
-- Storage policies for the `tattoo-images` bucket.
--
--   !! NOT YET APPLIED TO THE DEPLOYED PROJECT (ref: bntoeowrvvhuaypddxnl) !!
--   Verified against app/manager/index.tsx only; the live bucket configuration
--   could not be read because the project was paused during this audit.
--
-- The bucket name and the object layout are taken from the single place the app
-- uploads: app/manager/index.tsx writes to
--
--     tattoo-images/<auth.uid()>/<timestamp>-<random>.<ext>
--
-- and reads back a public URL via getPublicUrl(). The first path segment being
-- the uploader's user id is what makes per-owner storage policies possible.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Bucket configuration
-- -----------------------------------------------------------------------------
-- public = true keeps getPublicUrl() working, which the gallery and try-on
-- screens depend on. Public here means "anyone with the URL may READ"; it says
-- nothing about who may write, which is governed by the policies below.
--
-- The MIME allowlist is the important part. A public-read bucket that accepts
-- image/svg+xml or text/html is a stored-XSS vector: the file would be served
-- from the Supabase origin and could script against it. Only raster types the
-- app actually produces are permitted.
update storage.buckets
set
  public = true,
  file_size_limit = 8388608, -- 8 MiB, matches the API's MAX_UPLOAD_BYTES default
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'tattoo-images';

-- -----------------------------------------------------------------------------
-- 2. Object policies
-- -----------------------------------------------------------------------------
alter table storage.objects enable row level security;

drop policy if exists "tattoo-images: public read" on storage.objects;
drop policy if exists "tattoo-images: manager upload" on storage.objects;
drop policy if exists "tattoo-images: manager update" on storage.objects;
drop policy if exists "tattoo-images: manager delete" on storage.objects;

-- Public read: required by getPublicUrl() in the gallery/detail/try-on screens.
create policy "tattoo-images: public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'tattoo-images');

-- Writes require BOTH conditions:
--   1. the object sits in a folder named after the caller's own user id, so one
--      manager can never write into another manager's folder; and
--   2. the caller actually owns a shop, so an ordinary signed-up user who is
--      not a manager cannot use the bucket as free file hosting.
--
-- storage.foldername(name) splits the object key on '/'; element 1 is the first
-- segment, i.e. the '<auth.uid()>' prefix the app writes.
create policy "tattoo-images: manager upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'tattoo-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.shops s where s.owner_user_id = (select auth.uid())
    )
  );

-- Replacing an object (upsert / move) is as destructive as deleting one, so it
-- carries the same ownership requirement on both the existing and the new row.
create policy "tattoo-images: manager update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'tattoo-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'tattoo-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "tattoo-images: manager delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'tattoo-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Anonymous callers get no write verbs at all: with no anon INSERT/UPDATE/DELETE
-- policy, every such request fails closed.

commit;
