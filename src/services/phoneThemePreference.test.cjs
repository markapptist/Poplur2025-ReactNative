const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PHONE_THEME_IDS,
  PHONE_THEME_PREFERENCE_KEY,
  normalizePhoneThemeId,
  phoneThemeBootstrap,
} = require('./phoneThemePreference.ts');

test('accepts only the stable phone theme ids', () => {
  for (const id of PHONE_THEME_IDS) assert.equal(normalizePhoneThemeId(id), id);
  assert.equal(normalizePhoneThemeId('retired-finish'), null);
  assert.equal(normalizePhoneThemeId('blue<script>'), null);
  assert.equal(normalizePhoneThemeId(null), null);
});

test('hydrates the exact web storage key before Home content', () => {
  const storage = new Map();
  const localStorage = { setItem: (key, value) => storage.set(key, value) };
  Function('localStorage', phoneThemeBootstrap('blue'))(localStorage);
  assert.equal(storage.get(PHONE_THEME_PREFERENCE_KEY), 'blue');
});

test('invalid native values bootstrap the stable default', () => {
  const storage = new Map();
  const localStorage = { setItem: (key, value) => storage.set(key, value) };
  Function('localStorage', phoneThemeBootstrap('blue</script>'))(localStorage);
  assert.equal(storage.get(PHONE_THEME_PREFERENCE_KEY), PHONE_THEME_IDS[0]);
  assert.equal(phoneThemeBootstrap('blue</script>').includes('</script>'), false);
});
