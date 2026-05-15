/**
 * Memory surface breadth metric.
 *
 * Measures how broadly retrieval is distributed across the memory index
 * over a sequence of turns. A system that repeatedly retrieves the same
 * memories scores near zero; one that surfaces a diverse set scores near one.
 *
 * The metric is Shannon entropy over the empirical distribution of retrieved
 * memory IDs, normalised by log2(uniqueCount) so the result is always in
 * [0, 1] regardless of corpus size.
 *
 *   H = -Σ p(id) × log2(p(id))
 *   breadth = H / log2(uniqueCount)    // 0 when all retrievals are identical,
 *                                      // 1 when every retrieval is unique
 *
 * Pass the full sequence of RetrievalResult objects from an experiment run
 * to `computeRetrievalBreadth`. Individual turn results can be accumulated
 * incrementally via `RetrievalBreadthAccumulator` when streaming turns.
 */

import type { RetrievalResult } from "./types.js";

export interface RetrievalBreadthResult {
  /** Shannon entropy of the retrieved-memory-ID distribution, in bits. */
  readonly entropy: number;
  /** Entropy normalised to [0, 1] by log2(uniqueCount). Zero when only one unique ID was seen. */
  readonly breadth: number;
  /** Total number of memory references observed across all turns. */
  readonly totalReferences: number;
  /** Number of distinct memory IDs observed. */
  readonly uniqueMemoryIds: number;
  /** Retrieval count per memory ID, sorted descending. */
  readonly distribution: ReadonlyArray<{ memoryId: string; count: number }>;
}

/**
 * Computes retrieval breadth from a completed sequence of retrieval results.
 * Returns `breadth: 0` when no memories were retrieved.
 */
export function computeRetrievalBreadth(
  results: ReadonlyArray<RetrievalResult>,
): RetrievalBreadthResult {
  const accumulator = new RetrievalBreadthAccumulator();
  for (const result of results) {
    accumulator.observe(result);
  }
  return accumulator.compute();
}

/**
 * Incremental accumulator for streaming experiment runs where results
 * arrive turn-by-turn rather than all at once.
 */
export class RetrievalBreadthAccumulator {
  private readonly counts = new Map<string, number>();

  observe(result: RetrievalResult): void {
    for (const memory of result.memories) {
      this.counts.set(memory.memoryId, (this.counts.get(memory.memoryId) ?? 0) + 1);
    }
  }

  compute(): RetrievalBreadthResult {
    const total = [...this.counts.values()].reduce((sum, n) => sum + n, 0);
    const uniqueMemoryIds = this.counts.size;

    if (total === 0 || uniqueMemoryIds === 0) {
      return { entropy: 0, breadth: 0, totalReferences: 0, uniqueMemoryIds: 0, distribution: [] };
    }

    let entropy = 0;
    for (const count of this.counts.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }

    const maxEntropy = Math.log2(uniqueMemoryIds);
    const breadth = maxEntropy > 0 ? entropy / maxEntropy : 0;

    const distribution = [...this.counts.entries()]
      .map(([memoryId, count]) => ({ memoryId, count }))
      .sort((a, b) => b.count - a.count);

    return { entropy, breadth, totalReferences: total, uniqueMemoryIds, distribution };
  }
}
