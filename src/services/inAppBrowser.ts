const MAX_POPLUR_BROWSER_URL_LENGTH = 2048;

/**
 * External pages are admitted to Poplur's unprivileged browser only when the
 * top-level address is a credential-free HTTPS URL. The signed-in Home WebView
 * uses a separate loopback origin and never shares its bridge with this page.
 */
export function normalizePoplurBrowserUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_POPLUR_BROWSER_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function shouldAllowPoplurBrowserRequest(value: unknown): boolean {
  return normalizePoplurBrowserUrl(value) !== null;
}

/** Keeps target="_blank" navigation inside the one Poplur-owned WebView. */
export function resolvePoplurBrowserTargetUrl(value: unknown): string | null {
  return normalizePoplurBrowserUrl(value);
}
