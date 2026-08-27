import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizePoplurBrowserUrl } from '../services/inAppBrowser';
import { PoplurBrowserWebSurface } from './PoplurBrowserWebSurface';
import type { PoplurBrowserWebSurfaceHandle } from './PoplurBrowserWebSurfaceTypes';

type Props = {
  url: string | null;
  onClose: () => void;
};

export function PoplurInAppBrowser({ url, onClose }: Props) {
  const webViewRef = useRef<PoplurBrowserWebSurfaceHandle>(null);
  const [navigationUrl, setNavigationUrl] = useState<string | null>(url);
  const [displayUrl, setDisplayUrl] = useState<string | null>(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setNavigationUrl(url);
    setDisplayUrl(url);
    setCanGoBack(false);
    setLoading(url !== null);
    setFailed(false);
  }, [url]);

  const close = useCallback(() => {
    webViewRef.current?.stopLoading();
    onClose();
  }, [onClose]);

  const back = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
      return;
    }
    close();
  }, [canGoBack, close]);

  if (!url || !navigationUrl) return null;

  const displayHost = (() => {
    try {
      return new URL(displayUrl ?? navigationUrl).hostname;
    } catch {
      return 'Secure website';
    }
  })();

  return (
    <Modal
      animationType="slide"
      presentationStyle="fullScreen"
      visible
      onRequestClose={back}
      statusBarTranslucent={false}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={canGoBack ? 'Back in browser' : 'Close browser'}
            onPress={back}
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
          >
            <Text style={styles.backGlyph}>‹</Text>
            <Text style={styles.toolbarButtonText}>Back</Text>
          </Pressable>

          <View style={styles.location} accessibilityLabel={`Secure website ${displayHost}`}>
            <Text style={styles.brand}>POPLUR BROWSER</Text>
            <Text numberOfLines={1} style={styles.host}>🔒 {displayHost}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={close}
            style={({ pressed }) => [styles.toolbarButton, styles.doneButton, pressed && styles.pressed]}
          >
            <Text style={styles.toolbarButtonText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.browserSurface}>
          {!failed && (
            <PoplurBrowserWebSurface
              ref={webViewRef}
              url={navigationUrl}
              onNavigationStateChange={navigation => {
                const allowedUrl = normalizePoplurBrowserUrl(navigation.url);
                if (allowedUrl) setDisplayUrl(allowedUrl);
                setCanGoBack(navigation.canGoBack);
                setLoading(navigation.loading);
                setFailed(navigation.failed);
              }}
            />
          )}

          {loading && !failed && (
            <View pointerEvents="none" style={styles.loading}>
              <ActivityIndicator color="#ff3c9e" size="large" />
            </View>
          )}

          {failed && (
            <View style={styles.errorState}>
              <Text style={styles.errorTitle}>This page could not be opened.</Text>
              <Text style={styles.errorBody}>
                Poplur only opens secure HTTPS pages inside its private browser.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close browser"
                onPress={close}
                style={({ pressed }) => [styles.closeErrorButton, pressed && styles.pressed]}
              >
                <Text style={styles.closeErrorText}>Back to Poplur</Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#15040f',
  },
  toolbar: {
    minHeight: 64,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 116, 186, 0.42)',
    backgroundColor: '#210817',
  },
  toolbarButton: {
    minWidth: 68,
    minHeight: 46,
    paddingHorizontal: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButton: {
    marginLeft: 4,
  },
  pressed: {
    opacity: 0.62,
  },
  backGlyph: {
    marginTop: Platform.OS === 'android' ? -2 : -4,
    marginRight: 2,
    color: '#ff62b1',
    fontSize: 35,
    fontWeight: '400',
  },
  toolbarButtonText: {
    color: '#ff62b1',
    fontSize: 16,
    fontWeight: '800',
  },
  location: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    color: '#ff62b1',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  host: {
    maxWidth: '100%',
    marginTop: 3,
    color: '#fff7fb',
    fontSize: 13,
    fontWeight: '700',
  },
  browserSurface: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.66)',
  },
  errorState: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff5fa',
  },
  errorTitle: {
    color: '#210817',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorBody: {
    marginTop: 12,
    color: '#75586a',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  closeErrorButton: {
    marginTop: 24,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#e51d82',
  },
  closeErrorText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
});
