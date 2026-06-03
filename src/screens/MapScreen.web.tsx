import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { fetchRecentPosts, uploadPostMedia } from '../services/posts';
import type { Post } from '../types/models';

const toronto = { latitude: 43.6532, longitude: -79.3832 };

export function MapScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState(toronto);
  const [uploading, setUploading] = useState(false);

  const mappedPosts = useMemo(() => posts.filter(post => post.latitude && post.longitude), [posts]);

  const load = useCallback(async () => {
    setPosts(await fetchRecentPosts());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function selectFromSurface(index: number) {
    const latitude = toronto.latitude + (index % 5 - 2) * 0.012;
    const longitude = toronto.longitude + (Math.floor(index / 5) - 1) * 0.018;
    setSelected({ latitude, longitude });
  }

  async function chooseMediaForMap() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
      allowsEditing: false
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      await uploadPostMedia({
        uri: asset.uri,
        mediaType: asset.type === 'video' ? 'video' : 'photo',
        latitude: selected.latitude,
        longitude: selected.longitude
      });
      await load();
      Alert.alert('Posted', 'Your media was posted to the map.');
    } catch (error: any) {
      Alert.alert('Upload failed', error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.fill}>
      <View style={styles.mapSurface}>
        <View style={styles.grid}>
          {Array.from({ length: 15 }).map((_, index) => (
            <Pressable key={index} style={styles.gridCell} onPress={() => selectFromSurface(index)}>
              {index === 7 && <View style={styles.centerPin} />}
            </Pressable>
          ))}
        </View>

        {mappedPosts.slice(0, 8).map((post, index) => (
          <View
            key={post.id}
            style={[
              styles.postPin,
              {
                left: `${18 + (index % 4) * 22}%`,
                top: `${24 + Math.floor(index / 4) * 26}%`
              }
            ]}
          >
            <Ionicons name="radio-button-on" color="#818cf8" size={24} />
          </View>
        ))}

        <View style={styles.selectedPin}>
          <Ionicons name="location" color="#f97316" size={34} />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Map posts</Text>
        <Text style={styles.panelText}>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</Text>
        <Pressable style={styles.button} onPress={chooseMediaForMap} disabled={uploading}>
          <Ionicons name="cloud-upload" color="white" size={20} />
          <Text style={styles.buttonText}>{uploading ? 'Posting...' : 'Choose media & post'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.postStrip} contentContainerStyle={styles.postStripContent} showsHorizontalScrollIndicator={false}>
        {mappedPosts.map(post => (
          <View key={post.id} style={styles.postCard}>
            {post.mediaType.includes('video') ? (
              <View style={styles.videoPreview}><Ionicons name="play" color="white" size={22} /></View>
            ) : (
              <Image source={{ uri: post.mediaURL }} style={styles.previewImage} />
            )}
            <Text style={styles.postTitle} numberOfLines={1}>{post.username ?? 'Poplur'}</Text>
            <Text style={styles.postMeta}>{Math.round(post.radius / 1000)} km · {post.viewCount} views</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#050713' },
  mapSurface: { flex: 1, backgroundColor: '#0f172a', overflow: 'hidden' },
  grid: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: '20%', height: '33.333%', borderColor: 'rgba(148,163,184,0.18)', borderWidth: 1 },
  centerPin: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#38bdf8', margin: 'auto' },
  postPin: { position: 'absolute', width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  selectedPin: { position: 'absolute', left: '50%', top: '50%', marginLeft: -17, marginTop: -34 },
  panel: { position: 'absolute', left: 16, right: 16, top: 62, backgroundColor: 'rgba(5,7,19,0.86)', borderRadius: 8, padding: 16, borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1 },
  panelTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
  panelText: { color: '#bae6fd', marginTop: 5 },
  button: { marginTop: 12, backgroundColor: '#4f46e5', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: 'white', fontWeight: '800' },
  postStrip: { position: 'absolute', left: 0, right: 0, bottom: 148 },
  postStripContent: { paddingHorizontal: 16, gap: 12 },
  postCard: { width: 150, backgroundColor: 'rgba(15,23,42,0.88)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderRadius: 8, padding: 10 },
  previewImage: { height: 82, borderRadius: 8, backgroundColor: '#111827' },
  videoPreview: { height: 82, borderRadius: 8, backgroundColor: '#312e81', alignItems: 'center', justifyContent: 'center' },
  postTitle: { color: 'white', fontWeight: '800', marginTop: 8 },
  postMeta: { color: '#bae6fd', fontSize: 12, marginTop: 3 }
});
