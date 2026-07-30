-- =============================================================================
-- 20260730094902_published_flag.sql
-- Draft / published workflow for public.tattoos.
--
-- Supersedes the draft 20260728000003_optional_published_flag.sql. That file was
-- marked OPTIONAL because the feature had not been decided on; it has now been
-- approved, so this is a deliberate production migration and no longer optional.
--
-- REQUIRES 20260730094727_rls_core.sql (for public.owns_shop).
--
-- THE ASYMMETRY IS INTENTIONAL
-- ----------------------------
-- Existing rows are backfilled to published = true, so nothing disappears from
-- the live gallery on deploy. The column DEFAULT is false, so anything created
-- from now on starts as a draft and has to be published deliberately. Those are
-- two different values on purpose: one preserves what is already public, the
-- other makes "public" an explicit act.
--
-- RLS IS THE BOUNDARY, NOT THE QUERY
-- ----------------------------------
-- The app is updated in the same change to send .eq('published', true) on public
-- reads, but that filter is a nicety. The policy below is what actually enforces
-- it: if a screen forgets the filter, or someone calls PostgREST directly with
-- the publishable key, unpublished rows are still not returned.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Preconditions — fail closed
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tattoos') is null then
    raise exception 'precondition failed: table public.tattoos does not exist';
  end if;
  if to_regprocedure('public.owns_shop(uuid)') is null then
    raise exception 'precondition failed: public.owns_shop(uuid) is missing -- apply 20260730094727_rls_core.sql first';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.tattoos'::regclass) then
    raise exception 'precondition failed: RLS is not enabled on public.tattoos';
  end if;
  -- 0001 must have run: its read policy is the one being replaced here.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'tattoos'
                   and policyname = 'tattoos: public read') then
    raise exception 'precondition failed: policy "tattoos: public read" is missing -- apply 20260730094727_rls_core.sql first';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Column: add, backfill existing rows to TRUE, then default new rows to FALSE
-- -----------------------------------------------------------------------------
-- Added nullable first so the backfill is explicit and visible rather than
-- hidden inside a DEFAULT. All three steps are in this transaction, so the
-- column never exists in a half-populated state that a reader could observe.
alter table public.tattoos add column if not exists published boolean;

update public.tattoos set published = true where published is null;

alter table public.tattoos alter column published set not null;
alter table public.tattoos alter column published set default false;

comment on column public.tattoos.published is
  'False hides the row from everyone except the owning shop''s manager. Existing rows were backfilled to true on 2026-07-30; new rows default to false.';

-- Verify the backfill before going any further. At this point in the
-- transaction no row can have been inserted with the new default, so every row
-- must be published.
do $$
declare
  unpublished int;
begin
  select count(*) into unpublished from public.tattoos where published is not true;
  if unpublished > 0 then
    raise exception 'backfill failed: % pre-existing tattoo rows are not published', unpublished;
  end if;
end $$;

-- The anonymous read path filters on this column on every gallery and home
-- request, and only the published subset is ever scanned there.
create index if not exists tattoos_published_shop_created_idx
  on public.tattoos (shop_id, created_at desc)
  where published;

-- -----------------------------------------------------------------------------
-- 2. Read policies
-- -----------------------------------------------------------------------------
drop policy if exists "tattoos: public read"       on public.tattoos;
drop policy if exists "tattoos: published read"    on public.tattoos;
drop policy if exists "tattoos: owner read drafts" on public.tattoos;

-- Everyone -- anonymous visitors and ordinary signed-in users alike -- sees
-- published rows only. A signed-in non-manager gets no more than a visitor.
create policy "tattoos: published read"
  on public.tattoos
  as permissive
  for select
  to anon, authenticated
  using (published);

-- The owning manager additionally sees their own drafts. Policies are permissive
-- and therefore ORed, so this widens the rule above for owners and for nobody
-- else. It is scoped by shop ownership, so one manager cannot read another
-- manager's drafts.
create policy "tattoos: owner read drafts"
  on public.tattoos
  as permissive
  for select
  to authenticated
  using (public.owns_shop(shop_id));

-- Publishing and unpublishing is an UPDATE, already governed by the
-- "tattoos: owner update" policy from ...0001, whose USING and WITH CHECK both
-- require public.owns_shop(shop_id). A non-owner cannot update the row at all,
-- and therefore cannot change its publication status. No extra policy is needed,
-- and adding a column-scoped one would only create a second thing to keep in
-- sync.

-- -----------------------------------------------------------------------------
-- 3. Postconditions
-- -----------------------------------------------------------------------------
do $$
declare
  got  text;
  col  record;
begin
  select coalesce(string_agg(policyname, ', ' order by policyname), '(none)')
    into got
  from pg_policies where schemaname = 'public' and tablename = 'tattoos';
  if got <> 'tattoos: owner delete, tattoos: owner insert, tattoos: owner read drafts, tattoos: owner update, tattoos: published read' then
    raise exception 'postcondition failed: unexpected policy set on public.tattoos -> %', got;
  end if;

  select is_nullable, column_default into col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tattoos' and column_name = 'published';

  if col is null then
    raise exception 'postcondition failed: public.tattoos.published was not created';
  end if;
  if col.is_nullable <> 'NO' then
    raise exception 'postcondition failed: public.tattoos.published is nullable';
  end if;
  if col.column_default is distinct from 'false' then
    raise exception 'postcondition failed: public.tattoos.published default is %, expected false', col.column_default;
  end if;

  if exists (select 1 from public.tattoos where published is not true) then
    raise exception 'postcondition failed: a pre-existing tattoo row is not published';
  end if;
end $$;

commit;
