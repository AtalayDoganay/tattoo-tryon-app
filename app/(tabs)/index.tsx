import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React from 'react';
import { Text } from 'react-native';

export default function HomeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return (
    <Screen style={{ gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: theme.text }}>Home</Text>

      <Card>
        <Text style={{ color: theme.text }}>
          This is a “card/surface”. Your statue preview canvas will be like this, but white.
        </Text>
      </Card>
    </Screen>
  );
}
