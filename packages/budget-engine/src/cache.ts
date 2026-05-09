import type { HeuristicCacheEntry } from "./types.js";

export class HeuristicCache<T> {
  private readonly entries = new Map<string, HeuristicCacheEntry<T>>();

  set(key: string, value: T, utility: number, ttlMs: number = 300_000): HeuristicCacheEntry<T> {
    const now = Date.now();
    const entry: HeuristicCacheEntry<T> = {
      key,
      value,
      utility,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.entries.set(key, entry);
    return entry;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  prune(minUtility: number = 0): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now || entry.utility < minUtility) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
