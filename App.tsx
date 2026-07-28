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
import {
  markScreenNavigation,
  PerformanceMonitor,
  ProfiledScreen,
} from './src/performance/ScreenProfiler';

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
  // A signed-out launch already owns the custom permission sequence in the
  // approved pre-login surface. Keep that fact in memory for this app launch
  // so the immediate auth handoff does not show the same primers again in
  // Home. A returning persisted session never mounts pre-login, so this stays
  // false and Home checks the real OS statuses before choosing what to ask.
  const [preloginPermissionsHandled, setPreloginPermissionsHandled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsSplashMinimumElapsed(true), 3500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Fall back to logged-out after 4 s so a slow/offline Firebase never
    // leaves the app pinned on the loading screen.
    const timeout = setTimeout(() => {
      markScreenNavigation('PreloginWebScreen');
      setPreloginPermissionsHandled(false);
      setUser(null);
    }, 4000);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthStateChanged(auth, user => {
        clearTimeout(timeout);
        markScreenNavigation(user ? 'PostLoginHomeWebScreen' : 'PreloginWebScreen');
        if (!user) setPreloginPermissionsHandled(false);
        setUser(user);
      }, error => {
        clearTimeout(timeout);
        markScreenNavigation('PreloginWebScreen');
        setAuthError(error.message);
        setPreloginPermissionsHandled(false);
        setUser(null);
      });
    } catch (error: any) {
      clearTimeout(timeout);
      markScreenNavigation('PreloginWebScreen');
      setAuthError(error.message);
      setPreloginPermissionsHandled(false);
      setUser(null);
    }
    return () => { clearTimeout(timeout); unsubscribe?.(); };
  }, []);

  // DEV bypass (dev builds only): ?devAuth=1 skips the Firebase auth gate and
  // lands in the *current* post-login home (the approved clay web home, same as
  // a real signed-in user) for building sub-screens. Append &native=1 to see the
  // deprecated native MainApp tabs instead. Inert without the flag, and dead in
  // production builds since __DEV__ is false there — nothing to revert.
  if (__DEV__ && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('devAuth') === '1') {
    const wantNative = new URLSearchParams(window.location.search).get('native') === '1';
    return <SafeAreaProvider><PerformanceMonitor /><NavigationContainer documentTitle={{ formatter: () => 'Poplur' }}><StatusBar style="light" />{wantNative ? <MainApp /> : <ProfiledScreen name="PostLoginHomeWebScreen"><PostLoginHomeWebScreen forcePermissionPrimer /></ProfiledScreen>}</NavigationContainer></SafeAreaProvider>;
  }

  if (user === undefined) {
    return <SafeAreaProvider><PerformanceMonitor /><ProfiledScreen name="SplashScreen"><SplashScreen /></ProfiledScreen></SafeAreaProvider>;
  }

  // Post-login parity with iOS/Android Phase 3: signed-in users get the approved
  // web home (clay-map ViewHarness ?view=home) instead of the native RN remake.
  // Flip USE_WEB_HOME to false to restore the native MainApp tabs.
  return <SafeAreaProvider><PerformanceMonitor /><NavigationContainer documentTitle={{ formatter: () => 'Poplur' }}><StatusBar style="light" />{user ? (USE_WEB_HOME ? <ProfiledScreen name="PostLoginHomeWebScreen"><PostLoginHomeWebScreen skipPermissionPrimer={preloginPermissionsHandled} /></ProfiledScreen> : <MainApp />) : <AuthStack authError={authError} onPermissionSequenceHandled={() => setPreloginPermissionsHandled(true)} />}</NavigationContainer></SafeAreaProvider>;
}

function AuthStack({ authError, onPermissionSequenceHandled }: {
  authError: string | null;
  onPermissionSequenceHandled: () => void;
}) {
  return <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#050713' } }}>
    {/* iOS physical is the source baseline: render the same approved GCL web
        bundle on RN rather than maintaining a divergent native remake. */}
    <Stack.Screen name="Prelogin">
      {() => <ProfiledScreen name="PreloginWebScreen"><PreloginWebScreen onPermissionSequenceHandled={onPermissionSequenceHandled} /></ProfiledScreen>}
    </Stack.Screen>
  </Stack.Navigator>;
}

function MainApp() {
  const [tab, setTab] = useState<AppTab>('feed');
  const selectTab = (nextTab: AppTab) => {
    const profilerNames: Record<AppTab, string> = {
      feed: 'FeedScreen',
      map: 'MapScreen',
      record: 'CameraScreen',
      profile: 'ProfileScreen',
      settings: 'SettingsScreen',
    };
    markScreenNavigation(profilerNames[nextTab]);
    setTab(nextTab);
  };
  return <View style={styles.main}>
    {tab === 'feed' && <ProfiledScreen name="FeedScreen"><FeedScreen /></ProfiledScreen>}
    {tab === 'map' && <ProfiledScreen name="MapScreen"><MapScreen /></ProfiledScreen>}
    {tab === 'record' && <ProfiledScreen name="CameraScreen"><CameraScreen /></ProfiledScreen>}
    {tab === 'profile' && <ProfiledScreen name="ProfileScreen"><ProfileScreen /></ProfiledScreen>}
    {tab === 'settings' && <ProfiledScreen name="SettingsScreen"><SettingsScreen /></ProfiledScreen>}
    <View style={styles.cubeLayer}><PoplurCube activeTab={tab} onTabChange={selectTab} /></View>
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
