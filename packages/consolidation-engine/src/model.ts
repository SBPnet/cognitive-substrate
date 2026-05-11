/**
 * Default consolidation model.
 *
 * `ExtractiveConsolidationModel` produces the consolidation draft without
 * calling any language model. It selects the top three highest-importance
 * candidate summaries, builds a tag-driven generalisation sentence, and
 * averages the embeddings to produce a centroid vector for the new
 * semantic memory. The result is deterministic and testable; an LLM-backed
 * abstractive model can be plugged in later by implementing
 * `ConsolidationModel` and passing it to the engine.
 */

import type {
  ConsolidationDraft,
  ConsolidationModel,
  ReplayCandidate,
} from "./types.js";

export class ExtractiveConsolidationModel implements ConsolidationModel {
  async generate(
    candidates: ReadonlyArray<ReplayCandidate>,
  ): Promise<ConsolidationDraft> {
    const ordered = [...candidates].sort(
      (left, right) => right.importanceScore - left.importanceScore,
    );
    const summaries = ordered.map((candidate) => candidate.summary).filter(Boolean);
    const tags = [...new Set(ordered.flatMap((candidate) => candidate.tags))];

    return {
      summary: summaries.slice(0, 3).join(" "),
      generalization: buildGeneralization(summaries, tags),
      embedding: averageEmbedding(ordered),
      ...(tags[0] ? { semanticCluster: tags[0] } : {}),
    };
  }
}

/**
 * Builds a one-sentence generalisation that names the dominant tags
 * (capped at five) and the count of replayed experiences. The phrasing
 * is deliberately formulaic so that the resulting record is easy to
 * inspect during smoke tests.
 */
function buildGeneralization(
  summaries: ReadonlyArray<string>,
  tags: ReadonlyArray<string>,
): string {
  const tagPhrase = tags.length > 0 ? ` around ${tags.slice(0, 5).join(", ")}` : "";
  const evidenceCount = summaries.length;
  return `Consolidated pattern${tagPhrase} from ${evidenceCount} replayed experiences.`;
}

/**
 * Centroid of the candidate embeddings. Returns an empty vector when the
 * candidates have no embedding; downstream consumers should treat the
 * empty vector as a signal that semantic recall cannot be performed for
 * the resulting memory until a re-embedding pass populates it.
 */
function averageEmbedding(
  candidates: ReadonlyArray<ReplayCandidate>,
): ReadonlyArray<number> {
  const first = candidates[0]?.embedding;
  if (!first || first.length === 0) return [];

  const totals = Array.from({ length: first.length }, () => 0);
  for (const candidate of candidates) {
    candidate.embedding.forEach((value, index) => {
      totals[index] = (totals[index] ?? 0) + value;
    });
  }

  return totals.map((total) => total / candidates.length);
}
