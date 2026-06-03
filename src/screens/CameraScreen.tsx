import React, { useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { uploadPostMedia } from '../services/posts';

export function CameraScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'photo' | 'video'>('photo');
  const [uploading, setUploading] = useState(false);

  if (!cameraPermission?.granted || !micPermission?.granted) {
    return <View style={styles.permission}><Text style={styles.title}>Camera access needed</Text><Text style={styles.copy}>Poplur uses the camera like the iOS CameraKit screen.</Text><Pressable style={styles.button} onPress={() => { requestCameraPermission(); requestMicPermission(); }}><Text style={styles.buttonText}>Grant permissions</Text></Pressable></View>;
  }

  async function takePhoto() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.86 });
    if (photo?.uri) { setPreviewUri(photo.uri); setPreviewType('photo'); }
  }

  async function toggleRecord() {
    if (recording) { cameraRef.current?.stopRecording(); setRecording(false); return; }
    setRecording(true);
    try {
      const video = await cameraRef.current?.recordAsync({ maxDuration: 10 });
      if (video?.uri) { setPreviewUri(video.uri); setPreviewType('video'); }
    } catch (e: any) { Alert.alert('Recording failed', e.message); }
    finally { setRecording(false); }
  }

  async function pickLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85 });
    if (!result.canceled) { setPreviewUri(result.assets[0].uri); setPreviewType(result.assets[0].type === 'video' ? 'video' : 'photo'); }
  }

  async function postToProfile() {
    if (!previewUri) return;
    setUploading(true);
    try { await uploadPostMedia({ uri: previewUri, mediaType: previewType === 'video' ? 'video_profile' : 'photo_profile' }); setPreviewUri(null); Alert.alert('Posted', 'Saved to your profile feed.'); }
    catch (e: any) { Alert.alert('Upload failed', e.message); }
    finally { setUploading(false); }
  }

  return <View style={styles.fill}>
    <CameraView ref={cameraRef} style={styles.fill} facing={facing} enableTorch={torch} mode="video" />
    <View style={styles.scanFrame}><Text style={styles.scanText}>Scanning…</Text></View>
    {previewUri && <View style={styles.preview}><Image source={{ uri: previewUri }} style={styles.previewImage} /><Pressable style={styles.previewClose} onPress={() => setPreviewUri(null)}><Ionicons name="close" color="white" size={22} /></Pressable></View>}
    <View style={styles.topBar}>
      <Pressable onPress={() => setTorch(t => !t)} style={styles.round}><Ionicons name={torch ? 'flash' : 'flash-off'} color="white" size={24} /></Pressable>
      <Pressable onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={styles.round}><Ionicons name="camera-reverse" color="white" size={24} /></Pressable>
    </View>
    <View style={styles.controls}>
      <Pressable style={styles.smallRound} onPress={pickLibrary}><Ionicons name="images" color="white" size={28} /></Pressable>
      <Pressable style={[styles.shutter, recording && styles.recording]} onPress={takePhoto} onLongPress={toggleRecord}><View style={styles.innerShutter} /></Pressable>
      <Pressable style={styles.smallRound} onPress={previewUri ? postToProfile : toggleRecord}><Ionicons name={previewUri ? 'paper-plane' : recording ? 'stop' : 'videocam'} color="white" size={28} /></Pressable>
    </View>
    {uploading && <Text style={styles.uploading}>Uploading…</Text>}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#050713' }, permission: { flex: 1, backgroundColor: '#050713', alignItems: 'center', justifyContent: 'center', padding: 24 }, title: { color: 'white', fontWeight: '900', fontSize: 28 }, copy: { color: '#c7d2fe', textAlign: 'center', marginVertical: 14 }, button: { backgroundColor: '#4f46e5', borderRadius: 16, padding: 14 }, buttonText: { color: 'white', fontWeight: '800' }, topBar: { position: 'absolute', right: 20, top: 60, gap: 12 }, round: { backgroundColor: 'rgba(0,0,0,0.42)', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }, controls: { position: 'absolute', bottom: 220, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 }, smallRound: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.44)' }, shutter: { width: 86, height: 86, borderRadius: 43, borderWidth: 5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' }, innerShutter: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'white' }, recording: { borderColor: '#ef4444' }, preview: { position: 'absolute', left: 18, bottom: 322, width: 104, height: 154, borderRadius: 16, overflow: 'hidden', borderColor: 'white', borderWidth: 2 }, previewImage: { width: '100%', height: '100%' }, previewClose: { position: 'absolute', right: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14 }, scanFrame: { position: 'absolute', alignSelf: 'center', top: 160, width: 220, height: 260, borderColor: 'rgba(255,255,255,0.75)', borderWidth: 2, borderRadius: 110, alignItems: 'center' }, scanText: { color: 'white', marginTop: -28, fontWeight: '800' }, uploading: { position: 'absolute', top: 120, alignSelf: 'center', color: 'white', backgroundColor: 'rgba(0,0,0,0.55)', padding: 10, borderRadius: 12 }
});
