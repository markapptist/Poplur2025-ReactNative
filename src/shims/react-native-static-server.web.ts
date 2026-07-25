// Web-only stub for @dr.pogodin/react-native-static-server (no web build).
// On web there's no on-device static server; the WebView iframe shim loads HTML
// directly, so this is a no-op that just satisfies the import and the
// new Server(...).start()/stop() calls. Native keeps the real package.

export default class Server {
  constructor(_options?: Record<string, unknown>) {}
  async start(): Promise<string> {
    return '';
  }
  async stop(): Promise<void> {}
  addStateListener(_cb: (state: string) => void): { remove: () => void } {
    return { remove() {} };
  }
}
