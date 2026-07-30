-- =============================================================================
-- 20260730100013_private_helper_schema.sql
-- Move the RLS helper functions out of the PostgREST-exposed schema.
--
-- WHY
-- ---
-- After ...094958 the Supabase security advisor raised
-- `authenticated_security_definer_function_executable` for both
-- public.owns_shop(uuid) and public.is_shop_manager(): PostgREST serves every
-- function in `public`, so both had become RPC endpoints
-- (/rest/v1/rpc/owns_shop, /rest/v1/rpc/is_shop_manager).
--
-- Neither leaks anything. Both answer only about auth.uid() -- owns_shop takes
-- a shop id but reports whether *the caller* owns it, and is_shop_manager takes
-- no argument at all -- so neither can be used as an oracle about another user,
-- and shops.owner_user_id is already readable by anyone via "shops: public read".
-- The finding is about exposure surface, not disclosure.
--
-- WHY NOT JUST REVOKE EXECUTE
-- ---------------------------
-- Because it would break every tattoos policy. RLS policy expressions are
-- evaluated with the *querying role's* privileges, so `authenticated` must keep
-- EXECUTE on owns_shop() for "tattoos: owner insert/update/delete" to work at
-- all. Removing the endpoint while keeping the privilege means relocating the
-- function to a schema PostgREST does not serve.
--
-- Policies reference functions by OID, so ALTER FUNCTION ... SET SCHEMA is
-- transparent to them -- no policy is recreated here. The bodies already
-- schema-qualify public.shops and pin `search_path = ''`, so relocating the
-- function changes nothing about what they resolve.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.owns_shop(uuid)') is null then
    raise exception 'precondition failed: public.owns_shop(uuid) is missing';
  end if;
  if to_regprocedure('public.is_shop_manager()') is null then
    raise exception 'precondition failed: public.is_shop_manager() is missing';
  end if;
end $$;

create schema if not exists private;

comment on schema private is
  'Internal helpers called from RLS policies. Deliberately outside the PostgREST-exposed schema list so nothing here becomes an RPC endpoint.';

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

alter function public.owns_shop(uuid)   set schema private;
alter function public.is_shop_manager() set schema private;

revoke all on function private.owns_shop(uuid)   from public, anon;
revoke all on function private.is_shop_manager() from public, anon;
grant execute on function private.owns_shop(uuid)   to authenticated, service_role;
grant execute on function private.is_shop_manager() to authenticated, service_role;

do $$
declare
  offender text;
begin
  if to_regprocedure('private.owns_shop(uuid)') is null then
    raise exception 'postcondition failed: private.owns_shop(uuid) missing after move';
  end if;
  if to_regprocedure('public.owns_shop(uuid)') is not null then
    raise exception 'postcondition failed: public.owns_shop(uuid) still exists';
  end if;
  if to_regprocedure('public.is_shop_manager()') is not null then
    raise exception 'postcondition failed: public.is_shop_manager() still exists';
  end if;

  if not has_function_privilege('authenticated', 'private.owns_shop(uuid)', 'EXECUTE') then
    raise exception 'postcondition failed: authenticated cannot execute private.owns_shop(uuid); every tattoos policy would break';
  end if;
  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'postcondition failed: anon has USAGE on schema private';
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'tattoos'
                   and policyname = 'tattoos: owner insert'
                   and with_check like '%owns_shop%') then
    raise exception 'postcondition failed: tattoos owner insert policy no longer references owns_shop';
  end if;

  select string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    into offender
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname = 'public'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if offender is not null then
    raise exception 'postcondition failed: SECURITY DEFINER function(s) still API-reachable in public -> %', offender;
  end if;
end $$;

commit;
