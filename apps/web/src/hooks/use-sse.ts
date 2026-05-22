"use client";

import { useEffect, useRef } from "react";
import type { InteractionResponseDto, KafkaEventDto, SseEnvelope } from "@/lib/api-client";

// SSE connections bypass the Next.js rewrite proxy (which buffers responses
// and breaks long-lived streams). Connect directly to the API using the
// browser-accessible URL. NEXT_PUBLIC_SSE_URL must be set at build time to
// the host:port reachable from the browser (e.g. http://thor.local:4000).
// Falls back to empty string (relative) for local dev where API is on :3001.
const API_ORIGIN = process.env["NEXT_PUBLIC_SSE_URL"] ?? "";

export interface SseCallbacks {
  onResponse: (response: InteractionResponseDto) => void;
  onKafkaEvent?: (event: KafkaEventDto) => void;
  onError?: (error: Event) => void;
}

export function useSessionSSE(
  sessionId: string | null | undefined,
  callbacks: SseCallbacks,
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!sessionId) return;

    const url = `${API_ORIGIN}/api/sessions/${sessionId}/stream`;
    const es = new EventSource(url);

    es.addEventListener("interaction_response", (ev: MessageEvent<string>) => {
      try {
        const envelope = JSON.parse(ev.data) as SseEnvelope<InteractionResponseDto>;
        callbacksRef.current.onResponse(envelope.payload);
      } catch {
        // malformed message — ignore
      }
    });

    es.addEventListener("kafka_event", (ev: MessageEvent<string>) => {
      try {
        const envelope = JSON.parse(ev.data) as SseEnvelope<KafkaEventDto>;
        callbacksRef.current.onKafkaEvent?.(envelope.payload);
      } catch {
        // malformed message — ignore
      }
    });

    es.addEventListener("error", (ev) => {
      callbacksRef.current.onError?.(ev);
    });

    return (): void => {
      es.close();
    };
  }, [sessionId]);
}
