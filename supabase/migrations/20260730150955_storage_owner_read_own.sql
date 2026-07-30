-- =============================================================================
-- 20260730150955_storage_owner_read_own.sql
-- Restore owner-scoped SELECT on storage.objects.
--
-- WHAT WENT WRONG
-- ---------------
-- Migration ...094818 removed every SELECT policy on storage.objects, reasoning
-- that a public bucket serves object reads without consulting RLS, so a SELECT
-- policy would only enable bucket listing.
--
-- The first half is correct and was verified end to end: with no SELECT policy
-- at all, an anonymous GET of each of the three production images through
-- /storage/v1/object/public/... still returns HTTP 200 with image/jpeg. The
-- gallery read path never depended on a policy.
--
-- The second half was wrong. The Storage API resolves an object with a SELECT
-- before it will UPDATE or DELETE it. With no SELECT policy a manager could
-- upload an image and then never replace or delete it -- both returned
-- HTTP 400. Storage API tests 25a and 25b caught this. They exist precisely
-- because a policy set that denies everything looks identical to a secure one
-- until you assert that legitimate work still succeeds.
--
-- THE FIX
-- -------
-- A SELECT policy scoped to the caller's own folder, not a bucket-wide one:
--   * a manager sees and manages their own objects;
--   * nobody can enumerate the bucket;
--   * one manager cannot see another manager's folder;
--   * anonymous callers get no SELECT policy and do not need one.
--
-- Verified after applying: anon sees 0 objects, a signed-in non-owner sees 0,
-- the owner sees exactly their own 3. The Supabase advisor does not re-raise
-- `public_bucket_allows_listing`, because this policy is not broad.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='tattoo-images: owner upload') then
    raise exception 'precondition failed: storage upload policy is missing';
  end if;
end $$;

drop policy if exists "tattoo-images: owner read own" on storage.objects;

create policy "tattoo-images: owner read own"
  on storage.objects
  as permissive
  for select
  to authenticated
  using (
    bucket_id = 'tattoo-images'
    and owner = (select auth.uid())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
declare got text;
begin
  select coalesce(string_agg(policyname, ', ' order by policyname), '(none)') into got
  from pg_policies where schemaname='storage' and tablename='objects';
  if got <> 'tattoo-images: owner delete, tattoo-images: owner read own, tattoo-images: owner update, tattoo-images: owner upload' then
    raise exception 'postcondition failed: unexpected policy set on storage.objects -> %', got;
  end if;

  -- The read policy must never be bucket-wide: it has to constrain the folder.
  if exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and cmd='SELECT'
      and qual not like '%foldername%'
  ) then
    raise exception 'postcondition failed: a SELECT policy on storage.objects is not folder-scoped';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and cmd='SELECT'
      and 'anon' = any(roles)
  ) then
    raise exception 'postcondition failed: anon gained a SELECT policy on storage.objects';
  end if;
end $$;

commit;
