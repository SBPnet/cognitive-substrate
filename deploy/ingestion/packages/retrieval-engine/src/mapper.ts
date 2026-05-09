import type { MemoryReference } from "@cognitive-substrate/core-types";
import type {
  ExperienceEventSearchDocument,
  RetrievalSearchDocument,
  RetrievalSearchIndex,
  SemanticMemorySearchDocument,
} from "./types.js";

export interface SearchHit<T extends RetrievalSearchDocument> {
  readonly _id: string;
  readonly _score: number;
  readonly _source: T;
}

function isExperienceIndex(index: RetrievalSearchIndex): index is "experience_events" {
  return index === "experience_events";
}

export function mapSearchHitToMemoryReference(
  index: RetrievalSearchIndex,
  hit: SearchHit<RetrievalSearchDocument>,
): MemoryReference {
  if (isExperienceIndex(index)) {
    const source = hit._source as ExperienceEventSearchDocument;
    const reference: MemoryReference = {
      memoryId: source.event_id ?? hit._id,
      index,
      score: hit._score,
      summary: source.summary ?? "",
      importanceScore: source.importance_score ?? 0,
    };
    return source.timestamp
      ? { ...reference, lastRetrieved: source.timestamp }
      : reference;
  }

  const source = hit._source as SemanticMemorySearchDocument;
  const reference: MemoryReference = {
    memoryId: source.memory_id ?? hit._id,
    index,
    score: hit._score,
    summary: source.summary ?? source.generalization ?? "",
    importanceScore: source.importance_score ?? 0,
  };
  const lastRetrieved = source.last_retrieved ?? source.created_at;
  return lastRetrieved ? { ...reference, lastRetrieved } : reference;
}
