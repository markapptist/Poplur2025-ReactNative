import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionModule,
} from 'expo-speech-recognition';

export type NativeVoiceCommand = {
  token: string;
  tab?: 'map' | 'feed' | 'post' | 'profile';
  channel?: string;
};

const WAKE_WINDOW_MS = 6_000;
const DUPLICATE_WINDOW_MS = 1_200;
const RESTART_DELAY_MS = 320;

function normalizeTranscript(value: string) {
  let normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [heard, canonical] of [
    ['pop blur', 'poplur'],
    ['pop blurr', 'poplur'],
    ['pop lure', 'poplur'],
    ['pop lur', 'poplur'],
    ['pop lour', 'poplur'],
    ['popler', 'poplur'],
    ['poppler', 'poplur'],
    ['popular', 'poplur'],
    ['poplar', 'poplur'],
  ]) {
    normalized = normalized.replaceAll(heard, canonical);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

function commandFromTranscript(value: string): Omit<NativeVoiceCommand, 'token'> | null {
  const text = normalizeTranscript(value);
  const channelNames = [
    'food',
    'beauty',
    'sports',
    'modelling',
    'modeling',
    'fashion',
    'music',
    'tech',
    'news',
    'french',
    'spanish',
    'live',
  ];
  const channelName = channelNames.find(candidate => text.includes(candidate));
  const channelNumber = text.match(/\b(10[1-9]|11[01])\b/)?.[1];
  const hasChannelIntent = /\b(channel|feed|tune|watch|go to|open|switch)\b/.test(text);
  if (hasChannelIntent && (channelName || channelNumber)) {
    return {
      tab: 'feed',
      channel: channelName === 'modeling' ? 'modelling' : channelName ?? channelNumber,
    };
  }
  if (/\b(camera|post|create|record)\b/.test(text)) return { tab: 'post' };
  if (/\b(profile|account)\b/.test(text)) return { tab: 'profile' };
  if (/\b(map|globe)\b/.test(text)) return { tab: 'map' };
  if (/\b(feed|channel|tv)\b/.test(text)) return { tab: 'feed' };
  return null;
}

export function useNativeVoiceAssistant({
  enabled,
  onCommand,
}: {
  enabled: boolean;
  onCommand: (command: NativeVoiceCommand) => void;
}) {
  const onCommandRef = useRef(onCommand);
  const awaitingCommandUntilRef = useRef(0);
  const lastTranscriptRef = useRef({ text: '', at: 0 });
  const commandSequenceRef = useRef(0);
  const desiredListeningRef = useRef(false);
  const recognitionRunningRef = useRef(false);
  const recognitionStartingRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homeMountedRef = useRef(false);
  onCommandRef.current = onCommand;

  const handleTranscript = useCallback((rawTranscript: string) => {
    const transcript = normalizeTranscript(rawTranscript);
    const now = Date.now();
    if (!transcript) return;
    if (
      transcript === lastTranscriptRef.current.text
      && now - lastTranscriptRef.current.at < DUPLICATE_WINDOW_MS
    ) return;
    lastTranscriptRef.current = { text: transcript, at: now };

    const wake = transcript.match(/\b(?:hey|hay)\s+(?:poplur|populr)\b\s*(.*)$/);
    let commandText = '';
    if (wake) {
      awaitingCommandUntilRef.current = now + WAKE_WINDOW_MS;
      commandText = wake[1]?.trim() ?? '';
    } else if (now < awaitingCommandUntilRef.current) {
      commandText = transcript;
    } else {
      return;
    }

    if (!commandText) return;
    const detail = commandFromTranscript(commandText);
    if (!detail) return;
    awaitingCommandUntilRef.current = 0;
    commandSequenceRef.current += 1;
    onCommandRef.current({
      token: `rn-voice-${now}-${commandSequenceRef.current}`,
      ...detail,
    });
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const startRecognition = useCallback(() => {
    if (
      !enabled
      || Platform.OS === 'web'
      || !homeMountedRef.current
      || !desiredListeningRef.current
      || recognitionRunningRef.current
      || recognitionStartingRef.current
      || AppState.currentState !== 'active'
      || !ExpoSpeechRecognitionModule.isRecognitionAvailable()
    ) return;

    clearRestartTimer();
    recognitionStartingRef.current = true;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-CA',
        interimResults: false,
        maxAlternatives: 1,
        continuous: true,
        contextualStrings: ['Hey Poplur', 'Poplur', 'channel 101', 'channel 111'],
        iosCategory: {
          category: AVAudioSessionCategory.playAndRecord,
          categoryOptions: [
            AVAudioSessionCategoryOptions.defaultToSpeaker,
            AVAudioSessionCategoryOptions.allowBluetooth,
            AVAudioSessionCategoryOptions.mixWithOthers,
          ],
          mode: AVAudioSessionMode.measurement,
        },
      });
    } catch {
      recognitionStartingRef.current = false;
    }
  }, [clearRestartTimer, enabled]);

  const scheduleRestart = useCallback((delay = RESTART_DELAY_MS) => {
    clearRestartTimer();
    if (!desiredListeningRef.current || AppState.currentState !== 'active') return;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      startRecognition();
    }, delay);
  }, [clearRestartTimer, startRecognition]);

  const startIfAuthorized = useCallback(async () => {
    if (!enabled || Platform.OS === 'web') return false;
    const permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!homeMountedRef.current || !permission.granted) {
      desiredListeningRef.current = false;
      return false;
    }
    desiredListeningRef.current = true;
    startRecognition();
    return true;
  }, [enabled, startRecognition]);

  const stopRecognition = useCallback(() => {
    desiredListeningRef.current = false;
    recognitionRunningRef.current = false;
    recognitionStartingRef.current = false;
    clearRestartTimer();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // The recognizer was already inactive.
    }
  }, [clearRestartTimer]);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    homeMountedRef.current = true;

    const syncWithAppState = (state: AppStateStatus) => {
      if (state === 'active') void startIfAuthorized();
      else stopRecognition();
    };
    syncWithAppState(AppState.currentState);
    const appStateSubscription = AppState.addEventListener('change', syncWithAppState);
    const startSubscription = ExpoSpeechRecognitionModule.addListener('start', () => {
      recognitionStartingRef.current = false;
      recognitionRunningRef.current = true;
    });
    const resultSubscription = ExpoSpeechRecognitionModule.addListener('result', result => {
      if (result.isFinal) handleTranscript(result.results[0]?.transcript ?? '');
    });
    const errorSubscription = ExpoSpeechRecognitionModule.addListener('error', error => {
      recognitionStartingRef.current = false;
      recognitionRunningRef.current = false;
      if (error.error === 'aborted') return;
      if (error.error === 'not-allowed' || error.error === 'service-not-allowed') {
        desiredListeningRef.current = false;
        return;
      }
      scheduleRestart(error.error === 'busy' || error.error === 'audio-capture' ? 1_200 : undefined);
    });
    const endSubscription = ExpoSpeechRecognitionModule.addListener('end', () => {
      recognitionStartingRef.current = false;
      recognitionRunningRef.current = false;
      scheduleRestart();
    });

    return () => {
      homeMountedRef.current = false;
      startSubscription.remove();
      resultSubscription.remove();
      errorSubscription.remove();
      endSubscription.remove();
      appStateSubscription.remove();
      stopRecognition();
    };
  }, [enabled, handleTranscript, scheduleRestart, startIfAuthorized, stopRecognition]);

  const requestVoiceAssistant = useCallback(async () => {
    if (!enabled || Platform.OS === 'web') return false;

    // Only the explicit HEY POPLUR tile is allowed to open an OS permission
    // sheet. A normal Home mount calls startIfAuthorized(), which is read-only.
    awaitingCommandUntilRef.current = Date.now() + WAKE_WINDOW_MS;
    const existing = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    const permission = existing.granted
      ? existing
      : await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) return false;
    // The user may spend longer than the command window reading the system
    // sheet. Start a fresh window only after the explicit grant returns.
    awaitingCommandUntilRef.current = Date.now() + WAKE_WINDOW_MS;
    desiredListeningRef.current = true;
    startRecognition();
    return true;
  }, [enabled, startRecognition]);

  return { requestVoiceAssistant };
}
