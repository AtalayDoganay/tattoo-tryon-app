import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';

/**
 * Background removal is intentionally disabled.
 *
 * The Flask service that backed this screen is not currently deployed, so the
 * previous implementation would have fired a request at a host that answers
 * `404 Application not found` and then shown the user a failure. This screen
 * replaces that with a plain statement of fact.
 *
 * Deliberate properties of this file:
 *   * it performs NO network request of any kind — no health check, no upload;
 *   * it does not import `@/lib/env`, so the backend URL is neither read nor
 *     reachable from the bundle through this route;
 *   * it never renders a hostname, status code, or internal error string.
 *
 * The route itself stays registered in app/_layout.tsx so that an existing
 * link, bookmark, or share URL lands on this message instead of a 404.
 *
 * To restore the feature: redeploy bg_server, set EXPO_PUBLIC_BG_SERVER_URL,
 * and restore the picker/upload implementation from git history
 * (`git show 5b4d718:app/removebg.tsx`). See docs/PRODUCTION_SECURITY_CHECKLIST.md.
 */
export default function RemoveBgScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }: { pressed: boolean }) => [
          styles.backBtn,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={styles.center}>
        <Text style={styles.title}>Background Removal</Text>
        <Text style={styles.message}>
          Background removal is temporarily unavailable.
        </Text>
        <Text style={styles.note}>
          This feature will return once the processing service is back online.
          Everything else in the app is unaffected.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: AppTheme.bg,
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  title: {
    fontSize: 28,
    fontFamily: Fonts?.serif ?? 'serif',
    color: AppTheme.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.text,
    textAlign: 'center',
    lineHeight: 24,
  },
  note: {
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    color: AppTheme.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
});
