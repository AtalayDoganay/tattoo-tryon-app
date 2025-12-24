import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function BackHeader({ title }: { title?: string }) {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.backBtn,
          {
            borderColor: theme.icon,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={{ color: theme.text, fontWeight: '900' }}>← Back</Text>
      </Pressable>

      {title ? (
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    marginBottom: 12,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
  },
});
