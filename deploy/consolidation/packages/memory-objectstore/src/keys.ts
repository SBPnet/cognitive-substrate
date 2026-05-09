/**
 * Deterministic key scheme for the episodic truth layer.
 *
 * Object keys are structured so that:
 *   - Events are partitioned by date for cost-efficient lifecycle tiering.
 *   - The event ID is always recoverable from the key.
 *   - Semantic memories and other derived artifacts live in distinct prefixes.
 *
 * Key format:
 *   events/{YYYY}/{MM}/{DD}/{eventId}.json
 *   semantic/{YYYY}/{MM}/{semanticMemoryId}.json
 *   policy/{YYYY}/{MM}/{policyId}.json
 *   audit/{YYYY}/{MM}/{DD}/{auditId}.json
 */

export type ObjectPrefix = "events" | "semantic" | "policy" | "audit" | "consolidation";

/**
 * Builds the object storage key for a raw experience event.
 * The key is deterministic and recoverable from the eventId + timestamp.
 */
export function eventKey(eventId: string, timestamp: string): string {
  const date = new Date(timestamp);
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `events/${yyyy}/${mm}/${dd}/${eventId}.json`;
}

/**
 * Builds the object storage key for a consolidated semantic memory.
 */
export function semanticMemoryKey(memoryId: string, createdAt: string): string {
  const date = new Date(createdAt);
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `semantic/${yyyy}/${mm}/${memoryId}.json`;
}

/**
 * Builds the object storage key for a policy snapshot.
 */
export function policyKey(policyId: string, timestamp: string): string {
  const date = new Date(timestamp);
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `policy/${yyyy}/${mm}/${policyId}.json`;
}

/**
 * Builds the object storage key for an audit record.
 */
export function auditKey(auditId: string, timestamp: string): string {
  const date = new Date(timestamp);
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `audit/${yyyy}/${mm}/${dd}/${auditId}.json`;
}

/**
 * Builds the S3 list prefix for all events on a given UTC date.
 * Useful for batch replay and lifecycle management.
 */
export function eventDayPrefix(date: Date): string {
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `events/${yyyy}/${mm}/${dd}/`;
}
