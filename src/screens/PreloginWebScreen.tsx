import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
  return FileSystem.readAsStringAsync(uri);
}

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

  // The native clients use the bundled Three.js module over their custom asset
  // origin. RN's WebView gets the approved static clay cube fallback instead of
  // introducing a second, fragile GPU renderer. The surrounding page, copy,
  // permissions, radio controls, and login/signup flow remain unchanged.
  html = html.replace(/<script\s+type=["']importmap["'][\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script\s+type=["']module["'][\s\S]*?<\/script>/gi, '');
  if (page === 'welcome') {
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
  return html;
}

export function PreloginWebScreen({ splashOnly = false }: { splashOnly?: boolean }) {
  const webViewRef = useRef<WebView>(null);
  const [page, setPage] = useState<Page>('splash');
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
