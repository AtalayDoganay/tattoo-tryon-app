#!/usr/bin/env node
/**
 * supabase/tests/storage_api_tests.mjs
 *
 * Storage API-layer security tests for the `tattoo-images` bucket.
 *
 * WHY THIS EXISTS SEPARATELY FROM rls_negative_tests.sql
 * ------------------------------------------------------
 * The SQL suite proves the RLS policies on storage.objects. It cannot prove the
 * bucket's MIME allowlist or its 8 MiB cap, because those are enforced by the
 * Storage API before a row is ever written -- there is no SQL path that reaches
 * them. Object bytes only move through that API, so these assertions need real
 * user tokens.
 *
 * TWO WAYS TO RUN
 * ---------------
 * Put credentials in a gitignored .env.local at the repo root. Nothing is ever
 * printed: no token, no password, no user id, no object path.
 *
 * (A) Service-role mode -- one secret, fully automatic. PREFERRED.
 *
 *       SUPABASE_SERVICE_ROLE_KEY=...
 *
 *     The script provisions its own disposable outsider (created already
 *     confirmed, so no email is sent anywhere), discovers the shop owner, mints
 *     an owner session via the admin magic-link endpoint, runs every assertion
 *     with those NORMAL USER tokens, then deletes the outsider and signs both
 *     sessions out.
 *
 *     service_role is used ONLY to provision, mint and clean up. Every security
 *     assertion below runs with an ordinary user token -- service_role bypasses
 *     RLS, so using it as evidence would prove nothing.
 *
 * (B) Explicit-accounts mode -- if you would rather not put the service key on
 *     disk. You supply two existing accounts:
 *
 *       SECTEST_OWNER_EMAIL=...        a manager who owns a shop
 *       SECTEST_OWNER_PASSWORD=...
 *       SECTEST_OUTSIDER_EMAIL=...     an account owning NO shop
 *       SECTEST_OUTSIDER_PASSWORD=...
 *
 * SAFETY
 * ------
 *  - Every object it uploads is named  <uid>/ZZ-SECTEST-<runId>-*  and is
 *    removed in the finally block.
 *  - It never touches an object it did not create.
 *  - In mode (A) it deletes the outsider it created and verifies the deletion.
 *  - It asserts up front that the "outsider" owns no shop, and aborts if it does.
 *
 * RUN:
 *   node --env-file=.env --env-file=.env.local supabase/tests/storage_api_tests.mjs
 */

const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'tattoo-images';
const RUN_ID = Date.now().toString(36);
const OUTSIDER_EMAIL = `secops-outsider-${RUN_ID}@tattooar-sectest.local`;

if (!URL_BASE || !ANON) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

const results = [];
const rec = (id, title, pass, outcome) => results.push({ id, title, pass, outcome });

const admin = (path, init = {}) =>
  fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

/** Password grant. Returns { token, uid } — neither is ever printed. */
async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`sign-in failed for a test account: HTTP ${res.status} ${b.error_code || ''}`);
  }
  const b = await res.json();
  return { token: b.access_token, uid: b.user.id };
}

async function signOut(token) {
  try {
    await fetch(`${URL_BASE}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
  } catch { /* best effort */ }
}

/**
 * Mints a session for an existing user without knowing their password and
 * without sending mail: the admin generate_link endpoint returns a hashed
 * token, which /auth/v1/verify exchanges for a session.
 */
async function sessionForExistingUser(email) {
  const gen = await admin('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!gen.ok) {
    const b = await gen.json().catch(() => ({}));
    throw new Error(`generate_link failed: HTTP ${gen.status} ${b.error_code || b.msg || ''}`);
  }
  const link = await gen.json();
  const hashed = link.properties?.hashed_token || link.hashed_token;
  if (!hashed) throw new Error('generate_link returned no hashed_token');

  const ver = await fetch(`${URL_BASE}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token: hashed }),
  });
  if (!ver.ok) {
    const b = await ver.json().catch(() => ({}));
    throw new Error(`verify failed: HTTP ${ver.status} ${b.error_code || ''}`);
  }
  const b = await ver.json();
  return { token: b.access_token, uid: b.user.id };
}

/** Raw upload against the Storage API. */
async function upload(token, path, body, contentType) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body,
  });
  let code = '';
  try {
    const j = await res.json();
    code = j.error || j.statusCode || j.message || '';
  } catch { /* success bodies may be empty */ }
  return { status: res.status, code: String(code).slice(0, 80) };
}

const remove = (token, path) =>
  fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });

// A genuinely valid 1x1 JPEG, so any rejection can only be about policy or
// bucket rules -- never about the bytes being unparseable.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const cleanup = [];
let provisionedOutsiderId = null;
let ownerToken = null;
let outsiderToken = null;

(async () => {
  let owner, outsider;

  if (SERVICE) {
    // ---- Mode A: provision everything ourselves ---------------------------
    const pw = (await import('node:crypto')).randomBytes(32).toString('base64url');

    const create = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: OUTSIDER_EMAIL,
        password: pw,
        email_confirm: true, // created already confirmed; no mail is sent
        user_metadata: {
          security_test: true,
          purpose: 'Disposable outsider for automated storage/RLS negative tests.',
          delete_after_use: true,
          run_id: RUN_ID,
        },
      }),
    });
    if (!create.ok) {
      const b = await create.json().catch(() => ({}));
      throw new Error(`admin create user failed: HTTP ${create.status} ${b.error_code || b.msg || ''}`);
    }
    provisionedOutsiderId = (await create.json()).id;

    outsider = await signIn(OUTSIDER_EMAIL, pw);

    // Discover the shop owner through PostgREST (service_role has SELECT).
    const shopsRes = await fetch(`${URL_BASE}/rest/v1/shops?select=owner_user_id&limit=1`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const shops = await shopsRes.json();
    if (!Array.isArray(shops) || !shops.length || !shops[0].owner_user_id) {
      throw new Error('could not find a shop with an owner to test against');
    }
    const ownerId = shops[0].owner_user_id;

    const userRes = await admin(`/auth/v1/admin/users/${ownerId}`);
    if (!userRes.ok) throw new Error(`admin get user failed: HTTP ${userRes.status}`);
    const ownerEmail = (await userRes.json()).email;
    if (!ownerEmail) throw new Error('shop owner has no email address');

    owner = await sessionForExistingUser(ownerEmail);
  } else {
    // ---- Mode B: two supplied accounts ------------------------------------
    const oe = process.env.SECTEST_OWNER_EMAIL;
    const op = process.env.SECTEST_OWNER_PASSWORD;
    const xe = process.env.SECTEST_OUTSIDER_EMAIL;
    const xp = process.env.SECTEST_OUTSIDER_PASSWORD;
    if (!oe || !op || !xe || !xp) {
      console.error(
        'SKIPPED: no credentials. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or all four\n' +
        'SECTEST_* variables in a gitignored .env.local. See the header of this file.\n' +
        'No assertion was run.'
      );
      process.exit(3);
    }
    owner = await signIn(oe, op);
    outsider = await signIn(xe, xp);
  }

  ownerToken = owner.token;
  outsiderToken = outsider.token;

  // ---- Fixture sanity: the outsider must own no shop --------------------
  {
    const res = await fetch(
      `${URL_BASE}/rest/v1/shops?select=id&owner_user_id=eq.${outsider.uid}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${outsider.token}` } }
    );
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) {
      throw new Error('fixture invalid: the outsider account owns a shop');
    }
    rec('F1', 'Fixture: outsider owns no shop', true, 'confirmed');
  }

  const ownerDir = `${owner.uid}/ZZ-SECTEST-${RUN_ID}`;
  const outsiderDir = `${outsider.uid}/ZZ-SECTEST-${RUN_ID}`;

  // ---- 10. Outsider cannot upload into the bucket at all ------------------
  {
    const p = `${outsiderDir}-own-folder.jpg`;
    const r = await upload(outsider.token, p, JPEG_1PX, 'image/jpeg');
    if (r.status < 300) cleanup.push([outsider.token, p]);
    rec('10', 'Outsider cannot upload into tattoo-images (owns no shop)',
      r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 11. Outsider cannot upload into the owner's folder -----------------
  {
    const p = `${ownerDir}-hijack.jpg`;
    const r = await upload(outsider.token, p, JPEG_1PX, 'image/jpeg');
    if (r.status < 300) cleanup.push([owner.token, p]);
    rec('11', 'Outsider cannot upload into the owner folder',
      r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 24. Owner CAN upload an allowed image into their own folder --------
  const ownerObj = `${ownerDir}-legit.jpg`;
  {
    const r = await upload(owner.token, ownerObj, JPEG_1PX, 'image/jpeg');
    if (r.status < 300) cleanup.push([owner.token, ownerObj]);
    rec('24', 'Owner can upload an allowed image into their own folder',
      r.status < 300, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 12. Outsider cannot replace, move, or delete the owner's object ----
  {
    const rep = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(ownerObj)}`, {
      method: 'PUT',
      headers: { apikey: ANON, Authorization: `Bearer ${outsider.token}`, 'Content-Type': 'image/jpeg' },
      body: JPEG_1PX,
    });
    rec('12a', 'Outsider cannot replace the owner object', rep.status >= 400, `HTTP ${rep.status}`);

    const mv = await fetch(`${URL_BASE}/storage/v1/object/move`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${outsider.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucketId: BUCKET,
        sourceKey: ownerObj,
        destinationKey: `${outsiderDir}-stolen.jpg`,
      }),
    });
    rec('12b', 'Outsider cannot move the owner object', mv.status >= 400, `HTTP ${mv.status}`);

    const del = await remove(outsider.token, ownerObj);
    rec('12c', 'Outsider cannot delete the owner object', del.status >= 400, `HTTP ${del.status}`);
  }

  // ---- 13-16. Bucket content rules, exercised AS THE OWNER so a rejection
  // can only come from the MIME/size rules and never from RLS --------------
  {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const p = `${ownerDir}-xss.svg`;
    const r = await upload(owner.token, p, svg, 'image/svg+xml');
    if (r.status < 300) cleanup.push([owner.token, p]);
    rec('13', 'SVG upload is rejected', r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }
  {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const p = `${ownerDir}-xss.html`;
    const r = await upload(owner.token, p, html, 'text/html');
    if (r.status < 300) cleanup.push([owner.token, p]);
    rec('14', 'HTML upload is rejected', r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }
  {
    const big = Buffer.concat([JPEG_1PX, Buffer.alloc(9 * 1024 * 1024, 0x20)]);
    const p = `${ownerDir}-oversize.jpg`;
    const r = await upload(owner.token, p, big, 'image/jpeg');
    if (r.status < 300) cleanup.push([owner.token, p]);
    rec('15', 'File over 8 MiB is rejected', r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }
  {
    const p = `${ownerDir}-wrong-type.gif`;
    const r = await upload(owner.token, p, JPEG_1PX, 'image/gif');
    if (r.status < 300) cleanup.push([owner.token, p]);
    rec('16', 'Disallowed MIME type (image/gif) is rejected', r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 25. Owner can replace and delete their own object ------------------
  {
    const rep = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(ownerObj)}`, {
      method: 'PUT',
      headers: { apikey: ANON, Authorization: `Bearer ${owner.token}`, 'Content-Type': 'image/jpeg' },
      body: JPEG_1PX,
    });
    rec('25a', 'Owner can replace their own object', rep.status < 300, `HTTP ${rep.status}`);

    const del = await remove(owner.token, ownerObj);
    const ok = del.status < 300;
    if (ok) {
      const i = cleanup.findIndex(([, p]) => p === ownerObj);
      if (i >= 0) cleanup.splice(i, 1);
    }
    rec('25b', 'Owner can delete their own object', ok, `HTTP ${del.status}`);
  }

  // ---- Public read path still works without auth --------------------------
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/public/${BUCKET}/missing-${RUN_ID}.jpg`);
    rec('P1', 'Public object endpoint reachable unauthenticated (404 for missing, not 401/403)',
      r.status === 404, `HTTP ${r.status}`);
  }

  // ---- Bucket listing is closed to clients --------------------------------
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${outsider.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 100 }),
    });
    const body = await r.json().catch(() => []);
    const empty = Array.isArray(body) && body.length === 0;
    rec('P2', 'Bucket listing returns nothing to a signed-in client',
      r.status >= 400 || empty, `HTTP ${r.status}, ${Array.isArray(body) ? body.length : '?'} entries`);
  }
})()
  .catch((e) => rec('ERR', 'Harness error', false, e.message))
  .finally(async () => {
    // Remove every object this run created, whatever happened above.
    for (const [token, p] of cleanup) {
      try { await remove(token, p); } catch { /* best effort */ }
    }

    // Tear down the disposable account and both sessions.
    if (provisionedOutsiderId && SERVICE) {
      try {
        const d = await admin(`/auth/v1/admin/users/${provisionedOutsiderId}`, { method: 'DELETE' });
        const check = await admin(`/auth/v1/admin/users/${provisionedOutsiderId}`);
        rec('C1', 'Disposable outsider deleted and sessions invalidated',
          d.ok && check.status === 404, `delete HTTP ${d.status}, lookup HTTP ${check.status}`);
      } catch (e) {
        rec('C1', 'Disposable outsider deleted and sessions invalidated', false, e.message);
      }
    }
    if (ownerToken) await signOut(ownerToken);
    if (outsiderToken) await signOut(outsiderToken);

    let failed = 0;
    for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(4)} ${r.title}  [${r.outcome}]`);
    }
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
