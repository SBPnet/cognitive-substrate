/**
 * OpenSearch client factory and index management utilities.
 * Handles index creation (with schema), document upsert, and retrieval.
 */

import { Client } from "@opensearch-project/opensearch";
import { INDEX_SCHEMAS, type CognitiveIndex } from "./schemas.js";

export interface OpenSearchConfig {
  readonly node: string;
  readonly auth?: {
    readonly username: string;
    readonly password: string;
  };
  readonly ssl?: { readonly rejectUnauthorized: boolean };
}

/**
 * Builds an OpenSearchConfig from process environment variables.
 * Expected variables:
 *   OPENSEARCH_URL      — required (e.g. https://host:9200)
 *   OPENSEARCH_USERNAME — optional
 *   OPENSEARCH_PASSWORD — optional
 *   OPENSEARCH_TLS_REJECT_UNAUTHORIZED — "false" to disable cert check (dev only)
 */
export function opensearchConfigFromEnv(): OpenSearchConfig {
  const node = process.env["OPENSEARCH_URL"];
  if (!node) throw new Error("OPENSEARCH_URL environment variable is required");

  const username = process.env["OPENSEARCH_USERNAME"];
  const password = process.env["OPENSEARCH_PASSWORD"];
  const rejectUnauthorized = process.env["OPENSEARCH_TLS_REJECT_UNAUTHORIZED"] !== "false";

  const base = { node };
  const auth = username && password ? { username, password } : undefined;
  const ssl = { rejectUnauthorized };
  return auth ? { ...base, auth, ssl } : { ...base, ssl };
}

/** Creates an OpenSearch Client from the given config. */
export function createOpenSearchClient(config: OpenSearchConfig): Client {
  const opts: ConstructorParameters<typeof Client>[0] = { node: config.node };
  if (config.auth) opts.auth = config.auth;
  if (config.ssl) opts.ssl = config.ssl;
  return new Client(opts);
}

function isResourceAlreadyExistsError(error: unknown): boolean {
  const response = error as {
    readonly body?: { readonly error?: { readonly type?: string } };
  };
  return response.body?.error?.type === "resource_already_exists_exception";
}

/**
 * Ensures all cognitive memory indexes exist, creating them with the correct
 * mappings and settings if they are absent. Safe to call on every startup.
 */
export async function ensureIndexes(client: Client): Promise<void> {
  for (const [name, schema] of Object.entries(INDEX_SCHEMAS)) {
    const exists = await client.indices.exists({ index: name });
    if (!exists.body) {
      try {
        await client.indices.create({ index: name, body: schema });
      } catch (error) {
        if (!isResourceAlreadyExistsError(error)) throw error;
      }
    }
  }
}

/** Indexes a single document, creating the index if required. */
export async function indexDocument(
  client: Client,
  index: CognitiveIndex,
  id: string,
  document: Record<string, unknown>,
): Promise<void> {
  await client.index({ index, id, body: document, refresh: "wait_for" });
}

/** Updates specific fields on an existing document without replacing it. */
export async function updateDocument(
  client: Client,
  index: CognitiveIndex,
  id: string,
  partial: Record<string, unknown>,
): Promise<void> {
  await client.update({ index, id, body: { doc: partial }, refresh: "wait_for" });
}

/** Retrieves a document by ID. Returns undefined when not found. */
export async function getDocument<T extends Record<string, unknown>>(
  client: Client,
  index: CognitiveIndex,
  id: string,
): Promise<T | undefined> {
  try {
    const result = await client.get({ index, id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (result.body as any)._source as T | undefined;
  } catch {
    return undefined;
  }
}

/** Executes a pre-built query and returns the hits array. */
export async function search<T extends Record<string, unknown>>(
  client: Client,
  index: CognitiveIndex,
  query: Record<string, unknown>,
): Promise<Array<{ _id: string; _score: number; _source: T }>> {
  const result = await client.search({ index, body: query });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result.body as any).hits.hits as Array<{ _id: string; _score: number; _source: T }>;
}
