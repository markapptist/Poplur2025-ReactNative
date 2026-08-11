import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Camera, Circle, LatLng, Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { fetchRecentPosts, uploadPostMedia } from '../services/posts';
import type { Post } from '../types/models';
import { loadMapMode, mark2DNoticeSeen, shouldShow2DNotice, type MapMode } from '../services/mapMode';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';
import { PoplurPerformanceMode } from '../performance/PoplurPerformanceManager';

const toronto: LatLng = { latitude: 43.6532, longitude: -79.3832 };
const earthRadiusKm = 6371;

const worldCamera: Camera = {
  center: { latitude: 18, longitude: -100 },
  altitude: 65000000,
  heading: 0,
  pitch: 0,
  zoom: 1
};

function locationCamera(coordinate: LatLng, mode: MapMode): Partial<Camera> {
  return {
    center: coordinate,
    altitude: Platform.OS === 'ios' ? 900 : undefined,
    heading: mode === '2d' ? 0 : 28,
    pitch: mode === '2d' ? 0 : Platform.OS === 'ios' ? 68 : 58,
    zoom: Platform.OS === 'android' ? 18 : undefined
  };
}

export function MapScreen() {
  const mapRef = useRef<MapView | null>(null);
  const { width, height } = useWindowDimensions();
  const autoZoomedRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<LatLng | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapReadyGeneration, setMapReadyGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('3d');
  const performance = usePoplurPerformance();
  const ownsMapRenderer = usePoplurHeavyRenderer(
    'native-map-surface',
    true,
    { priority: 90, decorative: false },
  );
  const effectiveMapMode: MapMode = performance.mode === PoplurPerformanceMode.LOW_POWER
    || performance.mode === PoplurPerformanceMode.EMERGENCY
    ? '2d'
    : mapMode;

  const mappedPosts = useMemo(() => posts.filter(post => post.latitude != null && post.longitude != null), [posts]);
  const totalViews = useMemo(() => mappedPosts.reduce((sum, post) => sum + post.viewCount, 0), [mappedPosts]);
  const radiusKm = selected ? Math.max(0, Math.round(distanceKm(currentLocation ?? toronto, selected))) : 0;
  const isAndroid = Platform.OS === 'android';
  const mapType = effectiveMapMode === '2d' ? 'standard' : Platform.OS === 'ios' ? 'hybridFlyover' : 'hybrid';
  const responsive = useMemo(() => {
    const shortSide = Math.min(width, height);
    const isTablet = shortSide >= 600;
    return {
      header: {
        left: isTablet ? 56 : 38,
        right: isTablet ? 56 : 28,
        top: Math.max(88, Math.min(height * 0.13, isTablet ? 138 : 150))
      },
      title: {
        fontSize: isTablet ? 42 : 36,
        lineHeight: isTablet ? 48 : 42
      },
      subtitle: {
        maxWidth: isTablet ? Math.min(width * 0.62, 620) : undefined,
        fontSize: isTablet ? 28 : 30,
        lineHeight: isTablet ? 36 : 40
      },
      trending: {
        left: isTablet ? Math.max(48, width * 0.07) : 86,
        bottom: isTablet ? Math.max(116, height * 0.12) : 214
      },
      actions: {
        right: isTablet ? 48 : 28,
        bottom: isTablet ? Math.max(238, height * 0.27) : 320
      },
      radius: {
        right: isTablet ? 56 : 36,
        bottom: isTablet ? Math.max(72, height * 0.08) : 104
      }
    };
  }, [height, width]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPosts(await fetchRecentPosts());
    } catch (e: any) {
      setError(e.message ?? 'Map posts could not be loaded.');
    }
  }, []);

  const flyToLocation = useCallback((coordinate: LatLng, duration = 2600) => {
    mapRef.current?.animateCamera(locationCamera(coordinate, effectiveMapMode), { duration });
  }, [effectiveMapMode]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    loadMapMode().then(async ({ mode, automatic }) => {
      setMapMode(mode);
      if (mode === '2d' && automatic && await shouldShow2DNotice()) {
        Alert.alert(
          'Poplur Map is using 2D',
          'This phone may not run the 3D Poplur Map smoothly. The faster clay 2D map keeps the same posts and map tools. You can try 3D in Settings.',
          [{ text: 'OK', onPress: () => { mark2DNoticeSeen(); } }]
        );
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        const coordinate = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setCurrentLocation(coordinate);
        setSelected(coordinate);
      }
    } catch (e: any) {
      if (!cancelled) setError(e.message ?? 'Location could not be loaded.');
    }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapReady || autoZoomedRef.current) return;
    autoZoomedRef.current = true;
    const timer = setTimeout(() => flyToLocation(currentLocation ?? toronto), 900);
    return () => clearTimeout(timer);
  }, [currentLocation, flyToLocation, mapReady, mapReadyGeneration]);

  useEffect(() => {
    if (ownsMapRenderer) return;
    // The native map is deliberately destroyed while backgrounded or
    // pre-empted. Reset its readiness bookkeeping too, otherwise the fresh
    // instance returns at the world camera without running its initial zoom.
    setMapReady(false);
    autoZoomedRef.current = false;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, [ownsMapRenderer]);

  async function chooseMediaForMap() {
    if (!selected) return Alert.alert('Pick a coordinate first', 'Tap the map where this post should live.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85, allowsEditing: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      await uploadPostMedia({
        uri: asset.uri,
        mediaType: asset.type === 'video' ? 'video' : 'photo',
        latitude: selected.latitude,
        longitude: selected.longitude,
        sizeBytes: asset.fileSize,
      });
      setSelected(null); await load(); Alert.alert('Posted', 'Your media was posted to the map.');
    } catch (e: any) { Alert.alert('Upload failed', e.message); }
    finally { setUploading(false); }
  }

  function resetToGlobe() {
    mapRef.current?.animateCamera(worldCamera, { duration: 1200 });
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      flyToLocation(currentLocation ?? toronto);
    }, 1450);
  }

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  return <View style={styles.fill}>
    {ownsMapRenderer && <MapView
      ref={mapRef}
      provider={isAndroid ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
      mapType={mapType}
      userInterfaceStyle="dark"
      style={styles.fill}
      initialCamera={worldCamera}
      loadingEnabled
      loadingBackgroundColor="#000"
      loadingIndicatorColor="#fff"
      moveOnMarkerPress={false}
      showsBuildings={effectiveMapMode === '3d'}
      showsCompass={false}
      showsMyLocationButton={false}
      showsPointsOfInterest
      showsScale={false}
      showsUserLocation
      onMapReady={() => {
        // A background release creates a brand-new native map. Track each
        // ready callback even if React has not yet committed mapReady=false.
        autoZoomedRef.current = false;
        setMapReady(true);
        setMapReadyGeneration(generation => generation + 1);
      }}
      onPress={event => setSelected(event.nativeEvent.coordinate)}
    >
      {mappedPosts.map((post, index) => <React.Fragment key={post.id}>
        <Marker coordinate={{ latitude: post.latitude!, longitude: post.longitude! }} title={post.username ?? 'Poplur'} description={`${Math.round(post.radius / 1000)} km · ${post.viewCount} views`}>
          <View style={[styles.postMarker, index % 2 === 0 ? styles.blueMarker : styles.pinkMarker]}>
            <View style={styles.markerCore} />
          </View>
        </Marker>
        <Circle center={{ latitude: post.latitude!, longitude: post.longitude! }} radius={post.radius} strokeColor="rgba(168,85,247,0.72)" fillColor="rgba(168,85,247,0.16)" />
      </React.Fragment>)}
      {selected && <Marker coordinate={selected} anchor={{ x: 0.5, y: 0.62 }} title="Selected location">
        <View style={styles.selectedMarker}>
          <Ionicons name="navigate" color="#7dd3fc" size={34} />
        </View>
      </Marker>}
    </MapView>}

    {(!mapReady || !ownsMapRenderer) && <View style={styles.loading}><Text style={styles.loadingText}>{ownsMapRenderer ? 'Loading hybrid map...' : 'Map paused'}</Text></View>}

    <View pointerEvents="none" style={[styles.header, responsive.header]}>
      <Text style={[styles.title, responsive.title]}>Your Location</Text>
      <Text style={[styles.subtitle, responsive.subtitle]}>Explore what's happening around you right now!</Text>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>

    <View pointerEvents="none" style={[styles.trending, responsive.trending]}>
      <Text style={styles.label}>TRENDING</Text>
      <Ionicons name="arrow-up" color="#6ee36f" size={72} />
      <View style={styles.whiteRule} />
      <Text style={styles.count}>{totalViews}</Text>
      <Text style={styles.caption}>posts</Text>
    </View>

    <View style={[styles.actions, responsive.actions]}>
      <Pressable style={styles.weather} onPress={resetToGlobe}>
        <Ionicons name="rainy" color="white" size={48} />
        <Text style={styles.weatherText}>Rain</Text>
      </Pressable>
      <Pressable style={styles.iconButton} onPress={chooseMediaForMap} disabled={uploading}>
        <Ionicons name={uploading ? 'hourglass' : 'sparkles'} color="white" size={34} />
      </Pressable>
      <Pressable style={styles.iconButton} onPress={() => flyToLocation(currentLocation ?? toronto, 1200)}>
        <Ionicons name="analytics-outline" color="white" size={34} />
      </Pressable>
    </View>

    <View pointerEvents="none" style={[styles.radius, responsive.radius]}>
      <View style={styles.radiusHeader}>
        <Text style={styles.label}>RADIUS</Text>
        <Ionicons name="shield" color="#c98438" size={28} />
      </View>
      <Text style={styles.radiusCurrent}>{radiusKm}</Text>
      <View style={styles.goldRule} />
      <Text style={styles.radiusEarth}>{earthRadiusKm}</Text>
      <Text style={styles.km}>km</Text>
    </View>
  </View>;
}

function distanceKm(from: LatLng, to: LatLng) {
  const toRad = (value: number) => value * Math.PI / 180;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const deltaLat = toRad(to.latitude - from.latitude);
  const deltaLon = toRad(to.longitude - from.longitude);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: 'white', fontWeight: '800' },
  header: { position: 'absolute', left: 38, right: 28, top: 150 },
  title: { color: 'white', fontSize: 36, lineHeight: 42, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  subtitle: { color: 'white', fontSize: 30, lineHeight: 40, fontWeight: '800', marginTop: 10, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  error: { color: '#fecaca', fontSize: 14, fontWeight: '700', marginTop: 10 },
  postMarker: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 8 },
  blueMarker: { borderColor: 'rgba(125,211,252,0.52)', backgroundColor: 'rgba(14,165,233,0.16)' },
  pinkMarker: { borderColor: 'rgba(232,121,249,0.52)', backgroundColor: 'rgba(217,70,239,0.18)' },
  markerCore: { width: 24, height: 24, borderRadius: 12, borderWidth: 5, borderColor: 'rgba(255,255,255,0.72)' },
  selectedMarker: { width: 78, height: 110, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,165,233,0.2)', borderRadius: 39, borderColor: 'rgba(125,211,252,0.6)', borderWidth: 2 },
  trending: { position: 'absolute', left: 86, bottom: 214, alignItems: 'flex-start' },
  label: { color: 'rgba(255,255,255,0.72)', fontSize: 20, fontWeight: '900', letterSpacing: 4 },
  whiteRule: { width: 238, height: 4, backgroundColor: 'white', marginTop: 10 },
  count: { color: 'white', fontSize: 64, lineHeight: 72, fontWeight: '900', marginTop: 6 },
  caption: { color: 'rgba(255,255,255,0.72)', fontSize: 28, fontWeight: '900' },
  actions: { position: 'absolute', right: 28, bottom: 320, alignItems: 'center', gap: 24 },
  weather: { width: 116, minHeight: 120, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  weatherText: { color: 'white', fontWeight: '900', fontSize: 24, marginTop: 4 },
  iconButton: { width: 86, height: 86, borderRadius: 43, backgroundColor: 'rgba(0,0,0,0.46)', alignItems: 'center', justifyContent: 'center' },
  radius: { position: 'absolute', right: 36, bottom: 104, alignItems: 'flex-end' },
  radiusHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  radiusCurrent: { color: '#c98438', fontSize: 64, lineHeight: 76, fontWeight: '900', marginTop: 8 },
  goldRule: { width: 212, height: 4, backgroundColor: '#c98438', marginTop: 6 },
  radiusEarth: { color: 'white', fontSize: 56, lineHeight: 66, fontWeight: '900', marginTop: 6 },
  km: { color: '#c98438', fontSize: 22, fontWeight: '900' }
});
