import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import Server from '@dr.pogodin/react-native-static-server';
import { unzip } from 'react-native-zip-archive';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { PreloginWebScreen } from './PreloginWebScreen';
import { getCurrentProfile } from '../services/profile';
import { uploadPostMedia } from '../services/posts';
import {
  getHandledPermissionPrimers,
  markPermissionPrimerHandled,
  type PrimerPermission,
} from '../services/permissionPrimer';
import {
  useNativeVoiceAssistant,
  type NativeVoiceCommand,
} from '../services/nativeVoiceAssistant';

// Post-login HOME web embed (RN parity with iOS/Android Phase 3).
//
// The approved post-login home is the poplur-clay-map ViewHarness home twin
// (?view=home) — the same bundle the iOS app serves over its custom scheme and
// Android serves over WebViewAssetLoader. RN's WebView has neither, and the
// bundle needs a REAL http origin (Mapbox GL uses a Web Worker and the app is an
// ES-module Vite build; both are blocked on file://). So RN ships the bundle as
// one zip asset, extracts it to the document directory on first run (version-
// keyed), and serves it from a loopback static server.
//
// Bridge: the web posts { type, ... } via window.PoplurNative.onEvent /
// webkit.messageHandlers — in RN it arrives through window.ReactNativeWebView.
// postMessage (injected below as PoplurNative so the bundle's nativeBridge
// detects a native shell, hides the browser-only test pills, and emits
// homeReady).

// Bump when the staged claymap.zip changes so devices re-extract.
const BUNDLE_VERSION = '55';

const CLAYMAP_ZIP = require('../assets/claymap/claymap.zip');
const WEB_HOME_ORIGIN = 'http://127.0.0.1:5173';

// Adapter: the clay bundle talks to Android via window.PoplurNative.onEvent(json).
// Provide the same surface backed by ReactNativeWebView.postMessage, injected
// before the page loads so isNativeShell() is true from the first frame.
const RN_NATIVE_SHELL = `
  window.PoplurNative = {
    onEvent: function (json) {
      window.ReactNativeWebView.postMessage(json);
    }
  };
  true;
`;

async function prepareBundle(): Promise<string> {
  const root = `${FileSystem.documentDirectory}claymap-v${BUNDLE_VERSION}`;
  const marker = `${root}/.extracted`;
  const markerInfo = await FileSystem.getInfoAsync(marker);
  if (!markerInfo.exists) {
    const asset = Asset.fromModule(CLAYMAP_ZIP);
    await asset.downloadAsync();
    const zipUri = asset.localUri ?? asset.uri;
    await FileSystem.makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
    await unzip(zipUri.replace('file://', ''), root.replace('file://', ''));
    await FileSystem.writeAsStringAsync(marker, 'ok');
  }
  return root.replace('file://', '');
}

type ClayMessage = {
  type?: string;
  requestId?: string;
  kind?: 'photo' | 'video';
  data?: string;
  caption?: string;
  channelId?: string;
  filterId?: string;
  usedAI?: boolean;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  control?: string;
  scope?: 'once' | 'whileUsing';
  permission?: PrimerPermission;
  granted?: boolean;
};

type MediaAsset = {
  uri: string;
  type?: string | null;
  mimeType?: string | null;
  duration?: number | null;
};

function assetKind(asset: MediaAsset): 'photo' | 'video' {
  return asset.type === 'video' || asset.mimeType?.startsWith('video/') ? 'video' : 'photo';
}

function assetExtension(asset: MediaAsset, kind: 'photo' | 'video') {
  if (asset.mimeType?.includes('webm')) return 'webm';
  if (asset.mimeType?.includes('quicktime')) return 'mov';
  if (asset.mimeType?.includes('png')) return 'png';
  return kind === 'video' ? 'mp4' : 'jpg';
}

function clipLength(duration?: number | null) {
  if (!duration || duration <= 0) return undefined;
  const seconds = Math.round(duration / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type PermissionNeeds = {
  location: boolean;
  photos: boolean;
};

const WebHomeIframe = 'iframe' as unknown as React.ComponentType<{
  src: string;
  title: string;
  allow: string;
  onLoad: () => void;
  style: Record<string, string | number>;
}>;

export function PostLoginHomeWebScreen({
  skipPermissionPrimer = false,
  forcePermissionPrimer = false,
}: {
  skipPermissionPrimer?: boolean;
  forcePermissionPrimer?: boolean;
} = {}) {
  const webViewRef = useRef<WebView>(null);
  const serverRef = useRef<Server | null>(null);
  const bundleRootRef = useRef<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [homeReady, setHomeReady] = useState(false);
  const [profileQuery, setProfileQuery] = useState('');
  const [profileReady, setProfileReady] = useState(false);
  const [permissionNeeds, setPermissionNeeds] = useState<PermissionNeeds | null>(null);
  const photoPrimerConsumedRef = useRef(false);
  const homeReadyRef = useRef(false);
  const pendingNativeVoiceCommandRef = useRef<NativeVoiceCommand | null>(null);

  const sendProfileToWeb = async () => {
    try {
      const profile = await getCurrentProfile();
      const username = profile?.username?.trim();
      if (!username) return;
      const payload = JSON.stringify({
        username,
        business: profile?.accountType === 'business'
      });
      webViewRef.current?.injectJavaScript(`window.poplurProfile && window.poplurProfile(${payload}); true;`);
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] profile bridge failed', error);
    }
  };

  useEffect(() => {
    let active = true;
    void getCurrentProfile()
      .then(profile => {
        const username = profile?.username?.trim();
        if (active && username) {
          const business = profile?.accountType === 'business' ? '&business=1' : '';
          setProfileQuery(`&username=${encodeURIComponent(username)}${business}`);
        }
      })
      .catch(error => console.warn('[PostLoginHomeWebScreen] profile lookup failed', error))
      .finally(() => {
        if (active) setProfileReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const resolvePermissionNeeds = async () => {
      if (skipPermissionPrimer) {
        if (active) setPermissionNeeds({ location: false, photos: false });
        return;
      }
      if (forcePermissionPrimer) {
        if (active) setPermissionNeeds({ location: true, photos: true });
        return;
      }

      // Returning authenticated users bypass pre-login, so query (without
      // prompting) and ask only for permissions the OS has not already granted.
      const [locationPermission, photoPermission, handled] = await Promise.all([
        Location.getForegroundPermissionsAsync().catch(() => null),
        ImagePicker.getMediaLibraryPermissionsAsync().catch(() => null),
        getHandledPermissionPrimers().catch(() => ({ location: false, photos: false })),
      ]);
      if (active) {
        setPermissionNeeds({
          // Do not resurrect the clay primer for a persisted denial when the
          // OS can no longer open its prompt. That state belongs in Settings.
          location: !handled.location
            && locationPermission?.granted !== true
            && locationPermission?.canAskAgain === true,
          photos: !handled.photos
            && photoPermission?.granted !== true
            && photoPermission?.canAskAgain === true,
        });
      }
    };
    void resolvePermissionNeeds();
    return () => { active = false; };
  }, [forcePermissionPrimer, skipPermissionPrimer]);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web') {
      setOrigin(WEB_HOME_ORIGIN);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const fileDir = await prepareBundle();
        bundleRootRef.current = fileDir;
        const server = new Server({ fileDir, hostname: '127.0.0.1', stopInBackground: true });
        serverRef.current = server;
        const url = await server.start();
        if (!cancelled) setOrigin(url);
      } catch (error) {
        console.warn('[PostLoginHomeWebScreen] bundle/server failed', error);
      }
    })();
    return () => {
      cancelled = true;
      serverRef.current?.stop();
      serverRef.current = null;
      bundleRootRef.current = null;
    };
  }, []);

  const dispatchToClay = useCallback((eventName: string, detail: unknown) => {
    const name = JSON.stringify(eventName);
    const payload = JSON.stringify(detail)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    webViewRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent(${name}, { detail: ${payload} })); true;`,
    );
  }, []);

  const deliverNativeVoiceCommand = useCallback((command: NativeVoiceCommand) => {
    if (!homeReadyRef.current) {
      pendingNativeVoiceCommandRef.current = command;
      return;
    }
    dispatchToClay('poplur-native-voice-command', command);
  }, [dispatchToClay]);

  const { requestVoiceAssistant } = useNativeVoiceAssistant({
    enabled: Platform.OS !== 'web',
    onCommand: deliverNativeVoiceCommand,
  });

  const markHomeReady = useCallback(() => {
    homeReadyRef.current = true;
    setHomeReady(true);
    const pending = pendingNativeVoiceCommandRef.current;
    if (pending) {
      pendingNativeVoiceCommandRef.current = null;
      dispatchToClay('poplur-native-voice-command', pending);
    }
  }, [dispatchToClay]);

  const requestAndPushLocation = useCallback(async () => {
    await markPermissionPrimerHandled('location').catch(error =>
      console.warn('[PostLoginHomeWebScreen] location primer state save failed', error));
    // The custom clay primer is the only startup permission UI. Reuse an
    // existing grant, but never stack the Expo/OS sheet on top of that card.
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return;
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const payload = {
      type: 'poplur-location',
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
    };
    const json = JSON.stringify(payload);
    webViewRef.current?.injectJavaScript(`
      (function () {
        var location = ${json};
        window.__poplurNativeLocation = location;
        window.postMessage(location, '*');
        window.dispatchEvent(new CustomEvent('poplur-location', { detail: location }));
        var frame = document.querySelector('iframe[title="Poplur clay map"]');
        if (frame && frame.contentWindow) frame.contentWindow.postMessage(location, '*');
      })();
      true;
    `);
  }, []);

  const materializeCapture = useCallback(async (asset: MediaAsset) => {
    const root = bundleRootRef.current;
    if (!root || !origin) throw new Error('The Poplur camera is still starting. Try again in a moment.');

    const kind = assetKind(asset);
    const extension = assetExtension(asset, kind);
    const filename = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extension}`;
    // The static server needs a filesystem path, while Expo FileSystem requires
    // a file URI. Keep the two forms explicit instead of relying on platform
    // coercion, which fails on Android's content-backed camera result.
    const fileRoot = root.startsWith('file://') ? root : `file://${root}`;
    const captureDirectory = `${fileRoot}/captures`;
    const destination = `${captureDirectory}/${filename}`;
    await FileSystem.makeDirectoryAsync(captureDirectory, { intermediates: true }).catch(() => {});
    await FileSystem.copyAsync({ from: asset.uri, to: destination });

    return {
      kind,
      src: `${origin}/captures/${filename}`,
      length: kind === 'video' ? clipLength(asset.duration) : undefined,
    };
  }, [origin]);

  const pickCapture = useCallback(async (source: 'camera' | 'library', requestedKind: 'photo' | 'video' | 'all') => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(`${source === 'camera' ? 'Camera' : 'Photo library'} access was not allowed.`);

    const mediaTypes = requestedKind === 'video'
      ? ImagePicker.MediaTypeOptions.Videos
      : requestedKind === 'photo'
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.All;
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes,
      quality: 0.9,
      videoMaxDuration: 60,
      allowsEditing: false,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;

    const capture = await materializeCapture(result.assets[0]);
    dispatchToClay('poplur-native-capture', capture);
  }, [dispatchToClay, materializeCapture]);

  const publishPost = useCallback(async (message: ClayMessage) => {
    const requestId = message.requestId;
    if (!requestId || !message.data) return;
    try {
      const kind = message.kind === 'video' ? 'video' : 'photo';
      await uploadPostMedia({
        uri: message.data,
        mediaType: kind,
        latitude: Number.isFinite(message.latitude) ? message.latitude : undefined,
        longitude: Number.isFinite(message.longitude) ? message.longitude : undefined,
        caption: message.caption,
        channelId: message.channelId,
        filterId: message.filterId,
        usedAI: message.usedAI,
        radiusMeters: Number.isFinite(message.radiusKm) ? Math.round(Number(message.radiusKm) * 1000) : undefined,
      });
      dispatchToClay('poplur-upload-result', { requestId, ok: true });
    } catch (error) {
      const fallback = 'Your post could not be uploaded.';
      dispatchToClay('poplur-upload-result', {
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : fallback,
      });
    }
  }, [dispatchToClay]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as ClayMessage;
      if (message.type === 'homeReady' || message.type === 'mapReady') markHomeReady();
      if (message.type === 'requestProfile') void sendProfileToWeb();
      if (message.type === 'requestVoiceAssistant') {
        // This message is emitted only by the visible HEY POPLUR tile. Home
        // mount itself never requests microphone or speech permission.
        void requestVoiceAssistant().catch(error =>
          console.warn('[PostLoginHomeWebScreen] voice assistant request failed', error));
      }
      if (message.type === 'permissionHandled'
        && (message.permission === 'location' || message.permission === 'photos')) {
        const permission = message.permission;
        void markPermissionPrimerHandled(permission).catch(error =>
          console.warn('[PostLoginHomeWebScreen] permission state save failed', error));
        if (permission === 'photos') photoPrimerConsumedRef.current = true;
        setPermissionNeeds(needs => needs
          ? { ...needs, [permission]: false }
          : needs);
      }
      if (message.type === 'requestLocation') {
        setPermissionNeeds(needs => needs ? { ...needs, location: false } : needs);
        void requestAndPushLocation().catch(error =>
          console.warn('[PostLoginHomeWebScreen] location request failed', error));
      }
      if (message.type === 'requestCameraPermission') {
        void ImagePicker.requestCameraPermissionsAsync();
      }
      if (message.type === 'cameraShutter') {
        void pickCapture('camera', 'photo').catch(error => console.warn('[PostLoginHomeWebScreen] camera capture failed', error));
      }
      if (message.type === 'cameraControl' && message.control === 'record') {
        void pickCapture('camera', 'video').catch(error => console.warn('[PostLoginHomeWebScreen] video capture failed', error));
      }
      if (message.type === 'requestCameraRoll') {
        const rememberPhotos = markPermissionPrimerHandled('photos').catch(error =>
          console.warn('[PostLoginHomeWebScreen] photo primer state save failed', error));
        // The first post-login request while askPhotos=1 is the approved custom
        // primer's Allow action. It should not open an OS prompt or picker.
        // Later requests come from the actual Camera Roll surface and retain
        // the existing picker flow.
        if (permissionNeeds?.photos && !photoPrimerConsumedRef.current) {
          photoPrimerConsumedRef.current = true;
          setPermissionNeeds(needs => needs ? { ...needs, photos: false } : needs);
          void rememberPhotos
            .then(() => ImagePicker.getMediaLibraryPermissionsAsync())
            .catch(error =>
              console.warn('[PostLoginHomeWebScreen] camera roll permission failed', error));
        } else {
          void rememberPhotos;
          void pickCapture('library', 'all').catch(error => console.warn('[PostLoginHomeWebScreen] camera roll failed', error));
        }
      }
      if (message.type === 'publishPost') void publishPost(message);
    } catch {
      // Non-JSON messages are ignored.
    }
  };

  const permissionQuery = permissionNeeds
    ? `${permissionNeeds.location ? '&askLocation=1' : ''}${permissionNeeds.photos ? '&askPhotos=1' : ''}`
    : '';
  // The browser preview nests the clay home inside Expo Web, then nests the
  // Mapbox map inside that home. Advertise that extra compositor layer so the
  // map keeps its 3D look while using the same constrained GPU budget as the
  // native shells. Native devices already select their own performance tier.
  const webMapQuery = Platform.OS === 'web' ? '&mapLite=1' : '';
  const homeUri = origin && permissionNeeds && profileReady
    // Include the archive version in the page URL too. Native WebViews cache
    // index.html aggressively; this prevents a fresh extracted bundle from
    // reopening a stale home page from their HTTP cache.
    ? `${origin}/index.html?view=home&tabs=0&bundle=${BUNDLE_VERSION}${profileQuery}${permissionQuery}${webMapQuery}`
    : null;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {homeUri && Platform.OS === 'web' && (
        <WebHomeIframe
          src={homeUri}
          title="Poplur post-login"
          allow="geolocation; camera; microphone"
          onLoad={markHomeReady}
          style={webIframeStyle}
        />
      )}
      {homeUri && Platform.OS !== 'web' && (
        <WebView
          ref={webViewRef}
          style={styles.web}
          source={{ uri: homeUri }}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={RN_NATIVE_SHELL}
          onMessage={handleMessage}
          onLoadEnd={() => {
            if (Platform.OS === 'web') setHomeReady(true);
          }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
        />
      )}
      {/* The approved Loading screen (splash-only prelogin variant renders its
          loading treatment) covers extraction + server boot + the map intro,
          exactly like iOS/Android hold their loading over the home. */}
      {!homeReady && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <PreloginWebScreen splashOnly />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050407' },
  web: { flex: 1, backgroundColor: '#050407' },
});

const webIframeStyle = {
  width: '100%',
  height: '100%',
  border: 0,
  display: 'block',
  backgroundColor: '#050407',
};
