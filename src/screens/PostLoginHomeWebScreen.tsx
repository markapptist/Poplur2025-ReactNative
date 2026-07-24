import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import Server from '@dr.pogodin/react-native-static-server';
import { unzip } from 'react-native-zip-archive';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { PreloginWebScreen } from './PreloginWebScreen';

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
const BUNDLE_VERSION = '1';

const CLAYMAP_ZIP = require('../assets/claymap/claymap.zip');

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

export function PostLoginHomeWebScreen() {
  const webViewRef = useRef<WebView>(null);
  const serverRef = useRef<Server | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [homeReady, setHomeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fileDir = await prepareBundle();
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
    };
  }, []);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'homeReady' || message.type === 'mapReady') setHomeReady(true);
      // pop / requestLocation / poiTap: native reactions land in a later pass.
    } catch {
      // Non-JSON messages are ignored.
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {origin && (
        <WebView
          ref={webViewRef}
          style={styles.web}
          source={{ uri: `${origin}/index.html?view=home&tabs=0` }}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={RN_NATIVE_SHELL}
          onMessage={handleMessage}
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
