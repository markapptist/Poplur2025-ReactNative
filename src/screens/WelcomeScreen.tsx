import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { PoplurConfetti } from '../components/PoplurConfetti';

const dotRows = Array.from({ length: 22 });
const dotColumns = Array.from({ length: 14 });

export function WelcomeScreen({ navigation, authError }: any) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <PoplurConfetti />
      <View style={styles.ticket}>
        <HalftoneDots />
        <PoplurMark />
        {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          onPress={() => navigation.navigate('Login')}
          style={({ pressed }) => [styles.signInShadow, pressed && styles.pressed]}
        >
          <View style={styles.signInButton}>
            <WelcomeButtonShaderText text="Sign In" />
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

function WelcomeButtonShaderText({ text }: { text: string }) {
  const phase = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      phase.stopAnimation();
      phase.setValue(0.48);
      return;
    }

    phase.setValue(0);
    const animation = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: false
      })
    );
    animation.start();
    return () => animation.stop();
  }, [phase, reduceMotion]);

  // The 90pt label uses a 270pt (300%) gradient field. CSS 105deg maps to a
  // 15deg SVG vector, and the field travels from +100% to -200% in one loop.
  const x1 = phase.interpolate({ inputRange: [0, 1], outputRange: [90, -180] });
  const x2 = phase.interpolate({ inputRange: [0, 1], outputRange: [360, 90] });

  return (
    <Svg width={90} height={30} viewBox="0 0 90 30" accessible={false} pointerEvents="none">
      <Defs>
        <AnimatedLinearGradient
          id="welcomeButtonTextShader"
          gradientUnits="userSpaceOnUse"
          x1={x1}
          y1={-21}
          x2={x2}
          y2={51}
        >
          <Stop offset={0} stopColor="#080207" />
          <Stop offset={0.16} stopColor="#5b1238" />
          <Stop offset={0.31} stopColor="#ff2d8a" />
          <Stop offset={0.45} stopColor="#7a003e" />
          <Stop offset={0.59} stopColor="#160711" />
          <Stop offset={0.76} stopColor="#ff4d9e" />
          <Stop offset={0.9} stopColor="#2a0a1d" />
          <Stop offset={1} stopColor="#080207" />
        </AnimatedLinearGradient>
      </Defs>
      <SvgText
        x={45}
        y={22}
        textAnchor="middle"
        fontSize={19}
        fontWeight="900"
        fill="rgba(0,0,0,0.16)"
        transform="translate(0 1)"
      >
        {text}
      </SvgText>
      <SvgText
        x={45}
        y={22}
        textAnchor="middle"
        fontSize={19}
        fontWeight="900"
        fill="url(#welcomeButtonTextShader)"
      >
        {text}
      </SvgText>
    </Svg>
  );
}

function HalftoneDots() {
  return (
    <View pointerEvents="none" style={styles.dotField}>
      {dotRows.map((_, row) => (
        <View key={row} style={styles.dotRow}>
          {dotColumns.map((__, column) => {
            const edge = Math.min(column, dotColumns.length - 1 - column);
            const alpha = Math.max(0.1, 0.38 - edge * 0.045 - row * 0.004);
            return <View key={column} style={[styles.dot, { opacity: alpha }]} />;
          })}
        </View>
      ))}
    </View>
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
    backgroundColor: '#ff2d96',
    alignItems: 'center',
    justifyContent: 'center'
  },
  ticket: {
    width: '86%',
    maxWidth: 430,
    minHeight: '78%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#ef477d',
    alignItems: 'center',
    overflow: 'hidden'
  },
  dotField: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: 18,
    paddingHorizontal: 18,
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
  logoShadow: {
    marginTop: 82,
    width: 224,
    height: 224,
    borderRadius: 48,
    backgroundColor: 'rgba(91, 8, 72, 0.24)',
    transform: [{ translateY: 10 }],
    shadowColor: '#5a063d',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12
  },
  logoTile: {
    position: 'absolute',
    left: 0,
    top: -10,
    width: 224,
    height: 224,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#7a0d66',
    backgroundColor: '#21091f',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  petal: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#f80b86',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.22)'
  },
  petalTopLeft: { left: 42, top: 38 },
  petalTopRight: { right: 34, top: 42 },
  petalBottomLeft: { left: 44, bottom: 35, backgroundColor: '#dd0877' },
  petalBottomRight: { right: 38, bottom: 34, backgroundColor: '#ea077e' },
  logoLetter: {
    color: '#fff8fb',
    fontSize: 138,
    fontWeight: '900',
    lineHeight: 152,
    textShadowColor: '#c20b74',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 2
  },
  errorText: {
    marginTop: 46,
    maxWidth: 280,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center'
  },
  signInShadow: {
    position: 'absolute',
    top: '58%',
    width: 166,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#050505',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  signInButton: {
    width: 166,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)'
  },
  pressed: {
    transform: [{ translateY: 2 }]
  }
});
