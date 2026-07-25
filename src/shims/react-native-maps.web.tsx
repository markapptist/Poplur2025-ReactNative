import React from 'react';
import { StyleSheet, View } from 'react-native';

// Web-only stub for react-native-maps (no web build). Metro aliases it for the
// web platform (see metro.config.js); native iOS/Android use the real package.
// Renders a neutral placeholder so screens importing the map still mount on web.

const MapView = React.forwardRef(function MapView(props: any, ref: any) {
  return (
    <View ref={ref} style={[styles.map, props?.style]}>
      {props?.children}
    </View>
  );
});

export default MapView;
export const Marker = (_props: any) => null;
export const Circle = (_props: any) => null;
export const Callout = (_props: any) => null;
export const Polygon = (_props: any) => null;
export const Polyline = (_props: any) => null;
export const PROVIDER_DEFAULT: any = undefined;
export const PROVIDER_GOOGLE: any = 'google';

export type Camera = any;
export type LatLng = { latitude: number; longitude: number };

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#0b1020' }
});
