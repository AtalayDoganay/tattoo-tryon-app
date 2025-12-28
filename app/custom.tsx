import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function CustomScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  const handleUpload = () => {
    // Placeholder - implement image picker later
    console.log('Upload image button pressed');
  };

  return (
    <Screen>
      <BackHeader title="Back" />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContainer}>
        <View style={styles.content}>
          {/* Title */}
          <Text style={[styles.title, { color: theme.text }]}>
            Drop in the tattoo you want
          </Text>

          {/* Upload Section */}
          <Card style={styles.uploadSection}>
            <Pressable
              onPress={handleUpload}
              style={({ pressed }) => [
                styles.uploadButton,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.uploadButtonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Upload Image</Text>
            </Pressable>

            <Text style={[styles.uploadHint, { color: theme.tabIconDefault }]}>
              Tap to select an image from your device
            </Text>
          </Card>

          {/* Booking Section */}
          <Card style={styles.bookingSection}>
            <Text style={[styles.bookingText, { color: theme.text }]}>
              Book an appointment.
            </Text>

            <Text style={[styles.bookingSubtext, { color: theme.tabIconDefault }]}>
              Once you upload your design, you'll be able to schedule a consultation with our team to discuss your custom tattoo.
            </Text>
          </Card>
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
  title: {
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
    marginBottom: 8,
  },
  uploadSection: {
    gap: 12,
  },
  uploadButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  uploadHint: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  bookingSection: {
    gap: 8,
  },
  bookingText: {
    fontSize: 16,
    fontWeight: '700',
  },
  bookingSubtext: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
