# Poplur screen profiling

The RN shell has a development-only profiler covering web, iOS, and Android.
Production bundles do not start the monitors or add React Profiler wrappers.

## Screen inventory

Run:

```sh
npm run profile:inventory
```

The production entry point currently exposes `PreloginWebScreen` while logged
out and `PostLoginHomeWebScreen` while logged in. The native fallback tab shell
contains Feed, Map, Camera, Profile, and Settings, but `USE_WEB_HOME` keeps that
shell inactive. Login, SignUp, Splash, and Welcome are retained screen modules;
the approved pre-login WebView owns those flows in production.

## Runtime profiling

Run a development build on each platform, exercise every reachable screen, then
print the report:

```js
__POPLUR_PERF__.print()
```

On web, run that command in DevTools. On iOS or Android, use the development
JavaScript console. `__POPLUR_PERF__.summary()` returns machine-readable data and
`__POPLUR_PERF__.reset()` starts a fresh navigation pass.

The report measures:

- React mount/update commit duration by screen
- navigation request to the screen's first React commit
- frames longer than 32 ms and worst frame duration
- JavaScript event-loop stalls longer than 100 ms
- current JS heap usage in Chromium-based web browsers

React Native's JS cannot reliably measure native UI-thread FPS, GPU work, or
process memory. Use this harness to identify a reproduction, then confirm it on
physical devices with Instruments (iOS: Time Profiler, Core Animation, Leaks)
and Android Studio Profiler (CPU, Jank, Memory). Profile release-like builds
without remote JS debugging because debugger overhead changes timing.

For the two WebView screens, also inspect the embedded page with Safari Web
Inspector or Chrome `chrome://inspect`; React timings only cover the native
wrapper, not HTML layout, Mapbox/Three rendering, Web Workers, or media decode.
