import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
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
import { supabase } from '@/lib/supabase';

export default function RemoveBgScreen() {
  const insets = useSafeAreaInsets();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

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
    setStatusMsg('Processing with AI... this may take 20-30 seconds on first run');
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'remove-background',
        { body: { imageBase64 } }
      );
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setResultUri(data.image);
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
        disabled={!imageBase64 || processing}
        style={({ pressed }: { pressed: boolean }) => [
          styles.actionBtn,
          (!imageBase64 || processing) && styles.actionBtnDisabled,
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
            <View style={[styles.resultBox, styles.resultBoxDark]}>
              <Text style={styles.resultLabel}>CLEANED</Text>
              <Image
                source={{ uri: resultUri }}
                style={styles.resultImage}
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
    marginBottom: 28,
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
    backgroundColor: '#1a1914',
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
});
