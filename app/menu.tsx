import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function MenuScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  return (
    <Screen>
      <BackHeader title="Back" />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContainer}>
        <View style={styles.content}>
          {/* Flash Sheets Section */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Flash Sheets</Text>

            <Pressable
              onPress={() => router.push('/flash')}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Flash Sheets</Text>
            </Pressable>
          </Card>

          {/* Custom Tattoo Section */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Customize Your Own Tattoo</Text>

            <Pressable
              onPress={() => router.push('/custom')}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Customize</Text>
            </Pressable>
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
    gap: 20,
    paddingBottom: 40,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
});
