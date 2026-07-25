import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

// Web-only shim for `react-native-webview`. Metro aliases `react-native-webview`
// to this file for the web platform only (see metro.config.js) — native iOS/
// Android keep the real native WebView. It renders the same `source.html` /
// `source.uri` inside an <iframe>, and bridges the app's PoplurNative message
// channel so the pre-login flow's buttons and auth callbacks keep working on web.

type Source = { html?: string; uri?: string; baseUrl?: string };
type WebViewProps = {
  source?: Source;
  style?: any;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onLoad?: (event: { nativeEvent: Record<string, unknown> }) => void;
  onLoadEnd?: (event: { nativeEvent: Record<string, unknown> }) => void;
  injectedJavaScriptBeforeContentLoaded?: string;
  [key: string]: unknown;
};

export type WebViewMessageEvent = { nativeEvent: { data: string } };

function buildSrcDoc(html: string, injectBefore?: string): string {
  const bridge = `<script>
(function () {
  window.ReactNativeWebView = {
    postMessage: function (data) {
      try { window.parent.postMessage({ __rnwv: true, data: data }, '*'); } catch (e) {}
    }
  };
})();
${injectBefore || ''}
</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + bridge);
  }
  return bridge + html;
}

const WebView = forwardRef(function WebView(props: WebViewProps, ref) {
  const {
    source,
    style,
    onMessage,
    onLoad,
    onLoadEnd,
    injectedJavaScriptBeforeContentLoaded
  } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useImperativeHandle(ref, () => ({
    injectJavaScript: (js: string) => {
      try {
        const win = iframeRef.current?.contentWindow as (Window & { eval?: (s: string) => void }) | null;
        win?.eval?.(js);
      } catch (e) {
        // Same-origin eval can fail if the frame isn't ready yet; ignore.
      }
    },
    reload: () => {
      const el = iframeRef.current;
      if (el) el.src = el.src;
    },
    postMessage: () => {},
    stopLoading: () => {},
    goBack: () => {},
    goForward: () => {},
    requestFocus: () => {}
  }), []);

  useEffect(() => {
    function handler(ev: MessageEvent) {
      const data = ev?.data as { __rnwv?: boolean; data?: string } | undefined;
      if (data && data.__rnwv && typeof onMessage === 'function') {
        onMessage({ nativeEvent: { data: String(data.data ?? '') } });
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  const html = source?.html;
  const uri = source?.uri;
  const srcDoc = html != null ? buildSrcDoc(html, injectedJavaScriptBeforeContentLoaded) : undefined;

  return (
    <View style={[StyleSheet.absoluteFill, { flex: 1 }, style]}>
      {React.createElement('iframe', {
        ref: iframeRef,
        srcDoc,
        src: uri,
        onLoad: () => {
          onLoad?.({ nativeEvent: {} });
          onLoadEnd?.({ nativeEvent: {} });
        },
        allow: 'autoplay; encrypted-media; fullscreen; microphone; camera',
        style: { border: 0, width: '100%', height: '100%', backgroundColor: 'transparent' }
      })}
    </View>
  );
});

export default WebView;
export { WebView };
