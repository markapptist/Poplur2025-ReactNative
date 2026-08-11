import React from 'react';
import { requireNativeComponent, StyleSheet, View } from 'react-native';
import type { NativeSyntheticEvent, ViewStyle } from 'react-native';
import type { AppTab } from '../types/models';
import { usePoplurPerformance } from '../performance/PoplurPerformance';

type NativeCubeEvent = {
  tab: AppTab;
};

type NativeCubeProps = {
  activeTab: AppTab;
  active: boolean;
  targetFps: number;
  performanceMode: string;
  onTabChange: (event: NativeSyntheticEvent<NativeCubeEvent>) => void;
  style?: ViewStyle;
};

const NativeCube = requireNativeComponent<NativeCubeProps>('PoplurNativeCube');

export function PoplurCube({ activeTab, onTabChange }: { activeTab: AppTab; onTabChange: (tab: AppTab) => void }) {
  const performance = usePoplurPerformance();
  const active = performance.appState === 'active' && performance.documentVisible;
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <NativeCube
        activeTab={activeTab}
        active={active}
        targetFps={performance.targetFPS}
        performanceMode={performance.mode}
        onTabChange={(event) => onTabChange(event.nativeEvent.tab)}
        style={styles.nativeCube}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 210,
    width: 260,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none'
  },
  nativeCube: {
    height: 210,
    width: 260
  }
});
