import React from 'react';
import { requireNativeComponent, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';

type NativeConfettiProps = {
  active: boolean;
  targetFps: number;
  particleDensity: number;
  performanceMode: string;
  style?: ViewStyle;
};

const NativeConfetti = requireNativeComponent<NativeConfettiProps>('PoplurNativeConfetti');

export function PoplurConfetti() {
  const performance = usePoplurPerformance();
  const visible = performance.decorativeRenderingAllowed && performance.particlesAllowed;
  const active = usePoplurHeavyRenderer(
    'native-welcome-confetti',
    visible,
    { priority: 20, decorative: true },
  );
  return (
    <View pointerEvents="none" style={styles.layer}>
      <NativeConfetti
        active={active}
        targetFps={performance.targetFPS}
        particleDensity={performance.particleDensityMultiplier}
        performanceMode={performance.mode}
        style={styles.nativeLayer}
      />
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
