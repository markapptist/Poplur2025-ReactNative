// Web-only stub for react-native-zip-archive (no web build). Assets are served
// directly on web, so unzip is a no-op that resolves to the target path. Native
// keeps the real package.

export async function unzip(_source: string, target: string): Promise<string> {
  return target;
}

export async function zip(_source: string, target: string): Promise<string> {
  return target;
}

export function subscribe(_cb: (e: unknown) => void): { remove: () => void } {
  return { remove() {} };
}
