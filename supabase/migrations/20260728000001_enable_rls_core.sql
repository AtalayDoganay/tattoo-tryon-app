-- =============================================================================
-- 20260728000001_enable_rls_core.sql
-- Row Level Security for the two tables this application actually uses.
--
--   !! NOT YET APPLIED TO THE DEPLOYED PROJECT (ref: bntoeowrvvhuaypddxnl) !!
--   The project was INACTIVE (paused) during this audit, so the live schema
--   could not be read and this migration could not be verified against it.
--   Review, then apply per SUPABASE_SECURITY_CHECKLIST.md.
--
-- Scope was derived strictly from Supabase calls found in the app source:
--   public.shops    -> app/(tabs)/index.tsx, lib/tattoo-data.ts,
--                      app/manager/index.tsx, app/tattoo/[id].tsx
--   public.tattoos  -> app/(tabs)/index.tsx, app/gallery.tsx,
--                      app/tattoo/[id].tsx, app/tryon/[id].tsx,
--                      app/manager/index.tsx
-- No other table, view, or RPC is referenced by the client. Nothing here was
-- invented; if your schema has additional tables they are NOT covered.
--
-- Authorization model
-- -------------------
-- There is deliberately no `role` or `is_manager` column anywhere. "Manager"
-- is defined structurally: you are a manager of a shop if and only if
-- public.shops.owner_user_id equals your auth.uid(). Because no policy below
-- grants INSERT or UPDATE on public.shops to anon or authenticated, a signed-in
-- user cannot create a shop for themselves or repoint an existing shop's
-- owner_user_id at their own id. Self-promotion is therefore not expressible
-- through the public API — it requires the service_role key or the dashboard.
--
-- The React Native screens still check for a session, but only for UX. These
-- policies are the authoritative control.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Manager check
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the lookup reads public.shops with the function owner's
-- rights. That keeps the tattoos policies from re-entering the shops policies
-- (no recursive RLS evaluation) and means shop ownership stays checkable even
-- if the shops SELECT policy is later narrowed.
--
-- `set search_path = ''` is mandatory on a SECURITY DEFINER function: without
-- it, a caller can prepend a schema they control and have the function resolve
-- `shops` to their own table. Every identifier below is fully qualified for the
-- same reason.
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
  'True when the current user owns the given shop. Authoritative manager check used by RLS policies on public.tattoos.';

revoke all on function public.owns_shop(uuid) from public;
revoke all on function public.owns_shop(uuid) from anon;
grant execute on function public.owns_shop(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. public.shops
-- -----------------------------------------------------------------------------
alter table public.shops enable row level security;
-- FORCE also subjects the table owner to these policies, so a future
-- owner-privileged connection cannot silently sidestep them.
alter table public.shops force row level security;

-- Start from a clean slate so re-running cannot leave an older, wider policy in
-- place alongside the new one (policies are permissive and therefore additive).
drop policy if exists "shops: public read" on public.shops;
drop policy if exists "shops: owner update" on public.shops;

-- The shop directory on the home screen is browsable without signing in.
create policy "shops: public read"
  on public.shops
  for select
  to anon, authenticated
  using (true);

-- A shop owner may edit their own shop's details, but the USING/WITH CHECK pair
-- pins owner_user_id: USING selects only rows they already own, and WITH CHECK
-- rejects any result row whose owner_user_id is no longer theirs. That blocks
-- handing your shop to someone else and, combined with the absence of an INSERT
-- policy, blocks claiming a shop you do not own.
create policy "shops: owner update"
  on public.shops
  for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- Intentionally NO insert/delete policy for anon or authenticated.
-- Shop provisioning and removal are administrative actions performed with the
-- service_role key or from the Supabase dashboard.

-- -----------------------------------------------------------------------------
-- 3. public.tattoos
-- -----------------------------------------------------------------------------
alter table public.tattoos enable row level security;
alter table public.tattoos force row level security;

drop policy if exists "tattoos: public read" on public.tattoos;
drop policy if exists "tattoos: manager insert" on public.tattoos;
drop policy if exists "tattoos: manager update" on public.tattoos;
drop policy if exists "tattoos: manager delete" on public.tattoos;

-- The gallery, home slideshow, detail screen and try-on screens all read
-- tattoos without a session, so anonymous SELECT is required for the product to
-- work as it does today.
--
-- NOTE: this exposes every row. The current schema has no draft/published
-- concept -- no client query filters on such a column and the manager insert
-- does not set one. If you want unpublished drafts, apply the OPTIONAL
-- migration 20260728000003 and then replace this policy with the restricted
-- version it provides.
create policy "tattoos: public read"
  on public.tattoos
  for select
  to anon, authenticated
  using (true);

-- Writes require owning the shop the row belongs to.
create policy "tattoos: manager insert"
  on public.tattoos
  for insert
  to authenticated
  with check (public.owns_shop(shop_id));

-- USING picks the rows you may touch; WITH CHECK validates the row after the
-- update. Both are needed, otherwise a manager could move a tattoo into
-- another shop by rewriting shop_id.
create policy "tattoos: manager update"
  on public.tattoos
  for update
  to authenticated
  using (public.owns_shop(shop_id))
  with check (public.owns_shop(shop_id));

create policy "tattoos: manager delete"
  on public.tattoos
  for delete
  to authenticated
  using (public.owns_shop(shop_id));

-- -----------------------------------------------------------------------------
-- 4. Least-privilege table grants
-- -----------------------------------------------------------------------------
-- RLS filters rows; grants decide whether the verb is available at all. Both
-- matter: a table with RLS enabled but a blanket GRANT ALL still lets a role
-- attempt every operation and rely solely on policy correctness. Revoking first
-- means a missing policy fails closed.
revoke all on public.shops from anon, authenticated;
revoke all on public.tattoos from anon, authenticated;

-- Anonymous visitors: read-only.
grant select on public.shops to anon;
grant select on public.tattoos to anon;

-- Signed-in managers: read everything, write only what the policies allow.
grant select, update on public.shops to authenticated;
grant select, insert, update, delete on public.tattoos to authenticated;

-- Stop future tables in `public` from being world-writable by default.
alter default privileges in schema public revoke all on tables from anon, authenticated;

commit;
