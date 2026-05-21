/**
 * Formats the weekly digest data into a structured Markdown report.
 * Five fixed sections as described in weekly-memory-digest.mdx.
 */

import type {
  TagFrequency,
  TrustDeltaEntry,
  AbstractionPattern,
  BehaviorAnomaly,
} from "./queries.js";

export interface DigestData {
  readonly weekOf: string;
  readonly totalEvents: number;
  readonly topTags: ReadonlyArray<TagFrequency>;
  readonly abstractionPatterns: ReadonlyArray<AbstractionPattern>;
  readonly trustDeltas: ReadonlyArray<TrustDeltaEntry>;
  readonly anomalies: ReadonlyArray<BehaviorAnomaly>;
  readonly knowledgeGaps: ReadonlyArray<string>;
}

export function formatDigest(data: DigestData): string {
  const lines: string[] = [
    `# Cognitive Substrate — Weekly Memory Digest`,
    `**Week of ${data.weekOf}**`,
    `**Total blog/reader events ingested: ${data.totalEvents}**`,
    "",
  ];

  // --- Top Insight ---
  lines.push("## Top Insight");
  const topInsight = deriveTopInsight(data);
  lines.push(topInsight, "");

  // --- Emerging Patterns ---
  lines.push("## Emerging Patterns");
  if (data.abstractionPatterns.length === 0 && data.topTags.length === 0) {
    lines.push("No new patterns formed this week.", "");
  } else {
    for (const pattern of data.abstractionPatterns.slice(0, 5)) {
      lines.push(`- **[${pattern.level}]** ${pattern.summary} _(importance ${pattern.importance.toFixed(2)})_`);
    }
    if (data.topTags.length > 0) {
      lines.push("");
      lines.push("**Frequent topics:**");
      for (const tag of data.topTags.slice(0, 8)) {
        lines.push(`- \`${tag.tag}\` — ${tag.count} events, avg importance ${tag.avgImportance.toFixed(2)}`);
      }
    }
    lines.push("");
  }

  // --- Interesting Tensions ---
  lines.push("## Interesting Tensions");
  if (data.trustDeltas.length === 0) {
    lines.push("No memory critiques recorded this week.", "");
  } else {
    lines.push("Memories with declining trust scores (critiqued this week):");
    for (const entry of data.trustDeltas.slice(0, 5)) {
      lines.push(`- ${entry.summary} _(retrieval_priority ${entry.retrievalPriorityDelta.toFixed(3)})_`);
    }
    lines.push("");
  }

  // --- Knowledge Gaps ---
  lines.push("## Knowledge Gaps");
  if (data.knowledgeGaps.length === 0) {
    lines.push("No recurring low-importance topics detected.", "");
  } else {
    lines.push("Topics referenced repeatedly but consistently low-importance:");
    for (const gap of data.knowledgeGaps) {
      lines.push(`- \`${gap}\``);
    }
    lines.push("");
  }

  // --- Recommendations ---
  lines.push("## Recommendations");
  const recommendations = deriveRecommendations(data);
  for (const rec of recommendations) {
    lines.push(`- ${rec}`);
  }
  lines.push("");

  // --- Anomalies (appendix) ---
  if (data.anomalies.length > 0) {
    lines.push("## Reader Behavior Anomalies");
    for (const a of data.anomalies) {
      const direction = a.deltaPercent > 0 ? "▲" : "▼";
      lines.push(`- \`${a.tag}\` ${direction}${Math.abs(a.deltaPercent)}% (${a.priorWeekCount}→${a.currentWeekCount})`);
    }
    lines.push("");
  }

  lines.push(`_Generated at ${new Date().toISOString()}_`);
  return lines.join("\n");
}

function deriveTopInsight(data: DigestData): string {
  if (data.abstractionPatterns.length > 0) {
    const top = data.abstractionPatterns[0];
    if (top) {
      return `A new **${top.level}**-level pattern emerged this week: "${top.summary}" (importance ${top.importance.toFixed(2)}).`;
    }
  }
  if (data.anomalies.length > 0) {
    const top = data.anomalies[0];
    if (top) {
      const dir = top.deltaPercent > 0 ? "surged" : "dropped";
      return `Reader engagement with \`${top.tag}\` ${dir} ${Math.abs(top.deltaPercent)}% this week (${top.priorWeekCount}→${top.currentWeekCount} events).`;
    }
  }
  if (data.totalEvents > 0) {
    return `${data.totalEvents} blog/reader events ingested this week. No single standout pattern — review emerging topics below.`;
  }
  return "No reader events ingested this week. Check telemetry pipeline health.";
}

function deriveRecommendations(data: DigestData): string[] {
  const recs: string[] = [];

  if (data.totalEvents === 0) {
    recs.push("Investigate telemetry ingestion pipeline — no events this week.");
    return recs;
  }

  if (data.knowledgeGaps.length > 0) {
    recs.push(`Consider writing a deeper piece on: ${data.knowledgeGaps.slice(0, 3).map((g) => `\`${g}\``).join(", ")}`);
  }

  if (data.trustDeltas.length > 0) {
    recs.push(`Review ${data.trustDeltas.length} critiqued memories — some established patterns may need updating.`);
  }

  const spikedUp = data.anomalies.filter((a) => a.deltaPercent > 0);
  if (spikedUp.length > 0) {
    recs.push(`Capitalize on rising interest in: ${spikedUp.slice(0, 3).map((a) => `\`${a.tag}\``).join(", ")}`);
  }

  if (data.abstractionPatterns.length >= 3) {
    recs.push("Multiple high-level patterns formed this week — consider a synthesis post connecting them.");
  }

  if (recs.length === 0) {
    recs.push("Continue current content cadence — no strong signals requiring course correction.");
  }

  return recs;
}
