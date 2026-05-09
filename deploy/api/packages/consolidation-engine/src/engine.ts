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
  readonly model?: ConsolidationModel;
  readonly searchClient?: ReplaySearchClient;
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
        embedding: semanticMemory.embedding,
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

  async selectReplayCandidates(
    request: ConsolidationRequest,
  ): Promise<ReadonlyArray<ReplayCandidate>> {
    const query = buildReplaySelectionQuery({
      maxAge: request.maxAge,
      size: request.size ?? 100,
      minImportance: request.minImportance ?? 0.1,
      timestampField: "timestamp",
      usageField: "retrieval_count",
    });
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

function stabilityScore(candidates: ReadonlyArray<ReplayCandidate>): number {
  const importance = average(candidates.map((candidate) => candidate.importanceScore));
  const reward = average(candidates.map((candidate) => candidate.rewardScore));
  return clamp((importance + reward) / 2);
}

function contradictionScore(candidates: ReadonlyArray<ReplayCandidate>): number {
  const negativeSignals = candidates.filter((candidate) =>
    /\b(contradict|conflict|failed|error)\b/i.test(candidate.summary),
  );
  return clamp(negativeSignals.length / candidates.length);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
