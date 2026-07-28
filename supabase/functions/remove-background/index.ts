// supabase/functions/remove-background/index.ts
//
// Deno / Supabase Edge Function. Proxies an image to the Hugging Face RMBG-1.4
// inference API so that HUGGINGFACE_TOKEN stays server-side.
//
// This file is Deno, not React Native. It is excluded from the app's tsconfig
// (see tsconfig.json "exclude") because it resolves URL imports and the Deno
// global, neither of which the Expo TypeScript project knows about.
//
// Hardening applied:
//   * CORS restricted to an explicit origin allowlist (was: '*').
//   * Caller must present a valid Supabase access token (was: unauthenticated).
//   * Request body and decoded image size are bounded (was: unbounded).
//   * Upstream/internal error text is never forwarded to the caller
//     (was: the raw Hugging Face response body and e.message).
//   * Base64 encoding is chunked (was: String.fromCharCode(...bigArray),
//     which overflows the call stack on any realistically sized image).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MiB, matches the Flask API
const HF_ENDPOINT = 'https://api-inference.huggingface.co/models/briaai/RMBG-1.4';

// Comma-separated exact origins, e.g.
//   ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:8081
const ALLOWED_ORIGINS: string[] = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Reflects the request's Origin only when it is on the allowlist. Never falls
 * back to '*': combined with an Authorization header that would let any website
 * spend this project's inference quota using a visitor's session.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

/** Stable machine-readable codes; no internal detail ever reaches the client. */
function fail(
  origin: string | null,
  status: number,
  code: string,
  requestId: string
): Response {
  return new Response(JSON.stringify({ code, request_id: requestId }), {
    status,
    headers: corsHeaders(origin),
  });
}

/** Chunked base64 so large buffers do not blow the argument limit. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Verifies the caller's Supabase access token against the Auth server.
 * Supabase also enforces verify_jwt at the platform edge by default; this is a
 * deliberate second check so the function stays safe even if it is ever
 * redeployed with --no-verify-jwt.
 */
async function isAuthenticated(authHeader: string | null): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return false;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: anonKey },
    });
    return res.ok;
  } catch {
    return false;
  }
}

serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return fail(origin, 405, 'method_not_allowed', requestId);
  }
  // A browser request from an origin we do not recognise is rejected outright
  // rather than being served a response the browser would then block anyway.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return fail(origin, 403, 'origin_not_allowed', requestId);
  }
  if (!(await isAuthenticated(req.headers.get('Authorization')))) {
    return fail(origin, 401, 'unauthorized', requestId);
  }

  const token = Deno.env.get('HUGGINGFACE_TOKEN');
  if (!token) {
    console.error(JSON.stringify({ requestId, error: 'HUGGINGFACE_TOKEN not configured' }));
    return fail(origin, 503, 'not_configured', requestId);
  }

  try {
    const contentLength = Number(req.headers.get('Content-Length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      return fail(origin, 413, 'payload_too_large', requestId);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return fail(origin, 413, 'payload_too_large', requestId);
    }

    let parsed: { imageBase64?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(origin, 400, 'invalid_request', requestId);
    }
    if (typeof parsed.imageBase64 !== 'string' || parsed.imageBase64.length === 0) {
      return fail(origin, 400, 'invalid_request', requestId);
    }

    // Accept either a bare base64 payload or a full `data:image/...;base64,` URL.
    const commaIndex = parsed.imageBase64.indexOf(',');
    const b64 = commaIndex >= 0 ? parsed.imageBase64.slice(commaIndex + 1) : parsed.imageBase64;

    let bytes: Uint8Array;
    try {
      const binary = atob(b64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } catch {
      return fail(origin, 400, 'invalid_image', requestId);
    }
    if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) {
      return fail(origin, 413, 'payload_too_large', requestId);
    }

    const upstream = await fetch(HF_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      },
      body: bytes,
    });

    if (!upstream.ok) {
      // Log server-side only. The upstream body can echo the request and, on
      // an auth failure, describe the token we sent.
      console.error(
        JSON.stringify({ requestId, upstreamStatus: upstream.status, event: 'hf_error' })
      );
      return fail(origin, 502, 'processing_failed', requestId);
    }

    const result = new Uint8Array(await upstream.arrayBuffer());
    return new Response(
      JSON.stringify({ image: `data:image/png;base64,${toBase64(result)}` }),
      { headers: corsHeaders(origin) }
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        requestId,
        event: 'unhandled',
        message: e instanceof Error ? e.message : 'unknown',
      })
    );
    return fail(origin, 500, 'processing_failed', requestId);
  }
});
