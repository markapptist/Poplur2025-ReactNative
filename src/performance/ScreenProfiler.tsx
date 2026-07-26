import React, { Profiler, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

type ScreenSample = {
  commits: number;
  mountMs: number | null;
  renderTotalMs: number;
  renderMaxMs: number;
  navigationMs: number | null;
};

type RuntimeSummary = {
  screens: Record<string, ScreenSample>;
  slowFrames: number;
  maxFrameMs: number;
  jsStalls: number;
  maxJsStallMs: number;
  memoryMB: number | null;
};

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;
const screens: Record<string, ScreenSample> = {};
const navigationStarts: Record<string, number> = {};
let slowFrames = 0;
let maxFrameMs = 0;
let jsStalls = 0;
let maxJsStallMs = 0;
let monitorsStarted = false;

const now = () => globalThis.performance?.now?.() ?? Date.now();

function sampleFor(name: string): ScreenSample {
  return screens[name] ??= {
    commits: 0,
    mountMs: null,
    renderTotalMs: 0,
    renderMaxMs: 0,
    navigationMs: null,
  };
}

export function markScreenNavigation(name: string) {
  if (enabled) navigationStarts[name] = now();
}

export function getPerformanceSummary(): RuntimeSummary {
  const webPerformance = globalThis.performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  return {
    screens: { ...screens },
    slowFrames,
    maxFrameMs: Math.round(maxFrameMs * 10) / 10,
    jsStalls,
    maxJsStallMs: Math.round(maxJsStallMs * 10) / 10,
    memoryMB: webPerformance?.memory
      ? Math.round(webPerformance.memory.usedJSHeapSize / 1024 / 1024)
      : null,
  };
}

export function printPerformanceSummary() {
  if (!enabled) return;
  const summary = getPerformanceSummary();
  console.table(summary.screens);
  console.info('[Poplur profiler] runtime', {
    platform: Platform.OS,
    slowFrames: summary.slowFrames,
    maxFrameMs: summary.maxFrameMs,
    jsStalls: summary.jsStalls,
    maxJsStallMs: summary.maxJsStallMs,
    memoryMB: summary.memoryMB,
  });
}

function startMonitors() {
  if (!enabled || monitorsStarted) return () => {};
  monitorsStarted = true;

  let frameHandle: number | null = null;
  let lastFrame = now();
  const onFrame = (timestamp: number) => {
    const duration = timestamp - lastFrame;
    lastFrame = timestamp;
    if (duration > 32) {
      slowFrames += 1;
      maxFrameMs = Math.max(maxFrameMs, duration);
    }
    frameHandle = requestAnimationFrame(onFrame);
  };
  if (typeof requestAnimationFrame === 'function') {
    frameHandle = requestAnimationFrame(onFrame);
  }

  const intervalMs = 250;
  let expected = now() + intervalMs;
  const stallTimer = setInterval(() => {
    const current = now();
    const drift = current - expected;
    expected = current + intervalMs;
    if (drift > 100) {
      jsStalls += 1;
      maxJsStallMs = Math.max(maxJsStallMs, drift);
    }
  }, intervalMs);

  return () => {
    if (frameHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameHandle);
    }
    clearInterval(stallTimer);
    monitorsStarted = false;
  };
}

export function PerformanceMonitor() {
  useEffect(() => {
    if (!enabled) return;
    const stop = startMonitors();
    const globalObject = globalThis as typeof globalThis & {
      __POPLUR_PERF__?: {
        summary: typeof getPerformanceSummary;
        print: typeof printPerformanceSummary;
        reset: () => void;
      };
    };
    globalObject.__POPLUR_PERF__ = {
      summary: getPerformanceSummary,
      print: printPerformanceSummary,
      reset: () => {
        Object.keys(screens).forEach(key => delete screens[key]);
        Object.keys(navigationStarts).forEach(key => delete navigationStarts[key]);
        slowFrames = 0;
        maxFrameMs = 0;
        jsStalls = 0;
        maxJsStallMs = 0;
      },
    };
    console.info('[Poplur profiler] enabled. Run __POPLUR_PERF__.print() for a report.');
    return stop;
  }, []);
  return null;
}

export function ProfiledScreen({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  const firstCommit = useRef(true);
  if (!enabled) return <>{children}</>;

  return (
    <Profiler
      id={name}
      onRender={(_id, _phase, actualDuration) => {
        const sample = sampleFor(name);
        sample.commits += 1;
        sample.renderTotalMs += actualDuration;
        sample.renderMaxMs = Math.max(sample.renderMaxMs, actualDuration);
        if (firstCommit.current) {
          firstCommit.current = false;
          sample.mountMs = actualDuration;
          if (navigationStarts[name] !== undefined) {
            sample.navigationMs = now() - navigationStarts[name];
            delete navigationStarts[name];
          }
        }
        if (actualDuration > 16) {
          console.warn(`[Poplur profiler] slow React commit: ${name} ${actualDuration.toFixed(1)}ms`);
        }
      }}
    >
      {children}
    </Profiler>
  );
}
