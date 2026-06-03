import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile } from '../types/models';

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const profile = {
      uid: user.uid,
      username: user.displayName ?? user.email?.split('@')[0] ?? 'Poplur user',
      email: user.email ?? '',
      photoURL: user.photoURL ?? undefined,
      bio: ''
    };
    await setDoc(ref, profile, { merge: true });
    return profile;
  }
  const data = snap.data();
  return {
    uid: user.uid,
    username: data.username ?? user.displayName ?? 'Poplur user',
    email: data.email ?? user.email ?? '',
    photoURL: data.photoURL,
    bio: data.bio ?? ''
  };
}

export async function updateCurrentProfile(updates: Partial<UserProfile>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  await updateDoc(doc(db, 'users', user.uid), updates);
}
