import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  poplurPerformanceManager,
  type HeavyRendererHandle,
  type PoplurPerformanceSnapshot,
} from './PoplurPerformanceManager';

export function PoplurPerformanceRuntime() {
  useEffect(() => poplurPerformanceManager.start(), []);
  return null;
}

export function usePoplurPerformance(): PoplurPerformanceSnapshot {
  return useSyncExternalStore(
    poplurPerformanceManager.subscribe,
    poplurPerformanceManager.getSnapshot,
    poplurPerformanceManager.getSnapshot,
  );
}

export function usePoplurHeavyRenderer(
  id: string,
  visible: boolean,
  options: { priority?: number; decorative?: boolean } = {},
): boolean {
  const handleRef = useRef<HeavyRendererHandle | null>(null);
  const snapshot = usePoplurPerformance();
  const priority = options.priority ?? 0;
  const decorative = options.decorative ?? false;

  useEffect(() => {
    const handle = poplurPerformanceManager.registerHeavyRenderer(id, {
      priority,
      decorative,
      visible,
    });
    handleRef.current = handle;
    return () => {
      if (handleRef.current === handle) handleRef.current = null;
      handle.release();
    };
  }, [decorative, id, priority]);

  useEffect(() => {
    handleRef.current?.setVisible(visible);
  }, [visible]);

  return visible
    && snapshot.activeHeavyRendererId === id
    && snapshot.appState === 'active'
    && snapshot.documentVisible;
}
