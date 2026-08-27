const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WEB_HOME_IFRAME_ALLOW,
  WEB_HOME_PREVIEW_QUERY,
} = require('./webHomeEmbed.ts');

test('marks the browser home embed as managed and map-lite', () => {
  const params = new URLSearchParams(WEB_HOME_PREVIEW_QUERY);
  assert.equal(params.get('managedLocation'), '1');
  assert.equal(params.get('mapLite'), '1');
});

test('never advertises raw browser geolocation to the home iframe', () => {
  const permissions = WEB_HOME_IFRAME_ALLOW
    .split(';')
    .map(value => value.trim())
    .filter(Boolean);

  assert.deepEqual(permissions, ['camera', 'microphone']);
  assert.equal(permissions.includes('geolocation'), false);
});
