/**
 * Consolidation engine orchestrator.
 *
 * One `consolidate()` call runs the full sleep cycle:
 *   1. Select replay candidates from `experience_events` using a decay-aware
 *      query (`buildReplaySelectionQuery`).
 *   2. Hand them to the configured `ConsolidationModel` to produce a draft.
 *   3. Materialise the draft as a `SemanticMemory` and write it into the
 *      `memory_semantic` index with a fresh `decay_factor` of 1.0.
 *   4. Bump the source events' `retrieval_count` so that future replay
 *      cycles do not re-select them as aggressively.
 *
 * The engine takes a `ConsolidationEngineConfig` to allow injection of a
 * custom search client, model, or index writer for tests.
 */

import { randomUUID } from "node:crypto";
import type { Client } from "@opensearch-project/opensearch";
import type { SemanticMemory } from "@cognitive-substrate/core-types";
import {
  buildReplaySelectionQuery,
  indexDocument,
  search,
  updateDocument,
} from "@cognitive-substrate/memory-opensearch";
import { ExtractiveConsolidationModel } from "./model.js";
import type {
  ConsolidationModel,
  ConsolidationRequest,
  ConsolidationResult,
  ExperienceReplayDocument,
  ReplayCandidate,
} from "./types.js";

type ReplaySearchClient = typeof search<ExperienceReplayDocument>;

export interface ConsolidationEngineConfig {
  readonly openSearch: Client;
  /** Defaults to `ExtractiveConsolidationModel`. */
  readonly model?: ConsolidationModel;
  /** Override hook for tests; defaults to the production `search` client. */
  readonly searchClient?: ReplaySearchClient;
  /** Override hook for tests; defaults to the production `indexDocument`. */
  readonly indexMemory?: typeof indexDocument;
}

export class ConsolidationEngine {
  private readonly openSearch: Client;
  private readonly model: ConsolidationModel;
  private readonly searchClient: ReplaySearchClient;
  private readonly indexMemory: typeof indexDocument;

  constructor(config: ConsolidationEngineConfig) {
    this.openSearch = config.openSearch;
    this.model = config.model ?? new ExtractiveConsolidationModel();
    this.searchClient = config.searchClient ?? search<ExperienceReplayDocument>;
    this.indexMemory = config.indexMemory ?? indexDocument;
  }

  /**
   * Runs one consolidation cycle. Throws when no candidates are eligible,
   * since downstream subscribers expect a non-empty `sourceEventIds` list.
   */
  async consolidate(request: ConsolidationRequest): Promise<ConsolidationResult> {
    const candidates = await this.selectReplayCandidates(request);
    if (candidates.length === 0) {
      throw new Error("consolidation requires at least one replay candidate");
    }

    const draft = await this.model.generate(candidates);
    const now = new Date().toISOString();
    const semanticMemory: SemanticMemory = {
      memoryId: randomUUID(),
      createdAt: now,
      summary: draft.summary,
      generalization: draft.generalization,
      embedding: draft.embedding,
      sourceEventIds: candidates.map((candidate) => candidate.memoryId),
      importanceScore: average(candidates.map((candidate) => candidate.importanceScore)),
      stabilityScore: stabilityScore(candidates),
      contradictionScore: contradictionScore(candidates),
      ...(draft.semanticCluster ? { semanticCluster: draft.semanticCluster } : {}),
      usageFrequency: 0,
    };

    await this.indexMemory(
      this.openSearch,
      "memory_semantic",
      semanticMemory.memoryId,
      {
        memory_id: semanticMemory.memoryId,
        created_at: semanticMemory.createdAt,
        summary: semanticMemory.summary,
        generalization: semanticMemory.generalization,
        ...(semanticMemory.embedding.length > 0 ? { embedding: semanticMemory.embedding } : {}),
        source_event_ids: semanticMemory.sourceEventIds,
        importance_score: semanticMemory.importanceScore,
        stability_score: semanticMemory.stabilityScore,
        contradiction_score: semanticMemory.contradictionScore,
        semantic_cluster: semanticMemory.semanticCluster,
        usage_frequency: semanticMemory.usageFrequency,
        decay_factor: 1.0,
      },
    );

    await this.markCandidatesConsolidated(candidates);

    return {
      requestId: request.requestId,
      timestamp: now,
      semanticMemory,
      sourceEventIds: semanticMemory.sourceEventIds,
    };
  }

  /**
   * Queries `experience_events` for replay candidates ordered by decay
   * factor and importance. The returned shape projects raw hits into the
   * `ReplayCandidate` interface used by the consolidation model.
   */
  async selectReplayCandidates(
    request: ConsolidationRequest,
  ): Promise<ReadonlyArray<ReplayCandidate>> {
    const baseQuery = buildReplaySelectionQuery({
      maxAge: request.maxAge,
      size: request.size ?? 100,
      minImportance: request.minImportance ?? 0.1,
      timestampField: "timestamp",
      usageField: "retrieval_count",
    });

    // Overlay required tag filters when specified, without touching sort/size.
    const query = request.requiredTags && request.requiredTags.length > 0
      ? {
          ...baseQuery,
          query: {
            bool: {
              must: [
                baseQuery["query"] as Record<string, unknown>,
                ...request.requiredTags.map((tag) => ({ term: { tags: tag } })),
              ],
            },
          },
        }
      : baseQuery;

    const hits = await this.searchClient(this.openSearch, "experience_events", query);

    return hits.map((hit) => {
      const source = hit._source;
      return {
        memoryId: source.event_id ?? hit._id,
        timestamp: source.timestamp ?? request.timestamp,
        summary: source.summary ?? "",
        embedding: source.embedding ?? [],
        importanceScore: source.importance_score ?? 0,
        rewardScore: source.reward_score ?? 0.5,
        retrievalCount: source.retrieval_count ?? 0,
        tags: source.tags ?? [],
      };
    });
  }

  /**
   * Increments the source events' `retrieval_count`. Errors are swallowed
   * because partial failure of this bookkeeping step should not invalidate
   * the consolidated memory that has already been written.
   */
  private async markCandidatesConsolidated(
    candidates: ReadonlyArray<ReplayCandidate>,
  ): Promise<void> {
    await Promise.all(
      candidates.map((candidate) =>
        updateDocument(this.openSearch, "experience_events", candidate.memoryId, {
          retrieval_count: candidate.retrievalCount + 1,
        }).catch(() => undefined),
      ),
    );
  }
}

function average(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Coarse stability proxy: average of importance and reward across the
 * replayed candidates. Used to seed the new semantic memory's
 * `stabilityScore` until later reinforcement cycles refine it.
 */
function stabilityScore(candidates: ReadonlyArray<ReplayCandidate>): number {
  const importance = average(candidates.map((candidate) => candidate.importanceScore));
  const reward = average(candidates.map((candidate) => candidate.rewardScore));
  return clamp((importance + reward) / 2);
}

/**
 * Heuristic detection of contradictions by scanning the replayed summary
 * text for negative-signal words. The score reports the fraction of
 * candidates that hit the regex; later passes can replace this with a
 * proper semantic-contradiction check.
 */
function contradictionScore(candidates: ReadonlyArray<ReplayCandidate>): number {
  const negativeSignals = candidates.filter((candidate) =>
    /\b(contradict|conflict|failed|error)\b/i.test(candidate.summary),
  );
  return clamp(negativeSignals.length / candidates.length);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
