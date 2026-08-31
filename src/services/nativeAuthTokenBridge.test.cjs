const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { nativeAuthTokenDetail } = require('./nativeAuthTokenBridge.ts');

test('returns the signed-in Firebase user token in the native event shape', async () => {
  let calls = 0;
  const detail = await nativeAuthTokenDetail({
    async getIdToken() {
      calls += 1;
      return 'firebase-id-token';
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(detail, { token: 'firebase-id-token', expiresIn: 3600 });
});

test('does not invent a credential when no user is signed in', async () => {
  assert.equal(await nativeAuthTokenDetail(null), null);
});

test('PostLoginHomeWebScreen answers the web request on the shared native event', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'screens', 'PostLoginHomeWebScreen.tsx'),
    'utf8',
  );
  assert.match(source, /message\.type === 'requestAuthToken'/);
  assert.match(source, /dispatchToClay\('poplur-native-auth-token', detail\)/);
});
