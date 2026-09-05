import { commitDMIfNew } from './dmSendAttempt';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export type NativeDMThread = {
  id: string;
  otherId: string;
  title: string;
  initials: string;
  preview: string;
  unread: number;
  updatedAtMillis: number;
};

export type NativeDMMessage = {
  id: string;
  from: 'me' | 'them';
  text: string;
  createdAtMillis: number;
  pending: boolean;
  kind?: string;
  mediaURL?: string;
  mimeType?: string;
  durationMillis?: number;
};

export type NativeDMThreadState = {
  threadId: string;
  typingAtMillis?: number;
  otherReadAtMillis?: number;
};

let openThreadId: string | null = null;

function signedInUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to use Messages.');
  return uid;
}

/**
 * The name the other side should see for this account. Without it a thread
 * this client creates renders as an eight-character uid stub in their Mail
 * list, because `participantNames` is the only name source there.
 */
function signedInDisplayName(): string {
  const user = auth.currentUser;
  const name = user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || '';
  return name.slice(0, 80);
}

function millis(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== 'function') return 0;
  const result = Number(toMillis.call(value));
  return Number.isFinite(result) ? result : 0;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string'));
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    const number = Number(raw);
    return Number.isFinite(number) ? [[key, number] as const] : [];
  }));
}

function timestampMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    const valueMillis = millis(raw);
    return valueMillis > 0 ? [[key, valueMillis] as const] : [];
  }));
}

function initials(name: string): string {
  const letters = name.replace('@', '').split(/\s+/).flatMap(part => part[0] ? [part[0]] : []);
  return letters.slice(0, 2).join('').toUpperCase() || 'P';
}

function validClientMessageId(value: string): boolean {
  return /^msg-[A-Za-z0-9-]{16,96}$/.test(value) && value.length <= 100;
}

export function canonicalDMThreadId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Observe every established conversation for this account. Radius is
 * deliberately absent: it controls discovery/start eligibility, never the
 * participant-owned history after the first message creates a thread.
 */
export function observeDMThreads(
  onChange: (threads: NativeDMThread[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const me = signedInUid();
  const threadsQuery = query(
    collection(db, 'dmThreads'),
    where('participants', 'array-contains', me),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(threadsQuery, snapshot => {
    const threads = snapshot.docs.flatMap(document => {
      const data = document.data();
      const participants = Array.isArray(data.participants)
        ? data.participants.filter((value): value is string => typeof value === 'string')
        : [];
      const otherId = participants.find(value => value !== me) ?? '';
      if (!otherId) return [];
      const updatedAtMillis = millis(data.updatedAt);
      const hiddenAtMillis = timestampMap(data.hiddenAtBy)[me] ?? 0;
      if (hiddenAtMillis >= updatedAtMillis) return [];
      const readAtMillis = timestampMap(data.readAtBy)[me] ?? 0;
      const unreadBy = numberMap(data.unreadBy);
      const unread = unreadBy[me]
        ?? (data.lastSenderId !== me && updatedAtMillis > readAtMillis ? 1 : 0);
      const names = stringMap(data.participantNames);
      const title = names[otherId]?.trim() || otherId.slice(0, 8) || 'Poplur';
      return [{
        id: document.id,
        otherId,
        title,
        initials: initials(title),
        preview: typeof data.lastMessage === 'string' && data.lastMessage.trim()
          ? data.lastMessage.trim()
          : 'No messages yet',
        unread: Math.max(0, Math.floor(unread)),
        updatedAtMillis,
      }];
    });
    onChange(threads);
  }, error => {
    onError?.(error);
    onChange([]);
  });
}

export function observeDMThread(
  threadId: string,
  onMessages: (messages: NativeDMMessage[]) => void,
  onState: (state: NativeDMThreadState) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const me = signedInUid();
  if (!threadId || threadId.length > 200) throw new Error('Invalid conversation.');
  openThreadId = threadId;
  const threadRef = doc(db, 'dmThreads', threadId);
  const messagesQuery = query(
    collection(threadRef, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  const stopMessages = onSnapshot(messagesQuery, { includeMetadataChanges: true }, snapshot => {
    onMessages(snapshot.docs.flatMap(document => {
      const data = document.data();
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return [];
      const message: NativeDMMessage = {
        id: document.id,
        from: data.senderId === me ? 'me' : 'them',
        text,
        createdAtMillis: millis(data.createdAt),
        pending: document.metadata.hasPendingWrites,
      };
      if (typeof data.kind === 'string') message.kind = data.kind;
      if (typeof data.mediaURL === 'string') message.mediaURL = data.mediaURL;
      if (typeof data.mimeType === 'string') message.mimeType = data.mimeType;
      if (Number.isFinite(data.durationMillis)) message.durationMillis = Number(data.durationMillis);
      return [message];
    }));
  }, error => {
    onError?.(error);
    onMessages([]);
  });
  const stopState = onSnapshot(threadRef, snapshot => {
    const data = snapshot.data();
    if (!data) return;
    const participants = Array.isArray(data.participants)
      ? data.participants.filter((value): value is string => typeof value === 'string')
      : [];
    if (!participants.includes(me)) return;
    const otherId = participants.find(value => value !== me);
    const typingAtMillis = otherId ? timestampMap(data.typingBy)[otherId] : undefined;
    const otherReadAtMillis = otherId ? timestampMap(data.readAtBy)[otherId] : undefined;
    onState({
      threadId,
      ...(typingAtMillis ? { typingAtMillis } : {}),
      ...(otherReadAtMillis ? { otherReadAtMillis } : {}),
    });
    const updatedAtMillis = millis(data.updatedAt);
    const ownReadAtMillis = timestampMap(data.readAtBy)[me] ?? 0;
    if (data.lastSenderId !== me && updatedAtMillis > ownReadAtMillis) {
      void markDMThreadRead(threadId).catch(error => onError?.(error));
    }
  }, error => onError?.(error));
  return () => {
    stopMessages();
    stopState();
    if (openThreadId === threadId) openThreadId = null;
  };
}

export async function closeDMThread(threadId?: string): Promise<void> {
  const me = auth.currentUser?.uid;
  const closing = threadId ?? openThreadId;
  if (me && closing) {
    await setDoc(doc(db, 'dmThreads', closing), {
      typingBy: { [me]: deleteField() },
    }, { merge: true }).catch(() => {});
  }
  if (!threadId || openThreadId === threadId) openThreadId = null;
}

export async function setDMTyping(threadId: string, typing: boolean): Promise<void> {
  const me = signedInUid();
  if (!threadId || threadId !== openThreadId) return;
  await setDoc(doc(db, 'dmThreads', threadId), {
    typingBy: { [me]: typing ? serverTimestamp() : deleteField() },
  }, { merge: true });
}

export async function hideDMThread(threadId: string): Promise<void> {
  const me = signedInUid();
  if (!threadId || threadId.length > 200) throw new Error('Invalid conversation.');
  await setDoc(doc(db, 'dmThreads', threadId), {
    hiddenAtBy: { [me]: serverTimestamp() },
    unreadBy: { [me]: 0 },
  }, { merge: true });
  if (openThreadId === threadId) await closeDMThread(threadId);
}

export async function sendDM(
  otherId: string | undefined,
  text: string | undefined,
  clientMessageId: string | undefined,
): Promise<void> {
  const me = signedInUid();
  const other = otherId?.trim() ?? '';
  const messageText = text?.trim() ?? '';
  const messageId = clientMessageId?.trim() ?? '';
  if (!other || other === me || !messageText || messageText.length > 2_000
    || !validClientMessageId(messageId)) throw new Error('Invalid message.');
  const threadId = canonicalDMThreadId(me, other);
  const threadRef = doc(db, 'dmThreads', threadId);
  const messageRef = doc(threadRef, 'messages', messageId);
  const batch = writeBatch(db);
  const myName = signedInDisplayName();
  batch.set(threadRef, {
    participants: [me, other].sort(),
    lastMessage: messageText,
    lastSenderId: me,
    updatedAt: serverTimestamp(),
    unreadBy: { [me]: 0, [other]: increment(1) },
    // Name only ourselves. The roster is fixed by the rules, and claiming a
    // name for the other participant would let a sender relabel them.
    ...(myName ? { participantNames: { [me]: myName } } : {}),
  }, { merge: true });
  batch.set(messageRef, {
    senderId: me,
    clientMessageId: messageId,
    text: messageText,
    kind: 'text',
    createdAt: serverTimestamp(),
  });
  await commitDMIfNew(async () => (await getDoc(messageRef)).exists(), () => batch.commit());
}

async function markDMThreadRead(threadId: string): Promise<void> {
  const me = signedInUid();
  if (threadId !== openThreadId) return;
  await setDoc(doc(db, 'dmThreads', threadId), {
    readAtBy: { [me]: serverTimestamp() },
    unreadBy: { [me]: 0 },
  }, { merge: true });
}
