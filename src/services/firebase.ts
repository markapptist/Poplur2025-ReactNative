import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Converted from the uploaded iOS GoogleService-Info.plist.
// Add your Web App measurementId/appId here if you create a Firebase Web app later.
const firebaseConfig = {
  apiKey: 'AIzaSyC_b3-zHngzP-MKa1Cx5yclbV_6DlvGe_w',
  authDomain: 'poplur2025.firebaseapp.com',
  projectId: 'poplur2025',
  storageBucket: 'poplur2025.firebasestorage.app',
  messagingSenderId: '440480901104',
  appId: '1:440480901104:web:replace-with-web-app-id'
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
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
