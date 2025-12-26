import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchTattooById } from '@/lib/tattoo-data';
import { Tattoo } from '@/lib/types';

export default function TattooDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [tattoo, setTattoo] = useState<Tattoo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTattoo() {
      if (!id) return;
      try {
        const data = await fetchTattooById(id);
        setTattoo(data);
      } catch (error) {
        console.error('Error loading tattoo:', error);
      } finally {
        setLoading(false);
      }
    }

    loadTattoo();
  }, [id]);

  function handleTryOn() {
    if (tattoo) {
      router.push(`/tryon/${tattoo.id}`);
    }
  }

  if (loading) {
    return (
      <Screen>
        <BackHeader title="Tattoo Details" />
        <View style={[styles.centerContent, { justifyContent: 'center' }]}>
          <Text style={{ color: theme.text }}>Loading...</Text>
        </View>
      </Screen>
    );
  }

  if (!tattoo) {
    return (
      <Screen>
        <BackHeader title="Not Found" />
        <View style={[styles.centerContent, { justifyContent: 'center' }]}>
          <Text style={{ color: theme.text }}>Tattoo not found</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={{ gap: 16 }}>
      <BackHeader title="Tattoo Details" />

      {/* Image */}
      <Image
        source={{ uri: tattoo.imageUrl }}
        style={styles.detailImage}
        contentFit="contain"
      />

      {/* Info */}
      <View style={styles.infoSection}>
        <Text style={[styles.title, { color: theme.text }]}>{tattoo.title}</Text>

        <Text style={[styles.date, { color: theme.tabIconDefault }]}>
          Created: {new Date(tattoo.createdAt).toLocaleDateString()}
        </Text>
      </View>

      {/* Actions */}
      <View style={styles.actionSection}>
        <Pressable
          onPress={handleTryOn}
          style={({ pressed }) => [
            styles.tryOnButton,
            {
              backgroundColor: theme.tint,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={styles.tryOnButtonText}>Try On Statue</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerContent: {
    flex: 1,
    alignItems: 'center',
  },
  detailImage: {
    width: '100%',
    height: 400,
    borderRadius: 14,
  },
  infoSection: {
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
  },
  date: {
    fontSize: 13,
    fontWeight: '500',
  },
  actionSection: {
    marginTop: 'auto',
    gap: 12,
  },
  tryOnButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tryOnButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
});
