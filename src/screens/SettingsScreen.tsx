import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { GlassCard } from '../components/GlassCard';

export function SettingsScreen() {
  return <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
    <Text style={styles.title}>Poplur Settings</Text>
    <GlassCard style={styles.card}><Text style={styles.heading}>Converted architecture</Text><Text style={styles.copy}>SwiftUI screens were mapped into React Native screens. Firebase Auth, Firestore posts, Storage uploads, MapKit/Google Maps, CameraKit, profile editing, and cube tab navigation are represented here.</Text></GlassCard>
    <GlassCard style={styles.card}><Text style={styles.heading}>Native equivalents</Text><Text style={styles.copy}>iOS SceneKit/SpriteKit → Animated cube UI. AVFoundation/CameraKit → Expo Camera. MapKit → react-native-maps. UIKit media picker → Expo Image Picker.</Text></GlassCard>
    <GlassCard style={styles.card}><Text style={styles.heading}>Performance test goal</Text><Text style={styles.copy}>Run this on iOS and Android, compare camera startup, map smoothness, feed scrolling, media upload latency, and cube responsiveness against your native versions.</Text></GlassCard>
  </ScrollView>;
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: '#050713' }, content: { padding: 18, paddingTop: 64, paddingBottom: 230 }, title: { color: 'white', fontWeight: '900', fontSize: 30, marginBottom: 16 }, card: { marginBottom: 14 }, heading: { color: 'white', fontWeight: '900', fontSize: 18 }, copy: { color: '#c7d2fe', lineHeight: 22, marginTop: 8 } });
