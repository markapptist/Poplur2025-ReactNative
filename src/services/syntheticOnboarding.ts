export const ISOLATED_SYNTHETIC_ONBOARDING = 'first-user-v1' as const;
export const SHARED_SYNTHETIC_ONBOARDING = 'first-user-shared-v1' as const;
/**
 * The eight provisioned beta runner accounts (five people, three businesses)
 * using the real app on production.
 * Same shell behaviour as the shared first user (managed Toronto location, no
 * permission primers), but every post is stamped with the actor that made it.
 */
export const LIVE_COHORT_SYNTHETIC = 'five-actor-live' as const;

export type SyntheticOnboardingMode =
  | typeof ISOLATED_SYNTHETIC_ONBOARDING
  | typeof SHARED_SYNTHETIC_ONBOARDING
  | typeof LIVE_COHORT_SYNTHETIC;

/** Pinned by functions/scripts/provisionSyntheticBetaAccounts.js (UID === actorId). */
export const LIVE_COHORT_ACTOR_IDS = Object.freeze([
  'sim-food-001',
  'sim-sports-002',
  'sim-music-003',
  'sim-tech-004',
  'sim-news-005',
  // Business testers — listed businesses provisioned the same way.
  'sim-biz-food-006',
  'sim-biz-shop-007',
  'sim-biz-fashion-008',
]);

type BrowserLocation = Pick<Location, 'hostname' | 'search'>;

export function resolveSyntheticOnboardingMode(
  location: BrowserLocation | undefined = typeof window === 'undefined' ? undefined : window.location,
): SyntheticOnboardingMode | null {
  if (!location || location.hostname !== '127.0.0.1') return null;
  const params = new URLSearchParams(location.search);
  const value = params.get('syntheticOnboarding');
  if (value === LIVE_COHORT_SYNTHETIC) {
    // Live cohort mode is only meaningful when it names one provisioned actor.
    return resolveLiveCohortActorId(location) ? value : null;
  }
  return value === ISOLATED_SYNTHETIC_ONBOARDING || value === SHARED_SYNTHETIC_ONBOARDING
    ? value
    : null;
}

export function resolveLiveCohortActorId(
  location: BrowserLocation | undefined = typeof window === 'undefined' ? undefined : window.location,
): string | null {
  if (!location || location.hostname !== '127.0.0.1') return null;
  const value = new URLSearchParams(location.search).get('syntheticActorId')?.trim() ?? '';
  return LIVE_COHORT_ACTOR_IDS.includes(value) ? value : null;
}

/** The managed fix every synthetic web journey used before per-actor places existed. */
export const SYNTHETIC_DEFAULT_LOCATION = Object.freeze({ latitude: 43.6532, longitude: -79.3832 });

/**
 * Where a synthetic web session "is". The first-user journeys stay on the
 * managed Toronto fix; the live cohort may name its actor's own city with
 * `syntheticLatitude` / `syntheticLongitude` (exact decimal degrees, validated).
 * Nothing here reads a real device fix.
 */
export function resolveSyntheticLocation(
  mode: SyntheticOnboardingMode | null,
  location: BrowserLocation | undefined = typeof window === 'undefined' ? undefined : window.location,
): { latitude: number; longitude: number } {
  if (mode !== LIVE_COHORT_SYNTHETIC || !location || location.hostname !== '127.0.0.1') {
    return SYNTHETIC_DEFAULT_LOCATION;
  }
  const params = new URLSearchParams(location.search);
  const latitude = Number(params.get('syntheticLatitude'));
  const longitude = Number(params.get('syntheticLongitude'));
  const exact = /^-?\d{1,3}(?:\.\d{1,6})?$/;
  if (!exact.test(params.get('syntheticLatitude') ?? '') || !exact.test(params.get('syntheticLongitude') ?? '')
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) {
    return SYNTHETIC_DEFAULT_LOCATION;
  }
  return { latitude, longitude };
}

function resolveRunId(
  location: BrowserLocation | undefined = typeof window === 'undefined' ? undefined : window.location,
): string | null {
  if (!location || location.hostname !== '127.0.0.1') return null;
  const value = new URLSearchParams(location.search).get('syntheticRunId')?.trim() ?? '';
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/.test(value) ? value : null;
}

/**
 * Observable provenance only. Firestore/Auth ownership remains the authority
 * for every profile, post and cleanup decision; callers must never authorize
 * access or deletion from these fields.
 */
export function syntheticOnboardingMetadata(
  mode: SyntheticOnboardingMode | null,
): Record<string, string | boolean> | null {
  if (!mode) return null;
  const runId = resolveRunId();
  const liveActorId = mode === LIVE_COHORT_SYNTHETIC ? resolveLiveCohortActorId() : null;
  if (mode === LIVE_COHORT_SYNTHETIC && !liveActorId) return null;
  return {
    syntheticBeta: true,
    syntheticActorId: liveActorId
      ?? (mode === ISOLATED_SYNTHETIC_ONBOARDING
        ? 'sim-onboarding-first'
        : 'sim-onboarding-first-shared'),
    syntheticJourney: mode,
    syntheticSource: 'visible-app-ui',
    ...(runId ? { syntheticRunId: runId } : {}),
  };
}
