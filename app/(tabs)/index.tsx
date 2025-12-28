import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return (
    <Screen style={{ justifyContent: 'center', alignItems: 'center', gap: 24 }}>
      <Text style={[textStyles.bigTitle, { color: theme.text }]}>Hannah</Text>

      <Text style={[textStyles.subtitle, { color: theme.tabIconDefault }]}>
        Hannah will be doing UI
      </Text>

      <Pressable
        onPress={() => router.push('/info')}
        style={({ pressed }) => [
          boxStyles.primaryBtn,
          { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <Text style={[boxStyles.primaryBtnText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Next</Text>
      </Pressable>
    </Screen>
  );
}

const textStyles = StyleSheet.create({
  bigTitle: {
    fontSize: 48,
    fontWeight: '900',
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
  },
});


const boxStyles = StyleSheet.create({
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
});
