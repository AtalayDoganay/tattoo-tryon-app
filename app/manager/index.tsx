import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/components/AuthProvider';
import { AppTheme, Fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { DbTattoo } from '@/lib/types';

type DbShop = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
};

// Only these raster types may be uploaded. The bucket is public-read, so an
// uploaded SVG or HTML file would be a stored-XSS vector served from the
// Supabase origin — hence an allowlist rather than a blocklist.
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Derives a safe storage extension from a picker URI. Anything unrecognised
 * falls back to jpeg rather than trusting a user-controlled path fragment,
 * which could otherwise inject `..`, a query string, or a second extension
 * into the object key.
 */
function safeExtension(uri: string): string {
  const match = /\.([a-zA-Z0-9]{1,5})(?:[?#].*)?$/.exec(uri);
  const ext = match?.[1]?.toLowerCase() ?? '';
  return ext in ALLOWED_UPLOAD_TYPES ? ext : 'jpg';
}

/** Random, unguessable object name — never the user's original filename. */
function randomObjectName(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rand}.${ext}`;
}

export default function ManagerDashboard() {
  const { session, loading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();

  const [shop, setShop] = useState<DbShop | null>(null);
  const [tattoos, setTattoos] = useState<DbTattoo[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Add-tattoo form
  const [showForm, setShowForm] = useState(false);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedBase64, setPickedBase64] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formStyle, setFormStyle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      router.replace('/login');
      return;
    }

    async function loadData() {
      try {
        const { data: shopData, error: shopErr } = await supabase
          .from('shops')
          .select('*')
          .eq('owner_user_id', session!.user.id)
          .single();
        if (shopErr) throw shopErr;
        setShop(shopData as DbShop);

        const { data: tattoosData, error: tattoosErr } = await supabase
          .from('tattoos')
          .select('*')
          .eq('shop_id', shopData.id)
          .order('created_at', { ascending: false });
        if (tattoosErr) throw tattoosErr;
        setTattoos((tattoosData as DbTattoo[]) ?? []);
      } catch {
        setPageError('Failed to load dashboard.');
      } finally {
        setPageLoading(false);
      }
    }

    loadData();
  }, [authLoading, session]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('tattoos').delete().eq('id', id);
    if (!error) {
      setTattoos((prev) => prev.filter((t) => t.id !== id));
    }
  }

  /**
   * Flips a design between draft and live. Only the owning shop's manager can
   * do this — the "tattoos: owner update" RLS policy checks shop ownership in
   * both USING and WITH CHECK, so a request from anyone else updates 0 rows.
   */
  async function handleTogglePublished(item: DbTattoo) {
    const next = !item.published;
    setPublishingId(item.id);
    const { data, error } = await supabase
      .from('tattoos')
      .update({ published: next })
      .eq('id', item.id)
      .select()
      .single();
    setPublishingId(null);

    if (error || !data) {
      // Deliberately not setPageError: that state gates the whole dashboard
      // behind an error screen, and a failed toggle should not hide the list.
      setActionError(
        next ? 'Could not publish that design.' : 'Could not unpublish that design.'
      );
      return;
    }
    setActionError(null);
    setTattoos((prev) =>
      prev.map((t) => (t.id === item.id ? (data as DbTattoo) : t))
    );
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setFormError('Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled) {
      setPickedUri(result.assets[0].uri);
      setPickedBase64(result.assets[0].base64 ?? null);
    }
  }

  async function handleUploadAndSave() {
    if (!pickedUri || !formName.trim() || !shop || !session) {
      setFormError('Please enter a name and pick an image.');
      return;
    }

    setUploading(true);
    setFormError(null);

    try {
      const ext = Platform.OS === 'web' ? 'jpg' : safeExtension(pickedUri);
      const contentType = ALLOWED_UPLOAD_TYPES[ext];
      // First path segment is the owner's user id. The storage RLS policy keys
      // on exactly that segment, so a manager can only write inside their own
      // folder and can never overwrite another shop's images.
      const path = `${session.user.id}/${randomObjectName(ext)}`;

      let uploadData: Blob | ArrayBuffer;
      if (Platform.OS === 'web') {
        const base64 = pickedBase64!;
        const byteCharacters = atob(base64);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArray[i] = byteCharacters.charCodeAt(i);
        }
        uploadData = byteArray.buffer;
      } else {
        const response = await fetch(pickedUri);
        uploadData = await response.blob();
      }

      const { error: uploadErr } = await supabase.storage
        .from('tattoo-images')
        .upload(path, uploadData, {
          contentType,
          // Never replace an existing object; the random name makes a collision
          // essentially impossible, and refusing overwrite removes a whole
          // class of "replace someone else's image" bugs.
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from('tattoo-images')
        .getPublicUrl(path);
      const image_url = urlData.publicUrl;

      const { data: newTattoo, error: insertErr } = await supabase
        .from('tattoos')
        .insert({
          shop_id: shop.id,
          name: formName.trim(),
          style: formStyle.trim() || null,
          description: formDesc.trim() || null,
          image_url,
          // New designs start as drafts and are published deliberately. The
          // column default is also false, so omitting this would be equivalent
          // -- it is sent explicitly so the intent survives a schema change.
          published: false,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      setTattoos((prev) => [newTattoo as DbTattoo, ...prev]);
      resetForm();
    } catch {
      // Supabase storage/postgrest errors name the bucket, the policy that
      // rejected the write, and sometimes the row — none of which belongs on a
      // user-facing screen.
      setFormError('Upload failed. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    setShowForm(false);
    setPickedUri(null);
    setPickedBase64(null);
    setFormName('');
    setFormStyle('');
    setFormDesc('');
    setFormError(null);
  }

  function renderRow({ item }: { item: DbTattoo }) {
    const isBusy = publishingId === item.id;

    return (
      <View style={styles.row}>
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.pillRow}>
            <View style={item.published ? styles.livePill : styles.draftPill}>
              <Text
                style={
                  item.published ? styles.livePillText : styles.draftPillText
                }
              >
                {item.published ? 'Live' : 'Draft'}
              </Text>
            </View>
            {item.style ? (
              <View style={styles.stylePill}>
                <Text style={styles.stylePillText}>{item.style}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => handleTogglePublished(item)}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel={
              item.published
                ? `Unpublish ${item.name}`
                : `Publish ${item.name}`
            }
            style={({ pressed }: { pressed: boolean }) => [
              item.published ? styles.unpublishBtn : styles.publishBtn,
              { opacity: pressed || isBusy ? 0.7 : 1 },
            ]}
          >
            {isBusy ? (
              <ActivityIndicator color={AppTheme.text} size="small" />
            ) : (
              <Text
                style={
                  item.published
                    ? styles.unpublishBtnText
                    : styles.publishBtnText
                }
              >
                {item.published ? 'Unpublish' : 'Publish'}
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => setFormError('Editing is not available yet.')}
            style={({ pressed }: { pressed: boolean }) => [
              styles.editBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
          <Pressable
            onPress={() => handleDelete(item.id)}
            style={({ pressed }: { pressed: boolean }) => [
              styles.deleteBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.deleteBtnText}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (authLoading || pageLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ActivityIndicator
          color={AppTheme.accent}
          size="large"
          style={styles.loader}
        />
      </View>
    );
  }

  if (pageError || !shop) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.statusText}>
          {pageError ?? 'No shop found for this account.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.shopTitle} numberOfLines={1}>
          {shop.name}
        </Text>
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }: { pressed: boolean }) => [
            styles.signOutBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>

      {showForm ? (
        <ScrollView
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.formTitle}>New Tattoo</Text>

          <Pressable onPress={pickImage} style={styles.imagePicker}>
            {pickedUri ? (
              <Image source={{ uri: pickedUri }} style={styles.imagePreview} />
            ) : (
              <Text style={styles.imagePickerText}>Tap to pick image</Text>
            )}
          </Pressable>

          <TextInput
            placeholder="Name *"
            placeholderTextColor={AppTheme.muted}
            value={formName}
            onChangeText={setFormName}
            style={styles.input}
            editable={!uploading}
          />
          <TextInput
            placeholder="Style (e.g. Black & Grey)"
            placeholderTextColor={AppTheme.muted}
            value={formStyle}
            onChangeText={setFormStyle}
            style={styles.input}
            editable={!uploading}
          />
          <TextInput
            placeholder="Description"
            placeholderTextColor={AppTheme.muted}
            value={formDesc}
            onChangeText={setFormDesc}
            style={[styles.input, styles.inputMultiline]}
            multiline
            numberOfLines={3}
            editable={!uploading}
          />

          {formError ? (
            <Text style={styles.formError}>{formError}</Text>
          ) : null}

          <Pressable
            onPress={handleUploadAndSave}
            disabled={uploading}
            style={({ pressed }: { pressed: boolean }) => [
              styles.saveBtn,
              { opacity: pressed || uploading ? 0.85 : 1 },
            ]}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Upload & Save</Text>
            )}
          </Pressable>

          <Pressable
            onPress={resetForm}
            style={({ pressed }: { pressed: boolean }) => [
              styles.cancelBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.listWrap}>
          {actionError ? (
            <Text style={styles.actionError}>{actionError}</Text>
          ) : null}
          <FlatList
            data={tattoos}
            keyExtractor={(item: DbTattoo) => item.id}
            renderItem={renderRow}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.statusText}>
                No tattoos yet. Tap + Add Tattoo to get started.
              </Text>
            }
          />
          <Pressable
            onPress={() => setShowForm(true)}
            style={({ pressed }: { pressed: boolean }) => [
              styles.addBtn,
              { bottom: insets.bottom + 24, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.addBtnText}>+ Add Tattoo</Text>
          </Pressable>
        </View>
      )}
    </View>
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
  },
  loader: {
    marginTop: 60,
  },
  statusText: {
    color: AppTheme.muted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 40,
  },
  // Header
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.border,
  },
  shopTitle: {
    fontSize: 20,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    flex: 1,
    marginRight: 12,
  },
  signOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  signOutText: {
    color: AppTheme.muted,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  // List
  listWrap: {
    flex: 1,
  },
  actionError: {
    color: AppTheme.accent,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: AppTheme.surface,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  rowInfo: {
    flex: 1,
    gap: 6,
    marginRight: 12,
  },
  rowName: {
    fontSize: 15,
    color: AppTheme.text,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  // Publication state. Live borrows the accent; Draft stays deliberately quiet
  // so an unpublished design reads as incomplete rather than as an error.
  livePill: {
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.accent,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  livePillText: {
    color: AppTheme.text,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  draftPill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppTheme.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  draftPillText: {
    color: AppTheme.muted,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
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
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  publishBtn: {
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: AppTheme.accent,
  },
  publishBtnText: {
    color: AppTheme.text,
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700',
  },
  unpublishBtn: {
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  unpublishBtnText: {
    color: AppTheme.muted,
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  editBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  editBtnText: {
    color: AppTheme.muted,
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  deleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  deleteBtnText: {
    color: AppTheme.accent,
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700',
  },
  addBtn: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: AppTheme.accent,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 28,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  // Form
  formContent: {
    padding: 20,
    paddingBottom: 60,
  },
  formTitle: {
    fontSize: 22,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    marginBottom: 20,
  },
  imagePicker: {
    width: '100%',
    height: 180,
    backgroundColor: AppTheme.surface,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imagePickerText: {
    color: AppTheme.muted,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  input: {
    backgroundColor: AppTheme.surface,
    borderColor: AppTheme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: AppTheme.text,
    fontSize: 16,
    marginBottom: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  inputMultiline: {
    height: 90,
    textAlignVertical: 'top',
  },
  formError: {
    color: AppTheme.accent,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  saveBtn: {
    backgroundColor: AppTheme.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginBottom: 12,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: AppTheme.border,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: AppTheme.muted,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
});
