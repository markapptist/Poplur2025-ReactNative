import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { fetchMyPosts } from '../services/posts';
import { getCurrentProfile, updateCurrentProfile } from '../services/profile';
import type { Post, UserProfile } from '../types/models';

export function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await getCurrentProfile();
      setProfile(p); setUsername(p?.username ?? ''); setBio(p?.bio ?? '');
      setPosts(p ? await fetchMyPosts(p.uid) : []);
    } catch (e: any) {
      setError(e.message ?? 'Profile could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    try { await updateCurrentProfile({ username, bio }); setEditing(false); await load(); }
    catch (e: any) { Alert.alert('Could not save', e.message); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="white" /></View>;

  if (error) return <View style={styles.center}>
    <Text style={styles.errorTitle}>Profile unavailable</Text>
    <Text style={styles.errorText}>{error}</Text>
    <View style={styles.actions}>
      <Pressable style={styles.action} onPress={load}><Text style={styles.actionText}>Retry</Text></Pressable>
      <Pressable style={styles.actionAlt} onPress={() => signOut(auth)}><Text style={styles.actionText}>Logout</Text></Pressable>
    </View>
  </View>;

  return <FlatList data={posts} numColumns={3} keyExtractor={item => item.id} contentContainerStyle={styles.container} ListHeaderComponent={<View style={styles.header}>
    <View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.username ?? 'P').slice(0,1).toUpperCase()}</Text></View>
    {editing ? <>
      <TextInput value={username} onChangeText={setUsername} style={styles.input} placeholder="Username" placeholderTextColor="#9ca3af" />
      <TextInput value={bio} onChangeText={setBio} style={styles.input} placeholder="Bio" placeholderTextColor="#9ca3af" />
    </> : <>
      <Text style={styles.username}>@{profile?.username}</Text>
      <Text style={styles.email}>{profile?.email}</Text>
      {!!profile?.bio && <Text style={styles.bio}>{profile.bio}</Text>}
    </>}
    <View style={styles.stats}><Text style={styles.stat}>{posts.length}\nPosts</Text><Text style={styles.stat}>{posts.reduce((n,p)=>n+p.viewCount,0)}\nViews</Text><Text style={styles.stat}>{Math.round(posts.reduce((n,p)=>n+p.radius,0)/1000)} km\nRadius</Text></View>
    <View style={styles.actions}><Pressable style={styles.action} onPress={editing ? save : () => setEditing(true)}><Text style={styles.actionText}>{editing ? 'Save profile' : 'Edit profile'}</Text></Pressable><Pressable style={styles.actionAlt} onPress={() => signOut(auth)}><Text style={styles.actionText}>Logout</Text></Pressable></View>
    <Text style={styles.section}>My posts</Text>
  </View>} renderItem={({ item }) => <Image source={{ uri: item.mediaURL }} style={styles.gridImage} />} />;
}

const styles = StyleSheet.create({ center: { flex: 1, backgroundColor: '#050713', alignItems: 'center', justifyContent: 'center', padding: 24 }, errorTitle: { color: 'white', fontSize: 24, fontWeight: '900' }, errorText: { color: '#fecaca', marginTop: 10, textAlign: 'center', lineHeight: 20 }, container: { backgroundColor: '#050713', paddingBottom: 230 }, header: { padding: 20, paddingTop: 64, alignItems: 'center' }, avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: 'white', fontWeight: '900', fontSize: 42 }, username: { color: 'white', fontWeight: '900', fontSize: 26, marginTop: 14 }, email: { color: '#c7d2fe', marginTop: 4 }, bio: { color: 'white', marginTop: 10, textAlign: 'center' }, stats: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 24 }, stat: { color: 'white', fontWeight: '800', textAlign: 'center' }, actions: { flexDirection: 'row', gap: 10, marginTop: 22 }, action: { backgroundColor: '#4f46e5', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 }, actionAlt: { backgroundColor: '#374151', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 }, actionText: { color: 'white', fontWeight: '800' }, section: { color: 'white', fontSize: 20, fontWeight: '900', alignSelf: 'flex-start', marginTop: 28 }, gridImage: { width: '33.33%', aspectRatio: 1, backgroundColor: '#111827', borderWidth: 1, borderColor: '#050713' }, input: { width: '100%', color: 'white', borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12, backgroundColor: 'rgba(255,255,255,0.08)' }
});
