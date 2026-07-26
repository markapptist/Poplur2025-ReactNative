import { signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import { auth, db } from './firebase';

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /.+@.+\..+/.test(value.trim());
}

export async function ensureUsernameIsAvailable(username: string, uid?: string): Promise<string> {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error('Enter a username.');

  const usernameSnap = await getDoc(doc(db, 'usernames', normalized));
  if (usernameSnap.exists() && usernameSnap.data().uid !== uid) {
    throw new Error('That username is already taken.');
  }

  const existing = await getDocs(query(collection(db, 'users'), where('usernameNormalized', '==', normalized), limit(1)));
  const takenByOtherUser = existing.docs.find(userDoc => userDoc.id !== uid);
  if (takenByOtherUser) throw new Error('That username is already taken.');

  return normalized;
}

export async function writeUsernameIndex(uid: string, username: string, email: string): Promise<string> {
  const normalized = await ensureUsernameIsAvailable(username, uid);
  await setDoc(doc(db, 'usernames', normalized), {
    uid,
    username: username.trim().replace(/^@+/, ''),
    email: normalizeEmail(email),
    updatedAt: Date.now()
  }, { merge: true });
  return normalized;
}

export async function resolveLoginIdentifier(identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (!trimmed) throw new Error('Enter your username or email.');
  if (isEmail(trimmed)) return normalizeEmail(trimmed);

  const normalized = normalizeUsername(trimmed);
  const usernameSnap = await getDoc(doc(db, 'usernames', normalized));
  if (usernameSnap.exists()) {
    const email = usernameSnap.data().email;
    if (typeof email === 'string' && email) return email;
  }

  const normalizedMatches = await getDocs(query(collection(db, 'users'), where('usernameNormalized', '==', normalized), limit(1)));
  const normalizedMatch = normalizedMatches.docs[0]?.data();
  if (typeof normalizedMatch?.email === 'string' && normalizedMatch.email) return normalizedMatch.email;

  const displayMatches = await getDocs(query(collection(db, 'users'), where('username', '==', trimmed.replace(/^@+/, '')), limit(1)));
  const displayMatch = displayMatches.docs[0]?.data();
  if (typeof displayMatch?.email === 'string' && displayMatch.email) return displayMatch.email;

  throw new Error('No Poplur account found for that username.');
}

export async function signInWithUsernameOrEmail(identifier: string, password: string) {
  const email = await resolveLoginIdentifier(identifier);
  return signInWithEmailAndPassword(auth, email, password);
}

export async function saveUserProfile(uid: string, username: string, email: string, extra: Record<string, unknown> = {}) {
  const cleanUsername = username.trim().replace(/^@+/, '') || normalizeEmail(email).split('@')[0];
  const usernameNormalized = await writeUsernameIndex(uid, cleanUsername, email);
  await setDoc(doc(db, 'users', uid), {
    uid,
    username: cleanUsername,
    usernameNormalized,
    email: normalizeEmail(email),
    ...extra
  }, { merge: true });
  if (auth.currentUser?.uid === uid) {
    await updateProfile(auth.currentUser, { displayName: cleanUsername });
  }
}
