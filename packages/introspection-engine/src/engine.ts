import type { SelfModificationProposal } from "@cognitive-substrate/core-types";
import type { CalibrationReport } from "@cognitive-substrate/metacog-engine";
import { detectGaps } from "./gap-detector.js";
import { buildProposal } from "./proposal-builder.js";
import { DEFAULT_INTROSPECTION_CONFIG, type IntrospectionConfig } from "./types.js";

/**
 * Scans a CalibrationReport for coverage gaps and emits at most one
 * SelfModificationProposal per call (the highest-salience gap). Returns
 * undefined when no gap exceeds the configured salienceThreshold.
 *
 * The caller is responsible for passing the proposal through
 * ConstitutionEngine.assess() before persisting or acting on it.
 */
export class IntrospectionEngine {
  private readonly config: IntrospectionConfig;

  constructor(config: Partial<IntrospectionConfig> = {}) {
    this.config = { ...DEFAULT_INTROSPECTION_CONFIG, ...config };
  }

  assess(
    report: CalibrationReport,
    registeredSources: ReadonlyArray<string>,
    knownFields: ReadonlyArray<string>,
  ): SelfModificationProposal | undefined {
    const gaps = detectGaps(report, registeredSources, knownFields, this.config);
    if (gaps.length === 0) return undefined;

    // gaps is sorted descending by salience; take the most salient
    return buildProposal(gaps[0]!, this.config);
  }
}
