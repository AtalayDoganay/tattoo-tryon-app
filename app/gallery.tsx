import React from 'react';
import { Text } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function GalleryPlaceholder() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return (
    <Screen style={{ gap: 12 }}>
        <BackHeader title="Gallery" />
      <Text style={{ fontSize: 24, fontWeight: '900', color: theme.text }}>
        Tattoo Gallery
      </Text>

      <Card>
        <Text style={{ color: theme.text, fontWeight: '700' }}>
          Next step: load tattoos from Supabase and show them in a grid.
        </Text>
      </Card>
    </Screen>
  );
}
