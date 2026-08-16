/** Native AdMob has no browser equivalent. The web preview keeps the Feed
 * running normally; physical iOS/Android resolve feedAds.native.ts instead. */
export async function initializeFeedGoogleAds(): Promise<void> {}

export function presentFeedGoogleAd(_onVisibilityChange: (open: boolean) => void): void {}
