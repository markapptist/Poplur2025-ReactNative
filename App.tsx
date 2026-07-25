import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, User } from 'firebase/auth';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { auth } from './src/services/firebase';
import { SplashScreen } from './src/screens/SplashScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { PreloginWebScreen } from './src/screens/PreloginWebScreen';
import { PostLoginHomeWebScreen } from './src/screens/PostLoginHomeWebScreen';

// Post-login web-embed (parity with iOS/Android): render the approved web home
// rather than the divergent native RN tabs. Reversible.
const USE_WEB_HOME = true;
import { FeedScreen } from './src/screens/FeedScreen';
import { MapScreen } from './src/screens/MapScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { PoplurCube } from './src/components/PoplurCube';
import type { AppTab } from './src/types/models';

// Web-only: the app's screens are designed for a phone's portrait aspect ratio,
// so a wide desktop window collapses their vertical layout (text overlaps
// buttons). Present the app in a centered, phone-width frame that scales with
// the window — responsive down to mobile widths, framed on large screens.
// Native (iOS/Android) never runs this.
if (typeof document !== 'undefined') {
  const STYLE_ID = 'poplur-web-frame';
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    // Fill the whole browser window edge-to-edge and re-fit on resize.
    el.textContent =
      'html,body{height:100%;margin:0;overflow:hidden;background:#050713}' +
      '#root{width:100vw;height:100vh;overflow:hidden}';
    document.head.appendChild(el);
  }
}

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSplashMinimumElapsed, setIsSplashMinimumElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsSplashMinimumElapsed(true), 3500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Fall back to logged-out after 4 s so a slow/offline Firebase never
    // leaves the app pinned on the loading screen.
    const timeout = setTimeout(() => setUser(null), 4000);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthStateChanged(auth, user => {
        clearTimeout(timeout);
        setUser(user);
      }, error => {
        clearTimeout(timeout);
        setAuthError(error.message);
        setUser(null);
      });
    } catch (error: any) {
      clearTimeout(timeout);
      setAuthError(error.message);
      setUser(null);
    }
    return () => { clearTimeout(timeout); unsubscribe?.(); };
  }, []);

  if (user === undefined) return <SplashScreen />;

  // Post-login parity with iOS/Android Phase 3: signed-in users get the approved
  // web home (clay-map ViewHarness ?view=home) instead of the native RN remake.
  // Flip USE_WEB_HOME to false to restore the native MainApp tabs.
  return <SafeAreaProvider><NavigationContainer documentTitle={{ formatter: () => 'Poplur' }}><StatusBar style="light" />{user ? (USE_WEB_HOME ? <PostLoginHomeWebScreen /> : <MainApp />) : <AuthStack authError={authError} />}</NavigationContainer></SafeAreaProvider>;
}

function AuthStack({ authError }: { authError: string | null }) {
  return <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#050713' } }}>
    {/* iOS physical is the source baseline: render the same approved GCL web
        bundle on RN rather than maintaining a divergent native remake. */}
    <Stack.Screen name="Prelogin">
      {() => <PreloginWebScreen />}
    </Stack.Screen>
  </Stack.Navigator>;
}

function MainApp() {
  const [tab, setTab] = useState<AppTab>('feed');
  return <View style={styles.main}>
    {tab === 'feed' && <FeedScreen />}
    {tab === 'map' && <MapScreen />}
    {tab === 'record' && <CameraScreen />}
    {tab === 'profile' && <ProfileScreen />}
    {tab === 'settings' && <SettingsScreen />}
    <View style={styles.cubeLayer}><PoplurCube activeTab={tab} onTabChange={setTab} /></View>
  </View>;
}

const styles = StyleSheet.create({
  main: { flex: 1, backgroundColor: '#050713' },
  cubeLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 230,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
    zIndex: 1000,
    elevation: 1000
  }
});
