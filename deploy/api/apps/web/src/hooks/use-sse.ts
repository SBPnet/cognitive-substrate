"use client";

import { useEffect, useRef } from "react";
import type { InteractionResponseDto, SseEnvelope } from "@/lib/api-client";

const API_ORIGIN = process.env["NEXT_PUBLIC_API_URL"] ?? "";

export interface SseCallbacks {
  onResponse: (response: InteractionResponseDto) => void;
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

    es.addEventListener("error", (ev) => {
      callbacksRef.current.onError?.(ev);
    });

    return (): void => {
      es.close();
    };
  }, [sessionId]);
}
