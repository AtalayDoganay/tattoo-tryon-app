import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { fetchShops } from '@/lib/tattoo-data';
import { Shop } from '@/lib/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const H_PAD = IS_WEB ? 40 : 20;
const CARD_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - H_PAD * 2 - CARD_GAP) / 2;
const HERO_HEIGHT = IS_WEB ? 420 : Math.round(SCREEN_HEIGHT * 0.65);
const TITLE_SIZE = IS_WEB ? 48 : 36;
const BG = '#0a0908';
const SURFACE = '#111009';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [origImages, setOrigImages] = useState<string[]>([]);
  const [dotIndex, setDotIndex] = useState(0);

  // Web: index + transition toggle for CSS transition on/off
  const [webIndex, setWebIndex] = useState(0);
  const [webAnimate, setWebAnimate] = useState(true);

  // Native: Animated.Value drives the strip's translateX
  const animatedX = useRef(new Animated.Value(0)).current;

  const currentIndexRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    fetchShops()
      .then(setShops)
      .catch((err) => console.error('[HomeScreen] fetchShops failed:', err))
      .finally(() => setShopsLoading(false));
  }, []);

  useEffect(() => {
    supabase
      .from('tattoos')
      .select('image_url')
      .eq('published', true)
      .then(({ data }) => {
        const urls = (data ?? [])
          .map((r: { image_url: string }) => r.image_url)
          .filter(Boolean);
        setOrigImages(urls);
      });
  }, []);

  useEffect(() => {
    if (origImages.length < 2) return;

    const timer = setInterval(() => {
      const next = currentIndexRef.current + 1;
      const isWrap = next >= origImages.length;
      const target = isWrap ? 0 : next;

      if (IS_WEB) {
        if (isWrap) {
          // Turn off CSS transition so the jump is instant
          setWebAnimate(false);
          setWebIndex(0);
          // Re-enable transition after the DOM has applied the instant jump
          setTimeout(() => setWebAnimate(true), 50);
        } else {
          setWebAnimate(true);
          setWebIndex(target);
        }
      } else {
        if (isWrap) {
          // Instantly reset to position 0 — no animation
          animatedX.setValue(0);
        } else {
          Animated.timing(animatedX, {
            toValue: -target * SCREEN_WIDTH,
            duration: 700,
            useNativeDriver: false,
          }).start();
        }
      }

      currentIndexRef.current = target;
      setDotIndex(target);
    }, 3000);

    return () => clearInterval(timer);
  }, [origImages, animatedX]);

  function scrollToArtists() {
    scrollRef.current?.scrollTo({ y: HERO_HEIGHT, animated: true });
  }

  const stripWidth = origImages.length * SCREEN_WIDTH;

  const shopRows: Shop[][] = [];
  for (let i = 0; i < shops.length; i += 2) {
    shopRows.push(shops.slice(i, i + 2));
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── HERO ── */}
      <View style={styles.hero}>

        {/* Slideshow strip */}
        {origImages.length > 0 ? (
          IS_WEB ? (
            // Web: plain View, CSS transition via inline style cast
            <View
              style={[
                styles.slideStrip,
                { width: stripWidth },
                { transform: [{ translateX: -webIndex * SCREEN_WIDTH }] },
                Platform.select({
                  web: {
                    transition: webAnimate ? 'transform 0.7s ease' : 'none',
                  } as object,
                  default: {},
                }),
              ]}
            >
              {origImages.map((url, i) => (
                <Image
                  key={i}
                  source={{ uri: url }}
                  style={styles.slideImage}
                  contentFit="cover"
                />
              ))}
            </View>
          ) : (
            // Native: Animated.View with Animated.timing
            <Animated.View
              style={[
                styles.slideStrip,
                { width: stripWidth },
                { transform: [{ translateX: animatedX }] },
              ]}
            >
              {origImages.map((url, i) => (
                <Image
                  key={i}
                  source={{ uri: url }}
                  style={styles.slideImage}
                  contentFit="cover"
                />
              ))}
            </Animated.View>
          )
        ) : (
          <View style={styles.slideFallback} />
        )}

        {/* Left/right edge fades */}
        <LinearGradient
          colors={['rgba(10,9,8,0.85)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientLeft}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['transparent', 'rgba(10,9,8,0.85)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientRight}
          pointerEvents="none"
        />

        {/* Navbar — web only */}
        {IS_WEB && (
          <View style={styles.navbar}>
            <View style={styles.navBrand}>
              <View style={styles.logoSquare} />
              <View>
                <Text style={styles.logoTitle}>FROG GOD</Text>
                <Text style={styles.logoSub}>TATTOO STUDIO</Text>
              </View>
            </View>
            <View style={styles.navLinks}>
              <Text style={styles.navLink}>OUR ARTISTS</Text>
              <Text style={styles.navLink}>OUR TATTOOS</Text>
              <Pressable
                onPress={() => router.push('/login')}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.navCta,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.navCtaText}>GOD ACCESS</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Fixed text overlay — never moves */}
        <View
          style={[styles.heroText, IS_WEB && styles.heroTextWeb]}
          pointerEvents="box-none"
        >
          <Text style={styles.eyebrow}>EST. 2025 — CUSTOM INK</Text>
          <Text style={styles.heroTitle}>Frog God</Text>
          <Text style={styles.heroTitleAccent}>Tattoo</Text>
          <Text style={styles.heroSub}>TRY ON YOUR INK BEFORE IT&apos;S PERMANENT</Text>
          <View style={styles.heroBtns}>
            <Pressable
              onPress={scrollToArtists}
              style={({ pressed }: { pressed: boolean }) => [
                styles.btnFilled,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.btnFilledText}>BROWSE DESIGNS</Text>
            </Pressable>
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [
                styles.btnOutlined,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.btnOutlinedText}>HOW IT WORKS</Text>
            </Pressable>
          </View>
        </View>

        {/* Dot indicators — only shown when 2+ images */}
        {origImages.length > 1 && (
          <View style={styles.dots} pointerEvents="none">
            {origImages.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === dotIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── ARTISTS ── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionLabel}>OUR ARTISTS</Text>
            <Text style={styles.sectionHeading}>Meet the Crew</Text>
          </View>
          <Pressable>
            <Text style={styles.viewAll}>VIEW ALL →</Text>
          </Pressable>
        </View>

        {/* The AI background-removal banner used to sit here. It is removed
            while the processing service is offline: advertising a "Free AI
            tool" that cannot run is worse than not offering it. The /removebg
            route still exists and explains the situation to anyone who reaches
            it by an old link. Restore this banner when the backend returns. */}

        {shopRows.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.cardRow}>
            {row.map((shop, colIdx) => {
              const isActive = rowIdx === 0 && colIdx === 0;
              return (
                <Pressable
                  key={shop.id}
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.card,
                    isActive && styles.cardActive,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() =>
                    router.push({
                      pathname: '/gallery',
                      params: { shopId: shop.id, shopName: shop.name },
                    })
                  }
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{shop.name[0].toUpperCase()}</Text>
                  </View>
                  <Text style={styles.shopName} numberOfLines={2}>
                    {shop.name}
                  </Text>
                  <Text style={styles.designCount}>{shop.designCount ?? 0} designs</Text>
                  {isActive && <Text style={styles.bookingOpen}>BOOKING OPEN</Text>}
                </Pressable>
              );
            })}
          </View>
        ))}

        {!shopsLoading && shops.length === 0 && (
          <Text style={styles.empty}>No studios found.</Text>
        )}
      </View>

      {/* ── FOOTER ── */}
      <View style={styles.footer}>
        <Text style={styles.footerLeft}>FROG GOD TATTOO © 2025</Text>
        <Pressable onPress={() => router.push('/login')}>
          <Text style={styles.footerRight}>GOD ACCESS →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  // ── Hero ──
  hero: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    overflow: 'hidden',
    backgroundColor: BG,
  },
  slideStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: HERO_HEIGHT,
    flexDirection: 'row',
  },
  slideImage: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    opacity: 0.4,
  },
  slideFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
  },
  gradientLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 140,
    zIndex: 2,
  },
  gradientRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 140,
    zIndex: 2,
  },
  // ── Navbar ──
  navbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingVertical: 18,
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoSquare: {
    width: 32,
    height: 32,
    backgroundColor: AppTheme.accent,
    borderRadius: 4,
  },
  logoTitle: {
    fontSize: 13,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    letterSpacing: 2,
  },
  logoSub: {
    fontSize: 9,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    letterSpacing: 1.5,
  },
  navLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
  },
  navLink: {
    fontSize: 11,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.text,
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  navCta: {
    borderWidth: 1,
    borderColor: AppTheme.accent,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  navCtaText: {
    fontSize: 11,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  // ── Hero text ──
  heroText: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: H_PAD,
    gap: 6,
  },
  heroTextWeb: {
    paddingTop: 64,
  },
  eyebrow: {
    fontSize: 10,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    letterSpacing: 3,
    fontWeight: '600',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: TITLE_SIZE,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    lineHeight: TITLE_SIZE * 1.1,
    textAlign: 'center',
  },
  heroTitleAccent: {
    fontSize: TITLE_SIZE,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.accent,
    fontWeight: '700',
    lineHeight: TITLE_SIZE * 1.1,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 10,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    letterSpacing: 2.5,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  heroBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  btnFilled: {
    backgroundColor: AppTheme.accent,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 4,
  },
  btnFilledText: {
    fontSize: 11,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  btnOutlined: {
    borderWidth: 1,
    borderColor: AppTheme.text,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 4,
  },
  btnOutlinedText: {
    fontSize: 11,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.text,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  // ── Dots ──
  dots: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 5,
  },
  dot: {
    height: 3,
    borderRadius: 2,
  },
  dotActive: {
    width: 20,
    backgroundColor: AppTheme.accent,
  },
  dotInactive: {
    width: 6,
    backgroundColor: AppTheme.muted,
  },
  // ── Artists section ──
  section: {
    paddingTop: 48,
    paddingBottom: 24,
    paddingHorizontal: H_PAD,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    letterSpacing: 2.5,
    fontWeight: '600',
    marginBottom: 6,
  },
  sectionHeading: {
    fontSize: 28,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
  },
  viewAll: {
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardRow: {
    flexDirection: 'row',
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: '#2C2C2A',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  cardActive: {
    borderColor: AppTheme.accent,
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
  bookingOpen: {
    fontSize: 9,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  empty: {
    color: AppTheme.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 48,
  },
  // ── Footer ──
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: H_PAD,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: '#2C2C2A',
    marginTop: 8,
  },
  footerLeft: {
    fontSize: 11,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: '#333330',
    letterSpacing: 1,
  },
  footerRight: {
    fontSize: 11,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
