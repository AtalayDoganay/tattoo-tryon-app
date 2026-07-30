-- =============================================================================
-- 20260730100217_read_policy_and_index_tuning.sql
-- One SELECT policy per role on public.tattoos, plus the FK covering index.
--
-- WHY
-- ---
-- The Supabase performance advisor raised `multiple_permissive_policies` (WARN):
-- "tattoos: published read" (anon + authenticated) and
-- "tattoos: owner read drafts" (authenticated) both applied to `authenticated`
-- for SELECT, so both had to be evaluated for every row on every read.
--
-- Two permissive policies mean OR, so collapsing them into a single
-- `published or private.owns_shop(shop_id)` is exactly equivalent -- and
-- strictly better, because OR short-circuits: for a published row the
-- owns_shop() call never happens. Splitting by role also makes the intent
-- legible: anon has no ownership concept, so its policy does not mention one.
--
-- It also raised `unindexed_foreign_keys` (INFO) on shops.owner_user_id, which
-- is the manager dashboard's very first query
-- (`select * from shops where owner_user_id = auth.uid()`).
--
-- SECURITY IS UNCHANGED. Verified after applying: an ordinary signed-in
-- non-manager sees the 3 published rows and none of the owner's drafts; the
-- owner sees 4 (3 published + their own draft); anon sees 3.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('private.owns_shop(uuid)') is null then
    raise exception 'precondition failed: private.owns_shop(uuid) is missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tattoos'
                   and policyname='tattoos: published read') then
    raise exception 'precondition failed: policy "tattoos: published read" is missing';
  end if;
end $$;

drop policy if exists "tattoos: published read"      on public.tattoos;
drop policy if exists "tattoos: owner read drafts"   on public.tattoos;
drop policy if exists "tattoos: anon read published" on public.tattoos;
drop policy if exists "tattoos: authenticated read"  on public.tattoos;

-- Visitors: published rows only.
create policy "tattoos: anon read published"
  on public.tattoos
  as permissive
  for select
  to anon
  using (published);

-- Signed-in users: published rows, plus their own shops' drafts. owns_shop()
-- answers only about auth.uid(), so an ordinary signed-in non-manager gets
-- exactly what a visitor gets.
create policy "tattoos: authenticated read"
  on public.tattoos
  as permissive
  for select
  to authenticated
  using (published or private.owns_shop(shop_id));

create index if not exists shops_owner_user_id_idx
  on public.shops (owner_user_id);

do $$
declare got text;
begin
  select coalesce(string_agg(policyname, ', ' order by policyname), '(none)') into got
  from pg_policies where schemaname='public' and tablename='tattoos';
  if got <> 'tattoos: anon read published, tattoos: authenticated read, tattoos: owner delete, tattoos: owner insert, tattoos: owner update' then
    raise exception 'postcondition failed: unexpected policy set on public.tattoos -> %', got;
  end if;

  if (select count(*) from pg_policies
      where schemaname='public' and tablename='tattoos' and cmd='SELECT'
        and 'anon' = any(roles)) <> 1 then
    raise exception 'postcondition failed: anon does not have exactly one SELECT policy on tattoos';
  end if;
  if (select count(*) from pg_policies
      where schemaname='public' and tablename='tattoos' and cmd='SELECT'
        and 'authenticated' = any(roles)) <> 1 then
    raise exception 'postcondition failed: authenticated does not have exactly one SELECT policy on tattoos';
  end if;

  if not exists (select 1 from pg_indexes
                 where schemaname='public' and tablename='shops' and indexname='shops_owner_user_id_idx') then
    raise exception 'postcondition failed: shops_owner_user_id_idx was not created';
  end if;
end $$;

commit;
