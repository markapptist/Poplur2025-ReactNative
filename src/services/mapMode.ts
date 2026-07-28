import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type MapMode = '2d' | '3d';

const MODE_KEY = 'poplur.map.mode';
const NOTICE_KEY = 'poplur.map.2dNoticeSeen';

export function devicePrefers2D(): boolean {
  if (Platform.OS === 'web') {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (nav.deviceMemory != null && nav.deviceMemory <= 3) || navigator.hardwareConcurrency <= 4;
  }
  const constants = Platform.constants as typeof Platform.constants & { TotalMemory?: number; totalMemory?: number };
  const bytes = constants.TotalMemory ?? constants.totalMemory;
  return typeof bytes === 'number' && bytes <= 3 * 1024 * 1024 * 1024;
}

export async function loadMapMode(): Promise<{ mode: MapMode; automatic: boolean }> {
  const saved = await AsyncStorage.getItem(MODE_KEY);
  if (saved === '2d' || saved === '3d') return { mode: saved, automatic: false };
  const automatic = devicePrefers2D();
  return { mode: automatic ? '2d' : '3d', automatic };
}

export async function saveMapMode(mode: MapMode): Promise<void> {
  await AsyncStorage.setItem(MODE_KEY, mode);
}

export async function shouldShow2DNotice(): Promise<boolean> {
  return (await AsyncStorage.getItem(NOTICE_KEY)) !== '1';
}

export async function mark2DNoticeSeen(): Promise<void> {
  await AsyncStorage.setItem(NOTICE_KEY, '1');
}
