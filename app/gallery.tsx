import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { LoadableImage } from '@/components/LoadableImage';
import { AppTheme, Fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { DbTattoo } from '@/lib/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PAD = 16;
const CARD_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - H_PAD * 2 - CARD_GAP) / 2;
const IMAGE_HEIGHT = 200;

export default function GalleryScreen() {
  const { shopId, shopName } = useLocalSearchParams<{ shopId: string; shopName: string }>();
  const [tattoos, setTattoos] = useState<DbTattoo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;

    async function loadTattoos() {
      try {
        setError(null);
        // Belt and braces: the "tattoos: published read" RLS policy already
        // withholds drafts from this session, so this filter is a clarity aid
        // rather than the control.
        const { data, error: sbError } = await supabase
          .from('tattoos')
          .select('*')
          .eq('shop_id', shopId)
          .eq('published', true)
          .order('created_at', { ascending: false });

        if (sbError) throw sbError;
        setTattoos((data as DbTattoo[]) ?? []);
      } catch {
        setError('Failed to load designs. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    loadTattoos();
  }, [shopId]);

  function renderCard({ item }: { item: DbTattoo }) {
    return (
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.card,
          { opacity: pressed ? 0.8 : 1 },
        ]}
        onPress={() => router.push(`/tattoo/${item.id}`)}
      >
        <LoadableImage
          uri={item.image_url}
          width={CARD_WIDTH}
          height={IMAGE_HEIGHT}
          borderRadius={0}
          contentFit="cover"
        />
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          {item.style ? (
            <View style={styles.stylePill}>
              <Text style={styles.stylePillText}>{item.style}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <BackHeader title={shopName ?? 'Gallery'} />
      <FlatList
        data={tattoos}
        keyExtractor={(item: DbTattoo) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        renderItem={renderCard}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              color={AppTheme.accent}
              size="large"
              style={styles.loader}
            />
          ) : error ? (
            <Text style={styles.statusText}>{error}</Text>
          ) : (
            <Text style={styles.statusText}>No designs yet.</Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.bg,
    paddingHorizontal: H_PAD,
  },
  listContent: {
    paddingBottom: 40,
  },
  row: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: AppTheme.surface,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardInfo: {
    padding: 12,
    gap: 8,
  },
  cardName: {
    fontSize: 14,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    lineHeight: 20,
  },
  stylePill: {
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.accent,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stylePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  loader: {
    marginTop: 48,
  },
  statusText: {
    color: AppTheme.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 48,
  },
});
