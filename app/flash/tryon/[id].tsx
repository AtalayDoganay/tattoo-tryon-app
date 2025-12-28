import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    GestureResponderEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View
} from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchTattooById, getStatueImage } from '@/lib/tattoo-data';
import { StatueGender, StatueView, Tattoo, TryOnState } from '@/lib/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const STATUE_WIDTH = SCREEN_WIDTH - 32;
const STATUE_HEIGHT = 500;

export default function FlashTryOnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [tattoo, setTattoo] = useState<Tattoo | null>(null);
  const [loading, setLoading] = useState(true);
  const [statueGender, setStatueGender] = useState<StatueGender>('male');
  const [statueView, setStatueView] = useState<StatueView>('front');
  const [statueImageUrl, setStatueImageUrl] = useState<string | null>(null);
  const [tryOnState, setTryOnState] = useState<TryOnState>({
    scale: 0.3,
    rotationZ: 0,
    translateX: 0,
    translateY: 0,
  });

  // Gesture tracking
  const lastGestureState = useRef({ x: 0, y: 0, scale: 1, rotation: 0 });

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

  // Load statue image when gender or view changes
  useEffect(() => {
    const statue = getStatueImage(statueGender, statueView);
    setStatueImageUrl(statue?.imageUrl || null);
  }, [statueGender, statueView]);

  function handleTattooGestureStart(event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    lastGestureState.current = {
      x: pageX,
      y: pageY,
      scale: tryOnState.scale,
      rotation: tryOnState.rotationZ,
    };
  }

  function handleTattooGestureMove(event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    const dx = pageX - lastGestureState.current.x;
    const dy = pageY - lastGestureState.current.y;

    setTryOnState((prev) => ({
      ...prev,
      translateX: prev.translateX + dx,
      translateY: prev.translateY + dy,
    }));

    lastGestureState.current.x = pageX;
    lastGestureState.current.y = pageY;
  }

  function handleScaleUp() {
    setTryOnState((prev) => ({
      ...prev,
      scale: Math.min(prev.scale + 0.1, 1.5),
    }));
  }

  function handleScaleDown() {
    setTryOnState((prev) => ({
      ...prev,
      scale: Math.max(prev.scale - 0.1, 0.1),
    }));
  }

  function handleRotateLeft() {
    setTryOnState((prev) => ({
      ...prev,
      rotationZ: (prev.rotationZ - 15) % 360,
    }));
  }

  function handleRotateRight() {
    setTryOnState((prev) => ({
      ...prev,
      rotationZ: (prev.rotationZ + 15) % 360,
    }));
  }

  function handleReset() {
    setTryOnState({
      scale: 0.3,
      rotationZ: 0,
      translateX: 0,
      translateY: 0,
    });
  }

  if (loading) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={[styles.centerContent, { justifyContent: 'center' }]}>
          <Text style={{ color: theme.text }}>Loading...</Text>
        </View>
      </Screen>
    );
  }

  if (!tattoo) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={[styles.centerContent, { justifyContent: 'center' }]}>
          <Text style={{ color: theme.text }}>Tattoo not found</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={{ gap: 12, justifyContent: 'flex-start' }}>
      <BackHeader title={`Try On: ${tattoo.title}`} />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
        {/* Statue Selector */}
        <View style={styles.selectorContainer}>
          <View>
            <Text style={[styles.selectorLabel, { color: theme.text }]}>Body</Text>
            <View style={styles.buttonGroup}>
              <Pressable
                onPress={() => setStatueGender('male')}
                style={({ pressed }) => [
                  styles.selectorButton,
                  {
                    backgroundColor: statueGender === 'male' ? theme.tint : theme.tabIconDefault,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.selectorButtonText, { color: statueGender === 'male' ? '#fff' : theme.text }]}>
                  Male
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setStatueGender('female')}
                style={({ pressed }) => [
                  styles.selectorButton,
                  {
                    backgroundColor: statueGender === 'female' ? theme.tint : theme.tabIconDefault,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.selectorButtonText, { color: statueGender === 'female' ? '#fff' : theme.text }]}>
                  Female
                </Text>
              </Pressable>
            </View>
          </View>

          <View>
            <Text style={[styles.selectorLabel, { color: theme.text }]}>View</Text>
            <View style={styles.buttonGroup}>
              <Pressable
                onPress={() => setStatueView('front')}
                style={({ pressed }) => [
                  styles.selectorButton,
                  {
                    backgroundColor: statueView === 'front' ? theme.tint : theme.tabIconDefault,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.selectorButtonText, { color: statueView === 'front' ? '#fff' : theme.text }]}>
                  Front
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setStatueView('back')}
                style={({ pressed }) => [
                  styles.selectorButton,
                  {
                    backgroundColor: statueView === 'back' ? theme.tint : theme.tabIconDefault,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.selectorButtonText, { color: statueView === 'back' ? '#fff' : theme.text }]}>
                  Back
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Statue Container with Tattoo Overlay */}
        <View
          style={[
            styles.statueContainer,
            {
              borderColor: theme.icon,
              backgroundColor: scheme === 'dark' ? '#1f2123' : '#f5f5f5',
            },
          ]}
        >
          {/* Statue Image */}
          {statueImageUrl && (
            <Image
              source={{ uri: statueImageUrl }}
              style={styles.statueImage}
              contentFit="cover"
            />
          )}

          {/* Tattoo Overlay - Draggable & Transformable */}
          <View
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleTattooGestureStart}
            onResponderMove={handleTattooGestureMove}
            style={[
              styles.tattooOverlay,
              {
                transform: [
                  { scale: tryOnState.scale },
                  { rotateZ: `${tryOnState.rotationZ}deg` },
                  { translateX: tryOnState.translateX },
                  { translateY: tryOnState.translateY },
                ],
              },
            ]}
          >
            <Image
              source={{ uri: tattoo.imageUrl }}
              style={styles.tattooImage}
              contentFit="contain"
            />
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controlsSection}>
          <Text style={[styles.controlLabel, { color: theme.text }]}>
            Scale
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleScaleDown}
              style={({ pressed }) => [
                styles.controlButton,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.buttonText}>−</Text>
            </Pressable>

            <Text style={[styles.scaleValue, { color: theme.text }]}>
              {(tryOnState.scale * 100).toFixed(0)}%
            </Text>

            <Pressable
              onPress={handleScaleUp}
              style={({ pressed }) => [
                styles.controlButton,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.buttonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.controlsSection}>
          <Text style={[styles.controlLabel, { color: theme.text }]}>
            Rotate
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleRotateLeft}
              style={({ pressed }) => [
                styles.controlButton,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.buttonText}>↺</Text>
            </Pressable>

            <Text style={[styles.rotateValue, { color: theme.text }]}>
              {tryOnState.rotationZ.toFixed(0)}°
            </Text>

            <Pressable
              onPress={handleRotateRight}
              style={({ pressed }) => [
                styles.controlButton,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.buttonText}>↻</Text>
            </Pressable>
          </View>
        </View>

        {/* Reset & Save */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: theme.tint,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.tint }]}>
              Reset
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: theme.tint,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
  },
  selectorContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  selectorLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  selectorButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  selectorButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statueContainer: {
    width: STATUE_WIDTH,
    height: STATUE_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    alignSelf: 'center',
    marginBottom: 16,
  },
  statueImage: {
    width: '100%',
    height: '100%',
  },
  tattooOverlay: {
    position: 'absolute',
    width: 120,
    height: 160,
    top: '50%',
    left: '50%',
    marginLeft: -60,
    marginTop: -80,
  },
  tattooImage: {
    width: '100%',
    height: '100%',
  },
  controlsSection: {
    gap: 8,
    marginBottom: 16,
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  scaleValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
  },
  rotateValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 40,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '900',
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '900',
  },
});
