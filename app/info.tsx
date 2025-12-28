import { router } from 'expo-router';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BackHeader } from '@/components/BackHeader';
import { Card, Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function InfoScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];

  const openInstagram = () => {
    Linking.openURL(
      'https://www.instagram.com/porce1ain_?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw=='
    );
  };

  return (
    <Screen>
      <BackHeader title="Back" />

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContainer}>
        <View style={styles.content}>
          {/* INFO Title */}
          <Text style={[styles.bigTitle, { color: theme.text }]}>INFO</Text>

          {/* Hannah Subtitle */}
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>
            Beautiful girl Hannah, which is my girlfriend
          </Text>

          {/* Instagram Section */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Insta / Work</Text>

            <Pressable
              onPress={openInstagram}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Open Instagram</Text>
            </Pressable>
          </Card>

          {/* Tattoos Section */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Tattoos</Text>

            <Pressable
              onPress={() => router.push('/menu')}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: scheme === 'dark' ? '#151718' : '#fff' }]}>Next for Tattoos</Text>
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
  bigTitle: {
    fontSize: 48,
    fontWeight: '900',
    lineHeight: 52,
    marginTop: 12,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
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
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
