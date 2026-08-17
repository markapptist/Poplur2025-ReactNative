import mobileAds, {
  AdEventType,
  InterstitialAd,
} from 'react-native-google-mobile-ads';

const PRODUCTION_INTERSTITIAL_UNIT_ID = 'ca-app-pub-2086359936541081/6696033455';

let initialized: Promise<void> | null = null;
let interstitial: InterstitialAd | null = null;
let loaded = false;
let loading = false;
let pending = false;
let visibilityCallback: ((open: boolean) => void) | null = null;
let unsubscribe: Array<() => void> = [];

function clearListeners() {
  unsubscribe.forEach(off => off());
  unsubscribe = [];
}

function createInterstitial() {
  clearListeners();
  loaded = false;
  loading = false;
  interstitial = InterstitialAd.createForAdRequest(
    PRODUCTION_INTERSTITIAL_UNIT_ID,
    { requestNonPersonalizedAdsOnly: true },
  );
  unsubscribe = [
    interstitial.addAdEventListener(AdEventType.LOADED, () => {
      loaded = true;
      loading = false;
      if (pending) void showIfReady();
    }),
    interstitial.addAdEventListener(AdEventType.OPENED, () => {
      visibilityCallback?.(true);
    }),
    interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      visibilityCallback?.(false);
      visibilityCallback = null;
      pending = false;
      createInterstitial();
      loadInterstitial();
    }),
    interstitial.addAdEventListener(AdEventType.ERROR, (error: Error) => {
      loaded = false;
      loading = false;
      pending = false;
      visibilityCallback?.(false);
      visibilityCallback = null;
      console.warn('[FeedAds] Google interstitial failed', error.message);
    }),
  ];
}

function loadInterstitial() {
  if (!interstitial) createInterstitial();
  if (!interstitial || loading || loaded) return;
  loading = true;
  interstitial.load();
}

async function showIfReady() {
  if (!pending || !loaded || !interstitial) return;
  loaded = false;
  try {
    await interstitial.show();
  } catch (error) {
    loading = false;
    pending = false;
    visibilityCallback?.(false);
    visibilityCallback = null;
    console.warn('[FeedAds] Google interstitial could not open', error);
    createInterstitial();
    loadInterstitial();
  }
}

export async function initializeFeedGoogleAds(): Promise<void> {
  if (!initialized) {
    initialized = mobileAds().initialize().then(() => undefined);
  }
  await initialized;
  if (!interstitial) createInterstitial();
  loadInterstitial();
}

export function presentFeedGoogleAd(onVisibilityChange: (open: boolean) => void): void {
  visibilityCallback = onVisibilityChange;
  pending = true;
  void initializeFeedGoogleAds()
    .then(() => {
      if (loaded) void showIfReady();
      else loadInterstitial();
    })
    .catch(error => {
      pending = false;
      visibilityCallback = null;
      console.warn('[FeedAds] Google Mobile Ads initialization failed', error);
    });
}
