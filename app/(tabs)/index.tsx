import { router } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';
import { fetchShops } from '@/lib/tattoo-data';
import { Shop } from '@/lib/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PAD = 16;
const CARD_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - H_PAD * 2 - CARD_GAP) / 2;

export default function HomeScreen() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchShops()
      .then(setShops)
      .catch((err) => console.error('[HomeScreen] fetchShops failed:', err))
      .finally(() => setLoading(false));
  }, []);

  function renderCard({ item }: { item: Shop }) {
    return (
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() =>
          router.push({
            pathname: '/gallery',
            params: { shopId: item.id, shopName: item.name },
          })
        }
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name[0].toUpperCase()}</Text>
        </View>
        <Text style={styles.shopName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.designCount}>{item.designCount ?? 0} designs</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={shops}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        renderItem={renderCard}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.hero}>
            <Text style={styles.appName}>INK</Text>
            <Text style={styles.welcome}>Welcome to Ink Studio</Text>
            <Text style={styles.subtitle}>
              Try on your ink before it's permanent
            </Text>
            <Pressable onPress={() => router.push('/login')}>
              <Text style={styles.managerLink}>Manager Login</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              color={AppTheme.accent}
              size="large"
              style={styles.loader}
            />
          ) : (
            <Text style={styles.empty}>No studios found.</Text>
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
  },
  listContent: {
    paddingHorizontal: H_PAD,
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 36,
    gap: 8,
  },
  appName: {
    fontSize: 64,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.accent,
    letterSpacing: 16,
    fontWeight: '700',
  },
  welcome: {
    fontSize: 22,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 4,
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
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AppTheme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    fontFamily: Fonts?.serif ?? 'serif',
  },
  shopName: {
    fontSize: 16,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    lineHeight: 22,
  },
  designCount: {
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
  },
  loader: {
    marginTop: 48,
  },
  empty: {
    color: AppTheme.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 48,
  },
  managerLink: {
    fontSize: 13,
    color: AppTheme.muted,
    fontFamily: Fonts?.sans ?? 'system-ui',
    marginTop: 8,
  },
});
