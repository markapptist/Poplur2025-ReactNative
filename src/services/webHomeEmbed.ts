/**
 * Browser previews run inside an Expo Web iframe, so location must stay behind
 * Poplur's managed permission flow instead of opening the browser permission
 * sheet. Camera and microphone remain available for explicit capture flows.
 */
export const WEB_HOME_PREVIEW_QUERY = '&mapLite=1&managedLocation=1';

export const WEB_HOME_IFRAME_ALLOW = 'camera; microphone';
