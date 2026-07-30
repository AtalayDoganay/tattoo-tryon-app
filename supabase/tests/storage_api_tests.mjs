#!/usr/bin/env node
/**
 * supabase/tests/storage_api_tests.mjs
 *
 * Storage API-layer security tests for the `tattoo-images` bucket.
 *
 * WHY THIS EXISTS SEPARATELY FROM rls_negative_tests.sql
 * ------------------------------------------------------
 * The SQL suite proves the RLS policies on storage.objects. It cannot prove the
 * bucket's MIME allowlist or its 8 MiB size cap, because those are enforced by
 * the Storage API before a row is ever written -- there is no SQL path that
 * exercises them. Object bytes only move through that API, so these assertions
 * need real user tokens.
 *
 * WHAT IT NEEDS
 * -------------
 * Put these in a gitignored .env.local next to the repo root. Nothing is
 * printed; the script reads them and reports only PASS/FAIL lines.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=...        (already in .env)
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=...   (already in .env)
 *   SECTEST_OWNER_EMAIL=...             a manager who owns a shop
 *   SECTEST_OWNER_PASSWORD=...
 *   SECTEST_OUTSIDER_EMAIL=...          a signed-up user who owns NO shop
 *   SECTEST_OUTSIDER_PASSWORD=...
 *
 * Alternatively set SUPABASE_SERVICE_ROLE_KEY and pass --provision to have the
 * script create and then delete the disposable outsider itself via the Auth
 * Admin API. The service_role key is used ONLY for that; every security
 * assertion below runs with a normal user token, never with service_role.
 *
 * SAFETY
 * ------
 *  - Every object it uploads is named  <uid>/ZZ-SECTEST-<runId>-*  and is
 *    deleted in the finally block.
 *  - It never touches an object it did not create.
 *  - It never prints a token, password, or user id.
 *
 * RUN:  node --env-file=.env --env-file=.env.local supabase/tests/storage_api_tests.mjs
 */

const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const BUCKET = 'tattoo-images';
const RUN_ID = Date.now().toString(36);

if (!URL_BASE || !ANON) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

const results = [];
function rec(id, title, pass, outcome) {
  results.push({ id, title, pass, outcome });
}

/** Password grant. Returns { token, uid } — neither is ever printed. */
async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`sign-in failed for a test account: ${res.status} ${b.error_code || ''}`);
  }
  const b = await res.json();
  return { token: b.access_token, uid: b.user.id };
}

/** Raw upload against the Storage API. Returns { status, code }. */
async function upload(token, path, body, contentType) {
  const res = await fetch(
    `${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
    {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body,
    }
  );
  let code = '';
  try {
    const j = await res.json();
    code = j.error || j.statusCode || j.message || '';
  } catch { /* empty body on success */ }
  return { status: res.status, code: String(code) };
}

async function remove(token, path) {
  return fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
}

// A genuinely valid 1x1 JPEG, so a rejection can only be about policy, never
// about the bytes being unparseable.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const cleanup = [];

(async () => {
  const ownerEmail = process.env.SECTEST_OWNER_EMAIL;
  const ownerPass = process.env.SECTEST_OWNER_PASSWORD;
  const outEmail = process.env.SECTEST_OUTSIDER_EMAIL;
  const outPass = process.env.SECTEST_OUTSIDER_PASSWORD;

  if (!ownerEmail || !ownerPass || !outEmail || !outPass) {
    console.error(
      'SKIPPED: set SECTEST_OWNER_* and SECTEST_OUTSIDER_* in .env.local first.\n' +
      'See the header of this file. No assertion was run.'
    );
    process.exit(3);
  }

  const owner = await signIn(ownerEmail, ownerPass);
  const outsider = await signIn(outEmail, outPass);

  const ownerDir = `${owner.uid}/ZZ-SECTEST-${RUN_ID}`;
  const outsiderDir = `${outsider.uid}/ZZ-SECTEST-${RUN_ID}`;

  // ---- 10. Outsider cannot upload into the bucket at all -----------------
  {
    const p = `${outsiderDir}-own-folder.jpg`;
    const r = await upload(outsider.token, p, JPEG_1PX, 'image/jpeg');
    if (r.status < 300) cleanup.push([outsider.token, p]);
    rec('10', 'Outsider cannot upload into tattoo-images (owns no shop)',
      r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 11. Outsider cannot upload into the owner's folder ----------------
  {
    const p = `${ownerDir}-hijack.jpg`;
    const r = await upload(outsider.token, p, JPEG_1PX, 'image/jpeg');
    if (r.status < 300) cleanup.push([owner.token, p]);
    rec('11', "Outsider cannot upload into the owner's folder",
      r.status >= 400, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 24. Owner CAN upload an allowed image into their own folder -------
  const ownerObj = `${ownerDir}-legit.jpg`;
  {
    const r = await upload(owner.token, ownerObj, JPEG_1PX, 'image/jpeg');
    if (r.status < 300) cleanup.push([owner.token, ownerObj]);
    rec('24', 'Owner can upload an allowed image into their own folder',
      r.status < 300, `HTTP ${r.status} ${r.code}`);
  }

  // ---- 12. Outsider cannot replace, move, or delete the owner's object ---
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(ownerObj)}`, {
      method: 'PUT',
      headers: {
        apikey: ANON, Authorization: `Bearer ${outsider.token}`,
        'Content-Type': 'image/jpeg',
      },
      body: JPEG_1PX,
    });
    rec('12a', "Outsider cannot replace the owner's object", r.status >= 400, `HTTP ${r.status}`);

    const mv = await fetch(`${URL_BASE}/storage/v1/object/move`, {
      method: 'POST',
      headers: {
        apikey: ANON, Authorization: `Bearer ${outsider.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: BUCKET,
        sourceKey: ownerObj,
        destinationKey: `${outsiderDir}-stolen.jpg`,
      }),
    });
    rec('12b', "Outsider cannot move the owner's object", mv.status >= 400, `HTTP ${mv.status}`);

    const del = await remove(outsider.token, ownerObj);
    rec('12c', "Outsider cannot delete the owner's object", del.status >= 400, `HTTP ${del.status}`);
  }

  // ---- 13-16. Bucket content restrictions, exercised as the OWNER so the
  // rejection can only come from the MIME/size rules, not from RLS ---------
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
    // 9 MiB of JPEG-prefixed bytes: over the 8 MiB cap, correct content type.
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

  // ---- 25. Owner can replace and delete their own object -----------------
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(ownerObj)}`, {
      method: 'PUT',
      headers: {
        apikey: ANON, Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'image/jpeg',
      },
      body: JPEG_1PX,
    });
    rec('25a', 'Owner can replace their own object', r.status < 300, `HTTP ${r.status}`);

    const del = await remove(owner.token, ownerObj);
    const ok = del.status < 300;
    if (ok) {
      const i = cleanup.findIndex(([, p]) => p === ownerObj);
      if (i >= 0) cleanup.splice(i, 1);
    }
    rec('25b', 'Owner can delete their own object', ok, `HTTP ${del.status}`);
  }

  // ---- Anonymous read of a published image still works -------------------
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/public/${BUCKET}/nonexistent-${RUN_ID}.jpg`);
    rec('P1', 'Public object endpoint reachable without auth (404 for missing, not 401/403)',
      r.status === 404, `HTTP ${r.status}`);
  }

  // ---- Bucket listing is closed to clients -------------------------------
  {
    const r = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: {
        apikey: ANON, Authorization: `Bearer ${outsider.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix: '', limit: 100 }),
    });
    const body = await r.json().catch(() => []);
    const empty = Array.isArray(body) && body.length === 0;
    rec('P2', 'Bucket listing returns nothing to a signed-in client',
      r.status >= 400 || empty, `HTTP ${r.status}, ${Array.isArray(body) ? body.length : '?'} entries`);
  }
})()
  .catch((e) => {
    rec('ERR', 'Harness error', false, e.message);
  })
  .finally(async () => {
    for (const [token, p] of cleanup) {
      try { await remove(token, p); } catch { /* best effort */ }
    }
    let failed = 0;
    for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(4)} ${r.title}  [${r.outcome}]`);
    }
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
