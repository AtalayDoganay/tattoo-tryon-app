-- =============================================================================
-- 20260730090004_function_hardening.sql
-- Least-privilege EXECUTE on SECURITY DEFINER functions.
--
-- FULL INVENTORY (all schemas except pg_catalog / information_schema, read
-- live on 2026-07-30). Four SECURITY DEFINER functions exist:
--
--   public.rls_auto_enable()      owner postgres, search_path='pg_catalog',
--                                 EXECUTE held by PUBLIC, anon, authenticated,
--                                 service_role                        <-- FIXED HERE
--   pgbouncer.get_auth(text)      owner supabase_admin, search_path='',
--                                 not executable by anon or authenticated   OK
--   vault.create_secret(...)      owner supabase_admin, search_path='',
--                                 not executable by anon or authenticated   OK
--   vault.update_secret(...)      owner supabase_admin, search_path='',
--                                 not executable by anon or authenticated   OK
--
-- The three Supabase-managed ones are already correct: fixed empty search_path
-- and no API-role EXECUTE. They are left alone -- they belong to
-- supabase_admin and are not ours to modify.
--
-- The two functions this branch introduces, public.owns_shop(uuid) and
-- public.is_shop_manager(), are SECURITY DEFINER with `set search_path = ''`
-- and EXECUTE granted only to authenticated and service_role.
--
-- WHY rls_auto_enable IS NOT DROPPED
-- ----------------------------------
-- It is not dead code. It backs the `ensure_rls` event trigger
-- (ddl_command_end, owner postgres, enabled), which auto-enables RLS on every
-- new table created in `public`. That is a genuinely useful control and it is
-- the compensating control for the supabase_admin default-ACL entry that still
-- grants full DML on new public tables to anon (finding 4.7 in the divergence
-- report) and which cannot be altered from a postgres session. Dropping it
-- would make new tables less safe, not more. Only the surplus EXECUTE grants go.
--
-- Removing EXECUTE does not affect the event trigger: an event trigger invokes
-- its function as part of DDL processing under the trigger owner's authority,
-- not via the caller's EXECUTE privilege.
--
-- WHAT THE GRANT ACTUALLY EXPOSED
-- -------------------------------
-- PostgREST published it at /rest/v1/rpc/rls_auto_enable, and the Supabase
-- advisor flagged it twice. Practical impact was low: it returns `event_trigger`
-- and PostgreSQL refuses to execute an event-trigger function outside event
-- trigger context, so a call errors rather than escalating. Its body only calls
-- pg_catalog functions on a format()ed constant, so search_path='pg_catalog' was
-- not exploitable either. This is hygiene and advisor-clearing, not an
-- exploited hole -- recorded plainly so the severity is not overstated.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Preconditions — fail closed
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    raise exception 'precondition failed: public.rls_auto_enable() does not exist';
  end if;
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    raise exception 'precondition failed: event trigger ensure_rls does not exist; refusing to change privileges on a function whose purpose cannot be confirmed';
  end if;
  if to_regprocedure('public.owns_shop(uuid)') is null then
    raise exception 'precondition failed: public.owns_shop(uuid) is missing -- apply 20260730090001_rls_core.sql first';
  end if;
  if to_regprocedure('public.is_shop_manager()') is null then
    raise exception 'precondition failed: public.is_shop_manager() is missing -- apply 20260730090002_storage_policies.sql first';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Revoke the surplus EXECUTE grants
-- -----------------------------------------------------------------------------
-- PUBLIC first: PostgreSQL grants EXECUTE to PUBLIC on new functions by default,
-- and a role-specific revoke does not remove a privilege held via PUBLIC.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public.rls_auto_enable() from service_role;

-- Owner privilege is left intact; the event trigger continues to work.

-- Its search_path is deliberately left as 'pg_catalog' rather than retightened
-- to ''. pg_catalog is a fixed, non-user-writable schema, so it is already a
-- safe pin -- the requirement is a *fixed* search_path, not an *empty* one. This
-- function runs inside DDL processing for every CREATE TABLE in the database;
-- rewriting its definition for cosmetic consistency would risk that path for no
-- security gain. Once the grants below are revoked it is not reachable from the
-- API at all.

-- -----------------------------------------------------------------------------
-- 2. Re-assert least privilege on this branch's own helpers
-- -----------------------------------------------------------------------------
-- Idempotent; guards against a future CREATE OR REPLACE resetting the ACL.
revoke all on function public.owns_shop(uuid)   from public, anon;
revoke all on function public.is_shop_manager() from public, anon;
grant execute on function public.owns_shop(uuid)   to authenticated, service_role;
grant execute on function public.is_shop_manager() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Postconditions
-- -----------------------------------------------------------------------------
do $$
declare
  offender text;
begin
  if has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') then
    raise exception 'postcondition failed: rls_auto_enable() is still executable by an API role';
  end if;

  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled <> 'D') then
    raise exception 'postcondition failed: event trigger ensure_rls is missing or disabled';
  end if;

  if has_function_privilege('anon', 'public.owns_shop(uuid)', 'EXECUTE') then
    raise exception 'postcondition failed: anon can execute public.owns_shop(uuid)';
  end if;
  if has_function_privilege('anon', 'public.is_shop_manager()', 'EXECUTE') then
    raise exception 'postcondition failed: anon can execute public.is_shop_manager()';
  end if;
  if not has_function_privilege('authenticated', 'public.owns_shop(uuid)', 'EXECUTE') then
    raise exception 'postcondition failed: authenticated lost EXECUTE on public.owns_shop(uuid)';
  end if;

  -- The standing rule, enforced rather than asserted in prose: any SECURITY
  -- DEFINER function reachable by an API role must pin its search_path.
  select string_agg(format('%s.%s(%s)', n.nspname, p.proname,
                           pg_get_function_identity_arguments(p.oid)), ', ')
    into offender
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('pg_catalog', 'information_schema')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
      where cfg like 'search_path=%'
    );

  if offender is not null then
    raise exception 'postcondition failed: SECURITY DEFINER function(s) reachable by an API role without a fixed search_path -> %', offender;
  end if;
end $$;

commit;
