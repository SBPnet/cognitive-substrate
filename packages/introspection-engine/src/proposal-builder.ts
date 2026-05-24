import { randomUUID } from "node:crypto";
import type {
  IndexMappingPayload,
  ParameterTunePayload,
  PluginProposalPayload,
  SelfModificationProposal,
} from "@cognitive-substrate/core-types";
import type { CoverageGap, IntrospectionConfig } from "./types.js";

export function buildProposal(
  gap: CoverageGap,
  config: IntrospectionConfig,
): SelfModificationProposal {
  const stabilityRisk = Math.min(gap.salience * 0.6, config.maxProposalRisk);

  return {
    mutationId: randomUUID(),
    timestamp: new Date().toISOString(),
    mutationType: kindFor(gap),
    description: gap.description,
    expectedGain: gap.salience,
    stabilityRisk,
    approved: false,
    rollbackAvailable: true,
    payload: payloadFor(gap),
  };
}

function kindFor(gap: CoverageGap): SelfModificationProposal['mutationType'] {
  switch (gap.gapType) {
    case 'parameter_drifted': return 'parameter_tune';
    case 'plugin_absent':     return 'plugin_register';
    case 'metric_missing':    return 'metric_capture';
  }
}

function payloadFor(gap: CoverageGap): SelfModificationProposal['payload'] {
  switch (gap.gapType) {
    case 'parameter_drifted': {
      const param = gap.affectedOperations[0] ?? 'unknown';
      const payload: ParameterTunePayload = {
        engine: param,
        parameter: 'budgetThreshold',
        currentValue: 0,
        proposedValue: 0,
        evidenceSummary: gap.description,
      };
      return payload;
    }

    case 'plugin_absent': {
      const sourceType = gap.affectedOperations[0] ?? 'unknown';
      const payload: PluginProposalPayload = {
        pluginSourceType: sourceType,
        specDescription: gap.description,
        sampleSignalShape: null,
        requiredMappingFields: [],
      };
      return payload;
    }

    case 'metric_missing': {
      const payload: IndexMappingPayload = {
        indexName: 'experience_events',
        fieldName: `gap_metric_${Date.now()}`,
        fieldType: 'float',
        reason: gap.description,
      };
      return payload;
    }
  }
}
