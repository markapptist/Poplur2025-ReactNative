import { collection, doc, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import type { Post } from '../types/models';
import { poplurAssetCache } from '../performance/PoplurAssetCache';
import { verifiedMediaSize } from './mediaResources';
import {
  ISOLATED_SYNTHETIC_ONBOARDING,
  resolveSyntheticOnboardingMode,
  syntheticOnboardingMetadata,
} from './syntheticOnboarding';

const postsCollection = collection(db, 'posts');

/**
 * The reach a post is granted at birth so it can be found before it has earned
 * anything. It is capped at the same 5 km the security rules allow a post to be
 * created with, and it never counts toward the author's entitlement.
 */
export const POST_DISCOVERY_SEED_METERS = 5000;

function syntheticOnboardingContext() {
  const mode = resolveSyntheticOnboardingMode();
  const metadata = syntheticOnboardingMetadata(mode);
  return mode && metadata ? { mode, metadata } : null;
}

type FirestoreRestValue = {
  stringValue?: string;
  doubleValue?: number;
  integerValue?: string;
};

type FirestoreRestDocument = {
  fields?: Record<string, FirestoreRestValue>;
};

function restString(document: FirestoreRestDocument, key: string): string {
  return document.fields?.[key]?.stringValue ?? '';
}

function restNumber(document: FirestoreRestDocument, key: string): number {
  const value = document.fields?.[key];
  return Number(value?.doubleValue ?? value?.integerValue ?? Number.NaN);
}

/**
 * Playwright's fail-closed network interception can keep Firestore's streaming
 * WebChannel response open after the emulator has already committed the write.
 * This exact-loopback, synthetic-only proof prevents that transport quirk from
 * stranding the visible app while still requiring both committed documents
 * before the UI receives success. Production never enters this route.
 */
async function waitForSyntheticPostCommit(uid: string, postId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('The isolated post lost its bound account.');
  const token = await user.getIdToken();
  const base = 'http://127.0.0.1:8080/v1/projects/demo-poplur-first-user-v1/databases/(default)/documents';
  const postURL = `${base}/posts/${encodeURIComponent(postId)}`;
  const locationURL = `${base}/users/${encodeURIComponent(uid)}/postLocations/${encodeURIComponent(postId)}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [postResponse, locationResponse] = await Promise.all([
      fetch(postURL, { headers: { authorization: `Bearer ${token}` } }),
      fetch(locationURL, { headers: { authorization: `Bearer ${token}` } }),
    ]);
    if (postResponse.ok && locationResponse.ok) {
      const [post, location] = await Promise.all([
        postResponse.json() as Promise<FirestoreRestDocument>,
        locationResponse.json() as Promise<FirestoreRestDocument>,
      ]);
      if (restString(post, 'userID') === uid
        && restString(post, 'syntheticActorId') === 'sim-onboarding-first'
        && restString(post, 'syntheticJourney') === 'first-user-v1'
        && restString(post, 'syntheticSource') === 'visible-app-ui'
        && restString(location, 'source') === 'post-upload'
        && Math.abs(restNumber(location, 'latitude') - 43.6532) <= 0.000001
        && Math.abs(restNumber(location, 'longitude') - (-79.3832)) <= 0.000001) {
        return;
      }
      throw new Error('The isolated emulator returned a mismatched committed post.');
    }
    if (![200, 404].includes(postResponse.status)
      || ![200, 404].includes(locationResponse.status)) {
      throw new Error('The isolated committed post could not be verified.');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The isolated committed post did not become visible in time.');
}

export async function fetchRecentPosts(max = 40): Promise<Post[]> {
  const snap = await getDocs(query(postsCollection, orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(toPost);
}

export async function fetchMyPosts(uid: string): Promise<Post[]> {
  // Keep the profile working without a composite userID+createdAt index and
  // bound retained metadata on long-lived accounts. Native shells use the same
  // 64-post window and sort the small page locally.
  const snap = await getDocs(query(postsCollection, where('userID', '==', uid), limit(64)));
  return snap.docs
    .map(toPost)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
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
  postId?: string;
  targetLatitude?: number;
  targetLongitude?: number;
  locationVisibility?: 'approximate' | 'hidden';
  caption?: string;
  channelId?: string;
  filterId?: string;
  usedAI?: boolean;
  radiusMeters?: number;
  rightsAttestationVersion?: string;
  /** The poster's chosen clay pin model colour; absent keeps the pink pin. */
  pinColor?: 'red' | 'purple' | 'blue' | 'green' | 'orange';
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
  let uploadedStoragePath: string | null = null;
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
    const stableBasename = typeof params.postId === 'string'
      && /^post-[a-zA-Z0-9-]{16,96}$/.test(params.postId)
      ? params.postId
      : `${Date.now()}`;
    const storagePath = `posts/${user.uid}/${stableBasename}.${extension}`;
    uploadedStoragePath = storagePath;
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

  const nowMillis = Date.now();
  const syntheticContext = syntheticOnboardingContext();
  // Every post is born with a discovery seed, because a pop nobody can see can
  // never earn the reach that would let it be seen. The seed is reach only: it
  // is recorded separately and the account total that grants a claim is summed
  // from earned radius alone, so publishing more posts never buys more ground.
  const seedMeters = POST_DISCOVERY_SEED_METERS;
  const requestedMeters = Math.max(0, Math.round(params.radiusMeters ?? 0));
  const data: Record<string, unknown> = {
    userID: user.uid,
    username: user.displayName ?? user.email ?? 'Poplur user',
    mediaURL,
    mediaType: params.mediaType,
    viewCount: 0,
    radius: Math.max(requestedMeters, seedMeters),
    seedRadiusMeters: seedMeters,
    organicRadiusMeters: 0,
    createdAt: serverTimestamp(),
    createdAtMillis: nowMillis,
    ...(syntheticContext?.metadata ?? {}),
  };
  if (uploadedStoragePath) data.mediaStoragePath = uploadedStoragePath;

  const boundedPostId = typeof params.postId === 'string'
    && /^post-[a-zA-Z0-9-]{16,96}$/.test(params.postId)
    ? params.postId
    : null;

  const hasTarget = Number.isFinite(params.targetLatitude)
    && Number.isFinite(params.targetLongitude)
    && Math.abs(params.targetLatitude!) <= 90
    && Math.abs(params.targetLongitude!) <= 180;
  const accountSnapshot = await getDoc(doc(db, 'users', user.uid));
  const account = accountSnapshot.data();
  const accountHidesOrigin = account?.privateAccount === true || account?.ghostMode === true;
  const locationVisibility = hasTarget && !accountHidesOrigin && params.locationVisibility !== 'hidden'
    ? 'approximate'
    : 'hidden';
  data.audience = 'public';
  data.locationVisibility = locationVisibility;
  if (locationVisibility === 'approximate') {
    const latitudeCell = Math.round(params.targetLatitude! * 1_000);
    const longitudeCell = Math.round(params.targetLongitude! * 1_000);
    data.latitude = latitudeCell / 1_000;
    data.longitude = longitudeCell / 1_000;
    data.latitudeCell = latitudeCell;
    data.longitudeCell = longitudeCell;
  }
  if (params.caption?.trim()) data.caption = params.caption.trim();
  if (params.channelId) data.channelId = params.channelId;
  if (params.filterId) data.filterId = params.filterId;
  if (params.pinColor) data.pinColor = params.pinColor;
  if (params.usedAI) data.usedAI = true;
  if (params.rightsAttestationVersion?.trim()) {
    data.rightsAttestationVersion = params.rightsAttestationVersion.trim().slice(0, 80);
    data.rightsAttestedAtMillis = nowMillis;
  }

  const postRef = boundedPostId ? doc(postsCollection, boundedPostId) : doc(postsCollection);
  const batch = writeBatch(db);
  batch.set(postRef, data);
  if (hasTarget) {
    batch.set(doc(db, 'users', user.uid, 'postLocations', postRef.id), {
      latitude: params.targetLatitude,
      longitude: params.targetLongitude,
      createdAt: serverTimestamp(),
      source: 'post-upload',
    }, { merge: true });
  }
  const commitOutcome = batch.commit().then(
    () => ({ ok: true as const }),
    error => ({ ok: false as const, error }),
  );
  const outcome = syntheticContext?.mode === ISOLATED_SYNTHETIC_ONBOARDING
    ? await Promise.race([
      commitOutcome,
      waitForSyntheticPostCommit(user.uid, postRef.id).then(() => ({ ok: true as const })),
    ])
    : await commitOutcome;
  if (!outcome.ok) throw outcome.error;
  return { mediaURL, postId: postRef.id };
}

function toPost(document: any): Post {
  const data = document.data();
  return {
    id: document.id,
    userID: data.userID ?? '',
    username: data.username,
    mediaURL: data.mediaURL ?? '',
    mediaType: data.mediaType ?? 'photo',
    posterURL: data.posterURL,
    caption: data.caption,
    channelId: data.channelId,
    latitude: numberOrUndefined(data.latitude),
    longitude: numberOrUndefined(data.longitude),
    radius: Number(data.radius ?? 5000),
    viewCount: Number(data.viewCount ?? 0),
    createdAtMillis: Number(data.createdAtMillis ?? data.createdAt?.toMillis?.() ?? 0),
    locationVisibility: data.locationVisibility === 'approximate' ? 'approximate' : 'hidden',
    syntheticJourney: data.syntheticJourney === 'first-user-v1'
      || data.syntheticJourney === 'first-user-shared-v1'
      ? data.syntheticJourney
      : undefined,
    createdAt: data.createdAt?.toDate?.() ?? null
  };
}

function numberOrUndefined(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
