/**
 * Persistence implementations for `AgentActivityTrace`.
 *
 * `NoopAgentActivityStore` discards traces; useful for tests and for
 * deployments that have not yet enabled per-agent observability.
 * `OpenSearchAgentActivityStore` writes each trace to the
 * `agent_activity` index keyed by `traceId`, where the workbench reads
 * it to render the multi-agent debate timeline.
 */

import type { Client } from "@opensearch-project/opensearch";
import type { AgentActivityTrace } from "@cognitive-substrate/core-types";
import { indexDocument } from "@cognitive-substrate/memory-opensearch";
import type { AgentActivityStore } from "./types.js";

export class NoopAgentActivityStore implements AgentActivityStore {
  async record(): Promise<void> {
    return undefined;
  }
}

export interface OpenSearchAgentActivityStoreConfig {
  readonly openSearch: Client;
  readonly indexTrace?: typeof indexDocument;
}

export class OpenSearchAgentActivityStore implements AgentActivityStore {
  private readonly openSearch: Client;
  private readonly indexTrace: typeof indexDocument;

  constructor(config: OpenSearchAgentActivityStoreConfig) {
    this.openSearch = config.openSearch;
    this.indexTrace = config.indexTrace ?? indexDocument;
  }

  async record(trace: AgentActivityTrace): Promise<void> {
    await this.indexTrace(this.openSearch, "agent_activity", trace.traceId, {
      trace_id: trace.traceId,
      timestamp: trace.timestamp,
      agent_type: trace.agentType,
      input_summary: trace.inputSummary,
      proposed_action: trace.proposedAction,
      confidence: trace.confidence,
      score: trace.score,
      selected: trace.selected,
      ...(trace.critique ? { critique: trace.critique } : {}),
      ...(trace.embedding ? { embedding: trace.embedding } : {}),
    });
  }
}
