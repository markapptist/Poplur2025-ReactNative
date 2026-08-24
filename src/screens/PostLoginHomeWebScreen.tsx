import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import Server from '@dr.pogodin/react-native-static-server';
import { unzip } from 'react-native-zip-archive';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { PreloginWebScreen } from './PreloginWebScreen';
import { getCurrentProfile } from '../services/profile';
import { fetchMyPosts, uploadPostMedia } from '../services/posts';
import { auth, db } from '../services/firebase';
import {
  getHandledPermissionPrimers,
  markPermissionPrimerHandled,
  type PrimerPermission,
} from '../services/permissionPrimer';
import { poplurAssetCache } from '../performance/PoplurAssetCache';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';
import {
  createWebPerformanceBootstrap,
  createWebPerformanceUpdate,
  thermalStateForMode,
  webPerformanceMessage,
} from '../performance/PoplurPerformanceManager';
import { initializeFeedGoogleAds, presentFeedGoogleAd } from '../services/feedAds';
import { handleStoreCheckoutRequested } from '../services/storeCheckout';
import { NativeWebCallSignalling } from '../services/webCallSignalling';

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
const BUNDLE_VERSION = '93';

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

type BackgroundAudioScope = 'screen' | 'app' | 'outside';
type BackgroundAudioPreference = {
  enabled: boolean;
  scope: BackgroundAudioScope;
};

const BACKGROUND_AUDIO_ENABLED_KEY = 'poplur.backgroundAudioEnabled';
const RADIO_SCOPE_KEY = 'poplur.radio.scope';

function normalizeBackgroundAudioPreference(
  enabled: boolean,
  scope: string | null | undefined,
): BackgroundAudioPreference {
  if (!enabled) return { enabled: false, scope: 'screen' };
  return { enabled: true, scope: scope === 'outside' ? 'outside' : 'app' };
}

function backgroundAudioBootstrap(preference: BackgroundAudioPreference): string {
  const state = JSON.stringify(preference);
  return `
    (function () {
      var state = ${state};
      window.__poplurNativeBackgroundAudio = state;
      try {
        localStorage.setItem('poplur.radio.scope', state.scope);
        localStorage.setItem('poplur.radio.background', state.enabled ? '1' : '0');
        if (state.enabled) localStorage.setItem('poplur.radio.scope.explicit.v1', '1');
        else localStorage.removeItem('poplur.radio.scope.explicit.v1');
      } catch (_) {}
    })();
  `;
}

async function prepareBundle(): Promise<string> {
  const documentRoot = FileSystem.documentDirectory;
  if (!documentRoot) throw new Error('Poplur storage is unavailable.');
  const activeDirectoryName = `claymap-v${BUNDLE_VERSION}`;
  const root = `${documentRoot}${activeDirectoryName}`;
  const marker = `${root}/.extracted`;

  // Versioned extractions used to accumulate forever. Keep exactly the
  // active bundle and remove stale/partial predecessors from Poplur's own
  // sandbox before admitting another copy.
  const entries = await FileSystem.readDirectoryAsync(documentRoot).catch(() => [] as string[]);
  const staleDirectories = entries.filter(
    name => /^claymap-v\d+$/.test(name) && name !== activeDirectoryName,
  );
  for (const name of staleDirectories) {
    await FileSystem.deleteAsync(`${documentRoot}${name}`, { idempotent: true });
  }

  const markerInfo = await FileSystem.getInfoAsync(marker);
  if (!markerInfo.exists) {
    const asset = Asset.fromModule(CLAYMAP_ZIP);
    await asset.downloadAsync();
    const zipUri = asset.localUri ?? asset.uri;
    await FileSystem.makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
    await unzip(zipUri.replace('file://', ''), root.replace('file://', ''));
    await FileSystem.writeAsStringAsync(marker, 'ok');
  }
  // Captures are session scratch files, not part of the durable web bundle.
  // Clear anything left by a crash before the static server starts.
  await FileSystem.deleteAsync(`${root}/captures`, { idempotent: true });
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
  index?: number;
  sequence?: number;
  control?: string;
  otherId?: string;
  callerName?: string;
  callId?: string;
  sdpType?: string;
  sdp?: string;
  candidate?: Record<string, unknown>;
  video?: boolean;
  scope?: 'once' | 'whileUsing' | BackgroundAudioScope;
  permission?: PrimerPermission;
  granted?: boolean;
  url?: string;
  visible?: boolean;
};

function validatedHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

type MediaAsset = {
  uri: string;
  type?: string | null;
  mimeType?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
};

type CaptureCacheRecord = {
  key: string;
  sizeBytes: number;
  release: () => void;
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
  ref?: React.Ref<HTMLIFrameElement>;
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const serverRef = useRef<Server | null>(null);
  const bundleRootRef = useRef<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [homeReady, setHomeReady] = useState(false);
  const [profileQuery, setProfileQuery] = useState('');
  const [profileReady, setProfileReady] = useState(false);
  const [backgroundAudioPreference, setBackgroundAudioPreference] = useState<BackgroundAudioPreference | null>(null);
  const [permissionNeeds, setPermissionNeeds] = useState<PermissionNeeds | null>(null);
  const photoPrimerConsumedRef = useRef(false);
  const homeReadyRef = useRef(false);
  const inAppBrowserOpenRef = useRef(false);
  const cameraLiveVisibleRef = useRef(false);
  const feedAdSequenceRef = useRef(0);
  const performance = usePoplurPerformance();
  const ownsHeavyRenderer = usePoplurHeavyRenderer(
    'postlogin-web-home',
    true,
    { priority: 100, decorative: false },
  );
  const keepWebSurfaceMounted = ownsHeavyRenderer
    || performance.appState !== 'active'
    || !performance.documentVisible;
  const runtimeSnapshot = {
    ...performance,
    appState: ownsHeavyRenderer ? 'active' as const : 'background' as const,
    documentVisible: ownsHeavyRenderer,
  };
  const injectedShellRef = useRef(`${RN_NATIVE_SHELL}\n${createWebPerformanceBootstrap(runtimeSnapshot)}`);
  const captureSessionPrefixRef = useRef(`temporary:home-capture:${Date.now()}-${Math.random().toString(36).slice(2)}:`);
  const captureCacheKeysRef = useRef(new Map<string, CaptureCacheRecord>());
  const callSignallingRef = useRef<NativeWebCallSignalling | null>(null);

  useEffect(() => {
    let active = true;
    void AsyncStorage.multiGet([BACKGROUND_AUDIO_ENABLED_KEY, RADIO_SCOPE_KEY])
      .then(([[, enabledRaw], [, scope]]) => {
        if (!active) return;
        setBackgroundAudioPreference(normalizeBackgroundAudioPreference(
          enabledRaw === '1' || enabledRaw === 'true',
          scope,
        ));
      })
      .catch(() => {
        if (active) setBackgroundAudioPreference({ enabled: false, scope: 'screen' });
      });
    return () => { active = false; };
  }, []);

  const pushPerformancePolicy = useCallback(() => {
    webViewRef.current?.injectJavaScript(createWebPerformanceUpdate(runtimeSnapshot));
    const frame = iframeRef.current?.contentWindow;
    if (frame) {
      frame.postMessage(webPerformanceMessage(runtimeSnapshot), '*');
      frame.postMessage({
        type: 'poplur-native-thermal',
        state: thermalStateForMode(runtimeSnapshot.mode),
      }, '*');
    }
    if (!ownsHeavyRenderer) cameraLiveVisibleRef.current = false;
  }, [ownsHeavyRenderer, performance.mode, performance.targetFPS]);

  useEffect(() => {
    pushPerformancePolicy();
  }, [pushPerformancePolicy]);

  useEffect(() => {
    void initializeFeedGoogleAds().catch(error =>
      console.warn('[PostLoginHomeWebScreen] Google Mobile Ads init failed', error));
  }, []);

  useEffect(() => () => {
    cameraLiveVisibleRef.current = false;
    captureCacheKeysRef.current.forEach(record => record.release());
    poplurAssetCache.purgeMatching(
      key => key.startsWith(captureSessionPrefixRef.current),
      true,
    );
    captureCacheKeysRef.current.clear();
  }, []);

  const sendProfileToWeb = async () => {
    try {
      const profile = await getCurrentProfile();
      const username = profile?.username?.trim();
      const photo = validatedHttpsUrl(profile?.photoURL);
      const payload = JSON.stringify({
        ...(username ? { username } : {}),
        business: profile?.accountType === 'business',
        ...(photo ? { photo } : {}),
      })
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
      // ProfileTwin owns the shipping profile UI and listens to this event.
      // Calling only the legacy global updated neither its React state nor the
      // avatar after a pull-to-refresh.
      webViewRef.current?.injectJavaScript(
        `window.poplurProfile?.(${payload});` +
          `window.dispatchEvent(new CustomEvent('poplur-native-profile',{detail:${payload}}));true;`,
      );
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

  useEffect(() => {
    // iOS and Android native shells both advertise PoplurNative, so the web
    // navigator intentionally waits for a native `poplur-native-motion`
    // stream instead of subscribing to browser deviceorientation. RN used to
    // provide the shell without that stream, leaving every model — including
    // the Phone — static. Keep exactly one 30 Hz foreground subscription and
    // let CubeTab3D perform the display-rate interpolation for all models.
    if (Platform.OS === 'web'
      || !homeReady
      || !ownsHeavyRenderer
      || performance.appState !== 'active'
      || !performance.documentVisible) return;

    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    let lastRoll = Number.NaN;
    let lastPitch = Number.NaN;

    DeviceMotion.setUpdateInterval(1000 / 30);
    void DeviceMotion.isAvailableAsync().then(available => {
      if (!available || cancelled) return;
      subscription = DeviceMotion.addListener(sample => {
        if (cancelled) return;
        const roll = sample.rotation?.gamma;
        const pitch = sample.rotation?.beta;
        if (!Number.isFinite(roll) || !Number.isFinite(pitch)) return;
        // Drop sensor noise while the handset rests. A real tilt is many times
        // this threshold, and each accepted sample wakes only the one visible
        // navigator renderer.
        if (Number.isFinite(lastRoll)
          && Math.abs(roll - lastRoll) < 0.008
          && Math.abs(pitch - lastPitch) < 0.008) return;
        lastRoll = roll;
        lastPitch = pitch;
        dispatchToClay('poplur-native-motion', { roll, pitch });
      });
    }).catch(error => {
      if (!cancelled) console.warn('[PostLoginHomeWebScreen] cube motion unavailable', error);
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [
    dispatchToClay,
    homeReady,
    ownsHeavyRenderer,
    performance.appState,
    performance.documentVisible,
  ]);

  const sendProfilePostsToWeb = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const posts = await fetchMyPosts(uid);
      dispatchToClay('poplur-native-profile-posts', {
        posts: posts.slice(0, 64).map(post => ({
          id: post.id,
          mediaURL: post.mediaURL,
          mediaType: post.mediaType,
          posterURL: post.posterURL,
          caption: post.caption,
          channelId: post.channelId,
          createdAtMillis: post.createdAt?.getTime?.() ?? 0,
        })),
      });
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] profile posts bridge failed', error);
    }
  }, [dispatchToClay]);

  const sendNearbyTracksToWeb = useCallback(async (message: ClayMessage) => {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const latitude = typeof message.latitude === 'number' ? message.latitude : Number.NaN;
    const longitude = typeof message.longitude === 'number' ? message.longitude : Number.NaN;
    if (!requestId
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90
      || Math.abs(longitude) > 180) {
      if (requestId) {
        dispatchToClay('poplur-native-nearby-tracks', { requestId, tracks: [] });
      }
      return;
    }

    const requestedRadius = typeof message.radiusKm === 'number' ? message.radiusKm : Number.NaN;
    const radiusKm = Number.isFinite(requestedRadius)
      ? Math.min(2_000, Math.max(1, requestedRadius))
      : 120;
    const numberValue = (value: unknown): number | null => {
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    const textValue = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const text = value.trim();
      return text || null;
    };
    const distanceKm = (otherLatitude: number, otherLongitude: number) => {
      const toRadians = (value: number) => value * Math.PI / 180;
      const latitudeDelta = toRadians(otherLatitude - latitude);
      const longitudeDelta = toRadians(otherLongitude - longitude);
      const latitude1 = toRadians(latitude);
      const latitude2 = toRadians(otherLatitude);
      const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitude1) * Math.cos(latitude2)
        * Math.sin(longitudeDelta / 2) ** 2;
      return 6_371 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
    };
    const createdAtMillis = (data: Record<string, unknown>) => {
      const explicit = numberValue(data.createdAtMillis);
      if (explicit !== null) return explicit;
      const timestamp = data.createdAt as { toMillis?: () => number } | undefined;
      if (typeof timestamp?.toMillis !== 'function') return 0;
      try {
        const millis = timestamp.toMillis();
        return Number.isFinite(millis) ? millis : 0;
      } catch {
        return 0;
      }
    };

    try {
      const snapshot = await getDocs(query(collection(db, 'tracks'), limit(256)));
      const tracks = snapshot.docs.flatMap(document => {
        const data = document.data() as Record<string, unknown>;
        // Only Poplur-hosted audio belongs on this shelf. A SoundCloud
        // permalink (or any non-HTTPS pointer) must stay in its attributed
        // external-player path rather than being decoded as Poplur media.
        const audioURL = validatedHttpsUrl(data.audioURL);
        const trackLatitude = numberValue(data.lat);
        const trackLongitude = numberValue(data.lng);
        if (!audioURL
          || trackLatitude === null
          || trackLongitude === null
          || Math.abs(trackLatitude) > 90
          || Math.abs(trackLongitude) > 180) return [];

        const distance = distanceKm(trackLatitude, trackLongitude);
        if (distance > radiusKm) return [];

        const row: Record<string, unknown> = {
          id: document.id,
          title: textValue(data.title) ?? 'Untitled',
          url: audioURL,
          lat: trackLatitude,
          lng: trackLongitude,
          distanceKm: distance,
          place: textValue(data.place) ?? `${distance.toFixed(1)} km away`,
          postedAt: createdAtMillis(data),
          postedBy: textValue(data.postedBy) ?? textValue(data.userID) ?? 'Poplur artist',
        };
        for (const key of ['artist', 'licence', 'mood'] as const) {
          const value = textValue(data[key]);
          if (value) row[key] = value;
        }
        for (const key of ['bpm', 'duration'] as const) {
          const value = numberValue(data[key]);
          if (value !== null) row[key] = value;
        }
        return [{ distance, row }];
      })
        .sort((a, b) => a.distance - b.distance)
        .map(result => result.row);

      dispatchToClay('poplur-native-nearby-tracks', { requestId, tracks });
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] nearby tracks bridge failed', error);
      dispatchToClay('poplur-native-nearby-tracks', { requestId, tracks: [] });
    }
  }, [dispatchToClay]);

  const markHomeReady = useCallback(() => {
    homeReadyRef.current = true;
    setHomeReady(true);
  }, []);

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
    captureCacheKeysRef.current.forEach(record => record.release());
    poplurAssetCache.purgeMatching(
      key => key.startsWith(captureSessionPrefixRef.current),
      true,
    );
    captureCacheKeysRef.current.clear();
    await FileSystem.copyAsync({ from: asset.uri, to: destination });

    const info = await FileSystem.getInfoAsync(destination, { size: true });
    if (!info.exists) throw new Error('The captured media could not be cached.');
    const cacheKey = `${captureSessionPrefixRef.current}${filename}`;
    const src = `${origin}/captures/${filename}`;
    const admission = poplurAssetCache.admit({
      key: cacheKey,
      kind: kind === 'video' ? 'video' : 'temporary',
      value: destination,
      estimatedBytes: info.size,
      dispose: () => FileSystem.deleteAsync(destination, { idempotent: true }),
    });
    if (!admission.admitted) {
      throw new Error(`The captured media exceeded Poplur's active cache budget (${admission.reason}).`);
    }
    const lease = poplurAssetCache.retain<string>(cacheKey);
    if (!lease) {
      poplurAssetCache.delete(cacheKey, true);
      throw new Error('The captured media could not be retained safely.');
    }
    captureCacheKeysRef.current.set(src, {
      key: cacheKey,
      sizeBytes: info.size,
      release: lease.release,
    });

    return {
      kind,
      src,
      length: kind === 'video' ? clipLength(asset.duration) : undefined,
      width: kind === 'photo' && asset.width && asset.width > 0 ? asset.width : undefined,
      height: kind === 'photo' && asset.height && asset.height > 0 ? asset.height : undefined,
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
      // Library picks are already encoded originals. Maximum quality keeps
      // their full pixel dimensions (4K when the source has them) and never
      // invents pixels for a smaller image. Camera capture keeps its existing
      // compression because that is a newly-created asset, not Camera Roll.
      quality: source === 'library' ? 1 : 0.9,
      videoMaxDuration: 60,
      allowsEditing: false,
      allowsMultipleSelection: false,
      selectionLimit: 1,
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
      const captureRecord = captureCacheKeysRef.current.get(message.data);
      await uploadPostMedia({
        uri: message.data,
        mediaType: kind,
        sizeBytes: captureRecord?.sizeBytes,
        latitude: Number.isFinite(message.latitude) ? message.latitude : undefined,
        longitude: Number.isFinite(message.longitude) ? message.longitude : undefined,
        caption: message.caption,
        channelId: message.channelId,
        filterId: message.filterId,
        usedAI: message.usedAI,
        radiusMeters: Number.isFinite(message.radiusKm) ? Math.round(Number(message.radiusKm) * 1000) : undefined,
      });
      dispatchToClay('poplur-upload-result', { requestId, ok: true });
      if (captureRecord) {
        captureCacheKeysRef.current.delete(message.data);
        captureRecord.release();
        poplurAssetCache.delete(captureRecord.key, true);
      }
    } catch (error) {
      const fallback = 'Your post could not be uploaded.';
      dispatchToClay('poplur-upload-result', {
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : fallback,
      });
    }
  }, [dispatchToClay]);

  const openInAppBrowser = useCallback(async (value: unknown) => {
    const url = validatedHttpsUrl(value);
    if (!url) {
      console.warn('[PostLoginHomeWebScreen] blocked invalid in-app browser URL');
      return;
    }
    if (inAppBrowserOpenRef.current) return;

    inAppBrowserOpenRef.current = true;
    try {
      // Expo WebBrowser uses SFSafariViewController on iOS and a Custom Tab on
      // Android, keeping untrusted shopping pages outside the privileged clay
      // WebView while still presenting them inside Poplur.
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] in-app browser failed', error);
    } finally {
      inAppBrowserOpenRef.current = false;
    }
  }, []);

  // Delivers a native result back the SAME way iOS/Android do: a raw
  // window.postMessage (not a CustomEvent) so HomeTwin.tsx's
  // onNativeCheckoutResult listener — shared by all three platforms — picks
  // it up without any RN-specific handling on the web side.
  const postToWeb = useCallback((payload: unknown) => {
    const json = JSON.stringify(payload)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    webViewRef.current?.injectJavaScript(`window.postMessage(${json}, '*'); true;`);
  }, []);

  useEffect(() => {
    // The page owns WebRTC media and its FaceTime UI; RN owns Firestore and
    // hands the page the exact poplurCall* messages iOS/Android deliver.
    const signalling = new NativeWebCallSignalling(postToWeb);
    callSignallingRef.current = signalling;
    return () => {
      signalling.stopAll();
      if (callSignallingRef.current === signalling) callSignallingRef.current = null;
    };
  }, [postToWeb]);

  const runStoreCheckout = useCallback(async (message: ClayMessage) => {
    const result = await handleStoreCheckoutRequested(message);
    postToWeb(result);
  }, [postToWeb]);

  const persistBackgroundAudioScope = useCallback((scope: BackgroundAudioScope) => {
    const preference = normalizeBackgroundAudioPreference(scope !== 'screen', scope);
    setBackgroundAudioPreference(preference);
    void AsyncStorage.multiSet([
      [BACKGROUND_AUDIO_ENABLED_KEY, preference.enabled ? '1' : '0'],
      [RADIO_SCOPE_KEY, preference.scope],
    ]).catch(error =>
      console.warn('[PostLoginHomeWebScreen] background audio preference save failed', error));
  }, []);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as ClayMessage;
      if (message.type === 'homeReady' || message.type === 'mapReady') markHomeReady();
      if (message.type === 'requestProfile') void sendProfileToWeb();
      if (message.type === 'requestProfilePosts') void sendProfilePostsToWeb();
      if (message.type === 'requestNearbyTracks') void sendNearbyTracksToWeb(message);
      if (message.type === 'radioScope'
        && (message.scope === 'screen' || message.scope === 'app' || message.scope === 'outside')) {
        persistBackgroundAudioScope(message.scope);
      }
      if (message.type === 'requestBackgroundAudio') {
        dispatchToClay(
          'poplur-native-background-audio',
          backgroundAudioPreference ?? { enabled: false, scope: 'screen' },
        );
      }
      if (message.type === 'callStart'
        || message.type === 'callAccept'
        || message.type === 'callDescription'
        || message.type === 'callCandidate'
        || message.type === 'callEnd'
        || message.type === 'callDecline'
        || message.type === 'callWatchIncoming') {
        callSignallingRef.current?.handle(message);
      }
      if (message.type === 'openInAppBrowser') void openInAppBrowser(message.url);
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
      if (message.type === 'cameraLiveVisibilityChanged') {
        cameraLiveVisibleRef.current = message.visible === true;
      }
      if (message.type === 'feedContentAdvanced') {
        const sequence = Number.isFinite(message.sequence)
          ? Number(message.sequence)
          : ++feedAdSequenceRef.current;
        feedAdSequenceRef.current = Math.max(feedAdSequenceRef.current, sequence);
        if (sequence > 0 && sequence % 2 === 0) {
          presentFeedGoogleAd(open => {
            dispatchToClay('poplur-native-feed-ad', { open });
          });
        }
      }
      if (message.type === 'cameraShutter' && cameraLiveVisibleRef.current) {
        void pickCapture('camera', 'photo').catch(error => console.warn('[PostLoginHomeWebScreen] camera capture failed', error));
      }
      if (message.type === 'cameraControl'
        && message.control === 'record'
        && cameraLiveVisibleRef.current) {
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
      if (message.type === 'poplurStoreCheckoutRequested') void runStoreCheckout(message);
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
  const backgroundAudioBootstrapScript = backgroundAudioBootstrap(
    backgroundAudioPreference ?? { enabled: false, scope: 'screen' },
  );
  const homeUri = origin && permissionNeeds && profileReady && backgroundAudioPreference
    // Include the archive version in the page URL too. Native WebViews cache
    // index.html aggressively; this prevents a fresh extracted bundle from
    // reopening a stale home page from their HTTP cache.
    ? `${origin}/index.html?view=home&tabs=0&bundle=${BUNDLE_VERSION}${profileQuery}${permissionQuery}${webMapQuery}`
    : null;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {homeUri && keepWebSurfaceMounted && Platform.OS === 'web' && (
        <WebHomeIframe
          ref={iframeRef}
          src={homeUri}
          title="Poplur post-login"
          allow="geolocation; camera; microphone"
          onLoad={() => {
            pushPerformancePolicy();
            markHomeReady();
          }}
          style={webIframeStyle}
        />
      )}
      {homeUri && keepWebSurfaceMounted && Platform.OS !== 'web' && (
        <WebView
          ref={webViewRef}
          style={styles.web}
          source={{ uri: homeUri }}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={
            `${injectedShellRef.current}\n${backgroundAudioBootstrapScript}`
          }
          onMessage={handleMessage}
          onLoadEnd={pushPerformancePolicy}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          // The page still needs the normal OS camera/microphone grant. Once
          // granted, let WKWebView carry that same decision into FaceTime's
          // getUserMedia request rather than presenting a second web prompt.
          mediaCapturePermissionGrantType="grant"
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
