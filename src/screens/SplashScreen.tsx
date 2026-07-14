import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';

const loadingLines = [
  'Warming up Poplur',
  'Tuning the radius',
  'Loading the clay world',
  'Finding nearby posts'
];

export function SplashScreen() {
  const [showLoader, setShowLoader] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);

  const line = useMemo(() => loadingLines[lineIndex % loadingLines.length], [lineIndex]);

  useEffect(() => {
    const loaderTimer = setTimeout(() => setShowLoader(true), 2800);
    const lineTimer = setInterval(() => setLineIndex(current => current + 1), 850);
    return () => {
      clearTimeout(loaderTimer);
      clearInterval(lineTimer);
    };
  }, []);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Video
        source={require('../assets/poplur_splash.mp4')}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        isMuted={false}
      />
      {showLoader ? (
        <View style={styles.loaderWrap}>
          <LinearGradient
            colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0)']}
            start={{ x: 0.5, y: 0.45 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.loader}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.loaderText}>
              {line}
            </Text>
            <View style={styles.track}>
              <View style={styles.fill} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0709'
  },
  loaderWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  loader: {
    width: '82%',
    maxWidth: 340,
    alignItems: 'center',
    gap: 15,
    paddingHorizontal: 8
  },
  loaderText: {
    width: '100%',
    color: '#f63b9a',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(246,59,154,0.54)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12
  },
  track: {
    width: '100%',
    height: 14,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(246,59,154,0.35)'
  },
  fill: {
    width: '92%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#f63b9a'
  }
});
