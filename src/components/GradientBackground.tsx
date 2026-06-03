import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export function GradientBackground({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient colors={['#050713', '#111827', '#312e81']} style={[styles.fill, style]}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
