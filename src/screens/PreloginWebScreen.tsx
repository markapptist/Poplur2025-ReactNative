import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { saveUserProfile, signInWithUsernameOrEmail } from '../services/auth';
import { auth } from '../services/firebase';
import { markPermissionPrimerHandled } from '../services/permissionPrimer';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';
import {
  createWebPerformanceBootstrap,
  createWebPerformanceUpdate,
} from '../performance/PoplurPerformanceManager';

type Page = 'splash' | 'welcome';
type AssetModule = number;

const pageModules: Record<Page, AssetModule> = {
  splash: require('../assets/prelogin/splash.html'),
  welcome: require('../assets/prelogin/welcome.html')
};

// These are the same paths used by the iOS/Android pre-login bundle. Keeping
// the mapping here means all three clients load the same approved HTML and the
// same local media/model files; no RN-native screen remake is involved.
const mediaModules: Array<[string, AssetModule]> = [
  ['/Poplur2025-iOS/Poplur2025/Assets.xcassets/logo.imageset/logo3.png', require('../assets/welcome-logo.png')],
  ['/Poplur2025-iOS/Poplur2025/poplur_splash.mp4', require('../assets/prelogin/media/poplur_splash.mp4')],
  ['/Poplur2025-iOS/Poplur2025/pop.mp3', require('../assets/prelogin/media/pop.mp3')],
  ['/Poplur2025-iOS/Poplur2025/MarkHead_TalkingRig.glb', require('../assets/prelogin/media/MarkHead_TalkingRig.glb')],
  ['/poplur-clay-map/public/poplur_icon_cube.glb', require('../assets/prelogin/media/poplur_icon_cube.glb')],
  ['/poplur-clay-map/public/zoom_buildings.glb', require('../assets/prelogin/media/zoom_buildings.glb')],
  ['/poplur-clay-map/public/poplur-globe-lite.glb', require('../assets/prelogin/media/poplur-globe-lite.glb')],
  ['/.claude/artifacts/models/poplur-globe-lite.glb', require('../assets/prelogin/media/poplur-globe-lite.glb')],
  ['/poplur-clay-map/public/clay_cube.png', require('../assets/prelogin/media/clay_cube.png')],
  ['/poplur-clay-map/public/radio_bed.wav', require('../assets/prelogin/media/radio_bed.wav')]
];

const RN_BRIDGE = `
  (function () {
    window.PoplurNative = {
      onAction: function (action, payload) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ action: action, payload: payload || '{}' }));
        } catch (e) {}
      }
    };
  })();
  true;
`;

async function localUri(moduleRef: AssetModule): Promise<string> {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  return asset.localUri || asset.uri;
}

async function readHtml(moduleRef: AssetModule): Promise<string> {
  const uri = await localUri(moduleRef);
  // expo-file-system has no web implementation; on web the asset resolves to a
  // served URL, so fetch its text instead. Native keeps using the file system.
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return response.text();
  }
  return FileSystem.readAsStringAsync(uri);
}

// The app's own /poplur-clay-map three paths aren't served on web, so point the
// importmap + DRACO decoder at a CDN pinned to the version the cube was authored
// against (0.170.0). unpkg serves the raw modules, keeping a single three
// instance so the importmap's bare "three" specifiers resolve consistently.
const THREE_BUILD_PATH = '/poplur-clay-map/node_modules/three/build/three.module.js';
const THREE_ADDONS_PATH = '/poplur-clay-map/node_modules/three/examples/jsm/';
const THREE_BUILD_CDN = 'https://unpkg.com/three@0.170.0/build/three.module.js';
const THREE_ADDONS_CDN = 'https://unpkg.com/three@0.170.0/examples/jsm/';

// The canonical page rebuilds the real login cube in place after renderer,
// model, or context-loss failures. This bridge only asks React Native to remount
// the WebView when the module itself never loaded, so the generic flat cube is
// never substituted.
const LOGIN_CUBE_HOST_RECOVERY = `<script id="poplur-login-cube-host-recovery">
(function () {
  var readySent = false, failedSamples = 0, lastHostRecovery = 0;
  function post(action, payload) {
    try {
      if (window.PoplurNative && typeof window.PoplurNative.onAction === 'function') {
        window.PoplurNative.onAction(action, JSON.stringify(payload || {}));
      }
    } catch (e) {}
  }
  function check() {
    var stage = document.getElementById('lcubeStage');
    var canvas = document.getElementById('cubeGL');
    var ready = !!(stage && canvas && stage.dataset.cubeRenderer === 'ready'
      && stage.classList.contains('gl') && canvas.getBoundingClientRect().width > 8);
    if (ready) {
      failedSamples = 0;
      if (!readySent) { readySent = true; post('loginCubeReady'); }
      return;
    }
    failedSamples += 1;
    if (typeof window.__poplurRebuildLoginCube === 'function') return;
    if (failedSamples < 2 || Date.now() - lastHostRecovery < 1500) return;
    failedSamples = 0;
    lastHostRecovery = Date.now();
    post('loginCubeHostRebuild', { reason: 'module-not-ready' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
  setInterval(check, 1000);
})();
</script>`;

// Performance tweaks injected into every pre-login page (perf > aesthetic):
// - the full-screen permission blur (backdrop-filter) is the priciest effect
//   (~10 fps while an alert is up) -> replace it with a plain dark dim;
// - halve the confetti (~3 fps);
// - render the large worldMapMotion background canvas at half internal
//   resolution (~half its pixel cost, ~5 fps).
const PERF_TWEAKS = `<style id="poplur-perf">
#glassOverlay{ -webkit-backdrop-filter:none!important; backdrop-filter:none!important; background:rgba(6,4,12,.5)!important; }
#confetti > *:nth-child(even){ display:none!important; }
/* Clay consistency: the auth switch links get the full clay text-shadow (match
   the "Tap the cube to go back" hint), and the mute glyph gets a layered clay
   emboss so it reads as 3D. */
.authLink{ color:#f8efdc!important; text-shadow:0 -2px 0 rgba(255,255,255,0.4),0 2px 0 #d8b98e,0 4px 0 rgba(158,14,78,0.5),0 6px 8px rgba(104,2,48,0.5),0 12px 18px rgba(80,0,36,0.35)!important; }
.muteBtn{ filter:drop-shadow(0 -1px 0 rgba(255,255,255,0.55)) drop-shadow(0 1.5px 0 #d8b98e) drop-shadow(0 3px 0 rgba(158,14,78,0.5)) drop-shadow(0 5px 7px rgba(104,2,48,0.55))!important; }
.muteBtn svg,.muteBtn svg path{ fill:#f8efdc!important; }
</style>
<script>(function(){
  // The worldMapMotion canvas resets its backing resolution every frame, so a
  // one-shot resize won't stick. Intercept the width/height setters on the
  // canvas prototype and halve them for that one canvas -> ~half the pixels it
  // rasterises each frame (CSS size is unchanged, so it just renders softer).
  try {
    var proto = HTMLCanvasElement.prototype;
    ['width','height'].forEach(function(prop){
      var desc = Object.getOwnPropertyDescriptor(proto, prop);
      if(!desc || !desc.set) return;
      Object.defineProperty(proto, prop, {
        configurable:true, enumerable: desc.enumerable,
        get:function(){ return desc.get.call(this); },
        set:function(v){ desc.set.call(this, this.id==='worldMapMotion' ? Math.max(1, Math.round(v/2)) : v); }
      });
    });
  } catch(e){}
})();</script>`;

/**
 * Prepare a local HTML page for a RN WebView. The page is still the exact GCL
 * artifact; only absolute bundle paths are replaced with the downloaded local
 * asset URIs. RN does not expose the iOS custom URL scheme, so this is the
 * equivalent offline asset loader for the three-platform handoff.
 */
async function preparePage(page: Page): Promise<string> {
  let html = await readHtml(pageModules[page]);
  for (const [sourcePath, moduleRef] of mediaModules) {
    // Splash and welcome reference different subsets of the bundled media.
    // Do not materialize large GLBs/audio files that the active page cannot
    // use; Metro still packages required assets, but the runtime cache stays
    // bounded to the page that is actually on screen.
    if (html.includes(sourcePath)) {
      html = html.split(sourcePath).join(await localUri(moduleRef));
    }
  }

  // Always run the approved live login cube. The page's own watchdog retries
  // the GLB on a fresh canvas; RN only remounts if the Three module never loaded.
  html = html
    .split(THREE_BUILD_PATH).join(THREE_BUILD_CDN)
    .split(THREE_ADDONS_PATH).join(THREE_ADDONS_CDN);
  if (page === 'welcome') {
    html = html.replace('</head>', `${LOGIN_CUBE_HOST_RECOVERY}</head>`);
  }

  // Performance tweaks (blur -> dim, halve confetti, half-res map canvas).
  if (html.includes('</head>')) html = html.replace('</head>', `${PERF_TWEAKS}</head>`);
  else html = PERF_TWEAKS + html;

  return html;
}

// The same coordinates the approved Welcome source hardcodes, used whenever the
// person has not already granted location.
const FALLBACK_LAT = 43.6532;
const FALLBACK_LON = -79.3832;

export function PreloginWebScreen({ splashOnly = false, onPermissionSequenceHandled }: {
  splashOnly?: boolean;
  onPermissionSequenceHandled?: () => void;
}) {
  const webViewRef = useRef<WebView>(null);
  const permissionChoicesRef = useRef(new Set<'location' | 'photos'>());
  const cubeReadyRef = useRef(false);
  const cubeHostRecoveryAttemptRef = useRef(0);
  const cubeHostRecoveryAtRef = useRef(0);
  // Launch splash dropped (parity with iOS/Android): straight to Welcome on black.
  const [page, setPage] = useState<Page>(splashOnly ? 'splash' : 'welcome');
  const [html, setHtml] = useState<string | null>(null);
  const [cubeHostRecoveryKey, setCubeHostRecoveryKey] = useState(0);
  const performance = usePoplurPerformance();
  const ownsHeavyRenderer = usePoplurHeavyRenderer(
    splashOnly ? 'prelogin-splash-video' : 'prelogin-web-3d',
    true,
    { priority: splashOnly ? 10 : 90, decorative: false },
  );
  const keepWebSurfaceMounted = ownsHeavyRenderer
    || performance.appState !== 'active'
    || !performance.documentVisible;
  const runtimeActive = ownsHeavyRenderer;
  const runtimeSnapshot = {
    ...performance,
    appState: runtimeActive ? 'active' as const : 'background' as const,
    documentVisible: runtimeActive,
  };
  const injectedBridgeRef = useRef(`${RN_BRIDGE}\n${createWebPerformanceBootstrap(runtimeSnapshot)}`);

  useEffect(() => {
    let cancelled = false;
    let handoff: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const splash = await preparePage('splash');
        if (!cancelled) setHtml(splash);
        if (!splashOnly) {
          handoff = setTimeout(async () => {
            const welcome = await preparePage('welcome');
            if (!cancelled) {
              setPage('welcome');
              setHtml(welcome);
            }
          }, 3200);
        }
      } catch (error) {
        console.warn('[PreloginWebScreen] unable to prepare approved bundle', error);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (handoff) clearTimeout(handoff);
    };
  }, [splashOnly]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(createWebPerformanceUpdate(runtimeSnapshot));
  }, [performance.mode, performance.targetFPS, runtimeActive]);

  const handleMessage = async (event: WebViewMessageEvent) => {
    let message: { action?: string; payload?: string };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    const action = message.action;
    let payload: Record<string, string> = {};
    try { payload = JSON.parse(message.payload || '{}'); } catch { /* malformed bridge payload */ }

    if (action === 'loginCubeReady') {
      cubeReadyRef.current = true;
      cubeHostRecoveryAttemptRef.current = 0;
      return;
    }

    if (action === 'loginCubeHostRebuild' && page === 'welcome') {
      const now = Date.now();
      const retryDelay = Math.min(
        8000,
        1500 * (2 ** Math.min(cubeHostRecoveryAttemptRef.current, 3))
      );
      if (cubeReadyRef.current || now - cubeHostRecoveryAtRef.current < retryDelay) return;
      cubeHostRecoveryAtRef.current = now;
      cubeHostRecoveryAttemptRef.current += 1;
      setCubeHostRecoveryKey(value => value + 1);
      return;
    }

    if (action === 'signIn') {
      if (payload.method === 'faceid') {
        postAuthResult(false, 'Face ID sign-in isn’t available here yet — use your email and password.');
        return;
      }
      const identifier = payload.identifier || payload.email;
      if (!identifier || !payload.password) {
        postAuthResult(false, 'Enter your username or email and password.');
        return;
      }
      try {
        await signInWithUsernameOrEmail(identifier, payload.password);
        postAuthResult(true);
      } catch (error: any) {
        postAuthResult(false, error?.message || 'Unable to sign in.');
      }
      return;
    }

    if (action === 'signUp') {
      if (!payload.email || !payload.password) {
        postAuthResult(false, 'Enter your email and password to create your account.');
        return;
      }
      try {
        const credential = await createUserWithEmailAndPassword(auth, payload.email.trim(), payload.password);
        await saveUserProfile(credential.user.uid, payload.username || payload.email.split('@')[0], payload.email, {
          accountType: payload.accountType || 'personal',
          createdAt: Date.now()
        });
        postAuthResult(true);
      } catch (error: any) {
        postAuthResult(false, error?.message || 'Unable to create your account.');
      }
      return;
    }

    if (action === 'requestPermission') {
      const permission = payload.permission;
      if (permission === 'location') permissionChoicesRef.current.add('location');
      if (permission === 'camera') permissionChoicesRef.current.add('photos');
      if (permissionChoicesRef.current.size === 2) onPermissionSequenceHandled?.();

      // The clay choice is the primer. It records the answer but never opens an
      // Expo/OS prompt on top of the approved Poplur card. A real prompt is
      // deferred until the feature that needs the capability is used.
      try {
        if (permission === 'location') {
          await markPermissionPrimerHandled('location').catch(error =>
            console.warn('[PreloginWebScreen] location primer state save failed', error));
        }
        if (permission === 'camera') {
          await markPermissionPrimerHandled('photos').catch(error =>
            console.warn('[PreloginWebScreen] photo primer state save failed', error));
        }
      } catch (error) {
        console.warn('[PreloginWebScreen] permission request failed', error);
      }
    }

    if (action === 'radioStations') {
      await fetchRadioStations(payload.callbackId ?? '');
    }
  };

  // Live radio, the way the map already tunes it. The page's own station lookup
  // is a raw fetch that the offline bundle strips, so the call is made here.
  //
  // No permission is requested: pre-login defers every OS prompt until the
  // feature that needs it is used, so this uses a location the person has
  // ALREADY granted and otherwise falls back to the approved default coords.
  const fetchRadioStations = async (callbackId: string) => {
    let lat = FALLBACK_LAT;
    let lon = FALLBACK_LON;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const fix = await Location.getLastKnownPositionAsync();
        if (fix) { lat = fix.coords.latitude; lon = fix.coords.longitude; }
      }
    } catch { /* fall back to the approved coordinates */ }

    let list: unknown = [];
    try {
      // A launch screen must never wait on a third party. The web side gives up
      // after 6s; this gives up sooner so an empty list is a decision rather
      // than two timeouts racing each other.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 4000);
      const response = await fetch(
        'https://de1.api.radio-browser.info/json/stations/search'
        + `?geo_lat=${lat}&geo_long=${lon}&geo_distance=90000`
        // bitrateMin: nearest-by-popularity happily returns 32kbps mono streams,
        // and a heavily compressed stream behind the music is indistinguishable
        // from a fault in the app.
        + '&hidebroken=true&bitrateMin=96&order=clickcount&reverse=true&limit=16',
        { signal: abort.signal }
      );
      clearTimeout(timer);
      list = await response.json();
    } catch { /* an empty list just means pre-login stays silent */ }

    // Re-serialized rather than forwarded raw: this is third-party text landing
    // in an expression position, and round-tripping it through JSON is what
    // keeps it a value rather than a script.
    const safeId = callbackId.replace(/[^a-zA-Z0-9]/g, '');
    const json = JSON.stringify(Array.isArray(list) ? list : []);
    webViewRef.current?.injectJavaScript(
      `window.__poplurStationsResult && window.__poplurStationsResult('${safeId}', ${json}); true;`
    );
  };

  const postAuthResult = (ok: boolean, error = '') => {
    const json = JSON.stringify({ ok, error });
    webViewRef.current?.injectJavaScript(`window.poplurAuthResult && window.poplurAuthResult(${json}); true;`);
  };

  const backgroundColor = page === 'splash' ? '#0a0709' : '#ff2d96';
  const source = useMemo(() => html ? { html, baseUrl: 'file:///poplur-rn/' } : undefined, [html]);

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <StatusBar style="light" />
      {source && keepWebSurfaceMounted ? (
        <WebView
          key={`prelogin-${page}-${cubeHostRecoveryKey}`}
          ref={webViewRef}
          source={source}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={injectedBridgeRef.current}
          onMessage={handleMessage}
          onLoadEnd={() => webViewRef.current?.injectJavaScript(createWebPerformanceUpdate(runtimeSnapshot))}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          allowFileAccess
          allowUniversalAccessFromFileURLs
          setSupportMultipleWindows={false}
          style={styles.webView}
        />
      ) : (
        <ActivityIndicator color="#ff3b9d" size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webView: { flex: 1, backgroundColor: 'transparent' }
});
