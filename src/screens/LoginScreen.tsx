import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { signInWithUsernameOrEmail } from '../services/auth';

const scallops = Array.from({ length: 13 });

export function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    try {
      setLoading(true);
      await signInWithUsernameOrEmail(identifier, password);
    } catch (e: any) {
      Alert.alert('Login failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.ticket}>
          <PoplurMark />

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.fieldIcon}>@</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect={false}
                placeholder="Username or E-Mail"
                placeholderTextColor="rgba(255,255,255,0.34)"
                value={identifier}
                onChangeText={setIdentifier}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={26} color="#ffffff" style={styles.lockIcon} />
              <TextInput
                autoCapitalize="none"
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.34)"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Forgot password" style={styles.forgotButton}>
                <Text style={styles.forgotText}>FORGOT</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              disabled={loading}
              onPress={login}
              style={({ pressed }) => [styles.signInButton, pressed && styles.signInPressed, loading && styles.disabled]}
            >
              {loading ? <ActivityIndicator color="#060606" /> : <Text style={styles.signInText}>Sign In</Text>}
            </Pressable>
          </View>

          <View style={styles.scallopRow}>
            {scallops.map((_, index) => <View key={index} style={styles.scallop} />)}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PoplurMark() {
  return (
    <View style={styles.logoShadow}>
      <View style={styles.logoTile}>
        <View style={[styles.petal, styles.petalTopLeft]} />
        <View style={[styles.petal, styles.petalTopRight]} />
        <View style={[styles.petal, styles.petalBottomLeft]} />
        <View style={[styles.petal, styles.petalBottomRight]} />
        <Text style={styles.logoLetter}>P</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  keyboard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 34
  },
  ticket: {
    width: '88%',
    maxWidth: 438,
    minHeight: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#e94494',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#111',
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12
  },
  logoShadow: {
    marginTop: 50,
    width: 206,
    height: 206,
    borderRadius: 44,
    backgroundColor: 'rgba(91, 8, 72, 0.23)',
    transform: [{ translateY: 8 }],
    shadowColor: '#5a063d',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 14 },
    elevation: 11
  },
  logoTile: {
    position: 'absolute',
    left: 0,
    top: -8,
    width: 206,
    height: 206,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: '#7a0d66',
    backgroundColor: '#21091f',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  petal: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#f80b86',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.22)'
  },
  petalTopLeft: { left: 38, top: 35 },
  petalTopRight: { right: 30, top: 38 },
  petalBottomLeft: { left: 40, bottom: 31, backgroundColor: '#dd0877' },
  petalBottomRight: { right: 34, bottom: 31, backgroundColor: '#ea077e' },
  logoLetter: {
    color: '#fff8fb',
    fontSize: 126,
    fontWeight: '900',
    lineHeight: 140,
    textShadowColor: '#c20b74',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 2
  },
  form: {
    position: 'absolute',
    left: 56,
    right: 56,
    bottom: 86
  },
  field: {
    height: 58,
    borderBottomWidth: 1.6,
    borderBottomColor: 'rgba(255,255,255,0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18
  },
  fieldIcon: {
    width: 40,
    color: '#ffffff',
    fontSize: 33,
    fontWeight: '900',
    textAlign: 'center'
  },
  lockIcon: {
    width: 40,
    textAlign: 'center'
  },
  input: {
    flex: 1,
    height: 58,
    color: '#ffffff',
    fontSize: 27,
    fontWeight: '900',
    paddingHorizontal: 12
  },
  forgotButton: {
    height: 58,
    justifyContent: 'center',
    paddingLeft: 10
  },
  forgotText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 2
  },
  signInButton: {
    height: 108,
    borderRadius: 54,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16
  },
  signInPressed: {
    transform: [{ scale: 0.98 }]
  },
  disabled: {
    opacity: 0.72
  },
  signInText: {
    color: '#050505',
    fontSize: 31,
    fontWeight: '900'
  },
  scallopRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -16,
    height: 32,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 8
  },
  scallop: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff'
  }
});
