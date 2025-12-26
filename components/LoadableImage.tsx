import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface LoadableImageProps {
  uri: string;
  width: number;
  height: number;
  borderRadius?: number;
  contentFit?: 'cover' | 'contain' | 'fill' | 'scale-down';
}

export function LoadableImage({
  uri,
  width,
  height,
  borderRadius = 0,
  contentFit = 'cover',
}: LoadableImageProps) {
  const scheme = useColorScheme() ?? 'light';
  const theme = Colors[scheme];
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      {isLoading && !error && (
        <View
          style={[
            styles.skeleton,
            {
              width,
              height,
              backgroundColor: scheme === 'dark' ? '#2a2a2a' : '#e0e0e0',
            },
          ]}
        />
      )}

      <Image
        source={{ uri }}
        style={{
          width,
          height,
          borderRadius,
          opacity: isLoading ? 0 : 1,
        }}
        contentFit={contentFit}
        onLoadStart={() => setIsLoading(true)}
        onLoad={() => {
          setIsLoading(false);
          setError(false);
        }}
        onError={() => {
          setIsLoading(false);
          setError(true);
        }}
        cachePolicy="memory-disk"
      />

      {error && (
        <View
          style={[
            styles.errorContainer,
            {
              width,
              height,
              backgroundColor: scheme === 'dark' ? '#1f2123' : '#f5f5f5',
              borderColor: theme.icon,
            },
          ]}
        >
          <View style={styles.errorPlaceholder}>
            <View style={[styles.errorIcon, { backgroundColor: theme.tabIconDefault }]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
});
