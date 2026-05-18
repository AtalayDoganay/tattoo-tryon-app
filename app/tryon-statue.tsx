import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { AppTheme, Fonts } from '@/constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const WEBVIEW_HEIGHT = SCREEN_HEIGHT * 0.7;
const CONTROLS_HEIGHT = SCREEN_HEIGHT * 0.3;

const SKETCHFAB_URL =
  'https://sketchfab.com/models/59bb70402302466281bceca28add8ecf/embed?autostart=1&ui_controls=0&ui_infos=0&ui_watermark=0&ui_stop=0&ui_inspector=0&ui_annotations=0&ui_settings=0&ui_vr=0&ui_help=0';

const TATTOO_BASE_SIZE = 120;
const TATTOO_START_TOP = WEBVIEW_HEIGHT * 0.3;

function StatueViewer({ height }: { height: number }) {
  if (Platform.OS === 'web') {
    return (
      <iframe
        src={SKETCHFAB_URL}
        style={{ width: '100%', height, border: 'none', display: 'block' }}
        allow="autoplay; fullscreen; xr-spatial-tracking"
        allowFullScreen
      />
    );
  }
  return (
    <WebView
      source={{ uri: SKETCHFAB_URL }}
      style={{ flex: 1 }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

export default function TryOnStatueScreen() {
  const insets = useSafeAreaInsets();
  const { tattooBase64 } = useLocalSearchParams<{ tattooBase64: string }>();

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  const basePos = useRef({ x: 0, y: 0 });

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

  const tattooSize = TATTOO_BASE_SIZE * scale;
  const tattooLeft = SCREEN_WIDTH / 2 + position.x - tattooSize / 2;
  const tattooTop = TATTOO_START_TOP + position.y - tattooSize / 2;

  return (
    <View style={styles.container}>
      {/* LAYER 1: Sketchfab 3D statue */}
      <View style={styles.webview}>
        <StatueViewer height={WEBVIEW_HEIGHT} />
      </View>

      {/* LAYER 2: Cleaned tattoo overlay */}
      {tattooBase64 ? (
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
            source={{ uri: tattooBase64 }}
            style={styles.tattooImage}
            resizeMode="contain"
          />
        </View>
      ) : null}

      {/* LAYER 3: Controls panel */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 8 }]}>
        {/* Row 1: Back / Reset / Save Result */}
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
            <Text style={styles.rowBtnText}>Save Result</Text>
          </Pressable>
        </View>

        {/* Row 2: Scale */}
        <View style={styles.row}>
          <Pressable
            onPress={() => setScale((s) => Math.max(0.3, parseFloat((s - 0.1).toFixed(1))))}
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
    backgroundColor: '#0a0908',
  },
  webview: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: WEBVIEW_HEIGHT,
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
    paddingTop: 16,
    gap: 12,
    justifyContent: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
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
