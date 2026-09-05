import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import Server from '@dr.pogodin/react-native-static-server';
import { unzip } from 'react-native-zip-archive';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { PreloginWebScreen } from './PreloginWebScreen';
import { getCurrentProfile } from '../services/profile';
import { fetchMyPosts, fetchRecentPosts, uploadPostMedia } from '../services/posts';
import {
  closeDMThread,
  hideDMThread,
  observeDMThread,
  observeDMThreads,
  sendDM,
  setDMTyping,
} from '../services/directMessages';
import {
  dismissNotifications,
  markNotificationsRead,
  observeNotificationInbox,
} from '../services/notifications';
import { auth, db, functions } from '../services/firebase';
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
import { PoplurInAppBrowser } from '../components/PoplurInAppBrowser';
import { normalizePoplurBrowserUrl } from '../services/inAppBrowser';
import { nativeAuthTokenDetail } from '../services/nativeAuthTokenBridge';
import { uploadLimitBytes } from '../services/mediaResources';
import {
  INACTIVE_NAVIGATOR_MOTION_DEMAND,
  navigatorMotionSampleRateHz,
  navigatorMotionSubscriptionIsEligible,
  normalizeNavigatorMotionDemand,
} from '../services/navigatorMotionDemand';
import {
  normalizePhoneThemeId,
  phoneThemeBootstrap,
  PHONE_THEME_IDS,
  PHONE_THEME_PREFERENCE_KEY,
} from '../services/phoneThemePreference';
import {
  WEB_HOME_IFRAME_ALLOW,
  WEB_HOME_PREVIEW_QUERY,
} from '../services/webHomeEmbed';
import {
  ISOLATED_SYNTHETIC_ONBOARDING,
  resolveSyntheticLocation,
  type SyntheticOnboardingMode,
} from '../services/syntheticOnboarding';
import claymapBundle from '../assets/claymap/bundle.json';

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

// The ZIP's content hash, not only its human release number, keys the on-device
// extraction. Multiple verified bundles may legitimately share a release
// number; retaining only `claymap-v97` in that case made an upgraded app reuse
// an older archive whose side-control PNGs were absent.
const BUNDLE_VERSION = claymapBundle.bundleVersion;
const BUNDLE_CACHE_KEY = `${BUNDLE_VERSION}-${claymapBundle.sha256.slice(0, 12)}`;

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
  const activeDirectoryName = `claymap-v${BUNDLE_CACHE_KEY}`;
  const root = `${documentRoot}${activeDirectoryName}`;
  const marker = `${root}/.extracted`;

  // Versioned extractions used to accumulate forever. Keep exactly the
  // active bundle and remove stale/partial predecessors from Poplur's own
  // sandbox before admitting another copy.
  const entries = await FileSystem.readDirectoryAsync(documentRoot).catch(() => [] as string[]);
  const staleDirectories = entries.filter(
    name => /^claymap-v\d+(?:-[a-f0-9]+)?$/.test(name) && name !== activeDirectoryName,
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
  postId?: string;
  kind?: 'photo' | 'video' | 'image' | 'audio';
  mediaKind?: 'photo' | 'video' | 'all';
  data?: string;
  caption?: string;
  channelId?: string;
  filterId?: string;
  usedAI?: boolean;
  rightsAttested?: boolean;
  rightsAttestationVersion?: string;
  photoViewSeconds?: number | null;
  latitude?: number;
  longitude?: number;
  targetLatitude?: number;
  targetLongitude?: number;
  locationVisibility?: 'approximate' | 'hidden';
  privateAccount?: boolean;
  ghostMode?: boolean;
  radiusKm?: number;
  pinColor?: string;
  index?: number;
  sequence?: number;
  control?: string;
  otherId?: string;
  threadId?: string;
  clientMessageId?: string;
  typing?: boolean;
  source?: string;
  mimeType?: string;
  durationMillis?: number;
  ownerId?: string;
  text?: string;
  title?: string;
  user?: string;
  link?: string;
  url?: string;
  callerName?: string;
  callId?: string;
  sdpType?: string;
  sdp?: string;
  candidate?: Record<string, unknown>;
  video?: boolean;
  scope?: 'once' | 'whileUsing' | BackgroundAudioScope;
  permission?: PrimerPermission;
  granted?: boolean;
  visible?: boolean;
  themeId?: string;
  active?: boolean;
  aiming?: boolean;
  id?: string;
  ids?: string[];
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

function validatedOnboardingMediaUrl(value: unknown): string | null {
  const secure = validatedHttpsUrl(value);
  if (secure) return secure;
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.origin !== 'http://127.0.0.1:9199') return null;
    return url.toString();
  } catch {
    return null;
  }
}

type SyntheticOnboardingProfile = {
  username?: string;
  accountType?: string;
  photoURL?: string;
};

async function getSyntheticOnboardingProfile(): Promise<SyntheticOnboardingProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const endpoint = `http://127.0.0.1:8080/v1/projects/demo-poplur-first-user-v1/databases/(default)/documents/users/${encodeURIComponent(user.uid)}`;
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('The isolated profile could not be loaded.');
  const document = await response.json() as {
    fields?: Record<string, { stringValue?: string }>;
  };
  if (document.fields?.syntheticActorId?.stringValue !== 'sim-onboarding-first'
    || document.fields?.syntheticJourney?.stringValue !== 'first-user-v1') {
    throw new Error('The isolated profile identity did not match.');
  }
  return {
    username: document.fields?.username?.stringValue,
    accountType: document.fields?.accountType?.stringValue,
    photoURL: document.fields?.photoURL?.stringValue,
  };
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

function syntheticTransferByteSize(value: unknown, kind: 'photo' | 'video'): number | null {
  if (typeof value !== 'string') return null;
  const limit = uploadLimitBytes(kind);
  // A data URL is the only form produced when the browser shell converts a
  // retained blob capture for the bridge. Bound its encoded length before the
  // regular expression so a forged message cannot allocate an unbounded Blob.
  if (value.length > Math.ceil(limit * 4 / 3) + 256) return null;
  const media = kind === 'video'
    ? /^data:video\/(?:mp4|quicktime|webm);base64,([a-zA-Z0-9+/]+={0,2})$/
    : /^data:image\/(?:jpeg|jpg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/;
  const encoded = value.match(media)?.[1];
  if (!encoded || encoded.length % 4 !== 0) return null;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = encoded.length / 4 * 3 - padding;
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= limit ? bytes : null;
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
  syntheticOnboardingMode = null,
}: {
  skipPermissionPrimer?: boolean;
  forcePermissionPrimer?: boolean;
  syntheticOnboardingMode?: SyntheticOnboardingMode | null;
} = {}) {
  const syntheticOnboarding = syntheticOnboardingMode !== null;
  const isolatedSyntheticOnboarding =
    syntheticOnboardingMode === ISOLATED_SYNTHETIC_ONBOARDING;
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
  const [inAppBrowserUrl, setInAppBrowserUrl] = useState<string | null>(null);
  const [phoneThemeId, setPhoneThemeId] = useState<string | null>(null);
  const [navigatorMotionDemand, setNavigatorMotionDemand] = useState(
    INACTIVE_NAVIGATOR_MOTION_DEMAND,
  );
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
    appState: ownsHeavyRenderer && !inAppBrowserUrl ? 'active' as const : 'background' as const,
    documentVisible: ownsHeavyRenderer && !inAppBrowserUrl,
  };
  const injectedShellRef = useRef(`${RN_NATIVE_SHELL}\n${createWebPerformanceBootstrap(runtimeSnapshot)}`);
  const captureSessionPrefixRef = useRef(`temporary:home-capture:${Date.now()}-${Math.random().toString(36).slice(2)}:`);
  const captureCacheKeysRef = useRef(new Map<string, CaptureCacheRecord>());
  const callSignallingRef = useRef<NativeWebCallSignalling | null>(null);
  const dmThreadsStopRef = useRef<(() => void) | null>(null);
  const dmThreadStopRef = useRef<(() => void) | null>(null);
  const dmOpenThreadIdRef = useRef<string | null>(null);
  const notificationStopRef = useRef<(() => void) | null>(null);
  const notificationIdsRef = useRef<string[]>([]);
  const handleMessageRef = useRef<(event: WebViewMessageEvent) => void>(() => {});

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

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PHONE_THEME_PREFERENCE_KEY)
      .then(value => {
        if (active) setPhoneThemeId(normalizePhoneThemeId(value) ?? PHONE_THEME_IDS[0]);
      })
      .catch(() => {
        if (active) setPhoneThemeId(PHONE_THEME_IDS[0]);
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
  }, [inAppBrowserUrl, ownsHeavyRenderer, performance.mode, performance.targetFPS]);

  useEffect(() => {
    pushPerformancePolicy();
  }, [pushPerformancePolicy]);

  useEffect(() => {
    void initializeFeedGoogleAds().catch(error =>
      console.warn('[PostLoginHomeWebScreen] Google Mobile Ads init failed', error));
  }, []);

  useEffect(() => () => {
    cameraLiveVisibleRef.current = false;
    dmThreadsStopRef.current?.();
    dmThreadsStopRef.current = null;
    dmThreadStopRef.current?.();
    dmThreadStopRef.current = null;
    void closeDMThread(dmOpenThreadIdRef.current ?? undefined);
    dmOpenThreadIdRef.current = null;
    notificationStopRef.current?.();
    notificationStopRef.current = null;
    notificationIdsRef.current = [];
    captureCacheKeysRef.current.forEach(record => record.release());
    poplurAssetCache.purgeMatching(
      key => key.startsWith(captureSessionPrefixRef.current),
      true,
    );
    captureCacheKeysRef.current.clear();
  }, []);

  const dispatchProfileToWeb = (detail: Record<string, string | boolean>) => {
    const payload = JSON.stringify(detail)
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
    iframeRef.current?.contentWindow?.postMessage({
      type: 'poplur-rn-shell-dispatch',
      kind: 'event',
      eventName: 'poplur-native-profile',
      detail,
    }, WEB_HOME_ORIGIN);
  };

  const sendProfileToWeb = async () => {
    // Identity is the join key for Map, Feed and Profile. Capture it before
    // the optional profile-document read so a transient Firestore failure can
    // never turn an authenticated account into an ownerless Profile grid.
    const uid = auth.currentUser?.uid?.trim();
    try {
      const profile = isolatedSyntheticOnboarding
        ? await getSyntheticOnboardingProfile()
        : await getCurrentProfile();
      const username = profile?.username?.trim();
      const photo = isolatedSyntheticOnboarding
        ? validatedOnboardingMediaUrl(profile?.photoURL)
        : validatedHttpsUrl(profile?.photoURL);
      dispatchProfileToWeb({
        ...(uid ? { uid } : {}),
        ...(username ? { username } : {}),
        business: profile?.accountType === 'business',
        ...(photo ? { photo } : {}),
      });
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] profile bridge failed', error);
      // The richer profile can retry later; the stable auth identity must not
      // wait for it because owned posts are already available independently.
      dispatchProfileToWeb({ ...(uid ? { uid } : {}), business: false });
    }
  };

  async function sendAccountPrivacyToWeb() {
    const user = auth.currentUser;
    if (!user) {
      dispatchToClay('poplur-native-account-privacy', {
        privateAccount: false,
        ghostMode: false,
        ok: false,
        message: 'Sign in to load privacy.',
      });
      return;
    }
    try {
      const snapshot = await getDoc(doc(db, 'users', user.uid));
      const data = snapshot.data();
      await changeAccountPrivacy({
        privateAccount: data?.privateAccount === true,
        ghostMode: data?.ghostMode === true,
      });
    } catch (error) {
      dispatchToClay('poplur-native-account-privacy', {
        privateAccount: false,
        ghostMode: false,
        ok: false,
        message: error instanceof Error ? error.message : 'Privacy could not be loaded.',
      });
    }
  }

  async function changeAccountPrivacy(message: ClayMessage) {
    const privateAccount = message.privateAccount === true;
    const ghostMode = message.ghostMode === true;
    try {
      const callable = httpsCallable<
        { privateAccount: boolean; ghostMode: boolean },
        { privateAccount: boolean; ghostMode: boolean }
      >(functions, 'setAccountLocationPrivacy');
      const result = await callable({ privateAccount, ghostMode });
      dispatchToClay('poplur-native-account-privacy', { ...result.data, ok: true });
    } catch (error) {
      dispatchToClay('poplur-native-account-privacy', {
        privateAccount,
        ghostMode,
        ok: false,
        message: error instanceof Error ? error.message : 'Privacy could not be saved.',
      });
    }
  }

  useEffect(() => {
    let active = true;
    void (isolatedSyntheticOnboarding ? getSyntheticOnboardingProfile() : getCurrentProfile())
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
  }, [isolatedSyntheticOnboarding]);

  useEffect(() => {
    let active = true;
    const resolvePermissionNeeds = async () => {
      if (skipPermissionPrimer || syntheticOnboarding) {
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
  }, [forcePermissionPrimer, skipPermissionPrimer, syntheticOnboarding]);

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
    iframeRef.current?.contentWindow?.postMessage({
      type: 'poplur-rn-shell-dispatch',
      kind: 'event',
      eventName,
      detail,
    }, WEB_HOME_ORIGIN);
  }, []);

  const sendAuthTokenToWeb = useCallback(async () => {
    try {
      const detail = await nativeAuthTokenDetail(auth.currentUser);
      if (detail) dispatchToClay('poplur-native-auth-token', detail);
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] auth token bridge failed', error);
    }
  }, [dispatchToClay]);

  useEffect(() => {
    // The persistent web navigator owns this native sensor lease. Do not keep
    // DeviceMotion or the JS -> WebView bridge active merely because HOME is
    // in the foreground: the navigator reports demand only while its governed
    // renderer has visible work. Ordinary motion consumes 20 Hz; camera aim is
    // capped at the web renderer's 30 Hz ceiling.
    const eligible = navigatorMotionSubscriptionIsEligible({
      nativePlatform: Platform.OS !== 'web',
      homeReady,
      ownsHeavyRenderer,
      browserOpen: inAppBrowserUrl !== null,
      appActive: performance.appState === 'active',
      documentVisible: performance.documentVisible,
    }, navigatorMotionDemand);
    if (!eligible) return;

    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    let lastRoll = Number.NaN;
    let lastPitch = Number.NaN;

    DeviceMotion.setUpdateInterval(1000 / navigatorMotionSampleRateHz(navigatorMotionDemand));
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
    inAppBrowserUrl,
    navigatorMotionDemand,
    ownsHeavyRenderer,
    performance.appState,
    performance.documentVisible,
  ]);

  useEffect(() => {
    if (ownsHeavyRenderer
      && inAppBrowserUrl === null
      && performance.appState === 'active'
      && performance.documentVisible) return;
    setNavigatorMotionDemand(INACTIVE_NAVIGATOR_MOTION_DEMAND);
  }, [
    inAppBrowserUrl,
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
          photoViewSeconds: post.photoViewSeconds,
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

  const sendFeedPostsToWeb = useCallback(async () => {
    if (!auth.currentUser?.uid) return;
    try {
      if (isolatedSyntheticOnboarding) {
        const posts = await fetchRecentPosts(96);
        const rows = posts.flatMap(post => {
          if (post.syntheticJourney !== 'first-user-v1') return [];
          const mediaURL = validatedOnboardingMediaUrl(post.mediaURL);
          if (!mediaURL) return [];
          const posterURL = validatedOnboardingMediaUrl(post.posterURL);
          return [{
            id: post.id,
            ownerId: post.userID,
            mediaURL,
            mediaType: post.mediaType.includes('video') ? 'video' : 'photo',
            photoViewSeconds: post.photoViewSeconds,
            ...(posterURL ? { posterURL } : {}),
            username: post.username?.trim() || 'Poplur user',
            caption: post.caption,
            channelId: post.channelId?.trim() || 'live',
            radiusMeters: Math.max(0, Number(post.radius) || 0),
            createdAtMillis: post.createdAtMillis ?? post.createdAt?.getTime?.() ?? 0,
            viewCount: Math.max(0, Number(post.viewCount) || 0),
            locationVisibility: post.locationVisibility === 'approximate'
              ? 'approximate' as const
              : 'hidden' as const,
            ...(post.locationVisibility === 'approximate'
              && Number.isFinite(post.latitude) && Number.isFinite(post.longitude)
              ? { originLatitude: post.latitude, originLongitude: post.longitude }
              : {}),
            syntheticJourney: 'first-user-v1' as const,
          }];
        });
        dispatchToClay('poplur-native-feed-posts', { posts: rows });
        return;
      }
      const snapshot = await getDocs(query(
        collection(db, 'posts'),
        orderBy('createdAt', 'desc'),
        limit(96),
      ));
      const rows = snapshot.docs.flatMap(document => {
        const data = document.data() as Record<string, unknown>;
        if ((typeof data.audience === 'string' ? data.audience : 'public') !== 'public') return [];
        if ((typeof data.status === 'string' ? data.status : 'published') !== 'published') return [];
        const mediaURL = validatedHttpsUrl(data.playbackURL) ?? validatedHttpsUrl(data.mediaURL);
        if (!mediaURL) return [];
        const numberValue = (value: unknown): number | undefined => {
          const number = Number(value);
          return Number.isFinite(number) ? number : undefined;
        };
        const textValue = (value: unknown, limitValue: number): string | undefined => {
          if (typeof value !== 'string') return undefined;
          const text = value.trim().slice(0, limitValue);
          return text || undefined;
        };
        const timestamp = data.createdAt as { toMillis?: () => number } | undefined;
        const createdAtMillis = numberValue(data.createdAtMillis) ?? timestamp?.toMillis?.() ?? 0;
        const lowerMediaURL = mediaURL.toLowerCase();
        const inferredMediaType = /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(lowerMediaURL) ? 'video' : 'photo';
        const row: Record<string, unknown> = {
          id: document.id,
          mediaURL,
          photoViewSeconds: numberValue(data.photoViewSeconds),
          mediaType: data.mediaType === 'photo' || data.mediaType === 'image'
            ? 'photo'
            : data.mediaType === 'video' ? 'video' : inferredMediaType,
          username: textValue(data.username, 40) ?? 'Poplur user',
          channelId: textValue(data.channelId, 40) ?? 'live',
          createdAtMillis,
        };
        const ownerId = textValue(data.userID, 128)
          ?? textValue(data.userId, 128)
          ?? textValue(data.ownerId, 128);
        if (ownerId) row.ownerId = ownerId;
        const posterURL = validatedHttpsUrl(data.posterURL);
        if (posterURL) row.posterURL = posterURL;
        const caption = textValue(data.caption, 2_000);
        if (caption) row.caption = caption;
        const radiusMeters = numberValue(data.radius);
        if (radiusMeters != null) row.radiusMeters = Math.max(0, radiusMeters);
        for (const key of ['viewCount', 'likeCount', 'commentCount', 'shareCount'] as const) {
          const value = numberValue(data[key]);
          if (value != null) row[key] = Math.max(0, Math.round(value));
        }
        if (data.locationVisibility === 'hidden') {
          row.locationVisibility = 'hidden';
        } else if (data.locationVisibility === 'approximate') {
          const latitude = numberValue(data.latitude);
          const longitude = numberValue(data.longitude);
          if (latitude != null && longitude != null
            && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
            row.locationVisibility = 'approximate';
            row.originLatitude = latitude;
            row.originLongitude = longitude;
          }
        }
        return [row];
      });
      dispatchToClay('poplur-native-feed-posts', { posts: rows });
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] feed posts bridge failed', error);
    }
  }, [dispatchToClay, isolatedSyntheticOnboarding]);

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
    if (syntheticOnboarding && Platform.OS === 'web') {
      // The managed fix: Toronto for the first-user journeys, the actor's own
      // city for the live cohort. Never a real device position.
      const managed = resolveSyntheticLocation(syntheticOnboardingMode);
      const payload = {
        type: 'poplur-location',
        latitude: managed.latitude,
        longitude: managed.longitude,
      };
      dispatchToClay('poplur-location', payload);
      iframeRef.current?.contentWindow?.postMessage({
        type: 'poplur-rn-shell-dispatch',
        kind: 'message',
        detail: payload,
      }, WEB_HOME_ORIGIN);
      return;
    }
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
  }, [dispatchToClay, syntheticOnboarding]);

  useEffect(() => {
    if (!syntheticOnboarding || Platform.OS !== 'web' || !homeReady) return;
    // Seed the exact emulator-only fix before Camera parks its draft for Map.
    // The later explicit request remains supported, but it no longer races the
    // first focused-picker iframe mount.
    void requestAndPushLocation();
  }, [homeReady, requestAndPushLocation, syntheticOnboarding]);

  const materializeCapture = useCallback(async (asset: MediaAsset) => {
    const kind = assetKind(asset);
    if (syntheticOnboarding && Platform.OS === 'web') {
      const response = await fetch(asset.uri);
      if (!response.ok && response.status !== 0) {
        throw new Error(`The selected media could not be read (${response.status}).`);
      }
      const blob = await response.blob();
      const maximum = kind === 'video' ? 40 * 1024 * 1024 : 12 * 1024 * 1024;
      if (blob.size <= 0 || blob.size > maximum) {
        throw new Error(`Choose a ${kind} under ${kind === 'video' ? '40' : '12'} MB.`);
      }
      captureCacheKeysRef.current.forEach(record => record.release());
      poplurAssetCache.purgeMatching(
        key => key.startsWith(captureSessionPrefixRef.current),
        true,
      );
      captureCacheKeysRef.current.clear();
      const cacheKey = `${captureSessionPrefixRef.current}synthetic-${Date.now()}`;
      const admission = poplurAssetCache.admit({
        key: cacheKey,
        kind: kind === 'video' ? 'video' : 'temporary',
        value: asset.uri,
        estimatedBytes: blob.size,
      });
      if (!admission.admitted) {
        throw new Error(`The selected media exceeded Poplur's active cache budget (${admission.reason}).`);
      }
      const lease = poplurAssetCache.retain<string>(cacheKey);
      if (!lease) {
        poplurAssetCache.delete(cacheKey, true);
        throw new Error('The selected media could not be retained safely.');
      }
      captureCacheKeysRef.current.set(asset.uri, {
        key: cacheKey,
        sizeBytes: blob.size,
        release: lease.release,
      });
      return {
        kind,
        src: asset.uri,
        length: kind === 'video' ? clipLength(asset.duration) : undefined,
        width: kind === 'photo' && asset.width && asset.width > 0 ? asset.width : undefined,
        height: kind === 'photo' && asset.height && asset.height > 0 ? asset.height : undefined,
      };
    }
    const root = bundleRootRef.current;
    if (!root || !origin) throw new Error('The Poplur camera is still starting. Try again in a moment.');

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
  }, [origin, syntheticOnboarding]);

  const pickCapture = useCallback(async (
    source: 'camera' | 'library',
    requestedKind: 'photo' | 'video' | 'all',
    delivery: 'composer' | 'cameraRoll' = 'composer',
  ) => {
    if (!(syntheticOnboarding && Platform.OS === 'web')) {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error(`${source === 'camera' ? 'Camera' : 'Photo library'} access was not allowed.`);
    }

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
    dispatchToClay(
      delivery === 'cameraRoll' ? 'poplur-native-camera-roll-selection' : 'poplur-native-capture',
      capture,
    );
  }, [dispatchToClay, materializeCapture, syntheticOnboarding]);

  const publishPost = useCallback(async (message: ClayMessage) => {
    const requestId = message.requestId;
    if (!requestId || !message.data) return;
    try {
      if (message.rightsAttested !== true) {
        throw new Error('Confirm that you have permission to share this media and music.');
      }
      const kind = message.kind === 'video' ? 'video' : 'photo';
      const captureRecord = captureCacheKeysRef.current.get(message.data);
      const transferredSize = syntheticOnboarding && Platform.OS === 'web' && !captureRecord
        ? syntheticTransferByteSize(message.data, kind)
        : null;
      if (syntheticOnboarding && Platform.OS === 'web' && !captureRecord && transferredSize === null) {
        throw new Error('The isolated browser capture could not be size-verified.');
      }
      const uploaded = await uploadPostMedia({
        uri: message.data,
        mediaType: kind,
        postId: message.postId,
        sizeBytes: captureRecord?.sizeBytes ?? transferredSize ?? undefined,
        targetLatitude: Number.isFinite(message.targetLatitude) ? message.targetLatitude : undefined,
        targetLongitude: Number.isFinite(message.targetLongitude) ? message.targetLongitude : undefined,
        locationVisibility: message.locationVisibility === 'hidden' ? 'hidden' : 'approximate',
        caption: message.caption,
        channelId: message.channelId,
        filterId: message.filterId,
        usedAI: message.usedAI,
        radiusMeters: Number.isFinite(message.radiusKm) ? Math.round(Number(message.radiusKm) * 1000) : undefined,
        rightsAttestationVersion: message.rightsAttestationVersion,
        photoViewSeconds: message.photoViewSeconds,
        pinColor: typeof message.pinColor === 'string'
          && ['red', 'purple', 'blue', 'green', 'orange'].includes(message.pinColor)
          ? message.pinColor as 'red' | 'purple' | 'blue' | 'green' | 'orange'
          : undefined,
      });
      dispatchToClay('poplur-upload-result', {
        requestId,
        ok: true,
        postId: uploaded.postId,
      });
      // Home's initial feed request occurs before this post exists. In the
      // isolated browser journey, publish the exact committed row immediately
      // instead of making upload acknowledgement depend on a second Firestore
      // query. The runner independently proves the same post, location and
      // Storage objects through the emulator admin APIs before it accepts the
      // Map/Profile frames.
      if (isolatedSyntheticOnboarding) {
        const owner = auth.currentUser;
        const mediaURL = validatedOnboardingMediaUrl(uploaded.mediaURL);
        if (!owner || !mediaURL) {
          throw new Error('The isolated committed post could not be projected into Poplur.');
        }
        const locationVisibility = Number.isFinite(message.targetLatitude)
          && Number.isFinite(message.targetLongitude)
          && message.locationVisibility !== 'hidden'
          ? 'approximate' as const
          : 'hidden' as const;
        dispatchToClay('poplur-native-feed-posts', {
          posts: [{
            id: uploaded.postId,
            ownerId: owner.uid,
            mediaURL,
            mediaType: kind,
            username: owner.displayName?.trim() || owner.email?.trim() || 'Poplur user',
            caption: message.caption,
            channelId: message.channelId?.trim() || 'live',
            radiusMeters: Number.isFinite(message.radiusKm)
              ? Math.max(0, Math.round(Number(message.radiusKm) * 1_000))
              : 0,
            createdAtMillis: Date.now(),
            viewCount: 0,
            locationVisibility,
            ...(locationVisibility === 'approximate'
              ? {
                originLatitude: message.targetLatitude,
                originLongitude: message.targetLongitude,
              }
              : {}),
            syntheticJourney: 'first-user-v1' as const,
          }],
        });
      }
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
  }, [dispatchToClay, isolatedSyntheticOnboarding, syntheticOnboarding]);

  const openInAppBrowser = useCallback((value: unknown) => {
    const url = normalizePoplurBrowserUrl(value);
    if (!url) {
      console.warn('[PostLoginHomeWebScreen] blocked invalid in-app browser URL');
      return;
    }
    if (inAppBrowserOpenRef.current) return;

    inAppBrowserOpenRef.current = true;
    setInAppBrowserUrl(url);
  }, []);

  const closeInAppBrowser = useCallback(() => {
    setInAppBrowserUrl(null);
    inAppBrowserOpenRef.current = false;
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
    iframeRef.current?.contentWindow?.postMessage({
      type: 'poplur-rn-shell-dispatch',
      kind: 'message',
      detail: payload,
    }, WEB_HOME_ORIGIN);
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

  const watchDMThreads = useCallback(() => {
    dmThreadsStopRef.current?.();
    try {
      dmThreadsStopRef.current = observeDMThreads(
        threads => postToWeb({ type: 'poplurDMThreads', threads }),
        error => console.warn('[PostLoginHomeWebScreen] DM thread list failed', error),
      );
    } catch (error) {
      console.warn('[PostLoginHomeWebScreen] DM thread list unavailable', error);
      postToWeb({ type: 'poplurDMThreads', threads: [] });
    }
  }, [postToWeb]);

  const watchNotifications = useCallback(() => {
    notificationStopRef.current?.();
    notificationStopRef.current = observeNotificationInbox(
      notifications => {
        notificationIdsRef.current = notifications.map(item => item.id);
        postToWeb({ type: 'poplurNotifications', notifications });
      },
      error => console.warn('[PostLoginHomeWebScreen] notification inbox failed', error),
    );
  }, [postToWeb]);

  const stopWatchingNotifications = useCallback(() => {
    notificationStopRef.current?.();
    notificationStopRef.current = null;
    notificationIdsRef.current = [];
  }, []);

  const watchDMThread = useCallback((threadId: string) => {
    if (!threadId || threadId.length > 200) return;
    const previousThreadId = dmOpenThreadIdRef.current;
    dmThreadStopRef.current?.();
    dmThreadStopRef.current = null;
    if (previousThreadId && previousThreadId !== threadId) void closeDMThread(previousThreadId);
    try {
      dmOpenThreadIdRef.current = threadId;
      dmThreadStopRef.current = observeDMThread(
        threadId,
        messages => postToWeb({ type: 'poplurDMMessages', threadId, messages }),
        state => postToWeb({ type: 'poplurDMThreadState', ...state }),
        error => console.warn('[PostLoginHomeWebScreen] DM conversation failed', error),
      );
    } catch (error) {
      dmOpenThreadIdRef.current = null;
      console.warn('[PostLoginHomeWebScreen] DM conversation unavailable', error);
      postToWeb({ type: 'poplurDMMessages', threadId, messages: [] });
    }
  }, [postToWeb]);

  const stopWatchingDMThread = useCallback(() => {
    const threadId = dmOpenThreadIdRef.current;
    dmThreadStopRef.current?.();
    dmThreadStopRef.current = null;
    dmOpenThreadIdRef.current = null;
    void closeDMThread(threadId ?? undefined);
  }, []);

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
      if (message.type === 'navigatorMotionDemandChanged') {
        const demand = normalizeNavigatorMotionDemand(message.active, message.aiming);
        setNavigatorMotionDemand(current => (
          current.active === demand.active && current.aiming === demand.aiming
            ? current
            : demand
        ));
      }
      if (message.type === 'requestProfile') void sendProfileToWeb();
      if (message.type === 'requestAuthToken') void sendAuthTokenToWeb();
      if (message.type === 'requestAccountPrivacy') void sendAccountPrivacyToWeb();
      if (message.type === 'accountPrivacyChanged') void changeAccountPrivacy(message);
      if (message.type === 'requestProfilePosts') void sendProfilePostsToWeb();
      if (message.type === 'requestFeedPosts') void sendFeedPostsToWeb();
      if (message.type === 'notificationsRequested') watchNotifications();
      if (message.type === 'notificationsStopped') stopWatchingNotifications();
      if (message.type === 'notificationsRead') {
        void markNotificationsRead(message.ids ?? notificationIdsRef.current)
          .catch(error => console.warn('[PostLoginHomeWebScreen] notification read failed', error));
      }
      if (message.type === 'notificationDismissed' && message.id) {
        void dismissNotifications([message.id])
          .catch(error => console.warn('[PostLoginHomeWebScreen] notification dismiss failed', error));
      }
      if (message.type === 'notificationsCleared') {
        void dismissNotifications(message.ids ?? notificationIdsRef.current)
          .catch(error => console.warn('[PostLoginHomeWebScreen] notification clear failed', error));
      }
      if (message.type === 'requestDMThreads') watchDMThreads();
      if (message.type === 'openDMThread' && message.threadId) watchDMThread(message.threadId);
      if (message.type === 'closeDMThread') stopWatchingDMThread();
      if (message.type === 'setDMTyping' && message.threadId) {
        void setDMTyping(message.threadId, message.typing === true)
          .catch(error => console.warn('[PostLoginHomeWebScreen] DM typing failed', error));
      }
      if (message.type === 'deleteDMThread' && message.threadId) {
        const threadId = message.threadId;
        void hideDMThread(threadId)
          .then(() => postToWeb({ type: 'poplurDMThreadHidden', threadId, ok: true }))
          .catch(error => {
            console.warn('[PostLoginHomeWebScreen] DM hide failed', error);
            postToWeb({ type: 'poplurDMThreadHidden', threadId, ok: false });
          });
      }
      if (message.type === 'sendDM') {
        const clientMessageId = message.clientMessageId ?? '';
        const text = message.text ?? '';
        void sendDM(message.otherId, text, clientMessageId)
          .then(() => postToWeb({ type: 'poplurDMSent', clientMessageId }))
          .catch(error => {
            console.warn('[PostLoginHomeWebScreen] DM send failed', error);
            postToWeb({ type: 'poplurDMSendFailed', clientMessageId, text });
          });
      }
      if (message.type === 'sendDMAttachment') {
        // Text/history parity is live. Keep unsupported media explicit so the
        // optimistic bubble becomes retryable instead of waiting forever.
        postToWeb({
          type: 'poplurDMSendFailed',
          clientMessageId: message.clientMessageId ?? '',
          text: 'Attachment could not be sent.',
        });
      }
      if (message.type === 'sharePost') {
        const title = message.title?.trim() || 'Poplur';
        const user = message.user?.trim();
        const suppliedLink = validatedHttpsUrl(message.link ?? message.url);
        const postLink = message.postId
          ? `https://poplur.com/p/${encodeURIComponent(message.postId)}`
          : null;
        // A post id is the canonical identity. Never let a caller-supplied
        // channel/generic URL collapse distinct posts onto one share link.
        // Link-only surfaces such as Radio continue to use suppliedLink.
        const link = postLink ?? suppliedLink;
        const line = user ? `${title} — ${user}` : title;
        void Share.share({
          title: 'Poplur',
          message: link ? `${line}\n${link}` : line,
        }).catch(error => console.warn('[PostLoginHomeWebScreen] share failed', error));
      }
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
      if (message.type === 'openInAppBrowser') openInAppBrowser(message.url);
      if (message.type === 'phoneThemeChanged') {
        const nextThemeId = normalizePhoneThemeId(message.themeId);
        if (nextThemeId) {
          setPhoneThemeId(nextThemeId);
          void AsyncStorage.setItem(PHONE_THEME_PREFERENCE_KEY, nextThemeId)
            .catch(error => console.warn('[PostLoginHomeWebScreen] phone theme save failed', error));
        }
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
        if (!(syntheticOnboarding && Platform.OS === 'web')) {
          void ImagePicker.requestCameraPermissionsAsync();
        }
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
      if (message.type === 'requestProfileCameraRoll') {
        void markPermissionPrimerHandled('photos').catch(error =>
          console.warn('[PostLoginHomeWebScreen] profile photo permission state save failed', error));
        const requestedKind = message.mediaKind === 'photo' || message.mediaKind === 'video'
          ? message.mediaKind
          : 'all';
        void pickCapture('library', requestedKind, 'cameraRoll').catch(error =>
          console.warn('[PostLoginHomeWebScreen] profile camera roll failed', error));
      }
      if (message.type === 'publishPost') void publishPost(message);
      if (message.type === 'poplurStoreCheckoutRequested') void runStoreCheckout(message);
    } catch {
      // Non-JSON messages are ignored.
    }
  };
  handleMessageRef.current = handleMessage;

  useEffect(() => {
    if (!syntheticOnboarding || Platform.OS !== 'web') return;
    const receiveRNWebShellEvent = (event: MessageEvent) => {
      if (event.origin !== WEB_HOME_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { type?: unknown; data?: unknown } | null;
      if (!message || message.type !== 'poplur-rn-shell-event' || typeof message.data !== 'string') return;
      handleMessageRef.current({
        nativeEvent: { data: message.data },
      } as WebViewMessageEvent);
    };
    window.addEventListener('message', receiveRNWebShellEvent);
    return () => window.removeEventListener('message', receiveRNWebShellEvent);
  }, [syntheticOnboarding]);

  const permissionQuery = permissionNeeds
    ? `${permissionNeeds.location ? '&askLocation=1' : ''}${permissionNeeds.photos ? '&askPhotos=1' : ''}`
    : '';
  // The browser preview nests the clay home inside Expo Web, then nests the
  // Mapbox map inside that home. Advertise that extra compositor layer so the
  // map keeps its 3D look while using the same constrained GPU budget as the
  // native shells. Native devices already select their own performance tier.
  const webMapQuery = Platform.OS === 'web' ? WEB_HOME_PREVIEW_QUERY : '';
  const rnWebTransportQuery = syntheticOnboarding && Platform.OS === 'web'
    ? isolatedSyntheticOnboarding ? '&rnWebShell=1' : '&rnWebBridge=1'
    : '';
  const backgroundAudioBootstrapScript = backgroundAudioBootstrap(
    backgroundAudioPreference ?? { enabled: false, scope: 'screen' },
  );
  const phoneThemeBootstrapScript = phoneThemeBootstrap(phoneThemeId);
  const homeUri = origin && permissionNeeds && profileReady && backgroundAudioPreference && phoneThemeId
    // Include the archive version in the page URL too. Native WebViews cache
    // index.html aggressively; this prevents a fresh extracted bundle from
    // reopening a stale home page from their HTTP cache.
    ? `${origin}/index.html?view=home&tabs=0&bundle=${BUNDLE_CACHE_KEY}${profileQuery}${permissionQuery}${webMapQuery}${rnWebTransportQuery}`
    : null;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {homeUri && keepWebSurfaceMounted && Platform.OS === 'web' && (
        <WebHomeIframe
          ref={iframeRef}
          src={homeUri}
          title="Poplur post-login"
          allow={WEB_HOME_IFRAME_ALLOW}
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
            `${injectedShellRef.current}\n${backgroundAudioBootstrapScript}\n${phoneThemeBootstrapScript}`
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
      <PoplurInAppBrowser url={inAppBrowserUrl} onClose={closeInAppBrowser} />
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
