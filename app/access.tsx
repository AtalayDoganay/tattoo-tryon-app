import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

function ActionButton({
  label,
  onPress,
  variant,
}: {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary';
}) {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  const bg = variant === 'primary' ? theme.tint : 'transparent';
  const borderColor = variant === 'primary' ? theme.tint : theme.icon;
  const textColor = variant === 'primary' ? '#fff' : theme.text;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

export default function AccessScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return (
    <Screen>
      <BackHeader title="Choose Access" />

      <View style={styles.centerArea}>
        <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>
          Pick how you want to use the app.
        </Text>

        <Card style={{ gap: 12, marginTop: 12 }}>
          <ActionButton
            label="Client Access"
            variant="primary"
            onPress={() => router.push('/gallery')}
          />
          <ActionButton
            label="Manager Access"
            variant="secondary"
            onPress={() => router.push('/login')}
          />
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
  button: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '900' },
});
