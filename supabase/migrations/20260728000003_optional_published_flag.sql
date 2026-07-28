-- =============================================================================
-- 20260728000003_optional_published_flag.sql
--
--   !! OPTIONAL — DO NOT APPLY UNLESS YOU WANT THE DRAFT/PUBLISHED FEATURE !!
--   !! NOT APPLIED TO THE DEPLOYED PROJECT (ref: bntoeowrvvhuaypddxnl)      !!
--
-- Why this is optional rather than part of the core hardening
-- -----------------------------------------------------------
-- The brief asks that "public users may read only records explicitly marked
-- published". The deployed schema has no such concept today, and I did not
-- invent one silently:
--
--   * lib/types.ts defines `Tattoo.published`, but that interface only types
--     the hard-coded `placeholderTattoos` demo array.
--   * `DbTattoo` -- the type used for every real row -- has no published field.
--   * No client query filters on `published`, and app/manager/index.tsx does
--     not set it on insert.
--
-- So today every tattoo row is effectively public. Applying this migration adds
-- the column, backfills existing rows as published (so nothing disappears from
-- the live gallery), and narrows the anonymous read policy.
--
-- Applying this migration ALONE is safe but pointless: nothing can create a
-- draft until the manager UI exposes the toggle. See the "App changes required"
-- note at the bottom.
-- =============================================================================

begin;

-- default true + backfill: every row that exists right now stays visible, so
-- applying this does not empty the public gallery.
alter table public.tattoos
  add column if not exists published boolean not null default true;

comment on column public.tattoos.published is
  'False hides the row from anonymous visitors. Only the owning shop''s manager can read or change unpublished rows.';

-- Partial index: the anonymous read path filters on this column on every
-- gallery/home request, and only the published subset is ever scanned there.
create index if not exists tattoos_published_idx
  on public.tattoos (shop_id, created_at desc)
  where published;

-- Replace the permissive read policy from migration ...0001 with one that
-- distinguishes visitors from the owning manager.
drop policy if exists "tattoos: public read" on public.tattoos;
drop policy if exists "tattoos: published read" on public.tattoos;
drop policy if exists "tattoos: manager reads own drafts" on public.tattoos;

-- Anonymous and signed-in visitors: published rows only.
create policy "tattoos: published read"
  on public.tattoos
  for select
  to anon, authenticated
  using (published);

-- The owning manager additionally sees their own drafts. Policies are
-- permissive (OR-ed), so this widens the rule above for managers only.
create policy "tattoos: manager reads own drafts"
  on public.tattoos
  for select
  to authenticated
  using (public.owns_shop(shop_id));

commit;

-- =============================================================================
-- App changes required to actually use this
-- =============================================================================
-- 1. app/manager/index.tsx -- add `published` to the insert payload (or rely on
--    the DEFAULT true) and add a publish/unpublish control per row.
-- 2. lib/types.ts -- add `published: boolean` to `DbTattoo`.
-- 3. Manager-facing reads (app/manager/index.tsx) already select '*' and will
--    pick the column up automatically.
-- 4. Public reads need no change: the policy filters server-side, so an
--    unpublished row simply never reaches the client.
--
-- Verify after applying (see SUPABASE_SECURITY_CHECKLIST.md for the full
-- procedure): mark one row `published = false`, then confirm it is absent from
-- an anonymous query and present in the owning manager's query.
-- =============================================================================
