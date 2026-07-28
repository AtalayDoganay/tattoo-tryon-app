-- =============================================================================
-- supabase/tests/rls_negative_tests.sql
--
-- Adversarial checks for the policies in supabase/migrations/. Every test
-- asserts that an ATTACK FAILS; the last group asserts that legitimate manager
-- use still works, so a policy that is merely "deny everything" also fails.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   The script ends in ROLLBACK, so it writes nothing permanent.
--   Success looks like a run with no ERROR and a series of "PASS" notices.
--   Any "FAIL:" line means the corresponding policy is missing or too wide.
--
-- BEFORE RUNNING: fill in the three values in the CONFIGURE block below.
-- Real ids are used rather than fabricated ones so the script never has to
-- insert into auth.users.
--
-- NOTE ON PRIVILEGE: the SQL Editor runs as a superuser, which bypasses RLS.
-- Every test therefore switches into the `anon` or `authenticated` role with
-- SET LOCAL ROLE and sets request.jwt.claims, which is exactly how PostgREST
-- executes a request from the app. Tests are meaningless without that switch.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- CONFIGURE
-- ---------------------------------------------------------------------------
create temporary table _cfg on commit drop as
select
  -- A user who OWNS a shop (a manager). Find one with:
  --   select owner_user_id, name from public.shops limit 5;
  '00000000-0000-0000-0000-000000000001'::uuid as manager_uid,

  -- Any signed-up user who owns NO shop. Find one with:
  --   select id from auth.users
  --   where id not in (select owner_user_id from public.shops) limit 1;
  '00000000-0000-0000-0000-000000000002'::uuid as outsider_uid,

  -- The shop owned by manager_uid above.
  '00000000-0000-0000-0000-000000000003'::uuid as shop_id;

do $$
declare
  cfg record;
begin
  select * into cfg from _cfg;
  if not exists (select 1 from public.shops
                 where id = cfg.shop_id and owner_user_id = cfg.manager_uid) then
    raise exception
      'CONFIGURE BLOCK NOT FILLED IN: shop % is not owned by user %. Set real ids at the top of this file.',
      cfg.shop_id, cfg.manager_uid;
  end if;
  if exists (select 1 from public.shops where owner_user_id = cfg.outsider_uid) then
    raise exception
      'CONFIGURE BLOCK INVALID: outsider_uid % owns a shop, so it cannot test the non-manager case.',
      cfg.outsider_uid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers: become an anonymous visitor / a specific signed-in user
-- ---------------------------------------------------------------------------
create or replace function pg_temp.be_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role anon';
end $$;

create or replace function pg_temp.be_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.be_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end $$;

-- ===========================================================================
-- GROUP 1 — Anonymous visitors must not write
-- ===========================================================================
do $$
declare cfg record;
begin
  select * into cfg from _cfg;

  -- 1.1 anon INSERT tattoo
  begin
    perform pg_temp.be_anon();
    insert into public.tattoos (shop_id, name, image_url)
    values (cfg.shop_id, 'pwned', 'https://evil.example/x.png');
    perform pg_temp.be_admin();
    raise exception 'FAIL 1.1: anonymous user inserted a tattoo';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 1.1: anonymous INSERT on tattoos denied';
  end;

  -- 1.2 anon DELETE tattoo
  begin
    perform pg_temp.be_anon();
    delete from public.tattoos where shop_id = cfg.shop_id;
    perform pg_temp.be_admin();
    raise exception 'FAIL 1.2: anonymous user deleted tattoos';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 1.2: anonymous DELETE on tattoos denied';
  end;

  -- 1.3 anon UPDATE shop ownership
  begin
    perform pg_temp.be_anon();
    update public.shops set owner_user_id = cfg.outsider_uid where id = cfg.shop_id;
    perform pg_temp.be_admin();
    raise exception 'FAIL 1.3: anonymous user rewrote shop ownership';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 1.3: anonymous UPDATE on shops denied';
  end;
end $$;

-- ===========================================================================
-- GROUP 2 — A signed-in non-manager must not gain manager powers
-- ===========================================================================
do $$
declare
  cfg record;
  affected int;
begin
  select * into cfg from _cfg;

  -- 2.1 The self-promotion attack: point an existing shop at myself.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    update public.shops set owner_user_id = cfg.outsider_uid where id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    if affected > 0 then
      raise exception 'FAIL 2.1: non-manager took ownership of a shop (% rows)', affected;
    end if;
    -- 0 rows is the correct outcome: the USING clause matched nothing.
    raise notice 'PASS 2.1: non-manager could not take shop ownership (0 rows)';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 2.1: non-manager UPDATE on shops denied outright';
  end;

  -- 2.2 Create my own shop to become a manager.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into public.shops (name, slug, owner_user_id)
    values ('pwned shop', 'pwned-shop', cfg.outsider_uid);
    perform pg_temp.be_admin();
    raise exception 'FAIL 2.2: non-manager created their own shop';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 2.2: INSERT on shops denied (no self-provisioning)';
  end;

  -- 2.3 Write a tattoo into a shop I do not own.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into public.tattoos (shop_id, name, image_url)
    values (cfg.shop_id, 'pwned', 'https://evil.example/x.png');
    perform pg_temp.be_admin();
    raise exception 'FAIL 2.3: non-manager inserted into another shop';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 2.3: non-manager INSERT into foreign shop denied';
  end;

  -- 2.4 Delete another shop's tattoos.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    delete from public.tattoos where shop_id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    if affected > 0 then
      raise exception 'FAIL 2.4: non-manager deleted % foreign tattoo rows', affected;
    end if;
    raise notice 'PASS 2.4: non-manager DELETE affected 0 foreign rows';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 2.4: non-manager DELETE denied outright';
  end;
end $$;

-- ===========================================================================
-- GROUP 3 — Storage: unauthorized upload / delete must fail
-- ===========================================================================
do $$
declare cfg record;
begin
  select * into cfg from _cfg;

  -- 3.1 Anonymous upload.
  begin
    perform pg_temp.be_anon();
    insert into storage.objects (bucket_id, name, owner)
    values ('tattoo-images', 'anon-upload.png', null);
    perform pg_temp.be_admin();
    raise exception 'FAIL 3.1: anonymous upload to tattoo-images succeeded';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 3.1: anonymous storage INSERT denied';
  end;

  -- 3.2 Non-manager uploading into ANOTHER user's folder.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into storage.objects (bucket_id, name, owner)
    values ('tattoo-images', cfg.manager_uid::text || '/hijack.png', cfg.outsider_uid);
    perform pg_temp.be_admin();
    raise exception 'FAIL 3.2: user wrote into another user''s storage folder';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 3.2: cross-folder storage INSERT denied';
  end;

  -- 3.3 Non-manager uploading into their OWN folder while owning no shop.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into storage.objects (bucket_id, name, owner)
    values ('tattoo-images', cfg.outsider_uid::text || '/freehost.png', cfg.outsider_uid);
    perform pg_temp.be_admin();
    raise exception 'FAIL 3.3: non-manager used the bucket as free file hosting';
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    raise notice 'PASS 3.3: non-manager storage INSERT denied (no shop owned)';
  end;
end $$;

-- ===========================================================================
-- GROUP 4 — Legitimate manager operations must still work
-- (guards against policies that are simply too restrictive)
-- ===========================================================================
do $$
declare
  cfg record;
  new_id uuid;
begin
  select * into cfg from _cfg;

  perform pg_temp.be_user(cfg.manager_uid);

  insert into public.tattoos (shop_id, name, image_url)
  values (cfg.shop_id, 'rls-test-row', 'https://example.invalid/test.png')
  returning id into new_id;
  raise notice 'PASS 4.1: manager inserted into their own shop';

  update public.tattoos set name = 'rls-test-row-renamed' where id = new_id;
  raise notice 'PASS 4.2: manager updated their own tattoo';

  delete from public.tattoos where id = new_id;
  raise notice 'PASS 4.3: manager deleted their own tattoo';

  perform pg_temp.be_admin();
exception when others then
  perform pg_temp.be_admin();
  raise exception 'FAIL group 4: legitimate manager operation was blocked -> %', sqlerrm;
end $$;

-- ===========================================================================
-- GROUP 5 — Draft visibility
-- Only meaningful once the OPTIONAL migration 20260728000003 is applied.
-- Skipped automatically when the `published` column does not exist.
-- ===========================================================================
do $$
declare
  cfg record;
  visible int;
  draft_id uuid;
begin
  select * into cfg from _cfg;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tattoos' and column_name = 'published'
  ) then
    raise notice 'SKIP 5: no `published` column (optional migration not applied)';
    return;
  end if;

  perform pg_temp.be_admin();
  insert into public.tattoos (shop_id, name, image_url, published)
  values (cfg.shop_id, 'secret-draft', 'https://example.invalid/draft.png', false)
  returning id into draft_id;

  perform pg_temp.be_anon();
  select count(*) into visible from public.tattoos where id = draft_id;
  perform pg_temp.be_admin();
  if visible > 0 then
    raise exception 'FAIL 5.1: anonymous visitor could read an unpublished draft';
  end if;
  raise notice 'PASS 5.1: draft hidden from anonymous visitor';

  perform pg_temp.be_user(cfg.manager_uid);
  select count(*) into visible from public.tattoos where id = draft_id;
  perform pg_temp.be_admin();
  if visible = 0 then
    raise exception 'FAIL 5.2: owning manager could not read their own draft';
  end if;
  raise notice 'PASS 5.2: owning manager can read their own draft';
end $$;

-- Nothing above is persisted.
rollback;
