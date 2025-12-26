import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider } from '@/components/AuthProvider';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: Colors.dark.background,
          text: Colors.dark.text,
          primary: Colors.dark.tint,
          card: Colors.dark.background,
          border: Colors.dark.icon,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: Colors.light.background,
          text: Colors.light.text,
          primary: Colors.light.tint,
          card: Colors.light.background,
          border: Colors.light.icon,
        },
      };

  useEffect(() => {
    if (Platform.OS === 'web') {
      document.body.style.backgroundColor = isDark
        ? Colors.dark.background
        : Colors.light.background;
    }
  }, [isDark]);

  return (
    <AuthProvider>
      <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Tabs */}
        <Stack.Screen name="(tabs)" />

        {/* Non-tab routes */}
        <Stack.Screen name="access" />
        <Stack.Screen name="login" />
        <Stack.Screen name="gallery" />
        <Stack.Screen name="tattoo/[id]" />
        <Stack.Screen name="tryon/[id]" />
        <Stack.Screen name="manager" />

        {/* If you still have modal */}
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true }} />
      </Stack>

        <StatusBar style={isDark ? 'light' : 'dark'} />
      </ThemeProvider>
    </AuthProvider>
  );
}
