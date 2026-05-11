/**
 * Utility-aware in-memory cache for heuristic results.
 *
 * Entries are evicted either when their TTL expires or when their
 * recorded utility drops below a caller-supplied threshold during a
 * `prune()` sweep. The cache is intentionally simple: it does not track
 * hits or LRU order. It exists so that fast-path agents can reuse the
 * result of a recent heuristic computation without re-running it.
 */

import type { HeuristicCacheEntry } from "./types.js";

export class HeuristicCache<T> {
  private readonly entries = new Map<string, HeuristicCacheEntry<T>>();

  /**
   * Inserts or replaces an entry. The default TTL is five minutes, which
   * matches the typical reset window of the BudgetEngine.
   */
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

  /**
   * Returns the value for `key` if it exists and has not expired.
   * Expired entries are evicted lazily during the lookup.
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Drops every expired entry, plus any entry whose stored utility is
   * below `minUtility`. Returns the number of removed entries so that
   * callers can log or trace the sweep.
   */
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
