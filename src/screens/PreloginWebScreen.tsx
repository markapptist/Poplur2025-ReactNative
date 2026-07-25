import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { auth, db } from '../services/firebase';

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
  ['/Poplur2025-iOS/Poplur2025/Assets.xcassets/logo.imageset/logo1.png', require('../assets/prelogin/media/logo1.png')],
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

// Performance mode (perf > aesthetic): the app uses the lightweight static clay
// cube everywhere. The real Three.js (GPU) login cube costs ~12 fps, so it's off
// by default. `?cube=gl` force-enables the real cube (e.g. for A/B testing);
// anything else uses the static fallback.
function shouldUseFallbackCube(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof document === 'undefined') return true;
  try {
    if (new URLSearchParams(window.location.search).get('cube') === 'gl') return false;
  } catch {
    /* ignore */
  }
  return true;
}

// The app's own /poplur-clay-map three paths aren't served on web, so point the
// importmap + DRACO decoder at a CDN pinned to the version the cube was authored
// against (0.170.0). unpkg serves the raw modules, keeping a single three
// instance so the importmap's bare "three" specifiers resolve consistently.
const THREE_BUILD_PATH = '/poplur-clay-map/node_modules/three/build/three.module.js';
const THREE_ADDONS_PATH = '/poplur-clay-map/node_modules/three/examples/jsm/';
const THREE_BUILD_CDN = 'https://unpkg.com/three@0.170.0/build/three.module.js';
const THREE_ADDONS_CDN = 'https://unpkg.com/three@0.170.0/examples/jsm/';

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
    html = html.split(sourcePath).join(await localUri(moduleRef));
  }

  if (shouldUseFallbackCube()) {
    if (Platform.OS === 'web') {
      // Web: keep the Three.js module so the sign-up account-type previews (the
      // mark head / business buildings — each rendered ONCE and frozen to an
      // image, so they cost ~nothing at steady state) still appear. Just disable
      // the *continuous* login cube: point three at the CDN and remove #cubeGL so
      // its renderer bails (getElementById returns null) — no spin, no FPS cost.
      html = html
        .split(THREE_BUILD_PATH).join(THREE_BUILD_CDN)
        .split(THREE_ADDONS_PATH).join(THREE_ADDONS_CDN)
        .replace(/<canvas\s+id=["']cubeGL["'][^>]*>\s*<\/canvas>/i, '');
      // If three can't load (e.g. offline), still reveal the static clay cube.
      html = html.replace('</head>', `<script>
        window.addEventListener('error', function (e) {
          var t = e && e.target;
          if (t && t.tagName === 'SCRIPT' && String(t.src || '').indexOf('three@0.170.0') !== -1) {
            var s = document.getElementById('lcubeStage'); if (s) s.classList.add('flat');
          }
        }, true);
      </script></head>`);
    } else {
      // Native: drop the Three.js module entirely (approved static clay cube).
      html = html.replace(/<script\s+type=["']importmap["'][\s\S]*?<\/script>/gi, '');
      html = html.replace(/<script\s+type=["']module["'][\s\S]*?<\/script>/gi, '');
    }
    if (page === 'welcome') {
      // The GL cube module normally registers window.__poplurCubeOnBack to make
      // the cube the back button on sub-screens; the static fallback doesn't, so
      // wire it here. It must be defined BEFORE the page's nav script calls it,
      // so inject at the very start of <head>. Adds a hint under the cube that
      // only shows when "back" is available.
      html = html.replace(/<head[^>]*>/i, (headTag) => `${headTag}<script>
        (function () {
          var real = null, wired = false;
          function wireCube(goBack) {
            function setup() {
              var stage = document.getElementById('lcubeStage');
              if (!stage) { setTimeout(setup, 80); return; }
              if (wired) return; wired = true;
              stage.style.cursor = 'pointer';
              var sx = 0, sy = 0, moved = false;
              stage.addEventListener('pointerdown', function (e) { moved = false; sx = e.clientX; sy = e.clientY; });
              stage.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - sx) > 6 || Math.abs(e.clientY - sy) > 6) moved = true; });
              stage.addEventListener('pointerup', function () { if (!moved && typeof goBack === 'function') goBack(); });
              var kf = document.createElement('style');
              kf.textContent = "@keyframes poplurBackHint{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-6px)}}";
              document.head.appendChild(kf);
              var hint = document.createElement('div');
              hint.id = 'cubeBackHint';
              hint.textContent = 'Tap the cube to go back';
              // match the app's clay text (cream + layered clay shadow + rounded
              // font), float + blink, and sit lower so it hovers under the cube.
              hint.style.cssText = "position:fixed;left:50%;top:46%;transform:translateX(-50%);z-index:11;white-space:nowrap;pointer-events:none;display:none;font-family:'Arial Rounded MT Bold',ui-rounded,'SF Pro Rounded','Avenir Next',system-ui,sans-serif;font-size:13px;font-weight:800;letter-spacing:.3px;color:#f8efdc;text-shadow:0 -2px 0 rgba(255,255,255,0.4),0 2px 0 #d8b98e,0 4px 0 rgba(158,14,78,0.5),0 6px 8px rgba(104,2,48,0.5),0 12px 18px rgba(80,0,36,0.35);animation:poplurBackHint 1.6s ease-in-out infinite;";
              document.body.appendChild(hint);
              var welcome = document.getElementById('paneWelcome');
              function update() {
                var t = welcome ? (welcome.style.transform || '') : '';
                var onWelcome = t === '' || /translateX\\(0%?\\)/.test(t);
                hint.style.display = onWelcome ? 'none' : 'block';
              }
              update();
              var mo = new MutationObserver(update);
              document.querySelectorAll('.pane').forEach(function (p) { mo.observe(p, { attributes: true, attributeFilter: ['style'] }); });
            }
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
            else setup();
          }
          // The page assigns window.__poplurCubeOnBack (its own back-handler
          // registrar) and then calls it with goBack; the tap->goBack call itself
          // lived in the GL cube module we strip. Intercept via an accessor: keep
          // the page's registrar working, and also wire the fallback cube to goBack.
          try {
            Object.defineProperty(window, '__poplurCubeOnBack', {
              configurable: true,
              get: function () { return real ? function (fn) { try { real(fn); } catch (e) {} wireCube(fn); } : undefined; },
              set: function (v) { real = v; }
            });
          } catch (e) {}
        })();
      </script>`);
      html = html.replace('</body>', `<script>
        (function () {
          function revealCube() {
            var stage = document.getElementById('lcubeStage');
            if (stage) stage.classList.add('flat');
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revealCube);
          else revealCube();
        })();
      </script></body>`);
    }
  } else {
    // Web with a capable GPU: run the real Three.js login cube. Repoint its
    // three/addons/draco paths at the CDN (models were already rewritten to
    // served URLs above). If three can't load (e.g. offline), reveal the static
    // clay cube so the slot is never empty.
    html = html
      .split(THREE_BUILD_PATH).join(THREE_BUILD_CDN)
      .split(THREE_ADDONS_PATH).join(THREE_ADDONS_CDN);
    html = html.replace('</head>', `<script>
      window.addEventListener('error', function (e) {
        var t = e && e.target;
        if (t && t.tagName === 'SCRIPT' && String(t.src || '').indexOf('three@0.170.0') !== -1) {
          var s = document.getElementById('lcubeStage'); if (s) s.classList.add('flat');
        }
      }, true);
    </script></head>`);
  }

  // Performance tweaks (blur -> dim, halve confetti, half-res map canvas).
  if (html.includes('</head>')) html = html.replace('</head>', `${PERF_TWEAKS}</head>`);
  else html = PERF_TWEAKS + html;

  return html;
}

export function PreloginWebScreen({ splashOnly = false }: { splashOnly?: boolean }) {
  const webViewRef = useRef<WebView>(null);
  // Launch splash dropped (parity with iOS/Android): straight to Welcome on black.
  const [page, setPage] = useState<Page>(splashOnly ? 'splash' : 'welcome');
  const [html, setHtml] = useState<string | null>(null);

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

    if (action === 'signIn') {
      if (payload.method === 'faceid') {
        postAuthResult(false, 'Face ID sign-in isn’t available here yet — use your email and password.');
        return;
      }
      if (!payload.email || !payload.password) {
        postAuthResult(false, 'Enter your email and password.');
        return;
      }
      try {
        await signInWithEmailAndPassword(auth, payload.email.trim(), payload.password);
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
        await updateProfile(credential.user, { displayName: payload.email.split('@')[0] });
        await setDoc(doc(db, 'users', credential.user.uid), {
          uid: credential.user.uid,
          email: payload.email.trim(),
          accountType: payload.accountType || 'personal',
          createdAt: Date.now()
        }, { merge: true });
        postAuthResult(true);
      } catch (error: any) {
        postAuthResult(false, error?.message || 'Unable to create your account.');
      }
      return;
    }

    if (action === 'requestPermission') {
      try {
        if (payload.permission === 'location') await Location.requestForegroundPermissionsAsync();
        if (payload.permission === 'camera') await ImagePicker.requestMediaLibraryPermissionsAsync();
      } catch (error) {
        console.warn('[PreloginWebScreen] permission request failed', error);
      }
    }
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
      {source ? (
        <WebView
          ref={webViewRef}
          source={source}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={RN_BRIDGE}
          onMessage={handleMessage}
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
