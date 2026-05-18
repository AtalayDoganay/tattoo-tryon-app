import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';

const SERVER_URL =
  process.env.EXPO_PUBLIC_BG_SERVER_URL ?? 'http://localhost:5001';

async function removeBackground(imageBase64: string): Promise<string> {
  const response = await fetch(`${SERVER_URL}/remove-bg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64 }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error ?? `Server error (${response.status})`);
  }

  const data = await response.json();
  return data.image;
}

export default function RemoveBgScreen() {
  const insets = useSafeAreaInsets();
  const [serverStatus, setServerStatus] = useState<'checking' | 'ok' | 'down'>('checking');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    fetch(`${SERVER_URL}/health`)
      .then((r) => (r.ok ? setServerStatus('ok') : setServerStatus('down')))
      .catch(() => setServerStatus('down'));
  }, []);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      setError('Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      allowsEditing: false,
      quality: 0.9,
      base64: true,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setImageUri(asset.uri);
      setImageBase64(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : null);
      setResultUri(null);
      setError(null);
    }
  }

  async function handleRemoveBg() {
    if (!imageBase64 || processing) return;
    setProcessing(true);
    setError(null);
    setResultUri(null);
    setStatusMsg('Removing background...');
    try {
      const result = await removeBackground(imageBase64);
      console.log('[removebg] result prefix:', result?.slice(0, 100));
      setResultUri(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred.');
    } finally {
      setProcessing(false);
      setStatusMsg(null);
    }
  }

  function handleSave() {
    if (!resultUri) return;
    const link = document.createElement('a');
    link.download = 'tattoo-no-bg.png';
    link.href = resultUri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Mobile: not yet supported
  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top + 16 }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }: { pressed: boolean }) => [
            styles.backBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Background Removal</Text>
        <Text style={styles.mobileNote}>
          Available on web version.{'\n'}Mobile support coming soon.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: 60 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }: { pressed: boolean }) => [
          styles.backBtn,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Background Removal</Text>
      <Text style={styles.subtitle}>Powered by AI — Free & unlimited</Text>

      {/* Server status banner */}
      {serverStatus === 'down' && (
        <View style={styles.bannerError}>
          <Text style={styles.bannerErrorText}>
            ⚠️ Start the Python server first:{'\n'}
            cd bg_server && python server.py
          </Text>
        </View>
      )}
      {serverStatus === 'ok' && (
        <View style={styles.bannerOk}>
          <Text style={styles.bannerOkText}>✅ AI server running</Text>
        </View>
      )}

      {/* Upload zone */}
      <Pressable
        onPress={pickImage}
        style={({ pressed }: { pressed: boolean }) => [
          styles.uploadZone,
          imageUri && styles.uploadZoneFilled,
          { opacity: pressed ? 0.8 : 1 },
        ]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
        ) : (
          <Text style={styles.uploadText}>Tap to upload tattoo photo</Text>
        )}
      </Pressable>

      {/* Remove Background button */}
      <Pressable
        onPress={handleRemoveBg}
        disabled={!imageBase64 || processing || serverStatus !== 'ok'}
        style={({ pressed }: { pressed: boolean }) => [
          styles.actionBtn,
          (!imageBase64 || processing || serverStatus !== 'ok') && styles.actionBtnDisabled,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {processing ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.actionBtnText}>Remove Background</Text>
        )}
      </Pressable>

      {/* Progress */}
      {statusMsg ? (
        <View style={styles.progressRow}>
          <ActivityIndicator
            color={AppTheme.accent}
            size="small"
            style={{ marginRight: 10 }}
          />
          <Text style={styles.progressText}>{statusMsg}</Text>
        </View>
      ) : null}

      {/* Error */}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Before / After */}
      {resultUri ? (
        <>
          <View style={styles.beforeAfter}>
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>ORIGINAL</Text>
              <Image
                source={{ uri: imageUri! }}
                style={styles.resultImage}
                resizeMode="contain"
              />
            </View>
            <View style={[
              styles.resultBox,
              styles.resultBoxDark,
              Platform.OS === 'web' ? {
                backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                backgroundColor: 'white',
              } as object : {},
            ]}>
              <Text style={[styles.resultLabel, { color: '#888' }]}>CLEANED</Text>
              <Image
                source={{ uri: resultUri }}
                style={[styles.resultImage, { width: '100%', height: '100%' }]}
                resizeMode="contain"
              />
            </View>
          </View>

          <Pressable
            onPress={handleSave}
            style={({ pressed }: { pressed: boolean }) => [
              styles.saveBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.saveBtnText}>Save to Library</Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: '/tryon-statue',
                params: { tattooBase64: resultUri },
              })
            }
            style={({ pressed }: { pressed: boolean }) => [
              styles.actionBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.actionBtnText}>Try On Statue →</Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: '/tryon-webcam' as any,
                params: { tattooBase64: resultUri },
              })
            }
            style={({ pressed }: { pressed: boolean }) => [
              styles.outlineBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.outlineBtnText}>Try On Yourself →</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.bg,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 24,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  backText: {
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    marginBottom: 20,
  },
  bannerError: {
    backgroundColor: 'rgba(226,75,74,0.12)',
    borderWidth: 1,
    borderColor: AppTheme.accent,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  bannerErrorText: {
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    lineHeight: 20,
  },
  bannerOk: {
    backgroundColor: 'rgba(99,153,34,0.12)',
    borderWidth: 1,
    borderColor: '#639922',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  bannerOkText: {
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: '#639922',
    fontWeight: '600',
  },
  uploadZone: {
    width: '100%',
    height: 220,
    borderWidth: 2,
    borderColor: AppTheme.border,
    borderStyle: 'dashed',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  uploadZoneFilled: {
    borderStyle: 'solid',
  },
  uploadText: {
    fontSize: 15,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  actionBtn: {
    backgroundColor: AppTheme.accent,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginBottom: 16,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  progressText: {
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    flexShrink: 1,
  },
  errorText: {
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.accent,
    textAlign: 'center',
    marginBottom: 12,
  },
  beforeAfter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    marginBottom: 16,
  },
  resultBox: {
    flex: 1,
    backgroundColor: AppTheme.surface,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  resultBoxDark: {
    backgroundColor: '#e0e0e0',
  },
  resultLabel: {
    fontSize: 10,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    letterSpacing: 2,
    fontWeight: '700',
    padding: 8,
    paddingBottom: 4,
  },
  resultImage: {
    width: '100%',
    height: 200,
  },
  mobileNote: {
    fontSize: 15,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    textAlign: 'center',
    lineHeight: 24,
  },
  saveBtn: {
    borderWidth: 1,
    borderColor: AppTheme.border,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBtnText: {
    color: AppTheme.text,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.surface,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginBottom: 0,
  },
  outlineBtnText: {
    color: AppTheme.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
});
