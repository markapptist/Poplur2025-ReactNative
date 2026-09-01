import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('shared first-user mode is exact-loopback but retains production Firebase', async () => {
  const [app, firebase, mode] = await Promise.all([
    source('App.tsx'),
    source('src/services/firebase.ts'),
    source('src/services/syntheticOnboarding.ts'),
  ]);

  assert.match(mode, /SHARED_SYNTHETIC_ONBOARDING = 'first-user-shared-v1'/);
  assert.match(mode, /location\.hostname !== '127\.0\.0\.1'/);
  assert.match(mode, /value === ISOLATED_SYNTHETIC_ONBOARDING \|\| value === SHARED_SYNTHETIC_ONBOARDING/);
  assert.match(app, /const syntheticOnboardingMode = resolveSyntheticOnboardingMode\(\)/);
  assert.match(app, /syntheticOnboardingMode === ISOLATED_SYNTHETIC_ONBOARDING/);
  assert.match(firebase, /resolveSyntheticOnboardingMode\(\) === ISOLATED_SYNTHETIC_ONBOARDING/);
  assert.match(firebase, /const firebaseConfig = syntheticOnboardingEmulators \?/);
  assert.match(firebase, /projectId: 'poplur2025'/);
  assert.doesNotMatch(firebase, /SHARED_SYNTHETIC_ONBOARDING/);
});

test('shared browser journey keeps automation affordances without emulator-only projections', async () => {
  const [home, prelogin] = await Promise.all([
    source('src/screens/PostLoginHomeWebScreen.tsx'),
    source('src/screens/PreloginWebScreen.tsx'),
  ]);

  assert.match(home, /const syntheticOnboarding = syntheticOnboardingMode !== null/);
  assert.match(home, /syntheticOnboardingMode === ISOLATED_SYNTHETIC_ONBOARDING/);
  assert.match(home, /if \(skipPermissionPrimer \|\| syntheticOnboarding\)/);
  assert.match(home, /if \(syntheticOnboarding && Platform\.OS === 'web'\)/);
  assert.match(home, /rnWebTransportQuery = syntheticOnboarding && Platform\.OS === 'web'/);
  assert.match(home, /isolatedSyntheticOnboarding \? '&rnWebShell=1' : '&rnWebBridge=1'/);
  assert.match(home, /if \(isolatedSyntheticOnboarding\) \{\s*const posts = await fetchRecentPosts\(96\)/);
  assert.match(home, /if \(isolatedSyntheticOnboarding\) \{[\s\S]*dispatchToClay\('poplur-native-feed-posts'/);
  assert.match(home, /isolatedSyntheticOnboarding\s*\? await getSyntheticOnboardingProfile\(\)\s*: await getCurrentProfile\(\)/);
  assert.match(prelogin, /if \(syntheticOnboardingMode\) \{[\s\S]*await setDoc\([\s\S]*\} else \{\s*await saveUserProfile/);
  assert.match(prelogin, /shared[\s\S]*avoids the production \/usernames index/);
});

test('shared profile and post writes carry bounded provenance but keep normal commit ownership', async () => {
  const [mode, prelogin, posts] = await Promise.all([
    source('src/services/syntheticOnboarding.ts'),
    source('src/screens/PreloginWebScreen.tsx'),
    source('src/services/posts.ts'),
  ]);

  assert.match(mode, /\^\[a-zA-Z0-9\]\[a-zA-Z0-9_-\]\{7,63\}\$/);
  assert.match(mode, /syntheticActorId: mode === ISOLATED_SYNTHETIC_ONBOARDING/);
  assert.match(mode, /'sim-onboarding-first-shared'/);
  assert.match(mode, /syntheticJourney: mode/);
  assert.match(mode, /\.\.\.\(runId \? \{ syntheticRunId: runId \} : \{\}\)/);
  assert.match(prelogin, /syntheticOnboardingMetadata\(syntheticOnboardingMode\)/);
  assert.match(posts, /const syntheticContext = syntheticOnboardingContext\(\)/);
  assert.match(posts, /\.\.\.\(syntheticContext\?\.metadata \?\? \{\}\)/);
  assert.match(posts, /syntheticContext\?\.mode === ISOLATED_SYNTHETIC_ONBOARDING[\s\S]*: await commitOutcome/);
  assert.match(posts, /userID: user\.uid/);
  assert.match(posts, /where\('userID', '==', uid\)/);
});
