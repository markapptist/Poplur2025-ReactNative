import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

export function GlassCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'rgba(255,255,255,0.11)', borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderRadius: 24, padding: 18 }
});
