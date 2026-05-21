import type { AgentContext, EventResult, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest } from "@cognitive-substrate/agents";

export const WEB_FETCH_CAPABILITY: ToolCapability = {
  tool: "web_fetch",
  description: "Fetch the text content of a URL. Returns the first 4000 characters of the response body.",
  parameters: [
    { name: "url", type: "string", required: true },
  ],
};

export async function webFetch(action: ActionRequest, _context: AgentContext): Promise<EventResult> {
  const url = action.parameters?.["url"];
  if (typeof url !== "string" || !url) {
    return { output: "web_fetch requires a url parameter", success: false };
  }

  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "cognitive-substrate/1.0 (tool-executor)" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const truncated = text.slice(0, 4000);
    return {
      output: truncated,
      success: res.ok,
      latencyMs: Date.now() - start,
      ...(res.ok ? {} : { errorCode: String(res.status) }),
    };
  } catch (err) {
    return {
      output: err instanceof Error ? err.message : String(err),
      success: false,
      latencyMs: Date.now() - start,
      errorCode: "FETCH_ERROR",
    };
  }
}
