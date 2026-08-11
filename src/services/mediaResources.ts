import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const MIB = 1024 * 1024;

// These are hard admission limits for the encoded source. The live
// PoplurAssetCache budget can be lower (for example under thermal or memory
// pressure), in which case an upload is refused before it is materialized.
export const MAX_PHOTO_UPLOAD_BYTES = 25 * MIB;
export const MAX_VIDEO_UPLOAD_BYTES = 120 * MIB;

export const MAX_CAMERA_TEMP_FILES = 2;
export const MAX_CAMERA_TEMP_AGE_MS = 30 * 60 * 1000;

export type UploadMediaKind = 'photo' | 'video';

export function uploadLimitBytes(kind: UploadMediaKind): number {
  return kind === 'video' ? MAX_VIDEO_UPLOAD_BYTES : MAX_PHOTO_UPLOAD_BYTES;
}

export function formatByteLimit(bytes: number): string {
  return `${Math.floor(bytes / MIB)} MB`;
}

function normalizedByteCount(value: unknown): number | null {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

/**
 * Resolve a trusted encoded byte count without loading the media into JS.
 * Native local files are stat-ed even when the picker supplied a size. Web
 * callers must pass ImagePickerAsset.fileSize because an unbounded response
 * cannot safely be converted to a Blob just to discover its size.
 */
export async function verifiedMediaSize(
  uri: string,
  kind: UploadMediaKind,
  declaredBytes?: number,
): Promise<number> {
  const limit = uploadLimitBytes(kind);
  const declared = normalizedByteCount(declaredBytes);
  if (declaredBytes !== undefined && declared === null) {
    throw new Error('The selected media has an invalid file size.');
  }
  if (declared && declared > limit) {
    throw new Error(`${kind === 'video' ? 'Videos' : 'Photos'} must be ${formatByteLimit(limit)} or smaller.`);
  }

  if (Platform.OS !== 'web') {
    const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
    if (info?.exists && !info.isDirectory) {
      const actual = normalizedByteCount(info.size);
      if (!actual) throw new Error('The selected media is empty or unreadable.');
      if (actual > limit) {
        throw new Error(`${kind === 'video' ? 'Videos' : 'Photos'} must be ${formatByteLimit(limit)} or smaller.`);
      }
      return actual;
    }
  }

  if (declared) return declared;
  throw new Error('Poplur could not verify this media size safely. Choose the file again.');
}

function cameraDirectory(): string | null {
  return FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}Camera` : null;
}

/**
 * Expo Camera owns the cache/Camera directory on both native platforms. Keep
 * at most two files (the visible preview plus an in-flight replacement) and
 * remove expired/crash-leftover output deterministically.
 */
export async function cleanupExpoCameraTempFiles(preserveUris: readonly string[] = []): Promise<void> {
  if (Platform.OS === 'web') return;
  const directory = cameraDirectory();
  if (!directory) throw new Error('Poplur camera storage is unavailable.');

  const preserve = new Set(preserveUris);
  const names = await FileSystem.readDirectoryAsync(directory).catch(() => [] as string[]);
  const entries = (await Promise.all(names.map(async name => {
    const uri = `${directory}/${name}`;
    const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
    return info?.exists && !info.isDirectory ? { uri, modificationTime: info.modificationTime } : null;
  }))).filter((entry): entry is { uri: string; modificationTime: number } => entry !== null)
    .sort((left, right) => (
      Number(preserve.has(right.uri)) - Number(preserve.has(left.uri))
      || right.modificationTime - left.modificationTime
      || left.uri.localeCompare(right.uri)
    ));

  const now = Date.now();
  let kept = 0;
  for (const entry of entries) {
    const isPreserved = preserve.has(entry.uri);
    const expired = now - entry.modificationTime * 1000 > MAX_CAMERA_TEMP_AGE_MS;
    // A file not named by the active preview is unreachable scratch output,
    // regardless of age. Preserved entries still obey the count boundary;
    // their live 30-minute timer is enforced by CameraScreen.
    if (!isPreserved || expired || kept >= MAX_CAMERA_TEMP_FILES) {
      await FileSystem.deleteAsync(entry.uri, { idempotent: true });
      continue;
    }
    kept += 1;
  }

  const remaining = await FileSystem.readDirectoryAsync(directory).catch(() => [] as string[]);
  if (remaining.length > MAX_CAMERA_TEMP_FILES) {
    throw new Error('Poplur could not enforce the camera temporary-file limit.');
  }
}

export async function deleteExpoCameraTempFile(uri: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const directory = cameraDirectory();
  if (!directory || !uri.startsWith(`${directory}/`)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
