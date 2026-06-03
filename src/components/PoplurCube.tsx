import React from 'react';
import { requireNativeComponent, StyleSheet, View } from 'react-native';
import type { NativeSyntheticEvent, ViewStyle } from 'react-native';
import type { AppTab } from '../types/models';

type NativeCubeEvent = {
  tab: AppTab;
};

type NativeCubeProps = {
  activeTab: AppTab;
  onTabChange: (event: NativeSyntheticEvent<NativeCubeEvent>) => void;
  style?: ViewStyle;
};

const NativeCube = requireNativeComponent<NativeCubeProps>('PoplurNativeCube');

export function PoplurCube({ activeTab, onTabChange }: { activeTab: AppTab; onTabChange: (tab: AppTab) => void }) {
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <NativeCube
        activeTab={activeTab}
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
