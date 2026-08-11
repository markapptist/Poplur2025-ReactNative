export type PoplurAssetKind =
  | 'model'
  | 'texture'
  | 'scene'
  | 'image'
  | 'video'
  | 'temporary';

export type PoplurAssetDisposer = () => void | Promise<void>;

export type PoplurAssetCacheLimits = {
  maxBytes: number;
  maxEntries: number;
  maxEntriesByKind: Record<PoplurAssetKind, number>;
};

export type PoplurAssetCacheEntry<T> = {
  key: string;
  kind: PoplurAssetKind;
  value: T;
  estimatedBytes: number;
  dispose?: PoplurAssetDisposer;
};

export type PoplurAssetCacheAdmission =
  | { admitted: true; evictedKeys: string[] }
  | { admitted: false; reason: 'invalid-cost' | 'entry-too-large' | 'active-entry' | 'capacity'; evictedKeys: string[] };

type StoredEntry<T = unknown> = PoplurAssetCacheEntry<T> & {
  activeLeases: number;
  lastAccess: number;
  disposed: boolean;
};

export type PoplurAssetCacheDiagnostics = {
  estimatedBytes: number;
  maxBytes: number;
  entryCount: number;
  maxEntries: number;
  activeLeaseCount: number;
  rejectedAdmissions: number;
  evictionCount: number;
  entriesByKind: Record<PoplurAssetKind, number>;
};

const MIB = 1024 * 1024;
const kinds: PoplurAssetKind[] = ['model', 'texture', 'scene', 'image', 'video', 'temporary'];

export const POPLUR_CACHE_TIERS = {
  low: 150 * MIB,
  mid: 300 * MIB,
  high: 450 * MIB,
} as const;

const DEFAULT_LIMITS: PoplurAssetCacheLimits = {
  maxBytes: POPLUR_CACHE_TIERS.mid,
  maxEntries: 128,
  maxEntriesByKind: {
    model: 12,
    texture: 48,
    scene: 6,
    image: 48,
    video: 3,
    temporary: 12,
  },
};

/**
 * A deterministic, cost-aware application asset cache. This bounds resources
 * owned by Poplur; it is deliberately not described as a process-RAM limit.
 */
export class PoplurAssetCache {
  private entries = new Map<string, StoredEntry>();
  private limits: PoplurAssetCacheLimits;
  private estimatedBytes = 0;
  private clock = 0;
  private rejectedAdmissions = 0;
  private evictionCount = 0;

  constructor(limits: Partial<PoplurAssetCacheLimits> = {}) {
    this.limits = this.normalizedLimits(limits);
  }

  configure(limits: Partial<PoplurAssetCacheLimits>): string[] {
    this.limits = this.normalizedLimits({
      ...this.limits,
      ...limits,
      maxEntriesByKind: {
        ...this.limits.maxEntriesByKind,
        ...limits.maxEntriesByKind,
      },
    });
    // A mode change is a hard boundary, not a hint. If active leases prevent
    // normal LRU eviction, revoke the oldest leases deterministically and run
    // their disposer so diagnostics can never report a cache above its caps.
    // Callers retaining GPU/media values must treat their disposer as the
    // invalidation signal and recreate the resource on their next active pass.
    return this.evictUntilWithinLimits(true);
  }

  admit<T>(entry: PoplurAssetCacheEntry<T>): PoplurAssetCacheAdmission {
    const estimatedBytes = Number(entry.estimatedBytes);
    if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
      this.rejectedAdmissions += 1;
      return { admitted: false, reason: 'invalid-cost', evictedKeys: [] };
    }
    if (estimatedBytes > this.limits.maxBytes || this.limits.maxEntriesByKind[entry.kind] < 1) {
      this.rejectedAdmissions += 1;
      return { admitted: false, reason: 'entry-too-large', evictedKeys: [] };
    }

    const existing = this.entries.get(entry.key);
    if (existing?.activeLeases) {
      this.rejectedAdmissions += 1;
      return { admitted: false, reason: 'active-entry', evictedKeys: [] };
    }
    if (existing) this.removeEntry(existing, true);

    const evictedKeys: string[] = [];
    const roomForKind = this.limits.maxEntriesByKind[entry.kind] - 1;
    evictedKeys.push(...this.evictInactive(entry.kind, Number.POSITIVE_INFINITY, roomForKind));

    while (
      this.estimatedBytes + estimatedBytes > this.limits.maxBytes
      || this.entries.size + 1 > this.limits.maxEntries
    ) {
      const victim = this.oldestInactive();
      if (!victim) break;
      evictedKeys.push(victim.key);
      this.removeEntry(victim, true);
    }

    if (
      this.estimatedBytes + estimatedBytes > this.limits.maxBytes
      || this.entries.size + 1 > this.limits.maxEntries
      || this.count(entry.kind) + 1 > this.limits.maxEntriesByKind[entry.kind]
    ) {
      this.rejectedAdmissions += 1;
      this.disposeSafely({ ...entry, activeLeases: 0, lastAccess: 0, disposed: false });
      return { admitted: false, reason: 'capacity', evictedKeys };
    }

    this.entries.set(entry.key, {
      ...entry,
      estimatedBytes,
      activeLeases: 0,
      lastAccess: ++this.clock,
      disposed: false,
    });
    this.estimatedBytes += estimatedBytes;
    return { admitted: true, evictedKeys };
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastAccess = ++this.clock;
    return entry.value as T;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  retain<T>(key: string): { value: T; release: () => void } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.activeLeases += 1;
    entry.lastAccess = ++this.clock;
    let released = false;
    return {
      value: entry.value as T,
      release: () => {
        if (released) return;
        released = true;
        entry.activeLeases = Math.max(0, entry.activeLeases - 1);
        entry.lastAccess = ++this.clock;
        this.evictUntilWithinLimits();
      },
    };
  }

  delete(key: string, force = false): boolean {
    const entry = this.entries.get(key);
    if (!entry || (!force && entry.activeLeases > 0)) return false;
    this.removeEntry(entry, true);
    return true;
  }

  purgeInactive(kind?: PoplurAssetKind): string[] {
    return this.evictInactive(kind, Number.POSITIVE_INFINITY, 0);
  }

  purgeMatching(predicate: (key: string, kind: PoplurAssetKind) => boolean, force = false): string[] {
    const removed: string[] = [];
    for (const entry of [...this.entries.values()]) {
      if (!predicate(entry.key, entry.kind) || (!force && entry.activeLeases > 0)) continue;
      removed.push(entry.key);
      this.removeEntry(entry, true);
    }
    return removed;
  }

  handleMemoryPressure(level: 'warning' | 'critical'): string[] {
    if (level === 'critical') return this.purgeMatching(() => true, true);
    const targetBytes = Math.floor(this.limits.maxBytes * 0.5);
    const removed: string[] = [];
    while (this.estimatedBytes > targetBytes) {
      const victim = this.oldestEntry(undefined, true);
      if (!victim) break;
      removed.push(victim.key);
      this.removeEntry(victim, true);
    }
    return removed;
  }

  diagnostics(): PoplurAssetCacheDiagnostics {
    const entriesByKind = Object.fromEntries(kinds.map(kind => [kind, this.count(kind)])) as Record<PoplurAssetKind, number>;
    let activeLeaseCount = 0;
    for (const entry of this.entries.values()) activeLeaseCount += entry.activeLeases;
    return {
      estimatedBytes: this.estimatedBytes,
      maxBytes: this.limits.maxBytes,
      entryCount: this.entries.size,
      maxEntries: this.limits.maxEntries,
      activeLeaseCount,
      rejectedAdmissions: this.rejectedAdmissions,
      evictionCount: this.evictionCount,
      entriesByKind,
    };
  }

  private normalizedLimits(limits: Partial<PoplurAssetCacheLimits>): PoplurAssetCacheLimits {
    const maxEntriesByKind = { ...DEFAULT_LIMITS.maxEntriesByKind, ...limits.maxEntriesByKind };
    for (const kind of kinds) maxEntriesByKind[kind] = Math.max(0, Math.floor(maxEntriesByKind[kind]));
    return {
      maxBytes: Math.max(0, Math.floor(limits.maxBytes ?? DEFAULT_LIMITS.maxBytes)),
      maxEntries: Math.max(0, Math.floor(limits.maxEntries ?? DEFAULT_LIMITS.maxEntries)),
      maxEntriesByKind,
    };
  }

  private count(kind: PoplurAssetKind): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.kind === kind) count += 1;
    return count;
  }

  private oldestEntry(kind?: PoplurAssetKind, includeActive = false): StoredEntry | undefined {
    let oldest: StoredEntry | undefined;
    for (const entry of this.entries.values()) {
      if ((!includeActive && entry.activeLeases > 0) || (kind && entry.kind !== kind)) continue;
      if (!oldest || entry.lastAccess < oldest.lastAccess || (
        entry.lastAccess === oldest.lastAccess && entry.key.localeCompare(oldest.key) < 0
      )) oldest = entry;
    }
    return oldest;
  }

  private oldestInactive(kind?: PoplurAssetKind): StoredEntry | undefined {
    return this.oldestEntry(kind, false);
  }

  private evictInactive(kind?: PoplurAssetKind, maxRemovals = Number.POSITIVE_INFINITY, targetCount = 0): string[] {
    const removed: string[] = [];
    while (removed.length < maxRemovals && (kind ? this.count(kind) : this.entries.size) > targetCount) {
      const victim = this.oldestInactive(kind);
      if (!victim) break;
      removed.push(victim.key);
      this.removeEntry(victim, true);
    }
    return removed;
  }

  private evictUntilWithinLimits(force = false): string[] {
    const removed: string[] = [];
    for (const kind of kinds) {
      removed.push(...this.evictInactive(kind, Number.POSITIVE_INFINITY, this.limits.maxEntriesByKind[kind]));
      while (force && this.count(kind) > this.limits.maxEntriesByKind[kind]) {
        const victim = this.oldestEntry(kind, true);
        if (!victim) break;
        removed.push(victim.key);
        this.removeEntry(victim, true);
      }
    }
    while (this.estimatedBytes > this.limits.maxBytes || this.entries.size > this.limits.maxEntries) {
      const victim = this.oldestEntry(undefined, force);
      if (!victim) break;
      removed.push(victim.key);
      this.removeEntry(victim, true);
    }
    return removed;
  }

  private removeEntry(entry: StoredEntry, dispose: boolean) {
    if (!this.entries.delete(entry.key)) return;
    this.estimatedBytes = Math.max(0, this.estimatedBytes - entry.estimatedBytes);
    this.evictionCount += 1;
    if (dispose) this.disposeSafely(entry);
  }

  private disposeSafely(entry: StoredEntry) {
    if (entry.disposed) return;
    entry.disposed = true;
    try {
      const result = entry.dispose?.();
      if (result && typeof result.catch === 'function') {
        void result.catch(error => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[PoplurPerformance] Asset disposer failed', entry.key, error);
          }
        });
      }
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[PoplurPerformance] Asset disposer failed', entry.key, error);
      }
    }
  }
}

export const poplurAssetCache = new PoplurAssetCache();
