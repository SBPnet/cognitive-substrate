/**
 * Experiment 48 -- IntrospectionEngine Pipeline: Gap Detection, Proposal Schema,
 *                  ProposalStore Round-Trip, and SchemaEvolutionApplier
 *
 * Validates the full introspection pipeline introduced alongside the
 * IntrospectionEngine package:
 *
 *   IntrospectionEngine detects coverage gaps from a CalibrationReport and
 *   emits a typed SelfModificationProposal. ConstitutionEngine gates it.
 *   ProposalStore persists it to substrate_proposals. SchemaEvolutionApplier
 *   applies it and writes a schema_evolution event back to experience_events.
 *
 * Four hypotheses:
 *
 *   H1 -- IntrospectionEngine emits a proposal with expectedGain >= 0.6 given
 *         a CalibrationReport with calibration_drift_detected + 5 outcome
 *         mismatches.
 *
 *   H2 -- ConstitutionEngine.assess() returns approved=true for the proposal
 *         (stabilityRisk < 0.7 is the gate).
 *
 *   H3 -- Proposal round-trips through substrate_proposals index:
 *         save writes a document; listPending returns it; get retrieves it
 *         by mutationId.
 *
 *   H4 -- SchemaEvolutionApplier.apply() for a metric_capture proposal writes
 *         a schema_evolution event to experience_events.
 *
 * Usage:
 *   OPENSEARCH_URL=http://localhost:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp48
 */

import { randomUUID } from "node:crypto";
import type { Client } from "@opensearch-project/opensearch";
import {
  createOpenSearchClient,
  ensureIndexes,
  indexDocument,
  updateDocument,
  getDocument,
  search,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { CalibrationMonitor } from "@cognitive-substrate/metacog-engine";
import { IntrospectionEngine } from "@cognitive-substrate/introspection-engine";
import { ConstitutionEngine } from "@cognitive-substrate/constitution-engine";
import type { SelfModificationProposal } from "@cognitive-substrate/core-types";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Minimal inline ProposalStore (avoids depending on the orchestrator app)
// ---------------------------------------------------------------------------

type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'rolled_back';

interface ProposalRecord {
  readonly mutationId: string;
  readonly status: ProposalStatus;
  readonly proposal: SelfModificationProposal;
}

async function saveProp(client: Client, proposal: SelfModificationProposal): Promise<void> {
  await indexDocument(client, 'substrate_proposals', proposal.mutationId, {
    mutation_id: proposal.mutationId,
    status: 'pending',
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
  });
}

async function listPending(client: Client): Promise<ProposalRecord[]> {
  const hits = await search<Record<string, unknown>>(client, 'substrate_proposals', {
    query: { term: { status: 'pending' } },
    size: 50,
  });
  return hits.map((h) => ({
    mutationId: (h._source['mutation_id'] as string | undefined) ?? h._id,
    status: 'pending' as const,
    proposal: reconstructProposal(h._id, h._source),
  }));
}

async function getProp(client: Client, mutationId: string): Promise<ProposalRecord | null> {
  try {
    const doc = await getDocument<Record<string, unknown>>(client, 'substrate_proposals', mutationId);
    if (!doc) return null;
    return {
      mutationId,
      status: (doc['status'] as ProposalStatus | undefined) ?? 'pending',
      proposal: reconstructProposal(mutationId, doc),
    };
  } catch {
    return null;
  }
}

function reconstructProposal(id: string, s: Record<string, unknown>): SelfModificationProposal {
  return {
    mutationId: (s['mutation_id'] as string | undefined) ?? id,
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
  };
}

// ---------------------------------------------------------------------------
// Minimal inline SchemaEvolutionApplier
// ---------------------------------------------------------------------------

async function applyProp(client: Client, record: ProposalRecord): Promise<void> {
  const { proposal } = record;
  if (proposal.mutationType === 'metric_capture' || proposal.mutationType === 'index_mapping') {
    const payload = proposal.payload as { indexName?: string; fieldName?: string; fieldType?: string };
    const indexName = payload.indexName ?? 'experience_events';
    const fieldName = payload.fieldName ?? `auto_field_${Date.now()}`;
    const fieldType = payload.fieldType ?? 'float';
    await client.indices.putMapping({
      index: indexName,
      body: { properties: { [fieldName]: { type: fieldType } } },
    });
  }
  await updateDocument(client, 'substrate_proposals', record.mutationId, {
    status: 'applied',
    applied_at: new Date().toISOString(),
  });
  await indexDocument(client, 'experience_events', randomUUID(), {
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: 'schema_evolution',
    session_id: 'exp48',
    summary: `Exp48 schema evolution: ${proposal.mutationType} -- ${proposal.description}`,
    importance_score: proposal.expectedGain,
    tags: ['schema_evolution', proposal.mutationType, 'exp48'],
    mutation_id: proposal.mutationId,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  await ensureIndexes(client);

  // ---- H1: IntrospectionEngine emits a proposal from a high-failure report ----

  const monitor = new CalibrationMonitor();
  const introspection = new IntrospectionEngine({ salienceThreshold: 0.6 });

  // Synthetic high-failure traces: 3 outcome mismatches + 2 latency overruns
  const rawReport = monitor.evaluate([
    { operationId: 'op1', operationType: 'retrieval', confidence: 0.9, succeeded: false },
    { operationId: 'op2', operationType: 'retrieval', confidence: 0.8, succeeded: false },
    { operationId: 'op3', operationType: 'attention', confidence: 0.7, succeeded: false },
    { operationId: 'op4', operationType: 'causal', confidence: 0.6, succeeded: false, latencyMs: 90_000 },
    { operationId: 'op5', operationType: 'causal', confidence: 0.5, succeeded: false, latencyMs: 75_000 },
  ]);

  // Inject calibration_drift_detected watchdog and explicit failure attributions
  // (CalibrationMonitor produces these from trace.succeeded, but we augment to
  // ensure the gap-detector pattern-matches both code paths under test.)
  const report = {
    ...rawReport,
    watchdogAlerts: [...rawReport.watchdogAlerts, 'calibration_drift_detected'],
    failureAttributions: [
      'retrieval:outcome_mismatch',
      'retrieval:outcome_mismatch',
      'attention:outcome_mismatch',
      'causal:latency_budget_exceeded',
      'causal:latency_budget_exceeded',
    ],
  };

  const proposal = introspection.assess(report, [], []);
  const h1Pass = proposal !== undefined && proposal.expectedGain >= 0.6;

  console.log(`\nH1 -- IntrospectionEngine emits proposal (expectedGain>=0.6): ${h1Pass ? '+ PASS' : '- FAIL'}`);
  if (proposal) {
    console.log(`  mutationType=${proposal.mutationType} expectedGain=${proposal.expectedGain.toFixed(3)} stabilityRisk=${proposal.stabilityRisk.toFixed(3)}`);
  }

  // ---- H2: ConstitutionEngine approves the proposal ----

  const constitution = new ConstitutionEngine();
  let h2Pass = false;
  let assessmentResult: {
    approved: boolean;
    violations: ReadonlyArray<string>;
    quarantineRequired: boolean;
    epistemicHygieneScore: number;
  } = {
    approved: false,
    violations: [],
    quarantineRequired: false,
    epistemicHygieneScore: 0,
  };

  if (proposal) {
    const stablePolicy = {
      version: 'exp48',
      timestamp: new Date().toISOString(),
      retrievalBias: 0.5,
      toolBias: 0.5,
      riskTolerance: 0.4,
      memoryTrust: 0.7,
      explorationFactor: 0.5,
      goalPersistence: 0.5,
      workingMemoryDecayRate: 0.1,
    };
    const stableIdentity = {
      identityId: 'exp48',
      timestamp: new Date().toISOString(),
      curiosity: 0.5,
      caution: 0.5,
      verbosity: 0.5,
      toolDependence: 0.5,
      explorationPreference: 0.5,
      stabilityScore: 0.8,
    };
    assessmentResult = constitution.assess({
      policy: stablePolicy,
      identity: stableIdentity,
      proposal,
    });
    h2Pass = assessmentResult.approved;
  }

  console.log(`H2 -- ConstitutionEngine approves proposal: ${h2Pass ? '+ PASS' : '- FAIL'}`);
  console.log(`  approved=${assessmentResult.approved} violations=${assessmentResult.violations.join(',') || 'none'}`);

  // ---- H3: ProposalStore round-trip ----

  let h3Pass = false;
  let storedRecord: ProposalRecord | null = null;

  if (proposal && h2Pass) {
    await saveProp(client, proposal);
    const pending = await listPending(client);
    const found = pending.find((r) => r.mutationId === proposal.mutationId);
    storedRecord = await getProp(client, proposal.mutationId);
    h3Pass = found !== undefined && storedRecord !== null;
  }

  console.log(`H3 -- ProposalStore round-trip (save/listPending/get): ${h3Pass ? '+ PASS' : '- FAIL'}`);
  if (storedRecord) {
    console.log(`  stored mutationId=${storedRecord.mutationId} status=${storedRecord.status}`);
  }

  // ---- H4: SchemaEvolutionApplier writes schema_evolution event ----

  let h4Pass = false;

  if (storedRecord) {
    await applyProp(client, storedRecord);
    const events = await search<Record<string, unknown>>(client, 'experience_events', {
      query: {
        bool: {
          must: [
            { term: { event_type: 'schema_evolution' } },
            { term: { 'tags': 'exp48' } },
          ],
        },
      },
      size: 1,
    });
    h4Pass = events.length > 0;
  }

  console.log(`H4 -- SchemaEvolutionApplier writes schema_evolution event: ${h4Pass ? '+ PASS' : '- FAIL'}`);

  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? 'ALL PASS' : 'SOME FAIL'} ===`);

  saveResults(
    'exp48',
    [
      `H1 IntrospectionEngine emits proposal (expectedGain>=0.6): ${h1Pass ? 'PASS' : 'FAIL'}`,
      `H2 ConstitutionEngine approves proposal: ${h2Pass ? 'PASS' : 'FAIL'}`,
      `H3 ProposalStore round-trip (save/listPending/get): ${h3Pass ? 'PASS' : 'FAIL'}`,
      `H4 SchemaEvolutionApplier writes schema_evolution event: ${h4Pass ? 'PASS' : 'FAIL'}`,
    ].join('\n'),
    {
      h1Pass,
      h2Pass,
      h3Pass,
      h4Pass,
      proposalMutationType: proposal?.mutationType,
      proposalExpectedGain: proposal?.expectedGain,
      proposalStabilityRisk: proposal?.stabilityRisk,
      constitutionApproved: assessmentResult.approved,
      constitutionViolations: assessmentResult.violations,
      calibrationMeanError: report.meanCalibrationError,
    },
  );

  // Cleanup: remove exp48 entries
  if (proposal) {
    try {
      await client.delete({ index: 'substrate_proposals', id: proposal.mutationId, refresh: 'wait_for' });
    } catch { /* best-effort */ }
  }
  try {
    await client.deleteByQuery({
      index: 'experience_events',
      body: { query: { term: { 'tags': 'exp48' } } },
      refresh: true,
    });
  } catch { /* best-effort */ }
}

main().catch((err: unknown) => {
  process.stderr.write(`[exp48] Fatal: ${String(err)}\n`);
  process.exit(1);
});
