import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  boundedNotificationIds,
  notificationRowsFromDocuments,
  NATIVE_NOTIFICATION_LIMIT,
  type NativeNotificationRow,
} from './notificationInboxContract';

let activeNotificationInboxUID: string | null = null;

/**
 * One auth-owned notification listener. Auth changes first detach the previous
 * account query and clear its rows; the returned cleanup detaches both.
 */
export function observeNotificationInbox(
  onChange: (rows: NativeNotificationRow[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  let active = true;
  let observedUid: string | null | undefined;
  let stopQuery: Unsubscribe | null = null;

  const stopAuth = onAuthStateChanged(auth, user => {
    if (!active) return;
    const uid = user?.uid ?? null;
    stopQuery?.();
    stopQuery = null;
    const accountChanged = observedUid !== undefined && observedUid !== uid;
    observedUid = uid;
    activeNotificationInboxUID = uid;
    if (!uid) {
      onChange([]);
      return;
    }
    if (accountChanged) onChange([]);

    const inboxQuery = query(
      collection(db, 'users', uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(NATIVE_NOTIFICATION_LIMIT),
    );
    stopQuery = onSnapshot(inboxQuery, snapshot => {
      if (!active || observedUid !== uid) return;
      onChange(notificationRowsFromDocuments(snapshot.docs));
    }, error => {
      if (!active || observedUid !== uid) return;
      onError?.(error);
    });
  });

  return () => {
    if (!active) return;
    active = false;
    stopQuery?.();
    stopQuery = null;
    stopAuth();
    observedUid = undefined;
    activeNotificationInboxUID = null;
  };
}

async function updateNotificationInbox(
  ids: readonly unknown[],
  operation: 'read' | 'dismiss',
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || activeNotificationInboxUID !== uid) return;
  const selected = boundedNotificationIds(ids);
  if (selected.length === 0) return;
  const batch = writeBatch(db);
  selected.forEach(id => {
    const reference = doc(db, 'users', uid, 'notifications', id);
    if (operation === 'read') {
      batch.update(reference, { isUnread: false, readAt: serverTimestamp() });
    } else {
      batch.update(reference, { isDismissed: true, dismissedAt: serverTimestamp() });
    }
  });
  await batch.commit();
}

export function markNotificationsRead(ids: readonly unknown[]): Promise<void> {
  return updateNotificationInbox(ids, 'read');
}

export function dismissNotifications(ids: readonly unknown[]): Promise<void> {
  return updateNotificationInbox(ids, 'dismiss');
}
