const assert = require('node:assert/strict');
const test = require('node:test');
const {
  boundedNotificationIds,
  notificationRowsFromDocuments,
  NATIVE_NOTIFICATION_LIMIT,
} = require('./notificationInboxContract.ts');

const document = (id, data) => ({ id, data: () => data });

test('normalizes each complete listener snapshot and removes dismissed rows', () => {
  const rows = notificationRowsFromDocuments([
    document('new', {
      kind: 'dm', title: 'harbourfront', detail: 'Sent a message',
      createdAt: { toMillis: () => 200 }, isUnread: true, threadId: 'a_b',
    }),
    document('dismissed', { title: 'old', isDismissed: true }),
    document('changed', { title: 'Now read', isUnread: false }),
  ], 100);

  assert.deepEqual(rows, [
    {
      id: 'new', kind: 'dm', title: 'harbourfront', detail: 'Sent a message',
      createdAtMillis: 200, unread: true, threadId: 'a_b',
    },
    {
      id: 'changed', kind: 'engagement', title: 'Now read',
      detail: 'New activity on Poplur', createdAtMillis: 100, unread: false,
    },
  ]);
});

test('bounds snapshot rows and update ids to the same 80-document contract', () => {
  const documents = Array.from({ length: NATIVE_NOTIFICATION_LIMIT + 5 }, (_, index) =>
    document(`n-${index}`, { title: `Row ${index}` }));
  assert.equal(notificationRowsFromDocuments(documents).length, NATIVE_NOTIFICATION_LIMIT);
  const ids = boundedNotificationIds([' n-1 ', 'n-1', 'bad/path', '', ...documents.map(item => item.id)]);
  assert.equal(ids.length, NATIVE_NOTIFICATION_LIMIT);
  assert.equal(ids[0], 'n-1');
  assert.equal(ids.at(-1), 'n-79');
  assert.equal(new Set(ids).size, ids.length);
});
