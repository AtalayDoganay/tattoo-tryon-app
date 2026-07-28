// lib/env.ts
//
// Validates the EXPO_PUBLIC_* configuration the client needs, and fails loudly
// (but safely) when something is missing or obviously wrong.
//
// Two rules govern everything in this file:
//
//   1. Every value here is PUBLIC. Expo inlines EXPO_PUBLIC_* into the bundle
//      at build time, so anyone can read them. Nothing secret may be added.
//   2. Error messages name the VARIABLE, never the VALUE. A misconfiguration
//      must never print a credential into a console, a crash reporter, or a
//      user-visible error screen.
//
// The `assertNotAServerSecret` check exists because the single most damaging
// mistake possible in this app is pasting the Supabase `service_role` /
// `sb_secret_...` key into EXPO_PUBLIC_SUPABASE_ANON_KEY. That key bypasses
// Row Level Security completely, and shipping it in a web bundle hands every
// visitor full read/write control of the database. We refuse to boot instead.

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvConfigError';
  }
}

/** Decodes a base64url JWT payload segment. Returns null if it cannot. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  // `atob` is present on web and on modern React Native runtimes, but we never
  // assume: this check is a best-effort defence, not a correctness dependency.
  if (typeof atob !== 'function') return null;

  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // JSON.parse returns `any`; the Record cast keeps callers honest.
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Refuses to start if a privileged Supabase key was placed in a client slot.
 * Throws naming only the variable — never the value.
 */
function assertNotAServerSecret(varName: string, value: string): void {
  if (value.startsWith('sb_secret_')) {
    throw new EnvConfigError(
      `${varName} contains a Supabase SECRET key (sb_secret_...). ` +
        'Secret keys bypass Row Level Security and must never reach the client ' +
        'bundle. Use the publishable key (sb_publishable_...) instead, and ' +
        'rotate the secret key you just exposed.'
    );
  }

  const payload = decodeJwtPayload(value);
  if (payload && payload.role === 'service_role') {
    throw new EnvConfigError(
      `${varName} contains a Supabase service_role key. ` +
        'That key bypasses Row Level Security and must never reach the client ' +
        'bundle. Use the anon / publishable key instead, and rotate the ' +
        'service_role key you just exposed.'
    );
  }
}

function requireVar(varName: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    throw new EnvConfigError(
      `${varName} is not set. Copy .env.example to .env and fill it in ` +
        '(see the CLIENT section of that file).'
    );
  }

  // A literal placeholder means someone copied the template but never edited it.
  if (trimmed.startsWith('your_') || trimmed.includes('your-project-ref')) {
    throw new EnvConfigError(
      `${varName} still holds the placeholder value from .env.example. ` +
        'Replace it with the real value from your Supabase project settings.'
    );
  }

  return trimmed;
}

function requireHttpUrl(varName: string, value: string | undefined): string {
  const raw = requireVar(varName, value);

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new EnvConfigError(`${varName} is not a valid absolute URL.`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new EnvConfigError(`${varName} must use http:// or https://.`);
  }

  // Plain HTTP is tolerated only for loopback development. Anywhere else it
  // would send user photos and access tokens over the network in the clear.
  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';

  if (parsed.protocol === 'http:' && !isLoopback) {
    throw new EnvConfigError(
      `${varName} uses insecure http:// for a non-loopback host. ` +
        'Use https:// so credentials and images are not sent in cleartext.'
    );
  }

  // Normalise away a trailing slash so callers can safely do `${url}/path`.
  return raw.replace(/\/+$/, '');
}

export interface PublicEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly bgServerUrl: string;
}

function readEnv(): PublicEnv {
  const supabaseUrl = requireHttpUrl(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL
  );

  const supabaseAnonKey = requireVar(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  );
  assertNotAServerSecret('EXPO_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey);

  // The background-removal server is optional: the rest of the app works
  // without it, so it falls back to the documented local dev endpoint rather
  // than blocking startup.
  const bgServerUrl = requireHttpUrl(
    'EXPO_PUBLIC_BG_SERVER_URL',
    process.env.EXPO_PUBLIC_BG_SERVER_URL ?? 'http://localhost:5001'
  );

  return { supabaseUrl, supabaseAnonKey, bgServerUrl };
}

export const env: PublicEnv = readEnv();
