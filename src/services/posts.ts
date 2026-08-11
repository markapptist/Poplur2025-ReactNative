import { addDoc, collection, doc, getDocs, increment, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import type { Post } from '../types/models';
import { poplurAssetCache } from '../performance/PoplurAssetCache';
import { verifiedMediaSize } from './mediaResources';

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
  sizeBytes?: number;
  onProgress?: (progress: number) => void;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in before posting.');

  const isVideo = params.mediaType.includes('video');
  const encodedBytes = await verifiedMediaSize(
    params.uri,
    isVideo ? 'video' : 'photo',
    params.sizeBytes,
  );
  const uploadCacheKey = `temporary:post-upload:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let blob: Blob | null = null;
  let task: ReturnType<typeof uploadBytesResumable> | null = null;
  let revoked = false;
  const closeBlob = () => {
    const closable = blob as (Blob & { close?: () => void }) | null;
    closable?.close?.();
    blob = null;
  };
  const admission = poplurAssetCache.admit({
    key: uploadCacheKey,
    kind: 'temporary',
    value: params.uri,
    estimatedBytes: encodedBytes,
    dispose: () => {
      revoked = true;
      task?.cancel();
      closeBlob();
    },
  });
  if (!admission.admitted) {
    throw new Error(`This media exceeds Poplur's active upload budget (${admission.reason}).`);
  }
  const lease = poplurAssetCache.retain<string>(uploadCacheKey);
  if (!lease) {
    poplurAssetCache.delete(uploadCacheKey, true);
    throw new Error('Poplur could not reserve a bounded upload buffer.');
  }

  let mediaURL: string;
  try {
    const response = await fetch(params.uri);
    if (!response.ok && response.status !== 0) {
      throw new Error(`The selected media could not be read (${response.status}).`);
    }
    if (revoked) throw new Error('The upload was stopped to release resources.');
    blob = await response.blob();
    if (blob.size <= 0 || blob.size > encodedBytes) {
      throw new Error('The selected media size changed while Poplur was preparing it.');
    }
    if (revoked) throw new Error('The upload was stopped to release resources.');

    const extension = isVideo ? 'mp4' : 'jpg';
    const storagePath = `posts/${user.uid}/${Date.now()}.${extension}`;
    const storageRef = ref(storage, storagePath);
    task = uploadBytesResumable(storageRef, blob);
    mediaURL = await new Promise<string>((resolve, reject) => {
      task!.on('state_changed', snapshot => {
        params.onProgress?.(snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1));
      }, reject, () => {
        void getDownloadURL(task!.snapshot.ref).then(resolve, reject);
      });
    });
  } finally {
    lease.release();
    poplurAssetCache.delete(uploadCacheKey, true);
    // The cache may have force-evicted the lease before blob() resolved. Close
    // again here so that late materialization cannot wait for GC to release it.
    closeBlob();
  }

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
