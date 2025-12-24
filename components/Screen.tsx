import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function Screen({ style, ...props }: ViewProps) {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return <View {...props} style={[styles.screen, { backgroundColor: theme.background }, style]} />;
}

export function Card({ style, ...props }: ViewProps) {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  // A “surface” color that looks good in both modes
  const surface = scheme === 'dark' ? '#1f2123' : '#ffffff';
  const border = scheme === 'dark' ? '#2b2f33' : '#e5e7eb';

  return <View {...props} style={[styles.card, { backgroundColor: surface, borderColor: border }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  card: { padding: 12, borderWidth: 1, borderRadius: 14 },
});
