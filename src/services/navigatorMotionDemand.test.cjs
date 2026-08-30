const assert = require('node:assert/strict');
const test = require('node:test');
const {
  INACTIVE_NAVIGATOR_MOTION_DEMAND,
  navigatorMotionSampleRateHz,
  navigatorMotionSubscriptionIsEligible,
  normalizeNavigatorMotionDemand,
} = require('./navigatorMotionDemand.ts');

test('requires an explicit active navigator lease', () => {
  assert.deepEqual(
    normalizeNavigatorMotionDemand(true, false),
    { active: true, aiming: false },
  );
  assert.equal(
    normalizeNavigatorMotionDemand(false, true),
    INACTIVE_NAVIGATOR_MOTION_DEMAND,
  );
  assert.equal(
    normalizeNavigatorMotionDemand(undefined, true),
    INACTIVE_NAVIGATOR_MOTION_DEMAND,
  );
});

test('caps ordinary motion at 20 Hz and aiming at 30 Hz', () => {
  assert.equal(navigatorMotionSampleRateHz({ active: true, aiming: false }), 20);
  assert.equal(navigatorMotionSampleRateHz({ active: true, aiming: true }), 30);
});

test('subscribes only for explicit foreground web-renderer demand', () => {
  const foreground = {
    nativePlatform: true,
    homeReady: true,
    ownsHeavyRenderer: true,
    browserOpen: false,
    appActive: true,
    documentVisible: true,
  };
  const active = { active: true, aiming: false };

  assert.equal(navigatorMotionSubscriptionIsEligible(foreground, active), true);
  assert.equal(navigatorMotionSubscriptionIsEligible(foreground, {
    active: false,
    aiming: false,
  }), false);
  for (const key of Object.keys(foreground)) {
    const inactive = {
      ...foreground,
      [key]: key === 'browserOpen',
    };
    assert.equal(
      navigatorMotionSubscriptionIsEligible(inactive, active),
      false,
      `expected ${key} loss to release motion`,
    );
  }
});
