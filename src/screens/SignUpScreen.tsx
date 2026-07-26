import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { saveUserProfile } from '../services/auth';
import { auth } from '../services/firebase';
import { GradientBackground } from '../components/GradientBackground';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';

export function SignUpScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signUp() {
    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await saveUserProfile(cred.user.uid, username, email, { bio: '', createdAt: Date.now() });
    } catch (e: any) { Alert.alert('Signup failed', e.message); }
    finally { setLoading(false); }
  }

  return <GradientBackground style={styles.container}><GlassCard>
    <Text style={styles.title}>Create your Poplur</Text>
    <TextInput placeholder="Username" placeholderTextColor="#9ca3af" value={username} onChangeText={setUsername} style={styles.input} />
    <TextInput placeholder="Email" placeholderTextColor="#9ca3af" autoCapitalize="none" value={email} onChangeText={setEmail} style={styles.input} />
    <TextInput placeholder="Password" placeholderTextColor="#9ca3af" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
    <PrimaryButton title="Sign up" onPress={signUp} loading={loading} />
  </GlassCard></GradientBackground>;
}

const styles = StyleSheet.create({ container: { padding: 24, justifyContent: 'center' }, title: { color: 'white', fontSize: 30, fontWeight: '900', marginBottom: 16 }, input: { color: 'white', borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.22)' } });
