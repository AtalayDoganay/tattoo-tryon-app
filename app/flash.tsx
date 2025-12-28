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
const SCREEN_WIDTH = 400; // Approximate
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / GRID_COLUMNS;
const IMAGE_HEIGHT = 240;

export default function FlashScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [tattoos, setTattoos] = useState<Tattoo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTattoos();
  }, []);

  async function loadTattoos() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTattoos();
      setTattoos(data);
    } catch (err) {
      setError('Failed to load flash sheets');
      console.error('Error loading tattoos:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleTattooPress(id: string) {
    router.push(`/flash/${id}`);
  }

  function renderTattooCard({ item }: { item: Tattoo }) {
    return (
      <Pressable
        onPress={() => handleTattooPress(item.id)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.background,
            borderColor: theme.icon,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View style={styles.imageContainer}>
          <LoadableImage
            uri={item.imageUrl}
            width={CARD_WIDTH}
            height={IMAGE_HEIGHT}
            borderRadius={10}
          />
        </View>
        <View style={styles.cardInfo}>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.cardDate, { color: theme.tabIconDefault }]}>
            {new Date(item.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </Pressable>
    );
  }

  if (loading) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={styles.centerContent}>
          <Text style={{ color: theme.text }}>Loading flash sheets...</Text>
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={styles.centerContent}>
          <Text style={{ color: theme.text, marginBottom: 16 }}>{error}</Text>
          <Pressable
            onPress={loadTattoos}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.retryButtonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Try Again</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (tattoos.length === 0) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={styles.centerContent}>
          <Text style={{ color: theme.text }}>No flash sheets available</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingHorizontal: CARD_PADDING }}>
      <BackHeader title="Back" />
      <FlatList
        data={tattoos}
        renderItem={renderTattooCard}
        keyExtractor={(item) => `flash-${item.id}`}
        numColumns={GRID_COLUMNS}
        columnWrapperStyle={styles.columnWrapper}
        scrollEnabled={false}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  columnWrapper: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  listContent: {
    paddingBottom: 20,
  },
  card: {
    flex: 1 / GRID_COLUMNS,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 8,
  },
  imageContainer: {
    width: '100%',
  },
  cardInfo: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 4,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardDate: {
    fontSize: 11,
    fontWeight: '500',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
});
