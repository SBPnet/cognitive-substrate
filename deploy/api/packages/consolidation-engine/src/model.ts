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

function buildGeneralization(
  summaries: ReadonlyArray<string>,
  tags: ReadonlyArray<string>,
): string {
  const tagPhrase = tags.length > 0 ? ` around ${tags.slice(0, 5).join(", ")}` : "";
  const evidenceCount = summaries.length;
  return `Consolidated pattern${tagPhrase} from ${evidenceCount} replayed experiences.`;
}

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
