const assert = require('node:assert/strict');
const test = require('node:test');
const { commitDMIfNew } = require('./dmSendAttempt.ts');
test('creates a first conversation when its nonexistent message cannot be read', async () => {
  let commits = 0;
  await commitDMIfNew(async () => { throw { code: 'permission-denied' }; }, async () => { commits++; });
  assert.equal(commits, 1);
});
test('an acknowledged retry never commits the message or unread increment twice', async () => {
  let commits = 0;
  await commitDMIfNew(async () => true, async () => { commits++; });
  assert.equal(commits, 0);
});
test('a network failure does not guess whether an earlier message exists', async () => {
  let commits = 0;
  await assert.rejects(commitDMIfNew(async () => { throw new Error('offline'); }, async () => { commits++; }), /offline/);
  assert.equal(commits, 0);
});
test('creation remains subject to server rules after a denied preflight', async () => {
  await assert.rejects(commitDMIfNew(async () => { throw { code: 'permission-denied' }; }, async () => { throw new Error('blocked recipient'); }), /blocked recipient/);
});
