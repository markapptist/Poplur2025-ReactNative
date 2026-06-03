import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { GlassCard } from '../components/GlassCard';
import { fetchRecentPosts, incrementPostView } from '../services/posts';
import type { Post } from '../types/models';

export function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setLoading(true); try { setPosts(await fetchRecentPosts()); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && posts.length === 0) return <View style={styles.center}><ActivityIndicator color="white" /><Text style={styles.muted}>Loading feed…</Text></View>;

  return <FlatList data={posts} keyExtractor={item => item.id} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} contentContainerStyle={styles.list} renderItem={({ item }) => <PostCard post={item} />} />;
}

function PostCard({ post }: { post: Post }) {
  const isVideo = post.mediaType.includes('video') || post.mediaURL.toLowerCase().includes('.mp4');
  return <Pressable onPress={() => incrementPostView(post).catch(() => {})}><GlassCard style={styles.card}>
    <Text style={styles.username}>@{post.username ?? 'poplur'}</Text>
    <Text style={styles.meta}>{Math.round(post.radius / 1000)} km radius · {post.viewCount} views</Text>
    {isVideo ? <Video source={{ uri: post.mediaURL }} style={styles.media} useNativeControls resizeMode={ResizeMode.COVER} isLooping /> : <Image source={{ uri: post.mediaURL }} style={styles.media} />}
    <Text style={styles.caption}>{post.latitude && post.longitude ? `📍 ${post.latitude.toFixed(4)}, ${post.longitude.toFixed(4)}` : 'Profile post'}</Text>
  </GlassCard></Pressable>;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#050713', alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#9ca3af', marginTop: 10 },
  list: { padding: 16, paddingBottom: 230, backgroundColor: '#050713' },
  card: { marginBottom: 16, padding: 14 },
  username: { color: 'white', fontWeight: '900', fontSize: 18 },
  meta: { color: '#c7d2fe', marginTop: 4, marginBottom: 10 },
  media: { height: 460, borderRadius: 22, backgroundColor: '#111827' },
  caption: { color: 'rgba(255,255,255,0.72)', marginTop: 10 }
});
