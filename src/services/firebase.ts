import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ISOLATED_SYNTHETIC_ONBOARDING,
  resolveSyntheticOnboardingMode,
} from './syntheticOnboarding';

const syntheticOnboardingEmulators =
  resolveSyntheticOnboardingMode() === ISOLATED_SYNTHETIC_ONBOARDING;

// Converted from the uploaded iOS GoogleService-Info.plist. The isolated
// browser journey gets a separate demo identity as well as loopback transports,
// so its data cannot be mistaken for production data.
const productionFirebaseConfig = {
  apiKey: 'AIzaSyC_b3-zHngzP-MKa1Cx5yclbV_6DlvGe_w',
  authDomain: 'poplur2025.firebaseapp.com',
  projectId: 'poplur2025',
  storageBucket: 'poplur2025.firebasestorage.app',
  messagingSenderId: '440480901104',
  // There is no separately registered Firebase Web client. The RN bridge uses
  // the existing Poplur iOS app identity so Firebase services target the same
  // project instead of failing initialization on a placeholder app id.
  appId: '1:440480901104:ios:fb94ca04e37cd1d68c1f35'
};
const firebaseConfig = syntheticOnboardingEmulators ? {
  ...productionFirebaseConfig,
  authDomain: 'demo-poplur-first-user-v1.firebaseapp.com',
  projectId: 'demo-poplur-first-user-v1',
  storageBucket: 'demo-poplur-first-user-v1.appspot.com',
} : productionFirebaseConfig;

export const firebaseApp = syntheticOnboardingEmulators
  ? getApps().find(app => app.name === 'poplur-first-user-emulator')
    ?? initializeApp(firebaseConfig, 'poplur-first-user-emulator')
  : getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = (() => {
  try {
    const authModule = require('firebase/auth') as typeof import('firebase/auth') & {
      getReactNativePersistence?: (storage: typeof AsyncStorage) => unknown;
    };
    const persistence = authModule.getReactNativePersistence?.(AsyncStorage);
    return persistence ? initializeAuth(firebaseApp, { persistence: persistence as any }) : getAuth(firebaseApp);
  } catch {
    return getAuth(firebaseApp);
  }
})();
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
// verifyCardPurchase (Poplur Cards store) is deployed only in us-central1.
export const functions = getFunctions(firebaseApp, 'us-central1');

// Connect every mutable service before a screen can use it. The exact-host
// route gate above is intentionally repeated here so production initialization
// and all non-loopback previews retain their existing Firebase configuration.
if (syntheticOnboardingEmulators) {
  const root = globalThis as typeof globalThis & { __poplurFirstUserEmulatorsConnected?: boolean };
  if (!root.__poplurFirstUserEmulatorsConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    root.__poplurFirstUserEmulatorsConnected = true;
  }
}
