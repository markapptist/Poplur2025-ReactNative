import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('first-user route is exact-loopback and connects every mutable Firebase service to emulators', async () => {
  const [app, firebase, mode] = await Promise.all([
    source('App.tsx'),
    source('src/services/firebase.ts'),
    source('src/services/syntheticOnboarding.ts'),
  ]);
  assert.match(mode, /location\.hostname !== '127\.0\.0\.1'/);
  assert.match(mode, /ISOLATED_SYNTHETIC_ONBOARDING = 'first-user-v1'/);
  assert.match(app, /PreloginWebScreen syntheticOnboardingMode=\{syntheticOnboardingMode\}/);
  assert.doesNotMatch(mode, /location\.hostname === 'localhost'/);
  assert.match(firebase, /projectId: 'demo-poplur-first-user-v1'/);
  assert.match(firebase, /initializeApp\(firebaseConfig, 'poplur-first-user-emulator'\)/);
  assert.match(firebase, /resolveSyntheticOnboardingMode\(\) === ISOLATED_SYNTHETIC_ONBOARDING/);
  assert.match(firebase, /connectAuthEmulator\(auth, 'http:\/\/127\.0\.0\.1:9099'/);
  assert.match(firebase, /connectFirestoreEmulator\(db, '127\.0\.0\.1', 8080\)/);
  assert.match(firebase, /connectStorageEmulator\(storage, '127\.0\.0\.1', 9199\)/);
  assert.match(firebase, /connectFunctionsEmulator\(functions, '127\.0\.0\.1', 5001\)/);
});

test('approved personal signup waits for Firebase and carries its required profile photo', async () => {
  const [welcome, prelogin] = await Promise.all([
    source('src/assets/prelogin/welcome.html'),
    source('src/screens/PreloginWebScreen.tsx'),
  ]);
  assert.match(welcome, /if \(signupSubmitting\) return/);
  assert.match(welcome, /poplurBridge\.signUp\(\{/);
  assert.match(welcome, /profilePhotoDataUrl: signupPhotoDataUrl/);
  assert.match(welcome, /if \(posted\) \{\s*signupSubmitting = true\s*return/);
  assert.match(welcome, /window\.poplurAuthResult = function/);
  assert.match(prelogin, /createUserWithEmailAndPassword/);
  assert.match(prelogin, /profile_pictures\/\$\{credential\.user\.uid\}\.jpg/);
  assert.match(prelogin, /uploadString\(photoRef, payload\.profilePhotoDataUrl, 'data_url'\)/);
  assert.match(prelogin, /await setDoc\(doc\(db, 'users', credential\.user\.uid\), profile/);
  assert.match(prelogin, /if \(syntheticOnboardingMode\)/);
  assert.match(prelogin, /syntheticActorId: 'sim-onboarding-first'/);
  assert.match(prelogin, /syntheticJourney: 'first-user-v1'/);
});
