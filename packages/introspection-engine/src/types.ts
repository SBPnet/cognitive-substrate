export type GapType = 'metric_missing' | 'plugin_absent' | 'parameter_drifted';

export interface CoverageGap {
  readonly gapType: GapType;
  readonly description: string;
  /** 0–1; computed from failure attribution frequency relative to total failures. */
  readonly salience: number;
  readonly affectedOperations: ReadonlyArray<string>;
}

export interface IntrospectionConfig {
  /** Gaps with salience below this threshold are not converted to proposals. Default: 0.6 */
  readonly salienceThreshold: number;
  /** Caps stabilityRisk on emitted proposals regardless of salience. Default: 0.5 */
  readonly maxProposalRisk: number;
}

export const DEFAULT_INTROSPECTION_CONFIG: IntrospectionConfig = {
  salienceThreshold: 0.6,
  maxProposalRisk: 0.5,
};
