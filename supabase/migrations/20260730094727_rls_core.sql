-- =============================================================================
-- 20260730094727_rls_core.sql
-- Row Level Security and least-privilege grants for public.shops / public.tattoos.
--
-- Written against the LIVE schema of project bntoeowrvvhuaypddxnl, inspected
-- read-only on 2026-07-30 (see docs/SUPABASE_LIVE_DIVERGENCE_REPORT.md).
-- It supersedes the earlier draft 20260728000001_enable_rls_core.sql, which was
-- written blind while the project was paused and which dropped policies by names
-- that do not exist on this database.
--
-- WHY THE DROP LIST MATTERS
-- -------------------------
-- RLS was already enabled here and seven policies already existed, all with
-- names the old draft never mentioned. DROP POLICY IF EXISTS matches on name
-- only, and permissive policies are ORed together, so those seven would have
-- survived and kept granting whatever they granted. Every legacy name below was
-- read out of pg_policies on the live database, not guessed.
--
-- AUTHORIZATION MODEL
-- -------------------
-- There is no `role` or `is_manager` column. "Manager" is structural:
--   you manage a shop  iff  public.shops.owner_user_id = auth.uid().
-- No INSERT policy on shops exists for anon or authenticated, and no DELETE
-- policy or DELETE grant exists either, so a signed-in user can neither create
-- a shop for themselves nor destroy one. Shop provisioning and deletion are
-- backend-only actions performed with service_role or from the dashboard.
--
-- SHOP DELETION IS DELIBERATELY IMPOSSIBLE THROUGH THE API.
-- tattoos.shop_id is ON DELETE CASCADE, so deleting a shop silently destroys
-- every tattoo in it. A future shop-deletion feature must be a separately
-- reviewed server-side administrative flow with explicit confirmation and
-- impact reporting -- not an RLS policy.
--
-- NOTE ON READ SCOPE
-- ------------------
-- This migration keeps anonymous reads of public.tattoos wide open, because the
-- `published` column does not exist yet. Migration ...0003 adds the column and
-- replaces the read policy with a published-only one. 0001 and 0003 are meant to
-- ship together; between them the read behaviour is exactly what it is today.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Preconditions — fail closed rather than half-apply
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.shops') is null then
    raise exception 'precondition failed: table public.shops does not exist';
  end if;
  if to_regclass('public.tattoos') is null then
    raise exception 'precondition failed: table public.tattoos does not exist';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'shops'
                   and column_name = 'owner_user_id') then
    raise exception 'precondition failed: public.shops.owner_user_id is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'shops'
                   and column_name = 'id') then
    raise exception 'precondition failed: public.shops.id is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tattoos'
                   and column_name = 'shop_id') then
    raise exception 'precondition failed: public.tattoos.shop_id is missing';
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'uid') then
    raise exception 'precondition failed: auth.uid() is missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'precondition failed: role anon is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'precondition failed: role authenticated is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: role service_role is missing';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Authoritative manager check
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the shops lookup does not re-enter the shops policies
-- (no recursive RLS evaluation) and so ownership stays checkable even if the
-- shops SELECT policy is narrowed later.
--
-- `set search_path = ''` is mandatory on SECURITY DEFINER: without it a caller
-- can prepend a schema they control and make the function resolve `shops` to
-- their own table. Every identifier below is schema-qualified for the same
-- reason.
create or replace function public.owns_shop(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shops s
    where s.id = target_shop_id
      and s.owner_user_id = (select auth.uid())
  );
$$;

comment on function public.owns_shop(uuid) is
  'True when the current user owns the given shop. Authoritative manager check used by the RLS policies on public.tattoos.';

-- Least privilege: only signed-in users ever need to ask this question.
revoke all on function public.owns_shop(uuid) from public;
revoke all on function public.owns_shop(uuid) from anon;
grant execute on function public.owns_shop(uuid) to authenticated;
grant execute on function public.owns_shop(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. public.shops
-- -----------------------------------------------------------------------------
alter table public.shops enable row level security;
-- FORCE also subjects the table owner to these policies, so an owner-privileged
-- connection cannot silently sidestep them. (A role with BYPASSRLS -- postgres,
-- service_role -- still bypasses, by design.)
alter table public.shops force row level security;

-- Legacy policies confirmed present on the live database 2026-07-30.
drop policy if exists shops_select_public on public.shops;
drop policy if exists shops_update_owner  on public.shops;
drop policy if exists shops_delete_owner  on public.shops;
-- This migration's own policies, so re-running is safe.
drop policy if exists "shops: public read"  on public.shops;
drop policy if exists "shops: owner update" on public.shops;

-- The shop directory on the home screen is browsable without signing in.
create policy "shops: public read"
  on public.shops
  as permissive
  for select
  to anon, authenticated
  using (true);

-- A shop owner may edit their own shop's details. USING selects only rows they
-- already own; WITH CHECK re-validates the row AFTER the update and so pins
-- owner_user_id -- you cannot hand your shop to someone else, and combined with
-- the absence of an INSERT policy you cannot claim one you do not own.
create policy "shops: owner update"
  on public.shops
  as permissive
  for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- Intentionally NO insert policy and NO delete policy for anon or authenticated.

-- -----------------------------------------------------------------------------
-- 3. public.tattoos
-- -----------------------------------------------------------------------------
alter table public.tattoos enable row level security;
alter table public.tattoos force row level security;

-- Legacy policies confirmed present on the live database 2026-07-30.
drop policy if exists tattoos_select_public on public.tattoos;
drop policy if exists tattoos_insert_owner  on public.tattoos;
drop policy if exists tattoos_update_owner  on public.tattoos;
drop policy if exists tattoos_delete_owner  on public.tattoos;
-- This migration's own policies.
drop policy if exists "tattoos: public read"  on public.tattoos;
drop policy if exists "tattoos: owner insert" on public.tattoos;
drop policy if exists "tattoos: owner update" on public.tattoos;
drop policy if exists "tattoos: owner delete" on public.tattoos;

-- Superseded by migration ...0003, which narrows this to published rows only.
create policy "tattoos: public read"
  on public.tattoos
  as permissive
  for select
  to anon, authenticated
  using (true);

create policy "tattoos: owner insert"
  on public.tattoos
  as permissive
  for insert
  to authenticated
  with check (public.owns_shop(shop_id));

-- Both clauses are required and both are stated explicitly. USING picks the rows
-- you may touch; WITH CHECK validates the row after the update. Without the
-- WITH CHECK an owner could rewrite shop_id and move a tattoo into a shop they
-- do not own. (Postgres would reuse USING as the check here, but relying on that
-- implicit behaviour is exactly the kind of thing that breaks silently.)
create policy "tattoos: owner update"
  on public.tattoos
  as permissive
  for update
  to authenticated
  using (public.owns_shop(shop_id))
  with check (public.owns_shop(shop_id));

create policy "tattoos: owner delete"
  on public.tattoos
  as permissive
  for delete
  to authenticated
  using (public.owns_shop(shop_id));

-- -----------------------------------------------------------------------------
-- 4. Least-privilege grants
-- -----------------------------------------------------------------------------
-- RLS filters rows; grants decide whether the verb is available at all. A table
-- with RLS on but a blanket GRANT ALL still lets a role attempt every operation
-- and depend entirely on policy correctness. Revoking first means a missing
-- policy fails closed.
--
-- This also strips TRUNCATE, which anon and authenticated both held. TRUNCATE
-- bypasses RLS completely. PostgREST never emits it, so it was not reachable
-- through the API, but it is not a privilege either role has any use for.
revoke all on public.shops   from anon, authenticated, service_role;
revoke all on public.tattoos from anon, authenticated, service_role;

-- Anonymous visitors: read-only.
grant select on public.shops   to anon;
grant select on public.tattoos to anon;

-- Signed-in managers: read everything, write only what the policies allow.
-- No DELETE on shops -- see the header.
grant select, update                  on public.shops   to authenticated;
grant select, insert, update, delete  on public.tattoos to authenticated;

-- Backend administration. service_role has BYPASSRLS, so these grants are the
-- only thing standing between it and the data -- it must stay server-side and
-- must never be shipped to the app, a browser, or CI logs.
-- Deliberately no TRUNCATE: there is no demonstrated need for it.
grant select, insert, update, delete on public.shops   to service_role;
grant select, insert, update, delete on public.tattoos to service_role;

-- Narrow the default privileges this role hands out on future tables in public.
-- NOTE: this only affects defaults owned by the role running the migration.
-- A separate default-ACL entry owned by supabase_admin still grants full DML on
-- new tables and cannot be altered from here; the `ensure_rls` event trigger is
-- the compensating control. See finding 4.7 in the divergence report.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Postconditions — assert the exact resulting policy set
-- -----------------------------------------------------------------------------
do $$
declare
  got text;
begin
  select coalesce(string_agg(policyname, ', ' order by policyname), '(none)')
    into got
  from pg_policies where schemaname = 'public' and tablename = 'shops';
  if got <> 'shops: owner update, shops: public read' then
    raise exception 'postcondition failed: unexpected policy set on public.shops -> %', got;
  end if;

  select coalesce(string_agg(policyname, ', ' order by policyname), '(none)')
    into got
  from pg_policies where schemaname = 'public' and tablename = 'tattoos';
  if got <> 'tattoos: owner delete, tattoos: owner insert, tattoos: owner update, tattoos: public read' then
    raise exception 'postcondition failed: unexpected policy set on public.tattoos -> %', got;
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'shops' and cmd = 'DELETE') then
    raise exception 'postcondition failed: a DELETE policy survived on public.shops';
  end if;

  if has_table_privilege('authenticated', 'public.shops', 'DELETE') then
    raise exception 'postcondition failed: authenticated still holds DELETE on public.shops';
  end if;
  if has_table_privilege('anon', 'public.tattoos', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.tattoos', 'TRUNCATE') then
    raise exception 'postcondition failed: TRUNCATE on public.tattoos was not revoked';
  end if;
  if not has_table_privilege('service_role', 'public.shops', 'SELECT') then
    raise exception 'postcondition failed: service_role did not receive SELECT on public.shops';
  end if;
end $$;

commit;
