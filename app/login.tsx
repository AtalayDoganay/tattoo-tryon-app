import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        Alert.alert('Login failed', error.message);
        return;
      }

      // Login successful - navigate to manager home
      router.replace('/manager');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <BackHeader title="Manager Login" />

      <View style={styles.centerArea}>
        <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>
          Sign in to manage your tattoos
        </Text>

        <Card style={{ gap: 12, marginTop: 12 }}>
          <TextInput
            placeholder="Email"
            placeholderTextColor={theme.tabIconDefault}
            value={email}
            onChangeText={setEmail}
            editable={!loading}
            style={[styles.input, { color: theme.text, borderColor: theme.icon }]}
          />

          <TextInput
            placeholder="Password"
            placeholderTextColor={theme.tabIconDefault}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
            style={[styles.input, { color: theme.text, borderColor: theme.icon }]}
          />

          <Pressable
            onPress={handleLogin}
            disabled={loading}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: theme.tint,
                opacity: pressed || loading ? 0.8 : 1,
              },
            ]}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Text>
          </Pressable>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerArea: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  subtitle: { fontSize: 14, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontWeight: '900', color: '#fff' },
});
