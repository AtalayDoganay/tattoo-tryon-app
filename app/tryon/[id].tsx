import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { AppTheme, Fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { DbTattoo } from '@/lib/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTROLS_HEIGHT = 160;

const SKETCHFAB_URL =
  'https://sketchfab.com/models/59bb70402302466281bceca28add8ecf/embed?autostart=1&ui_controls=0&ui_infos=0&ui_watermark=0&ui_stop=0&ui_inspector=0&ui_annotations=0&ui_settings=0&ui_vr=0&ui_help=0';

export default function TryOnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [tattoo, setTattoo] = useState<DbTattoo | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  const basePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!id) return;
    supabase
      .from('tattoos')
      .select('*')
      .eq('id', id)
      .eq('published', true)
      .single()
      .then(({ data }) => {
        if (data) setTattoo(data as DbTattoo);
      });
  }, [id]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        setPosition({
          x: basePos.current.x + gesture.dx,
          y: basePos.current.y + gesture.dy,
        });
      },
      onPanResponderRelease: (_, gesture) => {
        basePos.current = {
          x: basePos.current.x + gesture.dx,
          y: basePos.current.y + gesture.dy,
        };
      },
    })
  ).current;

  function handleReset() {
    setPosition({ x: 0, y: 0 });
    setScale(1);
    setRotation(0);
    basePos.current = { x: 0, y: 0 };
  }

  const tattooSize = 120 * scale;
  const tattooLeft = SCREEN_WIDTH / 2 + position.x - tattooSize / 2;
  const tattooTop = (SCREEN_HEIGHT - CONTROLS_HEIGHT) / 2 + position.y - tattooSize / 2;

  return (
    <View style={styles.container}>
      {/* LAYER 1: Sketchfab 3D model */}
      <WebView
        source={{ uri: SKETCHFAB_URL }}
        style={styles.webview}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />

      {/* LAYER 2: Tattoo overlay */}
      {tattoo?.image_url ? (
        <View
          {...panResponder.panHandlers}
          style={[
            styles.tattooWrapper,
            {
              left: tattooLeft,
              top: tattooTop,
              width: tattooSize,
              height: tattooSize,
              transform: [{ rotate: `${rotation}deg` }],
            },
          ]}
        >
          <Image
            source={{ uri: tattoo.image_url }}
            style={styles.tattooImage}
            resizeMode="contain"
          />
        </View>
      ) : null}

      {/* LAYER 3: Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 8 }]}>
        {/* Row 1: Back / Reset / Save */}
        <View style={styles.row}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }: { pressed: boolean }) => [styles.rowBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.rowBtnText}>← Back</Text>
          </Pressable>
          <Pressable
            onPress={handleReset}
            style={({ pressed }: { pressed: boolean }) => [styles.rowBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.rowBtnText}>Reset</Text>
          </Pressable>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [styles.rowBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.rowBtnText}>Save</Text>
          </Pressable>
        </View>

        {/* Row 2: Scale */}
        <View style={styles.row}>
          <Pressable
            onPress={() => setScale((s) => Math.max(0.1, parseFloat((s - 0.1).toFixed(1))))}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>−</Text>
          </Pressable>
          <Text style={styles.readout}>{Math.round(scale * 100)}%</Text>
          <Pressable
            onPress={() => setScale((s) => Math.min(3, parseFloat((s + 0.1).toFixed(1))))}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>+</Text>
          </Pressable>
        </View>

        {/* Row 3: Rotate */}
        <View style={styles.row}>
          <Pressable
            onPress={() => setRotation((r) => r - 15)}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>↺</Text>
          </Pressable>
          <Text style={styles.readout}>{((rotation % 360) + 360) % 360}°</Text>
          <Pressable
            onPress={() => setRotation((r) => r + 15)}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>↻</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.bg,
  },
  webview: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: CONTROLS_HEIGHT,
  },
  tattooWrapper: {
    position: 'absolute',
    zIndex: 10,
  },
  tattooImage: {
    width: '100%',
    height: '100%',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CONTROLS_HEIGHT,
    backgroundColor: AppTheme.surface,
    borderTopWidth: 1,
    borderTopColor: AppTheme.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowBtnText: {
    color: AppTheme.text,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  iconBtn: {
    width: 48,
    height: 48,
    backgroundColor: AppTheme.bg,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  iconBtnText: {
    color: AppTheme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  readout: {
    flex: 1,
    textAlign: 'center',
    color: AppTheme.muted,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700',
  },
});
