import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return (
    <Screen style={{ justifyContent: 'center', gap: 16 }}>
      <Text style={[textStyles.kicker, { color: theme.tabIconDefault }]}>Tattoo Studio</Text>

      <Text style={[textStyles.title, { color: theme.text }]}>
        Welcome to Tattoo Artist&apos;s Gallery
      </Text>

      <Text style={[textStyles.subtitle, { color: theme.tabIconDefault }]}>
        You can see all my tattoos.
      </Text>

      <Card style={{ gap: 12 }}>
        <Text style={[textStyles.cardText, { color: theme.text }]}>
          Explore designs, preview them on a statue, and choose your next tattoo.
        </Text>

        <Pressable
          onPress={() => router.push('/access')}
          style={({ pressed }) => [
            boxStyles.primaryBtn,
            { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={boxStyles.primaryBtnText}>Next</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}

const textStyles = StyleSheet.create({
  kicker: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardText: {
    fontSize: 14,
    fontWeight: '700',
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
