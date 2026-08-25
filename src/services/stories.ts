import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';

const allowedReactions = new Set(['♥', '🔥', '😂', '👏']);

function boundedId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[!-~]+$/.test(value)
    && !value.includes('/')
    && !value.includes('\\')
    ? value
    : null;
}

function millis(data: Record<string, any>, key: string): number {
  const direct = Number(data[key]);
  if (Number.isFinite(direct)) return direct;
  const date = data[key]?.toDate?.();
  return date instanceof Date ? date.getTime() : 0;
}

export async function fetchStories(): Promise<Record<string, unknown>[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const now = new Date();
  const [publicSnapshot, favoriteSnapshot, ownSnapshot] = await Promise.all([
    getDocs(query(
      collection(db, 'stories'),
      where('audience', '==', 'public'),
      where('expiresAt', '>', now),
      orderBy('expiresAt', 'desc'),
      limit(48),
    )),
    getDocs(query(
      collection(db, 'stories'),
      where('audienceUserIds', 'array-contains', uid),
      where('expiresAt', '>', now),
      orderBy('expiresAt', 'desc'),
      limit(48),
    )),
    getDocs(query(
      collection(db, 'stories'),
      where('ownerID', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(64),
    )),
  ]);
  const documents = new Map(
    [...publicSnapshot.docs, ...favoriteSnapshot.docs, ...ownSnapshot.docs]
      .map(document => [document.id, document] as const),
  );
  return [...documents.values()].flatMap(document => {
    const data = document.data();
    const ownerId = typeof data.ownerID === 'string' ? data.ownerID : '';
    const mediaURL = typeof data.mediaURL === 'string' ? data.mediaURL : '';
    if (!ownerId || !mediaURL) return [];
    return [{
      id: document.id,
      ownerId,
      username: typeof data.username === 'string' ? data.username : 'Poplur user',
      mediaURL,
      mediaType: data.mediaType === 'video' ? 'video' : 'photo',
      ...(typeof data.posterURL === 'string' ? { posterURL: data.posterURL } : {}),
      ...(typeof data.caption === 'string' ? { caption: data.caption } : {}),
      createdAtMillis: millis(data, 'createdAtMillis'),
      expiresAtMillis: millis(data, 'expiresAtMillis'),
      audience: data.audience === 'favorites' ? 'favorites' : 'public',
      isOwner: ownerId === uid,
      highlighted: data.highlighted === true,
      repliesAllowed: data.repliesAllowed !== false,
      mentions: Array.isArray(data.mentions) ? data.mentions : [],
      ...(typeof data.sticker === 'string' ? { sticker: data.sticker } : {}),
      ...(data.music && typeof data.music === 'object' ? { music: data.music } : {}),
      ...(data.poll && typeof data.poll === 'object' ? { poll: data.poll } : {}),
    }];
  }).sort((a, b) => Number(b.createdAtMillis) - Number(a.createdAtMillis));
}

export async function reactToStory(storyIdValue: unknown, reaction: unknown): Promise<void> {
  const uid = auth.currentUser?.uid;
  const storyId = boundedId(storyIdValue);
  if (!uid || !storyId || typeof reaction !== 'string' || !allowedReactions.has(reaction)) return;
  const story = doc(db, 'stories', storyId);
  if (!(await getDoc(story)).exists()) return;
  await setDoc(doc(db, 'stories', storyId, 'reactions', uid), {
    actorId: uid,
    reaction,
    updatedAt: serverTimestamp(),
  });
}

export async function voteOnStory(storyIdValue: unknown, value: unknown): Promise<void> {
  const uid = auth.currentUser?.uid;
  const storyId = boundedId(storyIdValue);
  const optionIndex = Number(value);
  if (!uid || !storyId || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) return;
  const story = doc(db, 'stories', storyId);
  const snapshot = await getDoc(story);
  const options = snapshot.data()?.poll?.options;
  if (!Array.isArray(options) || optionIndex >= options.length) return;
  await setDoc(doc(db, 'stories', storyId, 'votes', uid), {
    actorId: uid,
    optionIndex,
    updatedAt: serverTimestamp(),
  });
}

export async function replyToStory(
  storyIdValue: unknown,
  ownerIdValue: unknown,
  textValue: unknown,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  const storyId = boundedId(storyIdValue);
  const ownerId = boundedId(ownerIdValue);
  const text = typeof textValue === 'string' ? textValue.trim().slice(0, 500) : '';
  if (!uid || !storyId || !ownerId || ownerId === uid || !text) return;
  const story = await getDoc(doc(db, 'stories', storyId));
  if (story.data()?.ownerID !== ownerId || story.data()?.repliesAllowed === false) return;

  const participants = [uid, ownerId].sort();
  const threadId = `${participants[0]}_${participants[1]}`;
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
  const preview = `Replied to your Story: ${text}`;
  const thread = doc(db, 'dmThreads', threadId);
  const batch = writeBatch(db);
  batch.set(thread, {
    participants,
    lastMessage: preview,
    lastSenderId: uid,
    updatedAt: serverTimestamp(),
    unreadBy: { [uid]: 0, [ownerId]: increment(1) },
  }, { merge: true });
  batch.set(doc(db, 'dmThreads', threadId, 'messages', messageId), {
    senderId: uid,
    clientMessageId: messageId,
    text: preview,
    kind: 'text',
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function setStoryHighlighted(storyIdValue: unknown, highlighted: unknown): Promise<void> {
  const uid = auth.currentUser?.uid;
  const storyId = boundedId(storyIdValue);
  if (!uid || !storyId || typeof highlighted !== 'boolean') return;
  const story = doc(db, 'stories', storyId);
  if ((await getDoc(story)).data()?.ownerID !== uid) return;
  await updateDoc(story, { highlighted });
}
