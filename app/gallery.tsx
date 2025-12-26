import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { LoadableImage } from '@/components/LoadableImage';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchTattoos } from '@/lib/tattoo-data';
import { Tattoo } from '@/lib/types';

const GRID_COLUMNS = 2;
const CARD_PADDING = 16;
const CARD_GAP = 12;
const IMAGE_HEIGHT = 240;

export default function GalleryScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [tattoos, setTattoos] = useState<Tattoo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTattoos() {
      try {
        setError(null);
        const data = await fetchTattoos();
        setTattoos(data);
      } catch (err) {
        console.error('Error loading tattoos:', err);
        setError('Failed to load tattoos. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    loadTattoos();
  }, []);

  function handleTattooPress(tattooId: string) {
    router.push(`/tattoo/${tattooId}`);
  }

  function renderTattooCard({ item }: { item: Tattoo }) {
    return (
      <Pressable
        onPress={() => handleTattooPress(item.id)}
        style={({ pressed }) => [
          styles.cardContainer,
          { flex: 1, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: scheme === 'dark' ? '#1f2123' : '#ffffff',
              borderColor: scheme === 'dark' ? '#2b2f33' : '#e5e7eb',
            },
          ]}
        >
          <LoadableImage
            uri={item.imageUrl}
            width={150}
            height={IMAGE_HEIGHT}
            borderRadius={10}
            contentFit="cover"
          />

          <View style={styles.cardInfo}>
            <Text
              style={[styles.cardTitle, { color: theme.text }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text style={[styles.cardDate, { color: theme.tabIconDefault }]}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  if (loading) {
    return (
      <Screen>
        <BackHeader title="Tattoo Gallery" />
        <View style={styles.centerContainer}>
          <Text style={{ color: theme.text, fontSize: 14 }}>Loading gallery...</Text>
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <BackHeader title="Tattoo Gallery" />
        <View style={styles.centerContainer}>
          <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 8 }}>
            {error}
          </Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              setError(null);
            }}
            style={({ pressed }) => [
              styles.retryButton,
              {
                backgroundColor: theme.tint,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingHorizontal: CARD_PADDING, paddingVertical: 0 }}>
      <View style={{ paddingVertical: 16 }}>
        <BackHeader title="Tattoo Gallery" />
      </View>

      <FlatList
        data={tattoos}
        renderItem={renderTattooCard}
        keyExtractor={(item) => `tattoo-${item.id}`}
        numColumns={GRID_COLUMNS}
        columnWrapperStyle={{
          gap: CARD_GAP,
          marginBottom: CARD_GAP,
        }}
        scrollEnabled={true}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.centerContainer}>
            <Text style={{ color: theme.text }}>No tattoos available</Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 24,
  },
  cardContainer: {
    marginBottom: 0,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardInfo: {
    padding: 12,
    gap: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  cardDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
