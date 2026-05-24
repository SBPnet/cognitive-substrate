import type { Client } from "@opensearch-project/opensearch";
import type { SelfModificationProposal } from "@cognitive-substrate/core-types";
import {
  indexDocument,
  updateDocument,
  search,
  getDocument,
} from "@cognitive-substrate/memory-opensearch";

export type ProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'rolled_back';

export interface ProposalRecord {
  readonly mutationId: string;
  readonly status: ProposalStatus;
  readonly proposal: SelfModificationProposal;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly appliedAt: string | null;
  readonly outcomeNotes: string | null;
  readonly createdAt: string;
}

export class ProposalStore {
  constructor(private readonly client: Client) {}

  async save(proposal: SelfModificationProposal): Promise<void> {
    const record = {
      mutation_id: proposal.mutationId,
      status: 'pending' as ProposalStatus,
      mutation_type: proposal.mutationType,
      description: proposal.description,
      expected_gain: proposal.expectedGain,
      stability_risk: proposal.stabilityRisk,
      payload: proposal.payload,
      reviewed_by: null,
      reviewed_at: null,
      applied_at: null,
      outcome_notes: null,
      created_at: proposal.timestamp,
    };
    await indexDocument(this.client, 'substrate_proposals', proposal.mutationId, record);
  }

  async updateStatus(
    mutationId: string,
    status: ProposalStatus,
    meta: {
      reviewedBy?: string;
      outcomeNotes?: string;
    } = {},
  ): Promise<void> {
    const partial: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    if (status === 'approved' || status === 'rejected') {
      partial['reviewed_by'] = meta.reviewedBy ?? null;
      partial['reviewed_at'] = now;
    }
    if (status === 'applied') {
      partial['applied_at'] = now;
      if (meta.outcomeNotes) partial['outcome_notes'] = meta.outcomeNotes;
    }
    await updateDocument(this.client, 'substrate_proposals', mutationId, partial);
  }

  async listPending(): Promise<ProposalRecord[]> {
    const hits = await search<Record<string, unknown>>(this.client, 'substrate_proposals', {
      query: { term: { status: 'pending' } },
      sort: [{ created_at: { order: 'asc' } }],
      size: 50,
    });
    return hits.map(toRecord);
  }

  async get(mutationId: string): Promise<ProposalRecord | null> {
    try {
      const doc = await getDocument<Record<string, unknown>>(
        this.client,
        'substrate_proposals',
        mutationId,
      );
      return doc ? toRecord({ _id: mutationId, _score: 1, _source: doc }) : null;
    } catch {
      return null;
    }
  }
}

function toRecord(hit: { _id: string; _score: number; _source: Record<string, unknown> }): ProposalRecord {
  const s = hit._source;
  return {
    mutationId: (s['mutation_id'] as string | undefined) ?? hit._id,
    status: (s['status'] as ProposalStatus | undefined) ?? 'pending',
    proposal: {
      mutationId: (s['mutation_id'] as string | undefined) ?? hit._id,
      timestamp: (s['created_at'] as string | undefined) ?? new Date().toISOString(),
      mutationType: (s['mutation_type'] as SelfModificationProposal['mutationType'] | undefined) ?? 'metric_capture',
      description: (s['description'] as string | undefined) ?? '',
      expectedGain: (s['expected_gain'] as number | undefined) ?? 0,
      stabilityRisk: (s['stability_risk'] as number | undefined) ?? 0,
      approved: s['status'] === 'approved',
      rollbackAvailable: true,
      payload: (s['payload'] as SelfModificationProposal['payload'] | undefined) ?? {
        indexName: 'experience_events',
        fieldName: 'unknown',
        fieldType: 'float',
        reason: '',
      },
    },
    reviewedBy: (s['reviewed_by'] as string | null | undefined) ?? null,
    reviewedAt: (s['reviewed_at'] as string | null | undefined) ?? null,
    appliedAt: (s['applied_at'] as string | null | undefined) ?? null,
    outcomeNotes: (s['outcome_notes'] as string | null | undefined) ?? null,
    createdAt: (s['created_at'] as string | undefined) ?? new Date().toISOString(),
  };
}
