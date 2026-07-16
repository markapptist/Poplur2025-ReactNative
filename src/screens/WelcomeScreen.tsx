import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { PoplurConfetti } from '../components/PoplurConfetti';

const scallops = Array.from({ length: 15 });
const dotRows = Array.from({ length: 9 });
const dotColumns = Array.from({ length: 13 });
const welcomeLogo = require('../assets/welcome-logo.png');

export function WelcomeScreen({ navigation, authError }: any) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.ticket}>
        <HalftoneDots />
        <View pointerEvents="none" style={[styles.radiusRing, styles.radiusRingLeft]} />
        <View pointerEvents="none" style={[styles.radiusRing, styles.radiusRingRight]} />
        <Image source={welcomeLogo} resizeMode="contain" style={styles.logo} />
        <WelcomeCube />
        {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
        <View style={styles.actions}>
          <WelcomeButton label="Sign In" onPress={() => navigation.navigate('Login')} />
          <WelcomeButton label="Sign Up" compact onPress={() => navigation.navigate('SignUp')} />
        </View>
        <View style={styles.scallopStrip}>
          {scallops.map((_, index) => <View key={index} style={styles.scallop} />)}
        </View>
      </View>
      <PoplurConfetti />
    </SafeAreaView>
  );
}

function WelcomeButton({ label, onPress, compact = false }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.buttonShadow, compact && styles.buttonShadowCompact, pressed && styles.pressed]}
    >
      <View style={[styles.button, compact && styles.buttonCompact]}>
        <Text style={[styles.buttonText, compact && styles.buttonTextCompact]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function WelcomeCube() {
  return (
    <View pointerEvents="none" style={styles.cubeShadow}>
      <View style={styles.cubeFace}>
        <Image source={welcomeLogo} resizeMode="contain" style={styles.cubeLogo} />
        <Text style={styles.cubeWordmark}>poplur</Text>
      </View>
    </View>
  );
}

function HalftoneDots() {
  return (
    <View pointerEvents="none" style={styles.dotField}>
      {dotRows.map((_, row) => (
        <View key={row} style={styles.dotRow}>
          {dotColumns.map((__, column) => {
            const distance = Math.abs(column - (dotColumns.length - 1) / 2);
            const alpha = Math.max(0.04, 0.3 - distance * 0.035 - row * 0.018);
            return <View key={column} style={[styles.dot, { opacity: alpha }]} />;
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ed2e79'
  },
  ticket: {
    flex: 1,
    backgroundColor: '#ef3d82',
    alignItems: 'center',
    overflow: 'hidden'
  },
  dotField: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '34%',
    paddingTop: 12,
    paddingHorizontal: 12,
    justifyContent: 'space-between'
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff'
  },
  radiusRing: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  radiusRingLeft: {
    left: -150,
    top: '24%'
  },
  radiusRingRight: {
    right: -144,
    bottom: '16%'
  },
  logo: {
    position: 'absolute',
    top: '6%',
    width: 142,
    height: 142
  },
  cubeShadow: {
    position: 'absolute',
    top: '43%',
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: 'rgba(82,0,39,0.38)',
    transform: [{ rotate: '-4deg' }, { translateY: 8 }],
    shadowColor: '#560024',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12
  },
  cubeFace: {
    position: 'absolute',
    left: 0,
    top: -8,
    width: 96,
    height: 96,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.38)',
    backgroundColor: '#f22b84',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cubeLogo: {
    width: 58,
    height: 58
  },
  cubeWordmark: {
    marginTop: -5,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: -0.5
  },
  errorText: {
    position: 'absolute',
    top: '33%',
    maxWidth: 300,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center'
  },
  actions: {
    position: 'absolute',
    bottom: '7.5%',
    alignItems: 'center',
    gap: 28
  },
  buttonShadow: {
    width: 220,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#050505',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 0
  },
  buttonShadowCompact: {
    width: 194,
    height: 58,
    borderRadius: 29
  },
  button: {
    width: 220,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fffafd',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)'
  },
  buttonCompact: {
    width: 194,
    height: 50,
    borderRadius: 25
  },
  buttonText: {
    color: '#080609',
    fontSize: 25,
    fontWeight: '900'
  },
  buttonTextCompact: {
    fontSize: 20
  },
  pressed: {
    transform: [{ translateY: 2 }],
    opacity: 0.92
  },
  scallopStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -13,
    height: 27,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff'
  },
  scallop: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: '#ef3d82'
  }
});
