import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../services/firebase';
import { GradientBackground } from '../components/GradientBackground';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    try { setLoading(true); await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch (e: any) { Alert.alert('Login failed', e.message); }
    finally { setLoading(false); }
  }

  return <GradientBackground style={styles.container}><GlassCard>
    <Text style={styles.title}>Welcome back</Text>
    <TextInput placeholder="Email" placeholderTextColor="#9ca3af" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
    <TextInput placeholder="Password" placeholderTextColor="#9ca3af" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
    <PrimaryButton title="Log in" onPress={login} loading={loading} />
  </GlassCard></GradientBackground>;
}

const styles = StyleSheet.create({ container: { padding: 24, justifyContent: 'center' }, title: { color: 'white', fontSize: 30, fontWeight: '900', marginBottom: 16 }, input: { color: 'white', borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.22)' } });
