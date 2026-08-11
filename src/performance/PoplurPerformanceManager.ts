import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
  type AppStateStatus,
} from 'react-native';
import { poplurAssetCache, POPLUR_CACHE_TIERS } from './PoplurAssetCache';

export enum PoplurPerformanceMode {
  FULL = 'FULL',
  REDUCED = 'REDUCED',
  LOW_POWER = 'LOW_POWER',
  EMERGENCY = 'EMERGENCY',
}

export type PoplurThermalCondition = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
export type PoplurMemoryPressure = 'normal' | 'warning' | 'critical';

export type PoplurPerformancePolicy = {
  mode: PoplurPerformanceMode;
  targetFPS: 30 | 24 | 15 | 10;
  particlesAllowed: boolean;
  particleDensityMultiplier: number;
  dynamicShadowsAllowed: boolean;
  postProcessingAllowed: boolean;
  physicsQuality: 'full' | 'reduced' | 'low' | 'paused';
  maximumTextureResolution: 2048 | 1024 | 512;
  cacheBudgetBytes: number;
  decorativeRenderingAllowed: boolean;
  expensiveVideoTexturesAllowed: boolean;
  maxDevicePixelRatio: 2 | 1.5 | 1.25 | 1;
};

export type PoplurPerformanceSnapshot = PoplurPerformancePolicy & {
  appState: AppStateStatus;
  documentVisible: boolean;
  sceneVisible: boolean;
  thermalCondition: PoplurThermalCondition;
  lowPowerMode: boolean;
  memoryPressure: PoplurMemoryPressure;
  memoryWarningCount: number;
  activeHeavyRendererId: string | null;
  activeHeavyRendererCount: 0 | 1;
  visibleRendererCount: number;
  currentScreen: string | null;
};

type HeavyRenderer = {
  id: string;
  token: symbol;
  priority: number;
  visible: boolean;
  decorative: boolean;
  sequence: number;
};

export type HeavyRendererHandle = {
  setVisible: (visible: boolean) => void;
  release: () => void;
};

type NativePerformanceState = {
  thermalState?: string;
  lowPowerMode?: boolean;
  memoryPressure?: string;
  memoryWarningCount?: number;
  cacheBudgetBytes?: number;
  appActive?: boolean;
};

type NativeSubscription = { remove: () => void };

const MiB = 1024 * 1024;
const modeRank: Record<PoplurPerformanceMode, number> = {
  [PoplurPerformanceMode.FULL]: 0,
  [PoplurPerformanceMode.REDUCED]: 1,
  [PoplurPerformanceMode.LOW_POWER]: 2,
  [PoplurPerformanceMode.EMERGENCY]: 3,
};

const modeFromRank = Object.entries(modeRank).reduce<Record<number, PoplurPerformanceMode>>(
  (result, [mode, rank]) => ({ ...result, [rank]: mode as PoplurPerformanceMode }),
  {},
);

const POLICY_BY_MODE: Record<PoplurPerformanceMode, Omit<PoplurPerformancePolicy, 'cacheBudgetBytes'>> = {
  [PoplurPerformanceMode.FULL]: {
    mode: PoplurPerformanceMode.FULL,
    targetFPS: 30,
    particlesAllowed: true,
    particleDensityMultiplier: 1,
    dynamicShadowsAllowed: true,
    postProcessingAllowed: true,
    physicsQuality: 'full',
    maximumTextureResolution: 2048,
    decorativeRenderingAllowed: true,
    expensiveVideoTexturesAllowed: true,
    maxDevicePixelRatio: 2,
  },
  [PoplurPerformanceMode.REDUCED]: {
    mode: PoplurPerformanceMode.REDUCED,
    targetFPS: 24,
    particlesAllowed: true,
    particleDensityMultiplier: 0.5,
    dynamicShadowsAllowed: false,
    postProcessingAllowed: false,
    physicsQuality: 'reduced',
    maximumTextureResolution: 2048,
    decorativeRenderingAllowed: true,
    expensiveVideoTexturesAllowed: true,
    maxDevicePixelRatio: 1.5,
  },
  [PoplurPerformanceMode.LOW_POWER]: {
    mode: PoplurPerformanceMode.LOW_POWER,
    targetFPS: 15,
    particlesAllowed: true,
    particleDensityMultiplier: 0.25,
    dynamicShadowsAllowed: false,
    postProcessingAllowed: false,
    physicsQuality: 'low',
    maximumTextureResolution: 1024,
    decorativeRenderingAllowed: true,
    expensiveVideoTexturesAllowed: false,
    maxDevicePixelRatio: 1.25,
  },
  [PoplurPerformanceMode.EMERGENCY]: {
    mode: PoplurPerformanceMode.EMERGENCY,
    targetFPS: 10,
    particlesAllowed: false,
    particleDensityMultiplier: 0,
    dynamicShadowsAllowed: false,
    postProcessingAllowed: false,
    physicsQuality: 'paused',
    maximumTextureResolution: 512,
    decorativeRenderingAllowed: false,
    expensiveVideoTexturesAllowed: false,
    maxDevicePixelRatio: 1,
  },
};

function isDebug() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function browserCacheBudget(): number {
  if (typeof navigator === 'undefined') return POPLUR_CACHE_TIERS.mid;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory !== 'number') return POPLUR_CACHE_TIERS.mid;
  if (memory <= 2) return POPLUR_CACHE_TIERS.low;
  if (memory >= 8) return POPLUR_CACHE_TIERS.high;
  return POPLUR_CACHE_TIERS.mid;
}

function normalizeThermal(value: unknown): PoplurThermalCondition {
  const state = String(value ?? '').toLowerCase();
  if (state === 'nominal' || state === 'none' || state === 'light') return 'nominal';
  if (state === 'fair' || state === 'moderate') return 'fair';
  if (state === 'serious' || state === 'severe') return 'serious';
  if (state === 'critical' || state === 'emergency' || state === 'shutdown') return 'critical';
  return 'unknown';
}

function normalizeMemoryPressure(value: unknown): PoplurMemoryPressure {
  const state = String(value ?? '').toLowerCase();
  if (state === 'critical') return 'critical';
  if (state === 'warning' || state === 'low') return 'warning';
  return 'normal';
}

function thermalMode(thermal: PoplurThermalCondition): PoplurPerformanceMode {
  switch (thermal) {
    case 'fair': return PoplurPerformanceMode.REDUCED;
    case 'serious': return PoplurPerformanceMode.LOW_POWER;
    case 'critical': return PoplurPerformanceMode.EMERGENCY;
    default: return PoplurPerformanceMode.FULL;
  }
}

function memoryMode(memory: PoplurMemoryPressure): PoplurPerformanceMode {
  if (memory === 'critical') return PoplurPerformanceMode.EMERGENCY;
  if (memory === 'warning') return PoplurPerformanceMode.LOW_POWER;
  return PoplurPerformanceMode.FULL;
}

function modeCacheMultiplier(mode: PoplurPerformanceMode): number {
  switch (mode) {
    case PoplurPerformanceMode.REDUCED: return 0.75;
    case PoplurPerformanceMode.LOW_POWER: return 0.5;
    case PoplurPerformanceMode.EMERGENCY: return 0.2;
    default: return 1;
  }
}

export class PoplurPerformanceManager {
  private listeners = new Set<() => void>();
  private renderers = new Map<string, HeavyRenderer>();
  private sequence = 0;
  private starts = 0;
  private subscriptions: NativeSubscription[] = [];
  private browserVisibilityHandler?: () => void;
  private thermalCondition: PoplurThermalCondition = 'unknown';
  private lowPowerMode = false;
  private memoryPressure: PoplurMemoryPressure = 'normal';
  private memoryWarningCount = 0;
  private nativeAppActive = true;
  private baseCacheBudgetBytes = browserCacheBudget();
  private debugMode: PoplurPerformanceMode | null = null;
  private currentScreen: string | null = null;
  private activeHeavyRendererId: string | null = null;
  private snapshot: PoplurPerformanceSnapshot;

  constructor() {
    this.snapshot = this.buildSnapshot(PoplurPerformanceMode.FULL);
  }

  start(): () => void {
    this.starts += 1;
    if (this.starts === 1) this.installSignals();
    return () => {
      this.starts = Math.max(0, this.starts - 1);
      if (this.starts === 0) this.removeSignals();
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PoplurPerformanceSnapshot => this.snapshot;

  setCurrentScreen(screen: string | null) {
    if (this.currentScreen === screen) return;
    this.currentScreen = screen;
    this.reconcile('Screen changed');
  }

  registerHeavyRenderer(
    id: string,
    options: { priority?: number; visible?: boolean; decorative?: boolean } = {},
  ): HeavyRendererHandle {
    const token = Symbol(id);
    const renderer: HeavyRenderer = {
      id,
      token,
      priority: options.priority ?? 0,
      visible: options.visible ?? true,
      decorative: options.decorative ?? false,
      sequence: ++this.sequence,
    };
    this.renderers.set(id, renderer);
    this.reconcile(`Registered renderer: ${id}`);
    let released = false;
    return {
      setVisible: visible => {
        const current = this.renderers.get(id);
        if (released || current?.token !== token || current.visible === visible) return;
        current.visible = visible;
        this.reconcile(visible ? `Renderer visible: ${id}` : `Renderer hidden: ${id}`);
      },
      release: () => {
        if (released) return;
        released = true;
        if (this.renderers.get(id)?.token === token) {
          this.renderers.delete(id);
          this.reconcile(`Released renderer: ${id}`);
        }
      },
    };
  }

  isHeavyRendererActive(id: string): boolean {
    return this.activeHeavyRendererId === id && this.isForegroundVisible();
  }

  setDebugMode(mode: PoplurPerformanceMode | null) {
    if (!isDebug()) return;
    this.debugMode = mode;
    this.reconcile(mode ? `Debug override: ${mode}` : 'Debug override cleared');
  }

  applyNativeState(state: NativePerformanceState) {
    const previousPressure = this.memoryPressure;
    const previousWarningCount = this.memoryWarningCount;
    if (state.thermalState !== undefined) this.thermalCondition = normalizeThermal(state.thermalState);
    if (state.lowPowerMode !== undefined) this.lowPowerMode = state.lowPowerMode;
    if (state.memoryPressure !== undefined) this.memoryPressure = normalizeMemoryPressure(state.memoryPressure);
    if (typeof state.memoryWarningCount === 'number') this.memoryWarningCount = Math.max(this.memoryWarningCount, state.memoryWarningCount);
    if (typeof state.cacheBudgetBytes === 'number' && Number.isFinite(state.cacheBudgetBytes)) {
      this.baseCacheBudgetBytes = Math.min(
        POPLUR_CACHE_TIERS.high,
        Math.max(32 * MiB, Math.floor(state.cacheBudgetBytes)),
      );
    }
    if (state.appActive !== undefined) this.nativeAppActive = state.appActive;

    // Native platforms can deliver multiple warnings while already in the
    // same pressure state. Every new warning must purge again; otherwise
    // resources admitted after the first warning survive the next one.
    if (this.memoryPressure !== 'normal' && (
      this.memoryPressure !== previousPressure
      || this.memoryWarningCount > previousWarningCount
    )) {
      const removed = poplurAssetCache.handleMemoryPressure(this.memoryPressure === 'critical' ? 'critical' : 'warning');
      if (isDebug() && removed.length) {
        console.info(`[PoplurPerformance] Purged ${removed.length} cached assets for memory pressure`);
      }
    }
    this.reconcile('Native performance signal');
  }

  diagnostics() {
    return {
      ...this.snapshot,
      cache: poplurAssetCache.diagnostics(),
      renderers: [...this.renderers.values()].map(renderer => ({
        id: renderer.id,
        visible: renderer.visible,
        active: renderer.id === this.activeHeavyRendererId,
        priority: renderer.priority,
        decorative: renderer.decorative,
      })),
    };
  }

  private installSignals() {
    const appStateSubscription = AppState.addEventListener('change', () => this.reconcile('App state changed'));
    this.subscriptions.push(appStateSubscription);

    if (typeof document !== 'undefined') {
      this.browserVisibilityHandler = () => this.reconcile('Document visibility changed');
      document.addEventListener('visibilitychange', this.browserVisibilityHandler);
      window.addEventListener('pagehide', this.browserVisibilityHandler);
      window.addEventListener('pageshow', this.browserVisibilityHandler);
    }

    const nativeModule = NativeModules.PoplurPerformanceNative as {
      getCurrentState?: () => Promise<NativePerformanceState>;
    } | undefined;
    if (nativeModule) {
      try {
        const emitter = new NativeEventEmitter(NativeModules.PoplurPerformanceNative);
        this.subscriptions.push(emitter.addListener('PoplurPerformanceDidChange', state => {
          this.applyNativeState(state as NativePerformanceState);
        }));
        void nativeModule.getCurrentState?.()
          .then(state => this.applyNativeState(state))
          .catch(error => isDebug() && console.warn('[PoplurPerformance] Native state unavailable', error));
      } catch (error) {
        if (isDebug()) console.warn('[PoplurPerformance] Native listener unavailable', error);
      }
    }

    const globalObject = globalThis as typeof globalThis & {
      __POPLUR_PERFORMANCE__?: {
        summary: () => ReturnType<PoplurPerformanceManager['diagnostics']>;
        setMode: (mode: PoplurPerformanceMode | null) => void;
        purgeCache: () => string[];
      };
    };
    if (isDebug()) {
      globalObject.__POPLUR_PERFORMANCE__ = {
        summary: () => this.diagnostics(),
        setMode: mode => this.setDebugMode(mode),
        purgeCache: () => poplurAssetCache.purgeInactive(),
      };
      console.info('[PoplurPerformance] Diagnostics: __POPLUR_PERFORMANCE__.summary()');
    }
    this.reconcile('Performance manager started');
  }

  private removeSignals() {
    this.subscriptions.splice(0).forEach(subscription => subscription.remove());
    if (this.browserVisibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.browserVisibilityHandler);
      window.removeEventListener('pagehide', this.browserVisibilityHandler);
      window.removeEventListener('pageshow', this.browserVisibilityHandler);
      this.browserVisibilityHandler = undefined;
    }
  }

  private selectedMode(): PoplurPerformanceMode {
    if (this.debugMode) return this.debugMode;
    const candidates = [
      thermalMode(this.thermalCondition),
      this.lowPowerMode ? PoplurPerformanceMode.LOW_POWER : PoplurPerformanceMode.FULL,
      memoryMode(this.memoryPressure),
    ];
    return candidates.reduce((worst, candidate) => (
      modeRank[candidate] > modeRank[worst] ? candidate : worst
    ), PoplurPerformanceMode.FULL);
  }

  private isForegroundVisible(): boolean {
    const documentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    return AppState.currentState === 'active' && documentVisible && this.nativeAppActive;
  }

  private reconcile(reason: string) {
    const previous = this.snapshot;
    const mode = this.selectedMode();
    const foregroundVisible = this.isForegroundVisible();
    const eligible = [...this.renderers.values()]
      .filter(renderer => renderer.visible && foregroundVisible)
      .filter(renderer => mode !== PoplurPerformanceMode.EMERGENCY || !renderer.decorative)
      .sort((left, right) => (
        right.priority - left.priority
        || left.sequence - right.sequence
        || left.id.localeCompare(right.id)
      ));
    this.activeHeavyRendererId = eligible[0]?.id ?? null;
    this.snapshot = this.buildSnapshot(mode);

    const cacheBudget = this.snapshot.cacheBudgetBytes;
    const maxEntries = mode === PoplurPerformanceMode.FULL
      ? 128
      : mode === PoplurPerformanceMode.REDUCED
        ? 96
        : mode === PoplurPerformanceMode.LOW_POWER ? 64 : 24;
    const removed = poplurAssetCache.configure({
      maxBytes: cacheBudget,
      maxEntries,
      maxEntriesByKind: {
        model: mode === PoplurPerformanceMode.EMERGENCY ? 2 : mode === PoplurPerformanceMode.LOW_POWER ? 6 : 12,
        texture: mode === PoplurPerformanceMode.EMERGENCY ? 8 : mode === PoplurPerformanceMode.LOW_POWER ? 24 : 48,
        scene: mode === PoplurPerformanceMode.EMERGENCY ? 1 : mode === PoplurPerformanceMode.LOW_POWER ? 3 : 6,
        image: mode === PoplurPerformanceMode.EMERGENCY ? 8 : mode === PoplurPerformanceMode.LOW_POWER ? 24 : 48,
        video: mode === PoplurPerformanceMode.EMERGENCY ? 0 : mode === PoplurPerformanceMode.LOW_POWER ? 1 : 3,
        temporary: mode === PoplurPerformanceMode.EMERGENCY ? 2 : 12,
      },
    });

    const changed = JSON.stringify(previous) !== JSON.stringify(this.snapshot);
    if (!changed) return;
    if (isDebug()) {
      if (previous.mode !== this.snapshot.mode) {
        console.info(`[PoplurPerformance] Mode changed ${previous.mode} -> ${this.snapshot.mode}. Reason: ${reason}`);
      }
      if (previous.activeHeavyRendererId !== this.snapshot.activeHeavyRendererId) {
        if (previous.activeHeavyRendererId) console.info(`[PoplurPerformance] Paused renderer: ${previous.activeHeavyRendererId}`);
        if (this.snapshot.activeHeavyRendererId) console.info(`[PoplurPerformance] Active renderer: ${this.snapshot.activeHeavyRendererId}`);
      }
      if (removed.length) console.info(`[PoplurPerformance] Evicted ${removed.length} over-budget cached assets`);
    }
    this.listeners.forEach(listener => listener());
  }

  private buildSnapshot(mode: PoplurPerformanceMode): PoplurPerformanceSnapshot {
    const basePolicy = POLICY_BY_MODE[mode] ?? POLICY_BY_MODE[modeFromRank[0]];
    const cacheBudgetBytes = Math.floor(this.baseCacheBudgetBytes * modeCacheMultiplier(mode));
    const documentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    let visibleRendererCount = 0;
    for (const renderer of this.renderers.values()) if (renderer.visible) visibleRendererCount += 1;
    return {
      ...basePolicy,
      cacheBudgetBytes,
      appState: AppState.currentState,
      documentVisible,
      sceneVisible: this.isForegroundVisible() && visibleRendererCount > 0,
      thermalCondition: this.thermalCondition,
      lowPowerMode: this.lowPowerMode,
      memoryPressure: this.memoryPressure,
      memoryWarningCount: this.memoryWarningCount,
      activeHeavyRendererId: this.activeHeavyRendererId,
      activeHeavyRendererCount: this.activeHeavyRendererId ? 1 : 0,
      visibleRendererCount,
      currentScreen: this.currentScreen,
    };
  }
}

export const poplurPerformanceManager = new PoplurPerformanceManager();

export function thermalStateForMode(mode: PoplurPerformanceMode): PoplurThermalCondition {
  switch (mode) {
    case PoplurPerformanceMode.REDUCED: return 'fair';
    case PoplurPerformanceMode.LOW_POWER: return 'serious';
    case PoplurPerformanceMode.EMERGENCY: return 'critical';
    default: return 'nominal';
  }
}

/**
 * Installed before bundled HTML executes. It coalesces every rAF source onto
 * one capped driver, suspends intervals/media/CSS animation while hidden, and
 * exposes a policy endpoint for subsequent native thermal/power updates.
 */
export function createWebPerformanceBootstrap(snapshot = poplurPerformanceManager.getSnapshot()): string {
  const initial = JSON.stringify({
    mode: snapshot.mode,
    targetFPS: snapshot.targetFPS,
    active: snapshot.appState === 'active' && snapshot.documentVisible,
    particlesAllowed: snapshot.particlesAllowed,
    particleDensityMultiplier: snapshot.particleDensityMultiplier,
    dynamicShadowsAllowed: snapshot.dynamicShadowsAllowed,
    postProcessingAllowed: snapshot.postProcessingAllowed,
    maximumTextureResolution: snapshot.maximumTextureResolution,
    expensiveVideoTexturesAllowed: snapshot.expensiveVideoTexturesAllowed,
    maxDevicePixelRatio: snapshot.maxDevicePixelRatio,
  }).replace(/</g, '\\u003c');
  return `;(function(){
    if(window.__poplurPerformanceRuntime){window.__poplurPerformanceRuntime.setPolicy(${initial});return;}
    var nativeRAF=window.requestAnimationFrame.bind(window),nativeCAF=window.cancelAnimationFrame.bind(window);
    var nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);
    var nativeSetInterval=window.setInterval.bind(window),nativeClearInterval=window.clearInterval.bind(window);
    var rafQueue=new Map(),rafSequence=1000000000,driver=0,driverTimer=0,lastFrame=0;
    var intervals=new Map(),intervalSequence=1500000000,timeouts=new Map(),timeoutSequence=1750000000,suspendedMedia=new Set(),pageVisible=true;
    var policy=${initial};
    function runnable(){return policy.active!==false&&pageVisible&&!document.hidden;}
    function targetDelay(){return 1000/Math.max(1,Number(policy.targetFPS)||30);}
    function scheduleDriver(){
      if(!runnable()||driver||driverTimer||rafQueue.size===0)return;
      var delay=Math.max(0,targetDelay()-(performance.now()-lastFrame));
      if(delay>2)driverTimer=nativeSetTimeout(function(){driverTimer=0;scheduleDriver();},delay);
      else driver=nativeRAF(flushFrames);
    }
    function flushFrames(now){
      driver=0;if(!runnable())return;
      if(now-lastFrame+0.5<targetDelay()){scheduleDriver();return;}
      lastFrame=now;var callbacks=Array.from(rafQueue.entries());rafQueue.clear();
      callbacks.forEach(function(pair){try{pair[1](now);}catch(error){nativeSetTimeout(function(){throw error;},0);}});
      scheduleDriver();
    }
    window.requestAnimationFrame=function(callback){var id=++rafSequence;rafQueue.set(id,callback);scheduleDriver();return id;};
    window.cancelAnimationFrame=function(id){rafQueue.delete(id);if(rafQueue.size===0){if(driver)nativeCAF(driver);if(driverTimer)nativeClearTimeout(driverTimer);driver=0;driverTimer=0;}};
    function armInterval(record){
      if(!runnable()||record.timer)return;
      record.timer=nativeSetTimeout(function tick(){
        record.timer=0;if(!intervals.has(record.id))return;
        if(runnable()){try{record.callback.apply(window,record.args);}catch(error){nativeSetTimeout(function(){throw error;},0);}}
        armInterval(record);
      },record.delay);
    }
    window.setInterval=function(callback,delay){
      if(typeof callback!=='function')return nativeSetInterval(callback,delay);
      var id=++intervalSequence,record={id:id,callback:callback,args:Array.prototype.slice.call(arguments,2),delay:Math.max(4,Number(delay)||0),timer:0};
      intervals.set(id,record);armInterval(record);return id;
    };
    window.clearInterval=function(id){var record=intervals.get(id);if(!record){nativeClearInterval(id);return;}if(record.timer)nativeClearTimeout(record.timer);intervals.delete(id);};
    function armTimeout(record){
      if(!runnable()||record.timer)return;
      record.deadline=performance.now()+record.remaining;
      record.timer=nativeSetTimeout(function(){
        record.timer=0;if(!timeouts.delete(record.id))return;
        try{record.callback.apply(window,record.args);}catch(error){nativeSetTimeout(function(){throw error;},0);}
      },record.remaining);
    }
    window.setTimeout=function(callback,delay){
      if(typeof callback!=='function')return nativeSetTimeout(callback,delay);
      var id=++timeoutSequence,record={id:id,callback:callback,args:Array.prototype.slice.call(arguments,2),remaining:Math.max(0,Number(delay)||0),deadline:0,timer:0};
      timeouts.set(id,record);armTimeout(record);return id;
    };
    window.clearTimeout=function(id){var record=timeouts.get(id);if(!record){nativeClearTimeout(id);return;}if(record.timer)nativeClearTimeout(record.timer);timeouts.delete(id);};
    var mediaPrototype=window.HTMLMediaElement&&window.HTMLMediaElement.prototype;
    var nativePlay=mediaPrototype&&mediaPrototype.play;
    if(nativePlay)mediaPrototype.play=function(){if(!runnable()){suspendedMedia.add(this);return Promise.resolve();}return nativePlay.call(this);};
    function pauseWork(){
      if(driver)nativeCAF(driver);if(driverTimer)nativeClearTimeout(driverTimer);driver=0;driverTimer=0;
      intervals.forEach(function(record){if(record.timer)nativeClearTimeout(record.timer);record.timer=0;});
      var pausedAt=performance.now();timeouts.forEach(function(record){if(record.timer){record.remaining=Math.max(0,record.deadline-pausedAt);nativeClearTimeout(record.timer);}record.timer=0;});
      document.querySelectorAll('audio,video').forEach(function(media){if(!media.paused){suspendedMedia.add(media);media.pause();}});
      if(document.documentElement)document.documentElement.classList.add('poplur-performance-paused');
      try{window.speechSynthesis&&window.speechSynthesis.cancel();}catch(e){}
    }
    function resumeWork(){
      if(document.documentElement)document.documentElement.classList.remove('poplur-performance-paused');
      intervals.forEach(armInterval);timeouts.forEach(armTimeout);scheduleDriver();
      Array.from(suspendedMedia).forEach(function(media){suspendedMedia.delete(media);if(media.isConnected){var result=nativePlay&&nativePlay.call(media);if(result&&result.catch)result.catch(function(){});}});
    }
    function sync(){if(runnable())resumeWork();else pauseWork();}
    function apply(next){
      policy=Object.assign({},policy,next||{});
      if(document.documentElement){document.documentElement.dataset.poplurPerformanceMode=policy.mode;document.documentElement.style.setProperty('--poplur-particle-density',String(policy.particleDensityMultiplier));}
      try{window.dispatchEvent(new CustomEvent('poplur-performance-policy',{detail:policy}));}catch(e){}
      sync();
    }
    window.__poplurPerformanceRuntime={setPolicy:apply,getPolicy:function(){return Object.assign({},policy);}};
    window.addEventListener('message',function(event){if(event.data&&event.data.type==='poplur-performance-policy')apply(event.data.policy);});
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('pagehide',function(){pageVisible=false;sync();});
    window.addEventListener('pageshow',function(){pageVisible=true;sync();});
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){
      var style=document.createElement('style');style.textContent='.poplur-performance-paused *{animation-play-state:paused!important}html[data-poplur-performance-mode="LOW_POWER"] #confetti>*:not(:nth-child(4n)){display:none!important}html[data-poplur-performance-mode="EMERGENCY"] #confetti,html[data-poplur-performance-mode="EMERGENCY"] .auth-particle-layer{display:none!important}';document.head.appendChild(style);apply(policy);
    });else apply(policy);
  })();true;`;
}

export function createWebPerformanceUpdate(snapshot = poplurPerformanceManager.getSnapshot()): string {
  const policy = JSON.stringify({
    mode: snapshot.mode,
    targetFPS: snapshot.targetFPS,
    active: snapshot.appState === 'active' && snapshot.documentVisible,
    particlesAllowed: snapshot.particlesAllowed,
    particleDensityMultiplier: snapshot.particleDensityMultiplier,
    dynamicShadowsAllowed: snapshot.dynamicShadowsAllowed,
    postProcessingAllowed: snapshot.postProcessingAllowed,
    maximumTextureResolution: snapshot.maximumTextureResolution,
    expensiveVideoTexturesAllowed: snapshot.expensiveVideoTexturesAllowed,
    maxDevicePixelRatio: snapshot.maxDevicePixelRatio,
  }).replace(/</g, '\\u003c');
  const thermal = JSON.stringify(thermalStateForMode(snapshot.mode));
  return `(function(){var p=${policy};window.__poplurPerformanceRuntime&&window.__poplurPerformanceRuntime.setPolicy(p);window.dispatchEvent(new CustomEvent('poplur-native-thermal',{detail:${thermal}}));window.postMessage({type:'poplur-native-thermal',state:${thermal}},'*');})();true;`;
}

export function webPerformanceMessage(snapshot = poplurPerformanceManager.getSnapshot()) {
  return {
    type: 'poplur-performance-policy',
    policy: {
      mode: snapshot.mode,
      targetFPS: snapshot.targetFPS,
      active: snapshot.appState === 'active' && snapshot.documentVisible,
      particlesAllowed: snapshot.particlesAllowed,
      particleDensityMultiplier: snapshot.particleDensityMultiplier,
      dynamicShadowsAllowed: snapshot.dynamicShadowsAllowed,
      postProcessingAllowed: snapshot.postProcessingAllowed,
      maximumTextureResolution: snapshot.maximumTextureResolution,
      expensiveVideoTexturesAllowed: snapshot.expensiveVideoTexturesAllowed,
      maxDevicePixelRatio: snapshot.maxDevicePixelRatio,
    },
  };
}

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // Construction is side-effect free; actual listeners remain tied to the root
  // runtime component so Fast Refresh cannot accumulate subscriptions.
}
