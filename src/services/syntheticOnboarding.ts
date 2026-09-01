export const ISOLATED_SYNTHETIC_ONBOARDING = 'first-user-v1' as const;
export const SHARED_SYNTHETIC_ONBOARDING = 'first-user-shared-v1' as const;

export type SyntheticOnboardingMode =
  | typeof ISOLATED_SYNTHETIC_ONBOARDING
  | typeof SHARED_SYNTHETIC_ONBOARDING;

type BrowserLocation = Pick<Location, 'hostname' | 'search'>;

export function resolveSyntheticOnboardingMode(
  location: BrowserLocation | undefined = typeof window === 'undefined' ? undefined : window.location,
): SyntheticOnboardingMode | null {
  if (!location || location.hostname !== '127.0.0.1') return null;
  const value = new URLSearchParams(location.search).get('syntheticOnboarding');
  return value === ISOLATED_SYNTHETIC_ONBOARDING || value === SHARED_SYNTHETIC_ONBOARDING
    ? value
    : null;
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
  return {
    syntheticBeta: true,
    syntheticActorId: mode === ISOLATED_SYNTHETIC_ONBOARDING
      ? 'sim-onboarding-first'
      : 'sim-onboarding-first-shared',
    syntheticJourney: mode,
    syntheticSource: 'visible-app-ui',
    ...(runId ? { syntheticRunId: runId } : {}),
  };
}
