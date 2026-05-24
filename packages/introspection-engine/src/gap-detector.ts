import type { CalibrationReport } from "@cognitive-substrate/metacog-engine";
import type { CoverageGap, IntrospectionConfig } from "./types.js";

/**
 * Scans a CalibrationReport for coverage gaps: metrics we are not
 * capturing, plugins absent for attributed failure sources, and
 * parameters that have drifted past their budget. Returns gaps sorted
 * descending by salience, filtered to those above the configured threshold.
 */
export function detectGaps(
  report: CalibrationReport,
  registeredSources: ReadonlyArray<string>,
  knownFields: ReadonlyArray<string>,
  config: IntrospectionConfig,
): ReadonlyArray<CoverageGap> {
  const total = report.failureAttributions.length;

  const gaps: CoverageGap[] = [
    ...detectAttributionGaps(report.failureAttributions, registeredSources, total),
    ...detectWatchdogGaps(report.watchdogAlerts, knownFields, total),
  ];

  return gaps
    .filter((g) => g.salience >= config.salienceThreshold)
    .sort((a, b) => b.salience - a.salience);
}

function detectAttributionGaps(
  attributions: ReadonlyArray<string>,
  registeredSources: ReadonlyArray<string>,
  total: number,
): CoverageGap[] {
  if (total === 0) return [];

  // Count occurrences of each suffix pattern
  const latencyCount = attributions.filter((a) => a.endsWith(':latency_budget_exceeded')).length;
  const mismatchCount = attributions.filter((a) => a.endsWith(':outcome_mismatch')).length;

  // Find operation types that appear in attributions but have no registered source plugin
  const attributedSources = new Set(
    attributions.map((a) => a.split(':')[0] ?? '').filter(Boolean),
  );
  const absentSources = [...attributedSources].filter((s) => !registeredSources.includes(s));

  const gaps: CoverageGap[] = [];

  if (latencyCount > 0) {
    gaps.push({
      gapType: 'parameter_drifted',
      description: `${latencyCount} operations exceeded latency budget; budget parameter may need tuning`,
      salience: latencyCount / total,
      affectedOperations: attributions
        .filter((a) => a.endsWith(':latency_budget_exceeded'))
        .map((a) => a.split(':')[0] ?? ''),
    });
  }

  if (mismatchCount > 0) {
    gaps.push({
      gapType: 'metric_missing',
      description: `${mismatchCount} outcome mismatches cannot be explained; metric coverage may be incomplete`,
      salience: mismatchCount / total,
      affectedOperations: attributions
        .filter((a) => a.endsWith(':outcome_mismatch'))
        .map((a) => a.split(':')[0] ?? ''),
    });
  }

  for (const source of absentSources) {
    const sourceCount = attributions.filter((a) => a.startsWith(`${source}:`)).length;
    gaps.push({
      gapType: 'plugin_absent',
      description: `Failures attributed to source "${source}" but no plugin is registered for it`,
      salience: sourceCount / total,
      affectedOperations: [source],
    });
  }

  return gaps;
}

function detectWatchdogGaps(
  alerts: ReadonlyArray<string>,
  knownFields: ReadonlyArray<string>,
  total: number,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  if (alerts.includes('calibration_drift_detected')) {
    // Calibration drift with no obvious attribution means the metric set is incomplete.
    // Salience is fixed at 0.7 since this is a direct watchdog signal.
    gaps.push({
      gapType: 'metric_missing',
      description: 'Calibration drift detected without matching failure attribution; a metric dimension is likely missing',
      salience: 0.7,
      affectedOperations: [],
    });
  }

  if (alerts.includes('introspection_operation_budget_exceeded') && knownFields.length === 0) {
    gaps.push({
      gapType: 'parameter_drifted',
      description: 'Introspection operation budget exceeded; maxOperations parameter needs tuning',
      salience: 0.65,
      affectedOperations: ['CalibrationMonitor'],
    });
  }

  return gaps;
}
