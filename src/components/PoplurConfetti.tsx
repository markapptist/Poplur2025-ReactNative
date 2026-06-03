import React from 'react';
import { requireNativeComponent, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';

type NativeConfettiProps = {
  style?: ViewStyle;
};

const NativeConfetti = requireNativeComponent<NativeConfettiProps>('PoplurNativeConfetti');

export function PoplurConfetti() {
  return (
    <View pointerEvents="none" style={styles.layer}>
      <NativeConfetti style={styles.nativeLayer} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10
  },
  nativeLayer: {
    flex: 1
  }
});
