export const NATIVE_NOTIFICATION_LIMIT = 80;

export type NativeNotificationRow = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAtMillis: number;
  unread: boolean;
  actorHandle?: string;
  postId?: string;
  threadId?: string;
};

export type NotificationDocumentLike = {
  id: string;
  data: () => Record<string, unknown>;
};

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function timestampMillis(value: unknown, fallback: number): number {
  if (!value || typeof value !== 'object') return fallback;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return fallback;
  const millis = Number(toMillis.call(value));
  return Number.isFinite(millis) && millis >= 0 ? millis : fallback;
}

export function notificationRowsFromDocuments(
  documents: readonly NotificationDocumentLike[],
  now = Date.now(),
): NativeNotificationRow[] {
  return documents.slice(0, NATIVE_NOTIFICATION_LIMIT).flatMap(document => {
    const id = boundedString(document.id, 200);
    if (!id || id.includes('/')) return [];
    const data = document.data();
    if (data.isDismissed === true) return [];
    const row: NativeNotificationRow = {
      id,
      kind: boundedString(data.kind, 64) ?? 'engagement',
      title: boundedString(data.title, 120) ?? 'Poplur',
      detail: boundedString(data.detail, 500) ?? 'New activity on Poplur',
      createdAtMillis: timestampMillis(data.createdAt, now),
      unread: data.isUnread !== false,
    };
    const actorHandle = boundedString(data.actorHandle, 80);
    const postId = boundedString(data.postId, 200);
    const threadId = boundedString(data.threadId, 200);
    if (actorHandle) row.actorHandle = actorHandle;
    if (postId) row.postId = postId;
    if (threadId) row.threadId = threadId;
    return [row];
  });
}

export function boundedNotificationIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = boundedString(value, 200);
    if (!id || id.includes('/') || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === NATIVE_NOTIFICATION_LIMIT) break;
  }
  return ids;
}
