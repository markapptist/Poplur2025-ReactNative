import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

export function PrimaryButton({ title, onPress, loading, disabled }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [styles.button, pressed && styles.pressed, (disabled || loading) && styles.disabled]}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#4f46e5', paddingVertical: 15, borderRadius: 18, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, elevation: 5 },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
  text: { color: 'white', fontWeight: '800', fontSize: 16 }
});
