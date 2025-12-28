import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { LoadableImage } from '@/components/LoadableImage';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchTattooById } from '@/lib/tattoo-data';
import { Tattoo } from '@/lib/types';

export default function FlashDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [tattoo, setTattoo] = useState<Tattoo | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={styles.centerContent}>
          <Text style={{ color: theme.text }}>Loading...</Text>
        </View>
      </Screen>
    );
  }

  if (!tattoo) {
    return (
      <Screen>
        <BackHeader title="Back" />
        <View style={styles.centerContent}>
          <Text style={{ color: theme.text }}>Tattoo not found</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <BackHeader title="Back" />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContainer}>
        <View style={styles.content}>
          {/* Large Image */}
          <View style={styles.imageWrapper}>
            <LoadableImage
              uri={tattoo.imageUrl}
              width={320}
              height={420}
              borderRadius={12}
            />
          </View>

          {/* Title and Date */}
          <View style={styles.infoSection}>
            <Text style={[styles.title, { color: theme.text }]}>{tattoo.title}</Text>
            <Text style={[styles.date, { color: theme.tabIconDefault }]}>
              Created: {new Date(tattoo.createdAt).toLocaleDateString()}
            </Text>
          </View>

          {/* Try-On Button Section */}
          <View style={styles.tryOnSection}>
            <Pressable
              onPress={() => router.push(`/flash/tryon/${id}`)}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.primaryButtonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>View on Statue</Text>
            </Pressable>
          </View>

          {/* Appointment Section */}
          <View style={styles.appointmentSection}>
            <Text style={[styles.appointmentTitle, { color: theme.text }]}>
              Make an appointment for this tattoo
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
  },
  content: {
    gap: 24,
    paddingVertical: 16,
    paddingBottom: 40,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrapper: {
    alignItems: 'center',
  },
  infoSection: {
    gap: 8,
    paddingHorizontal: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
  },
  date: {
    fontSize: 13,
    fontWeight: '500',
  },
  tryOnSection: {
    gap: 12,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  appointmentSection: {
    gap: 12,
    paddingHorizontal: 4,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  appointmentTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
});
