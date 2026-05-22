/**
 * Document ingestion route.
 *
 * POST /api/sessions/:sessionId/documents
 *
 * Accepts multipart/form-data with one or more files. Each file is chunked
 * and published to `experience.raw` as `environmental_observation` events.
 * The pipeline handles embedding and indexing asynchronously.
 */

import { Hono } from "hono";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import type { ExperienceEvent, EventContext } from "@cognitive-substrate/core-types";
import { publishExperienceEvent } from "../kafka/experience-producer.js";
import { getOrCreateSession } from "./sessions.js";

// UUIDv5 namespace for deterministic sourceDocumentId from filename + sessionId
const DOC_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

type DocFormat = "markdown" | "pdf" | "text" | "code";

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "cs",
  "rb", "php", "swift", "kt", "sh", "bash", "zsh", "fish",
]);

function detectFormat(filename: string, mimeType?: string): DocFormat {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "mdx") return "markdown";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "text";
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function slidingWindowChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      // Break at last newline before the boundary to avoid mid-line splits
      const nl = text.lastIndexOf("\n", end);
      if (nl > start + CHUNK_OVERLAP) end = nl + 1;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)).trim());
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 0);
}

function markdownChunks(text: string): string[] {
  // Split on heading lines (# / ## / ###); keep heading as first line of each section
  const sectionRegex = /(?=\n#{1,3} )/g;
  const sections = text.split(sectionRegex).filter((s) => s.trim().length > 0);
  const chunks: string[] = [];
  for (const section of sections) {
    if (section.length <= CHUNK_SIZE) {
      chunks.push(section.trim());
    } else {
      // Section too large — fall back to sliding window within it
      chunks.push(...slidingWindowChunks(section));
    }
  }
  return chunks;
}

function chunkText(text: string, format: DocFormat): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  return format === "markdown" ? markdownChunks(cleaned) : slidingWindowChunks(cleaned);
}

// ---------------------------------------------------------------------------
// Event builder
// ---------------------------------------------------------------------------

function buildChunkEvent(opts: {
  chunk: string;
  chunkIndex: number;
  totalChunks: number;
  sourceDocumentId: string;
  filename: string;
  format: DocFormat;
  context: EventContext;
  importanceScore: number;
  extraTags: string[];
}): ExperienceEvent {
  const {
    chunk, chunkIndex, totalChunks, sourceDocumentId,
    filename, format, context, importanceScore, extraTags,
  } = opts;

  const tags = [
    "source:upload",
    `format:${format}`,
    `doc:${sourceDocumentId}`,
    `chunk:${chunkIndex}/${totalChunks}`,
    ...extraTags,
  ];

  return {
    eventId: uuidv4(),
    timestamp: new Date().toISOString(),
    type: "environmental_observation",
    context,
    input: {
      text: chunk,
      embedding: [],
      structured: {
        sourceDocumentId,
        chunkIndex,
        totalChunks,
        filename,
        storageMode: "upload",
      },
    },
    importanceScore,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface IngestDocumentResult {
  filename: string;
  format: string;
  chunks: number;
  eventIds: string[];
}

export interface IngestDocumentsResponse {
  documents: IngestDocumentResult[];
  totalChunks: number;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function createDocumentsRouter(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Expected multipart/form-data" }, 400);
    }

    const session = getOrCreateSession(sessionId);

    const importanceRaw = formData.get("importance");
    const importanceScore =
      importanceRaw !== null ? Math.min(1, Math.max(0, parseFloat(String(importanceRaw)))) : 0.5;

    const tagsRaw = formData.get("tags");
    const extraTags: string[] =
      tagsRaw && String(tagsRaw).trim()
        ? String(tagsRaw)
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const fileEntries = formData.getAll("files");
    if (fileEntries.length === 0) {
      return c.json({ error: "No files provided" }, 400);
    }

    const context: EventContext = {
      sessionId: session.sessionId,
      ...(session.userId !== undefined ? { userId: session.userId } : {}),
    };

    const results: IngestDocumentResult[] = [];

    for (const entry of fileEntries) {
      if (!(entry instanceof File)) continue;

      const filename = entry.name;
      const format = detectFormat(filename, entry.type || undefined);
      const sourceDocumentId = uuidv5(`${sessionId}:${filename}`, DOC_NAMESPACE);

      let text: string;
      try {
        if (format === "pdf") {
          const buffer = Buffer.from(await entry.arrayBuffer());
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          const result = await parser.getText();
          text = result.text;
          await parser.destroy();
        } else {
          text = await entry.text();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ error: `Failed to read file "${filename}": ${msg}` }, 422);
      }

      const chunks = chunkText(text, format);
      if (chunks.length === 0) {
        results.push({ filename, format, chunks: 0, eventIds: [] });
        continue;
      }

      const totalChunks = chunks.length;
      const eventIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const event = buildChunkEvent({
          chunk: chunks[i]!,
          chunkIndex: i,
          totalChunks,
          sourceDocumentId,
          filename,
          format,
          context,
          importanceScore,
          extraTags,
        });

        try {
          await publishExperienceEvent(event);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return c.json({ error: `Failed to queue chunk ${i} of "${filename}": ${msg}` }, 503);
        }

        eventIds.push(event.eventId);
      }

      results.push({ filename, format, chunks: totalChunks, eventIds });
    }

    const response: IngestDocumentsResponse = {
      documents: results,
      totalChunks: results.reduce((sum, d) => sum + d.chunks, 0),
    };

    return c.json(response, 202);
  });

  return app;
}
