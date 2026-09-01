import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');

test('the isolated post acknowledges its commit before projecting the shared row', async () => {
  const [home, posts, mode] = await Promise.all([
    source('src/screens/PostLoginHomeWebScreen.tsx'),
    source('src/services/posts.ts'),
    source('src/services/syntheticOnboarding.ts'),
  ]);

  assert.match(home, /if \(isolatedSyntheticOnboarding\) \{\s*const posts = await fetchRecentPosts\(96\)/);
  assert.match(home, /async function getSyntheticOnboardingProfile\(\)/);
  assert.match(home, /isolatedSyntheticOnboarding\s*\? await getSyntheticOnboardingProfile\(\)\s*: await getCurrentProfile\(\)/);
  assert.match(home, /isolatedSyntheticOnboarding \? getSyntheticOnboardingProfile\(\) : getCurrentProfile\(\)/);
  assert.match(home, /const mediaURL = validatedOnboardingMediaUrl\(uploaded\.mediaURL\)/);
  assert.match(home, /id: uploaded\.postId,[\s\S]*ownerId: owner\.uid,[\s\S]*syntheticJourney: 'first-user-v1' as const/);
  const publishStart = home.indexOf('const publishPost = useCallback');
  const publishBody = home.slice(publishStart, home.indexOf('const openInAppBrowser', publishStart));
  const projection = publishBody.indexOf("dispatchToClay('poplur-native-feed-posts', {");
  const acknowledgement = publishBody.indexOf("dispatchToClay('poplur-upload-result', {");
  assert.ok(acknowledgement >= 0 && projection > acknowledgement,
    'the upload success acknowledgement must precede the shared post projection');
  assert.doesNotMatch(home, /if \(syntheticOnboarding\) await sendFeedPostsToWeb\(\);/);
  assert.match(home, /function syntheticTransferByteSize\(value: unknown, kind: 'photo' \| 'video'\)/);
  assert.match(home, /sizeBytes: captureRecord\?\.sizeBytes \?\? transferredSize \?\? undefined/);
  assert.match(home, /The isolated browser capture could not be size-verified\./);
  assert.match(home, /postId: uploaded\.postId/);
  assert.match(home, /syntheticJourney: 'first-user-v1' as const/);
  assert.match(posts, /return \{ mediaURL, postId: postRef\.id \};/);
  assert.match(mode, /syntheticSource: 'visible-app-ui'/);
  assert.match(posts, /async function waitForSyntheticPostCommit\(uid: string, postId: string\)/);
  assert.match(posts, /http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-poplur-first-user-v1\/databases\/\(default\)\/documents/);
  assert.match(posts, /restString\(post, 'syntheticActorId'\) === 'sim-onboarding-first'/);
  assert.match(posts, /restString\(post, 'syntheticSource'\) === 'visible-app-ui'/);
  assert.match(posts, /restString\(location, 'source'\) === 'post-upload'/);
  assert.match(posts, /const outcome = syntheticContext\?\.mode === ISOLATED_SYNTHETIC_ONBOARDING\s*\? await Promise\.race/);
});

test('production media remains HTTPS-only and the emulator exception is exact', async () => {
  const home = await source('src/screens/PostLoginHomeWebScreen.tsx');
  assert.match(home, /url\.protocol !== 'https:'/);
  assert.match(home, /url\.origin !== 'http:\/\/127\.0\.0\.1:9199'/);
  assert.doesNotMatch(home, /url\.hostname === 'localhost'/);
});

test('the exact RN web shell route carries Clay requests through one origin-pinned bridge', async () => {
  const [app, home] = await Promise.all([
    source('App.tsx'),
    source('src/screens/PostLoginHomeWebScreen.tsx'),
  ]);
  assert.match(app, /PostLoginHomeWebScreen skipPermissionPrimer=\{preloginPermissionsHandled\} syntheticOnboardingMode=\{syntheticOnboardingMode\}/);
  assert.match(home, /rnWebTransportQuery = syntheticOnboarding && Platform\.OS === 'web'[\s\S]*isolatedSyntheticOnboarding \? '&rnWebShell=1' : '&rnWebBridge=1'/);
  assert.match(home, /event\.origin !== WEB_HOME_ORIGIN \|\| event\.source !== iframeRef\.current\?\.contentWindow/);
  assert.match(home, /message\.type !== 'poplur-rn-shell-event'/);
  assert.match(home, /type: 'poplur-rn-shell-dispatch'/);
});

test('signup waits for its tagged profile and Home seeds the fixed map location', async () => {
  const [app, home] = await Promise.all([
    source('App.tsx'),
    source('src/screens/PostLoginHomeWebScreen.tsx'),
  ]);
  assert.match(app, /function waitForSyntheticProfile\(user: User/);
  assert.match(app, /void waitForSyntheticProfile\(user\)\.then\(ready =>/);
  assert.match(app, /http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-poplur-first-user-v1\/databases\/\(default\)\/documents\/users/);
  assert.match(app, /document\.fields\?\.syntheticActorId\?\.stringValue === 'sim-onboarding-first'/);
  assert.match(app, /document\.fields\?\.syntheticJourney\?\.stringValue === 'first-user-v1'/);
  assert.match(app, /if \(user && isolatedSyntheticOnboarding\)/);
  assert.match(home, /if \(!syntheticOnboarding \|\| Platform\.OS !== 'web' \|\| !homeReady\) return;/);
  assert.match(home, /void requestAndPushLocation\(\);/);
});
