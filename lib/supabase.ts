import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { env } from './env';
import { authStorage } from './sessionStorage';

// The publishable (anon) key is public by design — it ships inside the client
// bundle. It grants no privilege on its own: every table read and write is
// gated by Row Level Security in Postgres. See SUPABASE_SECURITY_CHECKLIST.md.
//
// lib/env.ts refuses to start the app if a service_role / sb_secret_ key is
// ever placed in the client slot.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    // Native: tokens go to the iOS Keychain / Android Keystore via SecureStore.
    // Web: left undefined so supabase-js uses its supported browser storage.
    storage: authStorage,

    // Keep managers signed in across restarts, and refresh access tokens before
    // they expire so a long editing session does not fail mid-upload.
    persistSession: true,
    autoRefreshToken: true,

    // Only the web build can receive a session in a URL fragment (magic link /
    // OAuth redirect). Leaving this on under React Native makes supabase-js
    // reach for browser location APIs that do not exist there.
    detectSessionInUrl: Platform.OS === 'web',

    // PKCE keeps the authorization code useless to anyone who intercepts a
    // redirect URL, which matters for the custom `tattootryonapp://` scheme.
    flowType: 'pkce',
  },
});
