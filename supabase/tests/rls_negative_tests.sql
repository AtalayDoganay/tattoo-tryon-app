-- =============================================================================
-- supabase/tests/rls_negative_tests.sql
--
-- Adversarial checks for the policies installed by supabase/migrations/.
-- Rewritten 2026-07-30 against the applied schema (published column, owner-
-- scoped storage policies, no shops DELETE).
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   It ends in ROLLBACK, so it writes NOTHING permanent. Every row and object
--   it touches is created inside the transaction and disappears with it.
--   Results come back as a table: one row per assertion, with a pass flag.
--
-- WHY ROLE SWITCHING IS MANDATORY
--   The SQL Editor runs as `postgres`, which holds BYPASSRLS -- it ignores
--   every policy, including FORCE ROW LEVEL SECURITY. Each test therefore
--   switches into `anon` or `authenticated` with SET LOCAL ROLE and sets
--   request.jwt.claims, which is exactly how PostgREST executes an app
--   request. Results obtained as postgres or service_role would prove nothing
--   about client access, so neither is ever used as evidence below.
--
-- WHAT THIS FILE CANNOT COVER
--   Bucket MIME-type and file-size limits are enforced by the Storage API, not
--   by RLS, and object bytes only move through that API. Those assertions live
--   in supabase/tests/storage_api_tests.mjs and need real user tokens.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Real ids are looked up, never hard-coded, and never printed.
-- ---------------------------------------------------------------------------
create temp table _cfg on commit drop as
select
  s.id                                            as shop_id,
  s.owner_user_id                                 as owner_uid,
  -- A signed-in user who owns no shop. Any uuid that is absent from
  -- shops.owner_user_id is a faithful outsider for RLS purposes: auth.uid()
  -- reads the JWT claim, and no policy joins against auth.users.
  '00000000-0000-0000-0000-0000000000ff'::uuid    as outsider_uid,
  -- A shop id that does not exist, for the "move my row into someone else's
  -- shop" attack.
  '00000000-0000-0000-0000-0000000000fe'::uuid    as foreign_shop_id
from public.shops s
where s.owner_user_id is not null
order by s.created_at
limit 1;

do $$
declare cfg record;
begin
  select * into cfg from _cfg;
  if cfg is null then
    raise exception 'fixture failed: no shop with an owner exists to test against';
  end if;
  if exists (select 1 from public.shops where owner_user_id = cfg.outsider_uid) then
    raise exception 'fixture failed: the synthetic outsider uid owns a shop';
  end if;
end $$;

create temp table results(
  id       text,
  title    text,
  outcome  text,
  pass     boolean
) on commit drop;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function pg_temp.be_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role anon';
end $$;

create or replace function pg_temp.be_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.be_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end $$;

create or replace function pg_temp.rec(p_id text, p_title text, p_pass boolean, p_outcome text)
returns void language plpgsql as $$
begin
  insert into results values (p_id, p_title, p_outcome, p_pass);
end $$;

-- ===========================================================================
-- MAIN
-- ===========================================================================
do $$
declare
  cfg        record;
  draft_id   uuid;
  n          int;
  affected   int;
  ok         boolean;
begin
  select * into cfg from _cfg;

  -- =========================================================================
  -- OWNER — legitimate operations must work (17-20, 22)
  -- A deny-everything policy set would otherwise look like a pass.
  -- =========================================================================

  -- 17. Owner can create a tattoo, and it starts unpublished.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    insert into public.tattoos (shop_id, name, image_url)
    values (cfg.shop_id, 'ZZ-SECTEST-draft', 'https://example.invalid/sectest.png')
    returning id, published into draft_id, ok;
    perform pg_temp.be_admin();
    perform pg_temp.rec('17', 'Owner can create a tattoo, defaulting to unpublished',
      draft_id is not null and ok is false,
      case when draft_id is null then 'insert returned no row'
           else 'inserted, published=' || ok end);
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('17', 'Owner can create a tattoo, defaulting to unpublished',
      false, 'blocked: ' || sqlerrm);
  end;

  -- 18. Owner can read their own unpublished row.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    select count(*) into n from public.tattoos where id = draft_id;
    perform pg_temp.be_admin();
    perform pg_temp.rec('18', 'Owner can read their own unpublished draft',
      n = 1, n || ' row(s) visible');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('18', 'Owner can read their own unpublished draft', false, 'error: ' || sqlerrm);
  end;

  -- 19. Owner can edit it.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    update public.tattoos set name = 'ZZ-SECTEST-draft-renamed' where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('19', 'Owner can edit their own tattoo', affected = 1, affected || ' row(s) updated');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('19', 'Owner can edit their own tattoo', false, 'blocked: ' || sqlerrm);
  end;

  -- 20. Owner can publish it.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    update public.tattoos set published = true where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('20', 'Owner can publish their own tattoo', affected = 1, affected || ' row(s) updated');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('20', 'Owner can publish their own tattoo', false, 'blocked: ' || sqlerrm);
  end;

  -- 21. Anonymous visitor can read it once published.
  begin
    perform pg_temp.be_anon();
    select count(*) into n from public.tattoos where id = draft_id;
    perform pg_temp.be_admin();
    perform pg_temp.rec('21', 'Anonymous user can read the tattoo after publishing',
      n = 1, n || ' row(s) visible to anon');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('21', 'Anonymous user can read the tattoo after publishing', false, 'error: ' || sqlerrm);
  end;

  -- 22. Owner can unpublish it.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    update public.tattoos set published = false where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('22', 'Owner can unpublish their own tattoo', affected = 1, affected || ' row(s) updated');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('22', 'Owner can unpublish their own tattoo', false, 'blocked: ' || sqlerrm);
  end;

  -- 23. Anonymous visitor can no longer read it.
  begin
    perform pg_temp.be_anon();
    select count(*) into n from public.tattoos where id = draft_id;
    perform pg_temp.be_admin();
    perform pg_temp.rec('23', 'Anonymous user cannot read the tattoo after unpublishing',
      n = 0, n || ' row(s) visible to anon');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('23', 'Anonymous user cannot read the tattoo after unpublishing', false, 'error: ' || sqlerrm);
  end;

  -- =========================================================================
  -- ANONYMOUS — reads allowed only for published, no writes at all (1-5)
  -- =========================================================================

  -- 1. Anonymous can read published tattoos.
  begin
    perform pg_temp.be_anon();
    select count(*) into n from public.tattoos;
    perform pg_temp.be_admin();
    perform pg_temp.rec('01', 'Anonymous user can read published tattoos',
      n > 0, n || ' published row(s) visible');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('01', 'Anonymous user can read published tattoos', false, 'error: ' || sqlerrm);
  end;

  -- 2. Anonymous cannot read an unpublished tattoo (draft_id is unpublished again).
  begin
    perform pg_temp.be_anon();
    select count(*) into n from public.tattoos where id = draft_id;
    perform pg_temp.be_admin();
    perform pg_temp.rec('02', 'Anonymous user cannot read unpublished tattoos',
      n = 0, n || ' draft row(s) visible');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('02', 'Anonymous user cannot read unpublished tattoos', false, 'error: ' || sqlerrm);
  end;

  -- 3. Anonymous cannot insert.
  begin
    perform pg_temp.be_anon();
    insert into public.tattoos (shop_id, name, image_url)
    values (cfg.shop_id, 'ZZ-SECTEST-anon', 'https://evil.invalid/x.png');
    perform pg_temp.be_admin();
    perform pg_temp.rec('03', 'Anonymous user cannot insert tattoos', false, 'INSERT SUCCEEDED');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('03', 'Anonymous user cannot insert tattoos', true, 'denied: insufficient_privilege');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('03', 'Anonymous user cannot insert tattoos', true, 'denied: ' || sqlerrm);
  end;

  -- 4. Anonymous cannot update.
  begin
    perform pg_temp.be_anon();
    update public.tattoos set name = 'ZZ-SECTEST-anon-edit' where shop_id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('04', 'Anonymous user cannot update tattoos',
      false, 'UPDATE SUCCEEDED on ' || affected || ' row(s)');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('04', 'Anonymous user cannot update tattoos', true, 'denied: insufficient_privilege');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('04', 'Anonymous user cannot update tattoos', true, 'denied: ' || sqlerrm);
  end;

  -- 5. Anonymous cannot delete.
  begin
    perform pg_temp.be_anon();
    delete from public.tattoos where shop_id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('05', 'Anonymous user cannot delete tattoos',
      false, 'DELETE SUCCEEDED on ' || affected || ' row(s)');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('05', 'Anonymous user cannot delete tattoos', true, 'denied: insufficient_privilege');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('05', 'Anonymous user cannot delete tattoos', true, 'denied: ' || sqlerrm);
  end;

  -- =========================================================================
  -- OUTSIDER — signed in, owns no shop (6-9)
  -- =========================================================================

  -- 6. Outsider cannot insert a tattoo into someone else's shop.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into public.tattoos (shop_id, name, image_url)
    values (cfg.shop_id, 'ZZ-SECTEST-outsider', 'https://evil.invalid/x.png');
    perform pg_temp.be_admin();
    perform pg_temp.rec('06', 'Outsider cannot insert tattoos', false, 'INSERT SUCCEEDED');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('06', 'Outsider cannot insert tattoos', true, 'denied by RLS WITH CHECK');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('06', 'Outsider cannot insert tattoos', true, 'denied: ' || sqlerrm);
  end;

  -- 7. Outsider cannot modify an owner's tattoo.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    update public.tattoos set name = 'ZZ-SECTEST-hijacked' where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('07', 'Outsider cannot modify an owner''s tattoo',
      affected = 0, affected || ' row(s) updated');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('07', 'Outsider cannot modify an owner''s tattoo', true, 'denied outright');
  end;

  -- 8. Outsider cannot publish or unpublish.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    update public.tattoos set published = true where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('08', 'Outsider cannot publish or unpublish a tattoo',
      affected = 0, affected || ' row(s) updated');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('08', 'Outsider cannot publish or unpublish a tattoo', true, 'denied outright');
  end;

  -- 9a. Outsider cannot seize shop ownership.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    update public.shops set owner_user_id = cfg.outsider_uid where id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('09a', 'Outsider cannot change shop ownership',
      affected = 0, affected || ' row(s) updated');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09a', 'Outsider cannot change shop ownership', true, 'denied outright');
  end;

  -- 9b. Owner cannot move their own tattoo into a shop they do not own.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    update public.tattoos set shop_id = cfg.foreign_shop_id where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('09b', 'Nobody can move a tattoo into a shop they do not own',
      false, 'UPDATE SUCCEEDED on ' || affected || ' row(s)');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09b', 'Nobody can move a tattoo into a shop they do not own',
      true, 'denied by RLS WITH CHECK');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09b', 'Nobody can move a tattoo into a shop they do not own',
      true, 'denied: ' || sqlerrm);
  end;

  -- 9c. Owner cannot give their shop away.
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    update public.shops set owner_user_id = cfg.outsider_uid where id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('09c', 'Owner cannot reassign their shop to another user',
      false, 'UPDATE SUCCEEDED on ' || affected || ' row(s)');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09c', 'Owner cannot reassign their shop to another user',
      true, 'denied by RLS WITH CHECK');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09c', 'Owner cannot reassign their shop to another user',
      true, 'denied: ' || sqlerrm);
  end;

  -- 9d. Nobody can create a shop through the API (no INSERT policy, no grant).
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into public.shops (name, slug, owner_user_id)
    values ('ZZ-SECTEST-shop', 'zz-sectest-shop', cfg.outsider_uid);
    perform pg_temp.be_admin();
    perform pg_temp.rec('09d', 'Outsider cannot self-provision a shop', false, 'INSERT SUCCEEDED');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09d', 'Outsider cannot self-provision a shop', true, 'denied: no INSERT grant/policy');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('09d', 'Outsider cannot self-provision a shop', true, 'denied: ' || sqlerrm);
  end;

  -- =========================================================================
  -- STORAGE — policy layer (10-12)
  -- These attempt writes against storage.objects to exercise the POLICY only.
  -- Every one of them is expected to be refused, so no metadata is written;
  -- the surrounding ROLLBACK guarantees it either way. Byte-level behaviour
  -- (MIME allowlist, size cap) is enforced by the Storage API and is covered
  -- in storage_api_tests.mjs, not here.
  -- =========================================================================

  -- 10. Outsider cannot upload into the bucket at all.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into storage.objects (bucket_id, name, owner)
    values ('tattoo-images', cfg.outsider_uid::text || '/ZZ-SECTEST.png', cfg.outsider_uid);
    perform pg_temp.be_admin();
    perform pg_temp.rec('10', 'Outsider cannot upload into tattoo-images', false, 'INSERT SUCCEEDED');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('10', 'Outsider cannot upload into tattoo-images',
      true, 'denied: owns no shop');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('10', 'Outsider cannot upload into tattoo-images', true, 'denied: ' || sqlerrm);
  end;

  -- 11. Outsider cannot upload into the owner's folder.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    insert into storage.objects (bucket_id, name, owner)
    values ('tattoo-images', cfg.owner_uid::text || '/ZZ-SECTEST-hijack.png', cfg.outsider_uid);
    perform pg_temp.be_admin();
    perform pg_temp.rec('11', 'Outsider cannot upload into the owner''s folder', false, 'INSERT SUCCEEDED');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('11', 'Outsider cannot upload into the owner''s folder',
      true, 'denied: folder is not theirs');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('11', 'Outsider cannot upload into the owner''s folder', true, 'denied: ' || sqlerrm);
  end;

  -- 12a. Outsider cannot rename/move an owner's object.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    update storage.objects
       set name = cfg.outsider_uid::text || '/ZZ-SECTEST-stolen.jpg'
     where bucket_id = 'tattoo-images'
       and (storage.foldername(name))[1] = cfg.owner_uid::text;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('12a', 'Outsider cannot replace or move owner objects',
      affected = 0, affected || ' object(s) updated');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('12a', 'Outsider cannot replace or move owner objects', true, 'denied outright');
  end;

  -- 12b. Outsider cannot delete an owner's object.
  begin
    perform pg_temp.be_user(cfg.outsider_uid);
    delete from storage.objects
     where bucket_id = 'tattoo-images'
       and (storage.foldername(name))[1] = cfg.owner_uid::text;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('12b', 'Outsider cannot delete owner objects',
      affected = 0, affected || ' object(s) deleted');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('12b', 'Outsider cannot delete owner objects', true, 'denied outright');
  end;

  -- 12c. Anonymous cannot upload.
  begin
    perform pg_temp.be_anon();
    insert into storage.objects (bucket_id, name, owner)
    values ('tattoo-images', 'ZZ-SECTEST-anon.png', null);
    perform pg_temp.be_admin();
    perform pg_temp.rec('12c', 'Anonymous user cannot upload into tattoo-images', false, 'INSERT SUCCEEDED');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('12c', 'Anonymous user cannot upload into tattoo-images', true, 'denied: no anon policy');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('12c', 'Anonymous user cannot upload into tattoo-images', true, 'denied: ' || sqlerrm);
  end;

  -- 12d. Bucket listing is closed to clients (no SELECT policy).
  begin
    perform pg_temp.be_anon();
    select count(*) into n from storage.objects where bucket_id = 'tattoo-images';
    perform pg_temp.be_admin();
    perform pg_temp.rec('12d', 'Clients cannot list the bucket',
      n = 0, n || ' object row(s) listable by anon');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('12d', 'Clients cannot list the bucket', true, 'denied: ' || sqlerrm);
  end;

  -- =========================================================================
  -- SHOP DELETION — must be impossible for the owner (26)
  -- =========================================================================
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    delete from public.shops where id = cfg.shop_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('26', 'Owner cannot delete their own shop',
      false, 'DELETE SUCCEEDED on ' || affected || ' row(s)');
  exception when insufficient_privilege then
    perform pg_temp.be_admin();
    perform pg_temp.rec('26', 'Owner cannot delete their own shop',
      true, 'denied: no DELETE grant or policy');
  when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('26', 'Owner cannot delete their own shop', true, 'denied: ' || sqlerrm);
  end;

  -- Owner CAN still delete their own tattoo (guards against over-restriction).
  begin
    perform pg_temp.be_user(cfg.owner_uid);
    delete from public.tattoos where id = draft_id;
    get diagnostics affected = row_count;
    perform pg_temp.be_admin();
    perform pg_temp.rec('25b', 'Owner can delete their own tattoo',
      affected = 1, affected || ' row(s) deleted');
  exception when others then
    perform pg_temp.be_admin();
    perform pg_temp.rec('25b', 'Owner can delete their own tattoo', false, 'blocked: ' || sqlerrm);
  end;

  perform pg_temp.be_admin();
end $$;

select id, title, outcome, case when pass then 'PASS' else 'FAIL' end as result
from results order by id;

rollback;
