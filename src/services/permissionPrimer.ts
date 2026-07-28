import AsyncStorage from '@react-native-async-storage/async-storage';

export type PrimerPermission = 'location' | 'photos';

const HANDLED_KEYS: Record<PrimerPermission, string> = {
  location: 'poplur.permissionPrimer.location.handled.v1',
  photos: 'poplur.permissionPrimer.photos.handled.v1',
};

export async function markPermissionPrimerHandled(permission: PrimerPermission) {
  await AsyncStorage.setItem(HANDLED_KEYS[permission], '1');
}

export async function getHandledPermissionPrimers(): Promise<Record<PrimerPermission, boolean>> {
  const entries = await AsyncStorage.multiGet([
    HANDLED_KEYS.location,
    HANDLED_KEYS.photos,
  ]);
  const values = new Map(entries);
  return {
    location: values.get(HANDLED_KEYS.location) === '1',
    photos: values.get(HANDLED_KEYS.photos) === '1',
  };
}
