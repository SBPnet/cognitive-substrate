/**
 * Confluent-compatible Schema Registry client with Avro wire-format encoding.
 *
 * Wire format (Confluent magic byte):
 *   byte 0:     0x00
 *   bytes 1-4:  schema ID as big-endian uint32
 *   bytes 5+:   avsc binary payload
 *
 * JSON payloads always start with 0x7B ('{'), so the magic byte is a reliable
 * sentinel for format detection in consumers.
 */

import avsc from "avsc";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface SchemaRegistryConfig {
  readonly url: string;
  readonly cacheCapacity?: number;
}

interface RegistrySchema {
  id: number;
  schema: string;
}

interface CompatibilityResponse {
  is_compatible: boolean;
}

export class SchemaRegistryClient {
  private readonly url: URL;
  private readonly cacheCapacity: number;
  private readonly typeCache = new Map<number, avsc.Type>();
  private readonly insertionOrder: number[] = [];

  constructor(config: SchemaRegistryConfig) {
    this.url = new URL(config.url);
    this.cacheCapacity = config.cacheCapacity ?? 256;
  }

  /**
   * Register a schema under a subject. Idempotent: returns the existing ID
   * if the schema is already registered with identical content.
   */
  async register(subject: string, schema: object): Promise<number> {
    const body = JSON.stringify({ schema: JSON.stringify(schema) });
    const result = await this.post<{ id: number }>(
      `/subjects/${encodeURIComponent(subject)}/versions`,
      body,
    );
    return result.id;
  }

  /**
   * Encode a payload as Confluent wire-format Avro bytes.
   * The caller must have previously registered the schema and obtained its ID.
   */
  async encode(schemaId: number, payload: unknown): Promise<Buffer> {
    const avroType = await this.getCompiledById(schemaId);
    const avroBytes = avroType.toBuffer(payload);
    const wire = Buffer.allocUnsafe(5 + avroBytes.length);
    wire.writeUInt8(0x00, 0);
    wire.writeUInt32BE(schemaId, 1);
    avroBytes.copy(wire, 5);
    return wire;
  }

  /**
   * Decode a Confluent wire-format buffer. Reads the schema ID from bytes 1-4,
   * retrieves (and caches) the compiled schema, then deserializes the payload.
   */
  async decode(buffer: Buffer): Promise<{ schemaId: number; value: unknown }> {
    if (buffer[0] !== 0x00) {
      throw new Error("not Confluent wire format: missing magic byte 0x00");
    }
    const schemaId = buffer.readUInt32BE(1);
    const avroType = await this.getCompiledById(schemaId);
    const value = avroType.fromBuffer(buffer.slice(5)) as unknown;
    return { schemaId, value };
  }

  /**
   * Check whether a proposed schema is compatible with the latest registered
   * version of a subject. Returns true if compatible.
   */
  async checkCompatibility(subject: string, schema: object): Promise<boolean> {
    const body = JSON.stringify({ schema: JSON.stringify(schema) });
    try {
      const result = await this.post<CompatibilityResponse>(
        `/compatibility/subjects/${encodeURIComponent(subject)}/versions/latest`,
        body,
      );
      return result.is_compatible;
    } catch {
      // 404 means no versions registered yet — treat as compatible
      return true;
    }
  }

  /**
   * Fetch a schema definition by numeric ID (used during decode).
   */
  async getSchemaById(schemaId: number): Promise<object> {
    const result = await this.get<RegistrySchema>(`/schemas/ids/${schemaId}`);
    return JSON.parse(result.schema) as object;
  }

  private async getCompiledById(schemaId: number): Promise<avsc.Type> {
    const cached = this.typeCache.get(schemaId);
    if (cached) return cached;

    const schemaDef = await this.getSchemaById(schemaId);
    const avroType = avsc.Type.forSchema(schemaDef as avsc.Schema);

    if (this.typeCache.size >= this.cacheCapacity) {
      const oldest = this.insertionOrder.shift()!;
      this.typeCache.delete(oldest);
    }
    this.typeCache.set(schemaId, avroType);
    this.insertionOrder.push(schemaId);

    return avroType;
  }

  private get<T>(path: string): Promise<T> {
    return this.httpCall<T>("GET", path, undefined);
  }

  private post<T>(path: string, body: string): Promise<T> {
    return this.httpCall<T>("POST", path, body);
  }

  private httpCall<T>(method: string, path: string, body: string | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      const isHttps = this.url.protocol === "https:";
      const options = {
        hostname: this.url.hostname,
        port: this.url.port || (isHttps ? 443 : 80),
        path,
        method,
        headers: {
          "Content-Type": "application/vnd.schemaregistry.v1+json",
          "Accept": "application/vnd.schemaregistry.v1+json",
          ...(body !== undefined ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      };

      const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Schema Registry ${method} ${path} -> ${res.statusCode}: ${raw}`));
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error(`Schema Registry ${method} ${path}: invalid JSON response`));
          }
        });
      });

      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}
