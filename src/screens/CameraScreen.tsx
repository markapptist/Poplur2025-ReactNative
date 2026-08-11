import React, { useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { uploadPostMedia } from '../services/posts';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';
import { PoplurPerformanceMode } from '../performance/PoplurPerformanceManager';
import {
  cleanupExpoCameraTempFiles,
  deleteExpoCameraTempFile,
  MAX_CAMERA_TEMP_AGE_MS,
  MAX_VIDEO_UPLOAD_BYTES,
  verifiedMediaSize,
} from '../services/mediaResources';

type CameraPreview = {
  uri: string;
  type: 'photo' | 'video';
  sizeBytes: number;
  ownedTempFile: boolean;
};

export function CameraScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<CameraPreview | null>(null);
  const [cameraStorageReady, setCameraStorageReady] = useState(false);
  const [cameraStorageError, setCameraStorageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const captureBusyRef = useRef(false);
  const performance = usePoplurPerformance();
  const cameraAvailable = cameraPermission?.granted === true && micPermission?.granted === true;
  const ownsCamera = usePoplurHeavyRenderer(
    'camera-capture-session',
    cameraAvailable && cameraStorageReady,
    { priority: 110, decorative: false },
  );

  React.useEffect(() => {
    let active = true;
    void cleanupExpoCameraTempFiles()
      .then(() => {
        if (active) setCameraStorageReady(true);
      })
      .catch(error => {
        if (!active) return;
        setCameraStorageError(error instanceof Error ? error.message : 'Camera storage cleanup failed.');
      });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    if (!preview?.ownedTempFile) return;
    const uri = preview.uri;
    const expiration = setTimeout(() => {
      setPreview(current => current?.uri === uri ? null : current);
    }, MAX_CAMERA_TEMP_AGE_MS);
    return () => {
      clearTimeout(expiration);
      void deleteExpoCameraTempFile(uri);
    };
  }, [preview]);

  React.useEffect(() => {
    if (ownsCamera) return;
    cameraRef.current?.stopRecording();
    setRecording(false);
    setTorch(false);
  }, [ownsCamera]);

  if (!cameraAvailable) {
    return <View style={styles.permission}><Text style={styles.title}>Camera access needed</Text><Text style={styles.copy}>Poplur uses the camera like the iOS CameraKit screen.</Text><Pressable style={styles.button} onPress={() => { requestCameraPermission(); requestMicPermission(); }}><Text style={styles.buttonText}>Grant permissions</Text></Pressable></View>;
  }

  if (!cameraStorageReady) {
    return <View style={styles.permission}><Text style={styles.title}>Camera storage</Text><Text style={styles.copy}>{cameraStorageError ?? 'Preparing a bounded capture workspace…'}</Text>{cameraStorageError && <Pressable style={styles.button} onPress={() => {
      setCameraStorageError(null);
      void cleanupExpoCameraTempFiles().then(() => setCameraStorageReady(true)).catch(error => setCameraStorageError(error instanceof Error ? error.message : 'Camera storage cleanup failed.'));
    }}><Text style={styles.buttonText}>Try again</Text></Pressable>}</View>;
  }

  async function showPreview(
    uri: string,
    type: 'photo' | 'video',
    ownedTempFile: boolean,
    declaredBytes?: number,
  ) {
    try {
      const sizeBytes = await verifiedMediaSize(uri, type, declaredBytes);
      if (ownedTempFile) await cleanupExpoCameraTempFiles([uri]);
      setPreview({ uri, type, sizeBytes, ownedTempFile });
    } catch (error) {
      if (ownedTempFile) await deleteExpoCameraTempFile(uri).catch(() => {});
      throw error;
    }
  }

  async function takePhoto() {
    if (!ownsCamera || captureBusyRef.current) return;
    captureBusyRef.current = true;
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.86 });
      if (photo?.uri) await showPreview(photo.uri, 'photo', true);
    } catch (error: any) {
      Alert.alert('Capture failed', error.message ?? 'The photo could not be captured.');
    } finally {
      captureBusyRef.current = false;
    }
  }

  async function toggleRecord() {
    if (!ownsCamera && !recording) return;
    if (recording) { cameraRef.current?.stopRecording(); setRecording(false); return; }
    if (captureBusyRef.current) return;
    captureBusyRef.current = true;
    setRecording(true);
    let recordedUri: string | null = null;
    try {
      const video = await cameraRef.current?.recordAsync({
        maxDuration: 10,
        maxFileSize: MAX_VIDEO_UPLOAD_BYTES,
      });
      if (video?.uri) {
        await showPreview(video.uri, 'video', true);
        recordedUri = video.uri;
      }
    } catch (e: any) { Alert.alert('Recording failed', e.message); }
    finally {
      captureBusyRef.current = false;
      setRecording(false);
      const preserved = recordedUri
        ? [recordedUri]
        : preview?.ownedTempFile ? [preview.uri] : [];
      void cleanupExpoCameraTempFiles(preserved).catch(() => {});
    }
  }

  async function pickLibrary() {
    if (captureBusyRef.current) return;
    captureBusyRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85 });
      if (!result.canceled) {
        const asset = result.assets[0];
        await showPreview(asset.uri, asset.type === 'video' ? 'video' : 'photo', false, asset.fileSize);
      }
    } catch (error: any) {
      Alert.alert('Selection failed', error.message ?? 'The selected media could not be prepared.');
    } finally {
      captureBusyRef.current = false;
    }
  }

  async function postToProfile() {
    if (!preview) return;
    setUploading(true);
    try { await uploadPostMedia({ uri: preview.uri, mediaType: preview.type === 'video' ? 'video_profile' : 'photo_profile', sizeBytes: preview.sizeBytes }); setPreview(null); Alert.alert('Posted', 'Saved to your profile feed.'); }
    catch (e: any) { Alert.alert('Upload failed', e.message); }
    finally { setUploading(false); }
  }

  return <View style={styles.fill}>
    {ownsCamera ? (
      <CameraView
        ref={cameraRef}
        style={styles.fill}
        facing={facing}
        enableTorch={torch}
        mode="video"
        active={ownsCamera}
        videoQuality={performance.mode === PoplurPerformanceMode.FULL ? '1080p' : performance.mode === PoplurPerformanceMode.EMERGENCY ? '480p' : '720p'}
      />
    ) : <View style={styles.fill} />}
    <View style={styles.scanFrame}><Text style={styles.scanText}>Scanning…</Text></View>
    {preview && <View style={styles.preview}><Image source={{ uri: preview.uri }} style={styles.previewImage} /><Pressable style={styles.previewClose} onPress={() => setPreview(null)}><Ionicons name="close" color="white" size={22} /></Pressable></View>}
    <View style={styles.topBar}>
      <Pressable onPress={() => setTorch(t => !t)} style={styles.round}><Ionicons name={torch ? 'flash' : 'flash-off'} color="white" size={24} /></Pressable>
      <Pressable onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={styles.round}><Ionicons name="camera-reverse" color="white" size={24} /></Pressable>
    </View>
    <View style={styles.controls}>
      <Pressable style={styles.smallRound} onPress={pickLibrary}><Ionicons name="images" color="white" size={28} /></Pressable>
      <Pressable style={[styles.shutter, recording && styles.recording]} onPress={takePhoto} onLongPress={toggleRecord}><View style={styles.innerShutter} /></Pressable>
      <Pressable style={styles.smallRound} onPress={preview ? postToProfile : toggleRecord}><Ionicons name={preview ? 'paper-plane' : recording ? 'stop' : 'videocam'} color="white" size={28} /></Pressable>
    </View>
    {uploading && <Text style={styles.uploading}>Uploading…</Text>}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#050713' }, permission: { flex: 1, backgroundColor: '#050713', alignItems: 'center', justifyContent: 'center', padding: 24 }, title: { color: 'white', fontWeight: '900', fontSize: 28 }, copy: { color: '#c7d2fe', textAlign: 'center', marginVertical: 14 }, button: { backgroundColor: '#4f46e5', borderRadius: 16, padding: 14 }, buttonText: { color: 'white', fontWeight: '800' }, topBar: { position: 'absolute', right: 20, top: 60, gap: 12 }, round: { backgroundColor: 'rgba(0,0,0,0.42)', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }, controls: { position: 'absolute', bottom: 220, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 }, smallRound: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.44)' }, shutter: { width: 86, height: 86, borderRadius: 43, borderWidth: 5, borderColor: 'white', alignItems: 'center', justifyContent: 'center' }, innerShutter: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'white' }, recording: { borderColor: '#ef4444' }, preview: { position: 'absolute', left: 18, bottom: 322, width: 104, height: 154, borderRadius: 16, overflow: 'hidden', borderColor: 'white', borderWidth: 2 }, previewImage: { width: '100%', height: '100%' }, previewClose: { position: 'absolute', right: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14 }, scanFrame: { position: 'absolute', alignSelf: 'center', top: 160, width: 220, height: 260, borderColor: 'rgba(255,255,255,0.75)', borderWidth: 2, borderRadius: 110, alignItems: 'center' }, scanText: { color: 'white', marginTop: -28, fontWeight: '800' }, uploading: { position: 'absolute', top: 120, alignSelf: 'center', color: 'white', backgroundColor: 'rgba(0,0,0,0.55)', padding: 10, borderRadius: 12 }
});
