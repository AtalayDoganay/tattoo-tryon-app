import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { LoadableImage } from '@/components/LoadableImage';
import { AppTheme, Fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { DbTattoo } from '@/lib/types';

type TattooWithShop = DbTattoo & { shops: { name: string } | null };

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PAD = 16;

export default function TattooDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tattoo, setTattoo] = useState<TattooWithShop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    async function loadTattoo() {
      try {
        const { data, error: sbError } = await supabase
          .from('tattoos')
          .select('*, shops(name)')
          .eq('id', id)
          .eq('published', true)
          .single();

        if (sbError) throw sbError;
        setTattoo(data as TattooWithShop);
      } catch {
        setError('Failed to load tattoo details.');
      } finally {
        setLoading(false);
      }
    }

    loadTattoo();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.screen}>
        <View style={styles.headerPad}>
          <BackHeader />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={AppTheme.accent} size="large" />
        </View>
      </View>
    );
  }

  if (!tattoo || error) {
    return (
      <View style={styles.screen}>
        <View style={styles.headerPad}>
          <BackHeader />
        </View>
        <View style={styles.center}>
          <Text style={styles.statusText}>{error ?? 'Tattoo not found.'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.headerPad}>
        <BackHeader />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <LoadableImage
          uri={tattoo.image_url}
          width={SCREEN_WIDTH}
          height={320}
          borderRadius={0}
          contentFit="cover"
        />

        <View style={styles.body}>
          {tattoo.style ? (
            <View style={styles.stylePill}>
              <Text style={styles.stylePillText}>{tattoo.style}</Text>
            </View>
          ) : null}

          {tattoo.shops ? (
            <Text style={styles.shopName}>{tattoo.shops.name}</Text>
          ) : null}

          <Text style={styles.tattooName}>{tattoo.name}</Text>

          {tattoo.description ? (
            <Text style={styles.description}>{tattoo.description}</Text>
          ) : null}

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.btnFilled,
              { opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => router.push(`/tryon/${tattoo.id}`)}
          >
            <Text style={styles.btnFilledText}>Try It On Your Body</Text>
          </Pressable>

          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.btnOutlined,
              { opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => console.log('Book consultation:', tattoo.id)}
          >
            <Text style={styles.btnOutlinedText}>Book a Consultation</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.bg,
  },
  headerPad: {
    paddingHorizontal: H_PAD,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    color: AppTheme.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: 48,
  },
  body: {
    padding: 20,
    gap: 12,
  },
  stylePill: {
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.accent,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stylePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  shopName: {
    fontSize: 13,
    color: AppTheme.muted,
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  tattooName: {
    fontSize: 26,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    lineHeight: 32,
  },
  description: {
    fontSize: 15,
    color: AppTheme.muted,
    fontFamily: Fonts?.sans ?? 'system-ui',
    lineHeight: 22,
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.border,
    marginVertical: 8,
  },
  btnFilled: {
    backgroundColor: AppTheme.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnFilledText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  btnOutlined: {
    borderWidth: 1,
    borderColor: AppTheme.border,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnOutlinedText: {
    color: AppTheme.muted,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
});
