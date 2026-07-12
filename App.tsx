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
import { FeedScreen } from './src/screens/FeedScreen';
import { MapScreen } from './src/screens/MapScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { PoplurCube } from './src/components/PoplurCube';
import type { AppTab } from './src/types/models';

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

  if (user === undefined || !isSplashMinimumElapsed) return <SplashScreen />;

  return <SafeAreaProvider><NavigationContainer><StatusBar style="light" />{user ? <MainApp /> : <AuthStack authError={authError} />}</NavigationContainer></SafeAreaProvider>;
}

function AuthStack({ authError }: { authError: string | null }) {
  return <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#050713' } }}>
    <Stack.Screen name="Welcome">{props => <WelcomeScreen {...props} authError={authError} />}</Stack.Screen>
    <Stack.Screen name="Login" component={LoginScreen} />
    <Stack.Screen name="SignUp" component={SignUpScreen} />
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
  cubeLayer: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 230, alignItems: 'center', justifyContent: 'center', pointerEvents: 'box-none' }
});
