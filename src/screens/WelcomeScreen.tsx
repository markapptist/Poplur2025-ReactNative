import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle } from 'react-native-svg';
import { PoplurConfetti } from '../components/PoplurConfetti';
import { usePoplurPerformance } from '../performance/PoplurPerformance';

const scallops = Array.from({ length: 15 });
const welcomeLogo = require('../assets/welcome-logo.png');

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 1700;
const WORLD_DOT_SPACING = 24;
const worldLand = [
  [[0.02, 0.13], [0.08, 0.08], [0.17, 0.07], [0.25, 0.12], [0.31, 0.2], [0.27, 0.27], [0.23, 0.3], [0.21, 0.38], [0.15, 0.43], [0.1, 0.37], [0.06, 0.34], [0.03, 0.27]],
  [[0.2, 0.04], [0.27, 0.05], [0.3, 0.11], [0.27, 0.17], [0.22, 0.15], [0.18, 0.09]],
  [[0.16, 0.39], [0.23, 0.4], [0.29, 0.47], [0.31, 0.57], [0.28, 0.68], [0.25, 0.79], [0.22, 0.91], [0.18, 0.82], [0.16, 0.7], [0.13, 0.56], [0.13, 0.46]],
  [[0.39, 0.18], [0.45, 0.14], [0.53, 0.16], [0.56, 0.23], [0.52, 0.29], [0.46, 0.28], [0.4, 0.24]],
  [[0.4, 0.28], [0.51, 0.27], [0.57, 0.36], [0.56, 0.49], [0.52, 0.62], [0.47, 0.72], [0.42, 0.62], [0.38, 0.47], [0.38, 0.35]],
  [[0.51, 0.14], [0.63, 0.08], [0.76, 0.08], [0.89, 0.14], [0.98, 0.23], [0.95, 0.33], [0.87, 0.36], [0.82, 0.44], [0.73, 0.42], [0.68, 0.37], [0.6, 0.37], [0.54, 0.3], [0.51, 0.23]],
  [[0.61, 0.34], [0.68, 0.37], [0.73, 0.47], [0.8, 0.52], [0.78, 0.59], [0.71, 0.56], [0.66, 0.49]],
  [[0.7, 0.65], [0.8, 0.6], [0.9, 0.64], [0.94, 0.74], [0.87, 0.83], [0.76, 0.81], [0.69, 0.73]],
  [[0.93, 0.4], [0.96, 0.43], [0.95, 0.5], [0.92, 0.48]],
  [[0.58, 0.69], [0.6, 0.73], [0.59, 0.8], [0.57, 0.77]]
] as const;

type WorldDot = { x: number; y: number; radius: number; highlight: boolean; phase: number };

function pointIsInsideLand(x: number, y: number, polygon: readonly (readonly number[])[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[previous];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / ((y2 - y1) || 0.000001) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

const worldDots: WorldDot[] = [];
for (let y = WORLD_DOT_SPACING / 2, row = 0; y < WORLD_HEIGHT; y += WORLD_DOT_SPACING, row += 1) {
  for (let x = WORLD_DOT_SPACING / 2, column = 0; x < WORLD_WIDTH; x += WORLD_DOT_SPACING, column += 1) {
    const nx = x / WORLD_WIDTH;
    const ny = y / WORLD_HEIGHT;
    if (!worldLand.some(polygon => pointIsInsideLand(nx, ny, polygon))) continue;
    const hash = Math.abs(row * 73 + column * 151 + row * column * 19) % 41;
    worldDots.push({ x, y, radius: 4.6, highlight: hash < 4, phase: hash % 3 });
  }
}

export function WelcomeScreen({ navigation, authError }: any) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.ticket}>
        <AnimatedWorldMap />
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

function AnimatedWorldMap() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const performance = usePoplurPerformance();
  const animationAllowed = performance.appState === 'active'
    && performance.documentVisible
    && performance.decorativeRenderingAllowed;
  const pulses = useRef([
    new Animated.Value(0.42),
    new Animated.Value(0.42),
    new Animated.Value(0.42)
  ]).current;

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
    const animations = pulses.map((pulse, index) => {
      pulse.stopAnimation();
      if (reduceMotion || !animationAllowed) {
        pulse.setValue(0.72);
        return undefined;
      }
      pulse.setValue(0.3);
      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(index * 310),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 920,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true
          }),
          Animated.timing(pulse, {
            toValue: 0.3,
            duration: 920,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true
          }),
          Animated.delay((2 - index) * 310)
        ])
      );
      animation.start();
      return animation;
    });
    return () => animations.forEach(animation => animation?.stop());
  }, [animationAllowed, pulses, reduceMotion]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.worldMap}
    >
      {pulses.map((pulse, phase) => (
        <Animated.View key={phase} style={[styles.worldMapPulse, { opacity: pulse }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} preserveAspectRatio="none">
            {worldDots.map((dot, index) => dot.highlight && dot.phase === phase ? (
              <React.Fragment key={index}>
                <Circle cx={dot.x} cy={dot.y} r={dot.radius * 2.25} fill="#ffffff" opacity={0.12} />
                <Circle cx={dot.x} cy={dot.y} r={dot.radius * 1.08} fill="#ffffff" />
              </React.Fragment>
            ) : null)}
          </Svg>
        </Animated.View>
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
  worldMap: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.88
  },
  worldMapPulse: {
    ...StyleSheet.absoluteFillObject
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
