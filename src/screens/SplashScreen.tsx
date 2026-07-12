import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';

const loadingMessages = [
  'Warming up the pinetrees',
  'Rolling out the clay roads',
  'Teaching the pin to drop',
  'Sprinkling pink stars',
  'Kneading the little mountains',
  'Waking up the tugboat',
  'Polishing the big P',
  'Fluffing the clouds'
] as const;

const stripeColors = ['#ffe1f1', '#ff86c4', '#f53c99'] as const;
const stripeWidths = [21, 20, 21] as const;
const barberSegments = Array.from({ length: 30 }, (_, index) => ({
  color: stripeColors[index % stripeColors.length],
  width: stripeWidths[index % stripeWidths.length]
}));

export function SplashScreen() {
  const [messageIndex, setMessageIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const messageOpacity = useRef(new Animated.Value(1)).current;
  const textSheen = useRef(new Animated.Value(0)).current;
  const fillProgress = useRef(new Animated.Value(0.04)).current;
  const barberOffset = useRef(new Animated.Value(0)).current;

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
    let cancelled = false;
    let fade: Animated.CompositeAnimation | undefined;
    const interval = setInterval(() => {
      if (reduceMotion) {
        setMessageIndex(index => (index + 1) % loadingMessages.length);
        return;
      }

      fade?.stop();
      fade = Animated.timing(messageOpacity, {
        toValue: 0.18,
        duration: 220,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true
      });
      fade.start(({ finished }) => {
        if (!finished || cancelled) return;
        setMessageIndex(index => (index + 1) % loadingMessages.length);
        fade = Animated.timing(messageOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        });
        fade.start();
      });
    }, 850);

    return () => {
      cancelled = true;
      clearInterval(interval);
      fade?.stop();
      messageOpacity.stopAnimation();
      messageOpacity.setValue(1);
    };
  }, [messageOpacity, reduceMotion]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    textSheen.stopAnimation();
    textSheen.setValue(0);

    if (!reduceMotion) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(textSheen, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false
          }),
          Animated.timing(textSheen, {
            toValue: 0,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false
          })
        ])
      );
      animation.start();
    }

    return () => {
      animation?.stop();
      textSheen.stopAnimation();
    };
  }, [reduceMotion, textSheen]);

  useEffect(() => {
    let cancelled = false;
    let fillAnimation: Animated.CompositeAnimation | undefined;
    let barberAnimation: Animated.CompositeAnimation | undefined;

    if (reduceMotion) {
      fillProgress.setValue(0.7);
      barberOffset.setValue(0);
      return () => {
        fillProgress.stopAnimation();
        barberOffset.stopAnimation();
      };
    }

    const runFill = () => {
      if (cancelled) return;
      fillProgress.setValue(0.04);
      fillAnimation = Animated.sequence([
        Animated.timing(fillProgress, {
          toValue: 0.9,
          duration: 2800,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        }),
        Animated.timing(fillProgress, {
          toValue: 1,
          duration: 720,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        }),
        Animated.delay(480)
      ]);
      fillAnimation.start(({ finished }) => {
        if (finished) runFill();
      });
    };

    runFill();
    barberOffset.setValue(0);
    barberAnimation = Animated.loop(
      Animated.timing(barberOffset, {
        toValue: -62,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    barberAnimation.start();

    return () => {
      cancelled = true;
      fillAnimation?.stop();
      barberAnimation?.stop();
      fillProgress.stopAnimation();
      barberOffset.stopAnimation();
    };
  }, [barberOffset, fillProgress, reduceMotion]);

  const loadingTextColor = textSheen.interpolate({
    inputRange: [0, 1],
    outputRange: ['#f43b99', '#fff3fa']
  });
  const fillWidth = fillProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%']
  });

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Video
        accessible={false}
        pointerEvents="none"
        source={require('../assets/poplur_splash.mp4')}
        style={styles.video}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isMuted
        isLooping
        useNativeControls={false}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0.52)']}
        locations={[0, 0.52, 1]}
        style={styles.scrim}
      />
      <View pointerEvents="none" style={styles.loaderLayer}>
        <View style={styles.loader}>
          <Animated.Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={[styles.loadingText, { color: loadingTextColor, opacity: messageOpacity }]}
          >
            {loadingMessages[messageIndex]}
          </Animated.Text>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Loading Poplur"
            accessibilityValue={{ min: 0, max: 100, now: 90 }}
            style={styles.track}
          >
            <Animated.View style={[styles.fill, { width: fillWidth }]}>
              <Animated.View
                style={[styles.stripeField, { transform: [{ translateX: barberOffset }] }]}
              >
                {barberSegments.map((segment, index) => (
                  <View
                    key={index}
                    style={[
                      styles.stripeSegment,
                      { backgroundColor: segment.color, width: segment.width }
                    ]}
                  />
                ))}
              </Animated.View>
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#0a0709'
  },
  video: {
    ...StyleSheet.absoluteFillObject
  },
  scrim: {
    ...StyleSheet.absoluteFillObject
  },
  loaderLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center'
  },
  loader: {
    position: 'absolute',
    top: '68%',
    width: '58%',
    maxWidth: 215,
    gap: 16,
    textAlign: 'center',
    transform: [{ translateY: -26 }]
  },
  loadingText: {
    minHeight: 26,
    color: '#f43b99',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(244,59,153,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12
  },
  track: {
    position: 'relative',
    width: '100%',
    height: 9,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(244,59,153,0.35)',
    borderRadius: 999,
    backgroundColor: 'rgba(28,8,18,0.55)'
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    borderRadius: 999,
    shadowColor: '#f43b99',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2
  },
  stripeField: {
    position: 'absolute',
    left: -62,
    top: -22,
    width: 620,
    height: 52,
    flexDirection: 'row',
    backgroundColor: '#ffe1f1'
  },
  stripeSegment: {
    height: 52,
    transform: [{ skewX: '-45deg' }]
  }
});
