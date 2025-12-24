import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';

  // ✅ Keep React Navigation theme in sync with your Colors
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

  // ✅ Web: ensure page background matches app theme
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.body.style.backgroundColor = isDark
        ? Colors.dark.background
        : Colors.light.background;
    }
  }, [isDark]);

  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: 'Modal', headerShown: true }}
        />
        {/* Add other non-tab routes like /login or /manager here later */}
      </Stack>

      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
