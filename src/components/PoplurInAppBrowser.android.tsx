import React, { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';

type Props = {
  url: string | null;
  onClose: () => void;
};

type PoplurSafeBrowserModule = {
  open: (url: string) => Promise<void>;
};

const safeBrowser = NativeModules.PoplurSafeBrowser as PoplurSafeBrowserModule | undefined;

export function PoplurInAppBrowser({ url, onClose }: Props) {
  const openedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url || openedUrlRef.current === url) return;
    openedUrlRef.current = url;
    let active = true;

    if (!safeBrowser) {
      console.warn('[PoplurInAppBrowser] Android safe browser module is unavailable');
      onClose();
      return () => { active = false; };
    }

    void safeBrowser.open(url)
      .catch(error => console.warn('[PoplurInAppBrowser] Android browser failed', error))
      .finally(() => {
        openedUrlRef.current = null;
        if (active) onClose();
      });

    return () => { active = false; };
  }, [onClose, url]);

  // Android renders the browser in its own Poplur-owned Activity/process. The
  // React Home remains mounted but parked by PostLoginHomeWebScreen until the
  // Activity result resolves and onClose clears the browser state.
  return null;
}
