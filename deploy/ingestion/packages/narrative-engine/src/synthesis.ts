import type { IdentityState } from "@cognitive-substrate/core-types";
import {
  dominantIdentityTraits,
  driftMagnitude,
  scoreIdentityCoherence,
} from "./scoring.js";
import type { IdentityEvidence, IdentityVectorKey, NarrativeSelfModel } from "./types.js";

const TRAIT_LABELS: Record<IdentityVectorKey, string> = {
  curiosity: "novelty seeking",
  caution: "risk monitoring",
  verbosity: "explanatory detail",
  toolDependence: "external tool reliance",
  explorationPreference: "exploratory strategy",
  stabilityScore: "identity stability",
};

export function synthesizeNarrativeSelfModel(
  previous: IdentityState,
  next: IdentityState,
  evidence: ReadonlyArray<IdentityEvidence>,
): NarrativeSelfModel {
  const dominantTraits = dominantIdentityTraits(next);
  const themes = synthesizeThemes(evidence, dominantTraits);
  const coherenceScore = scoreIdentityCoherence(previous, next, evidence);
  const magnitude = driftMagnitude(previous, next);

  return {
    identityId: next.identityId,
    timestamp: next.timestamp,
    summary: narrativeSummary(next, dominantTraits, themes, coherenceScore),
    dominantTraits,
    themes,
    coherenceScore,
    driftMagnitude: magnitude,
    supportingMemoryIds: evidence.map((item) => item.sourceMemoryId),
  };
}

export function synthesizeThemes(
  evidence: ReadonlyArray<IdentityEvidence>,
  dominantTraits: ReadonlyArray<IdentityVectorKey>,
): ReadonlyArray<string> {
  const tagCounts = evidence.reduce<Map<string, number>>((counts, item) => {
    for (const tag of item.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());

  const tagThemes = [...tagCounts.entries()]
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .slice(0, 3)
    .map(([tag]) => tag);

  const traitThemes = dominantTraits.map((trait) => TRAIT_LABELS[trait]);
  return unique([...tagThemes, ...traitThemes]).slice(0, 5);
}

function narrativeSummary(
  identity: IdentityState,
  dominantTraits: ReadonlyArray<IdentityVectorKey>,
  themes: ReadonlyArray<string>,
  coherenceScore: number,
): string {
  const traitPhrase = dominantTraits.map((trait) => TRAIT_LABELS[trait]).join(", ");
  const themePhrase = themes.length > 0 ? themes.join(", ") : "general identity continuity";
  const coherenceBand = coherenceScore >= 0.7
    ? "high coherence"
    : coherenceScore >= 0.45
      ? "moderate coherence"
      : "low coherence";

  return [
    `Identity ${identity.identityId} currently emphasizes ${traitPhrase}.`,
    `Recent evidence links this self-model to ${themePhrase}.`,
    `The stabilized model shows ${coherenceBand}.`,
  ].join(" ");
}

function unique(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)];
}
