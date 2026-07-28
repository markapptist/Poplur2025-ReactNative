import { addDoc, collection, doc, getDocs, increment, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import type { Post } from '../types/models';

const postsCollection = collection(db, 'posts');

export async function fetchRecentPosts(max = 40): Promise<Post[]> {
  const snap = await getDocs(query(postsCollection, orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(toPost);
}

export async function fetchMyPosts(uid: string): Promise<Post[]> {
  const snap = await getDocs(query(postsCollection, where('userID', '==', uid), orderBy('createdAt', 'desc')));
  return snap.docs.map(toPost);
}

export async function incrementPostView(post: Post) {
  await updateDoc(doc(db, 'posts', post.id), {
    viewCount: increment(1),
    radius: increment(100)
  });
}

export async function uploadPostMedia(params: {
  uri: string;
  mediaType: 'photo' | 'video' | 'photo_profile' | 'video_profile';
  latitude?: number;
  longitude?: number;
  caption?: string;
  channelId?: string;
  filterId?: string;
  usedAI?: boolean;
  radiusMeters?: number;
  onProgress?: (progress: number) => void;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in before posting.');

  const response = await fetch(params.uri);
  const blob = await response.blob();
  const extension = params.mediaType.includes('video') ? 'mp4' : 'jpg';
  const storagePath = `posts/${user.uid}/${Date.now()}.${extension}`;
  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, blob);

  const mediaURL = await new Promise<string>((resolve, reject) => {
    task.on('state_changed', snapshot => {
      params.onProgress?.(snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1));
    }, reject, async () => resolve(await getDownloadURL(task.snapshot.ref)));
  });

  const data: Record<string, unknown> = {
    userID: user.uid,
    username: user.displayName ?? user.email ?? 'Poplur user',
    mediaURL,
    mediaType: params.mediaType,
    viewCount: 0,
    radius: params.radiusMeters ?? 5000,
    createdAt: serverTimestamp()
  };

  if (params.latitude !== undefined && params.longitude !== undefined) {
    data.latitude = params.latitude;
    data.longitude = params.longitude;
  }
  if (params.caption?.trim()) data.caption = params.caption.trim();
  if (params.channelId) data.channelId = params.channelId;
  if (params.filterId) data.filterId = params.filterId;
  if (params.usedAI) data.usedAI = true;

  await addDoc(postsCollection, data);
  return mediaURL;
}

function toPost(document: any): Post {
  const data = document.data();
  return {
    id: document.id,
    userID: data.userID ?? '',
    username: data.username,
    mediaURL: data.mediaURL ?? '',
    mediaType: data.mediaType ?? 'photo',
    latitude: numberOrUndefined(data.latitude),
    longitude: numberOrUndefined(data.longitude),
    radius: Number(data.radius ?? 5000),
    viewCount: Number(data.viewCount ?? 0),
    createdAt: data.createdAt?.toDate?.() ?? null
  };
}

function numberOrUndefined(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
