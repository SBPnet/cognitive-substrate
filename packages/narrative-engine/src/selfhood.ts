/**
 * Long-horizon narrative tools.
 *
 *   - `synthesizeAutobiography` groups episodes into themed threads.
 *   - `projectFutureSelf` builds a forward-looking identity projection
 *     under a caller-supplied drift hypothesis.
 *   - `reviseNarrativeThreads` invalidates threads whose anchoring
 *     beliefs changed, lowering their coherence score.
 *
 * The engine treats "selfhood" terminology as computational analogy.
 */

import { randomUUID } from "node:crypto";
import type { IdentityState } from "@cognitive-substrate/core-types";
import type {
  AutobiographicalEpisode,
  FutureSelfProjection,
  IdentityThread,
  NarrativeRevision,
} from "./types.js";

export function synthesizeAutobiography(
  episodes: ReadonlyArray<AutobiographicalEpisode>,
): ReadonlyArray<IdentityThread> {
  const grouped = episodes.reduce<Map<string, AutobiographicalEpisode[]>>((groups, episode) => {
    const theme = primaryTheme(episode);
    groups.set(theme, [...(groups.get(theme) ?? []), episode]);
    return groups;
  }, new Map<string, AutobiographicalEpisode[]>());

  return [...grouped.entries()].map(([theme, themedEpisodes]) => ({
    threadId: randomUUID(),
    theme,
    episodeIds: themedEpisodes.map((episode) => episode.episodeId),
    coherenceScore: scoreThreadCoherence(themedEpisodes),
    lastUpdated: latestTimestamp(themedEpisodes),
  }));
}

export function projectFutureSelf(
  identity: IdentityState,
  horizon: FutureSelfProjection["horizon"],
  drift: Partial<Omit<IdentityState, "identityId" | "timestamp">> = {},
): FutureSelfProjection {
  const projectedTraits: IdentityState = {
    ...identity,
    timestamp: new Date().toISOString(),
    curiosity: clamp(identity.curiosity + (drift.curiosity ?? 0)),
    caution: clamp(identity.caution + (drift.caution ?? 0)),
    verbosity: clamp(identity.verbosity + (drift.verbosity ?? 0)),
    toolDependence: clamp(identity.toolDependence + (drift.toolDependence ?? 0)),
    explorationPreference: clamp(
      identity.explorationPreference + (drift.explorationPreference ?? 0),
    ),
    stabilityScore: clamp(identity.stabilityScore + (drift.stabilityScore ?? 0)),
  };

  return {
    projectionId: randomUUID(),
    horizon,
    projectedTraits,
    expectedNarrative: `Projected ${horizon} identity remains anchored by stability ${projectedTraits.stabilityScore.toFixed(2)} and curiosity ${projectedTraits.curiosity.toFixed(2)}.`,
    confidence: clamp(projectedTraits.stabilityScore * 0.6 + (1 - Math.abs(projectedTraits.curiosity - projectedTraits.caution)) * 0.4),
  };
}

export function reviseNarrativeThreads(
  threads: ReadonlyArray<IdentityThread>,
  changedBeliefIds: ReadonlyArray<string>,
): {
  readonly threads: ReadonlyArray<IdentityThread>;
  readonly revision: NarrativeRevision;
} {
  const affected = threads.filter((thread) =>
    changedBeliefIds.some((beliefId) => thread.theme.includes(beliefId)),
  );
  const affectedIds = affected.map((thread) => thread.threadId);
  const nextThreads = threads.map((thread) =>
    affectedIds.includes(thread.threadId)
      ? { ...thread, coherenceScore: clamp(thread.coherenceScore * 0.9), lastUpdated: new Date().toISOString() }
      : thread,
  );

  return {
    threads: nextThreads,
    revision: {
      revisionId: randomUUID(),
      revisedAt: new Date().toISOString(),
      affectedThreadIds: affectedIds,
      reason: "belief_update",
      coherenceDelta: affectedIds.length > 0 ? -0.1 : 0,
    },
  };
}

function primaryTheme(episode: AutobiographicalEpisode): string {
  return episode.beliefIds?.[0] ?? episode.affectTone ?? "general-continuity";
}

function scoreThreadCoherence(episodes: ReadonlyArray<AutobiographicalEpisode>): number {
  const memorySupport = Math.min(1, episodes.reduce((sum, episode) => sum + episode.memoryIds.length, 0) / 8);
  const temporalSupport = Math.min(1, episodes.length / 5);
  return clamp(memorySupport * 0.55 + temporalSupport * 0.45);
}

function latestTimestamp(episodes: ReadonlyArray<AutobiographicalEpisode>): string {
  return [...episodes].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0]?.timestamp
    ?? new Date().toISOString();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
