export type NavigatorMotionDemand = Readonly<{
  active: boolean;
  aiming: boolean;
}>;

export const INACTIVE_NAVIGATOR_MOTION_DEMAND: NavigatorMotionDemand = Object.freeze({
  active: false,
  aiming: false,
});

export type NavigatorMotionRuntime = Readonly<{
  nativePlatform: boolean;
  homeReady: boolean;
  ownsHeavyRenderer: boolean;
  browserOpen: boolean;
  appActive: boolean;
  documentVisible: boolean;
}>;

export function normalizeNavigatorMotionDemand(
  active: unknown,
  aiming: unknown,
): NavigatorMotionDemand {
  if (active !== true) return INACTIVE_NAVIGATOR_MOTION_DEMAND;
  return { active: true, aiming: aiming === true };
}

export function navigatorMotionSampleRateHz(demand: NavigatorMotionDemand): 20 | 30 {
  return demand.aiming ? 30 : 20;
}

export function navigatorMotionSubscriptionIsEligible(
  runtime: NavigatorMotionRuntime,
  demand: NavigatorMotionDemand,
): boolean {
  return runtime.nativePlatform
    && runtime.homeReady
    && runtime.ownsHeavyRenderer
    && !runtime.browserOpen
    && runtime.appActive
    && runtime.documentVisible
    && demand.active;
}
