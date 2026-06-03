import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { fetchRecentPosts, uploadPostMedia } from '../services/posts';
import type { Post } from '../types/models';

const toronto: Region = { latitude: 43.6532, longitude: -79.3832, latitudeDelta: 0.08, longitudeDelta: 0.08 };

export function MapScreen() {
  const [region, setRegion] = useState<Region>(toronto);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<{ latitude: number; longitude: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapStyle = useMemo(() => [{ elementType: 'geometry', stylers: [{ color: '#111827' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1f2937' }] }], []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPosts((await fetchRecentPosts()).filter(p => p.latitude && p.longitude));
    } catch (e: any) {
      setError(e.message ?? 'Map posts could not be loaded.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setRegion({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 });
      }
    } catch (e: any) {
      setError(e.message ?? 'Location could not be loaded.');
    }
  })(); }, []);

  async function chooseMediaForMap() {
    if (!selected) return Alert.alert('Pick a coordinate first', 'Tap the map where this post should live.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85, allowsEditing: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      await uploadPostMedia({ uri: asset.uri, mediaType: asset.type === 'video' ? 'video' : 'photo', latitude: selected.latitude, longitude: selected.longitude });
      setSelected(null); await load(); Alert.alert('Posted', 'Your media was posted to the map.');
    } catch (e: any) { Alert.alert('Upload failed', e.message); }
    finally { setUploading(false); }
  }

  return <View style={styles.fill}>
    <MapView provider={PROVIDER_GOOGLE} customMapStyle={mapStyle} style={styles.fill} region={region} onMapReady={() => setMapReady(true)} onRegionChangeComplete={setRegion} showsUserLocation onPress={event => setSelected(event.nativeEvent.coordinate)}>
      {posts.map(post => <React.Fragment key={post.id}>
        <Marker coordinate={{ latitude: post.latitude!, longitude: post.longitude! }} title={post.username ?? 'Poplur'} description={`${Math.round(post.radius / 1000)} km · ${post.viewCount} views`} />
        <Circle center={{ latitude: post.latitude!, longitude: post.longitude! }} radius={post.radius} strokeColor="rgba(99,102,241,0.9)" fillColor="rgba(99,102,241,0.18)" />
      </React.Fragment>)}
      {selected && <Marker coordinate={selected} pinColor="#f97316" title="New post location" />}
    </MapView>
    {!mapReady && <View style={styles.loading}><Text style={styles.loadingText}>Loading Google Maps...</Text></View>}
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{selected ? 'Coordinate selected' : 'Tap the map'}</Text>
      <Text style={styles.panelText}>{error ?? (selected ? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}` : 'Select where your photo or video should grow from.')}</Text>
      <Pressable style={styles.button} onPress={chooseMediaForMap} disabled={uploading}><Ionicons name="cloud-upload" color="white" size={20} /><Text style={styles.buttonText}>{uploading ? 'Posting…' : 'Choose media & post'}</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 }, loading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050713', alignItems: 'center', justifyContent: 'center' }, loadingText: { color: 'white', fontWeight: '800' }, panel: { position: 'absolute', left: 16, right: 16, top: 62, backgroundColor: 'rgba(5,7,19,0.84)', borderRadius: 22, padding: 16, borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1 }, panelTitle: { color: 'white', fontWeight: '900', fontSize: 18 }, panelText: { color: '#c7d2fe', marginTop: 5 }, button: { marginTop: 12, backgroundColor: '#4f46e5', borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonText: { color: 'white', fontWeight: '800' } });
