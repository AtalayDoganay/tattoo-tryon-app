import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// Supabase distinguishes "wrong password" from "no such user" from "email not
// confirmed". Surfacing that difference lets anyone probe which email addresses
// have manager accounts, so every failure is collapsed into one message. The
// only exception is rate limiting, which the user needs to understand to retry.
function loginErrorMessage(status: number | undefined, code: string | undefined): string {
  if (status === 429 || code === 'over_request_rate_limit') {
    return 'Too many sign-in attempts. Please wait a minute and try again.';
  }
  return 'Incorrect email or password.';
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  async function handleLogin() {
    if (!email.trim() || !password) {
      setErrorMsg('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg(loginErrorMessage(error.status, error.code));
        return;
      }

      router.replace('/manager');
    } catch {
      // Never surface the raw exception: it can contain the request URL, the
      // submitted email, and response headers.
      setErrorMsg('Could not sign in right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.form}>
        <Text style={styles.heading}>Manager Login</Text>
        <Text style={styles.sub}>Studio access only</Text>

        <TextInput
          placeholder="Email"
          placeholderTextColor={AppTheme.muted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
          style={styles.input}
        />

        <TextInput
          placeholder="Password"
          placeholderTextColor={AppTheme.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          style={styles.input}
        />

        <Pressable
          onPress={handleLogin}
          disabled={loading}
          style={({ pressed }: { pressed: boolean }) => [
            styles.btn,
            { opacity: pressed || loading ? 0.85 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>Sign In</Text>
          )}
        </Pressable>

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.bg,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  form: {
    gap: 0,
  },
  heading: {
    fontSize: 26,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: AppTheme.muted,
    fontFamily: Fonts?.sans ?? 'system-ui',
    marginBottom: 28,
  },
  input: {
    backgroundColor: AppTheme.surface,
    borderColor: AppTheme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: AppTheme.text,
    fontSize: 16,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: AppTheme.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    height: 52,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  error: {
    color: AppTheme.accent,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    textAlign: 'center',
    marginTop: 12,
  },
});
