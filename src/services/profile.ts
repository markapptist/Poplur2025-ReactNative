import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile } from '../types/models';
import { saveUserProfile } from './auth';

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const username = user.displayName ?? user.email?.split('@')[0] ?? 'Poplur user';
    const profile = {
      uid: user.uid,
      username,
      email: user.email ?? '',
      accountType: 'personal',
      photoURL: user.photoURL ?? undefined,
      bio: ''
    };
    await saveUserProfile(user.uid, username, user.email ?? '', {
      accountType: 'personal',
      photoURL: user.photoURL ?? undefined,
      bio: '',
      createdAt: Date.now()
    });
    return profile;
  }
  const data = snap.data();
  return {
    uid: user.uid,
    username: data.username ?? user.displayName ?? 'Poplur user',
    email: data.email ?? user.email ?? '',
    accountType: data.accountType === 'business' ? 'business' : 'personal',
    photoURL: data.photoURL,
    bio: data.bio ?? ''
  };
}

export async function updateCurrentProfile(updates: Partial<UserProfile>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (updates.username) {
    await saveUserProfile(user.uid, updates.username, user.email ?? '', updates);
    return;
  }
  await updateDoc(doc(db, 'users', user.uid), updates);
}
