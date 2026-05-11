import assert from "node:assert/strict";
import type { Client } from "@opensearch-project/opensearch";

import { MemoryRetriever } from "../retriever.js";
import type { RetrievalSearchDocument } from "../types.js";
import type { CognitiveIndex } from "@cognitive-substrate/memory-opensearch";

let capturedQuery: Record<string, unknown> | undefined;

const retriever = new MemoryRetriever({
  openSearch: {} as Client,
  searchClient: async (
    _client: Client,
    _index: CognitiveIndex,
    query: Record<string, unknown>,
  ) => {
    capturedQuery = query;
    return [] as Array<{
      _id: string;
      _score: number;
      _source: RetrievalSearchDocument;
    }>;
  },
});

await retriever.retrieve({
  queryText: "deployment elevated errors",
  queryEmbedding: [0.2, 0.3, 0.4],
  indexes: ["experience_events"],
  retrievalMode: "quality",
  fusion: { lexicalWeight: 4, vectorWeight: 6 },
});

assert.ok(capturedQuery);
const serialized = JSON.stringify(capturedQuery);
assert.match(serialized, /"embedding_qwen"/);
assert.match(serialized, /"boost":6/);
assert.match(serialized, /"boost":4/);
assert.doesNotMatch(serialized, /"embedding_nomic":\{"vector"/);

process.stdout.write("[retrieval-engine] retrieval-mode tests passed\n");
