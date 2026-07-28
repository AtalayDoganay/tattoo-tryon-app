// lib/sessionStorage.ts
//
// Storage backend for the Supabase auth session (access token + refresh token).
//
// Platform split:
//   web    — undefined, so supabase-js uses its own localStorage handling.
//            That is the supported browser behaviour and is what the existing
//            web deployment already relies on.
//   native — Expo SecureStore, which puts the tokens in the iOS Keychain /
//            Android Keystore instead of plaintext AsyncStorage.
//
// Why chunking: SecureStore stores values in the keychain and warns/fails past
// roughly 2 KB per entry. A Supabase session (two JWTs plus the user object)
// routinely exceeds that, so values are split across numbered entries with a
// small manifest entry recording the chunk count. Without this, sign-in appears
// to succeed and then silently fails to persist across app restarts.

import { Platform } from 'react-native';

/** Matches the `auth.storage` shape supabase-js expects. */
export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Comfortably under the SecureStore per-entry limit, leaving headroom for the
// platform's own encoding overhead.
const CHUNK_SIZE = 1536;

type SecureStoreModule = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

function createSecureStoreAdapter(): SupabaseAuthStorage | undefined {
  let SecureStore: SecureStoreModule;
  try {
    // Required lazily so that the web bundle never pulls in a native-only
    // module, and so a missing install degrades to in-memory sessions rather
    // than crashing the app at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SecureStore = require('expo-secure-store') as SecureStoreModule;
  } catch {
    return undefined;
  }

  const countKey = (key: string) => `${key}.chunks`;
  const chunkKey = (key: string, i: number) => `${key}.${i}`;

  async function clearChunks(key: string, count: number): Promise<void> {
    const deletions: Promise<void>[] = [];
    for (let i = 0; i < count; i += 1) {
      deletions.push(SecureStore.deleteItemAsync(chunkKey(key, i)));
    }
    await Promise.all(deletions);
  }

  async function readCount(key: string): Promise<number> {
    const raw = await SecureStore.getItemAsync(countKey(key));
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  return {
    async getItem(key: string): Promise<string | null> {
      try {
        const count = await readCount(key);
        if (count === 0) return null;

        const parts = await Promise.all(
          Array.from({ length: count }, (_unused, i) =>
            SecureStore.getItemAsync(chunkKey(key, i))
          )
        );

        // A missing chunk means the stored session is torn (interrupted write,
        // partial keychain wipe). Treat it as absent rather than handing
        // supabase-js a truncated token it would fail to parse.
        if (parts.some((p) => p === null)) return null;

        return parts.join('');
      } catch {
        return null;
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      // Remove any longer previous value first, otherwise stale trailing
      // chunks would be re-read as part of the next, shorter session.
      const previous = await readCount(key);
      if (previous > 0) await clearChunks(key, previous);

      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }

      await Promise.all(
        chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk))
      );
      // Manifest written last: until it lands, getItem reports "no session"
      // rather than reading a half-written value.
      await SecureStore.setItemAsync(countKey(key), String(chunks.length));
    },

    async removeItem(key: string): Promise<void> {
      try {
        const count = await readCount(key);
        // Manifest first, so an interrupted sign-out cannot leave a readable
        // session behind.
        await SecureStore.deleteItemAsync(countKey(key));
        if (count > 0) await clearChunks(key, count);
      } catch {
        // Sign-out must never throw; the in-memory session is cleared anyway.
      }
    },
  };
}

/**
 * `undefined` on web (supabase-js uses its supported browser storage),
 * a SecureStore-backed adapter on native.
 */
export const authStorage: SupabaseAuthStorage | undefined =
  Platform.OS === 'web' ? undefined : createSecureStoreAdapter();
