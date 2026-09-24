// Server-only model configuration. Imported by app/api routes, never by client components,
// so VLM_API_KEY stays on the server.
import { defaultExtraBody, type VlmConfig } from "@/lib/vlm/client";

/** Models the browser may pick from (VLM_MODEL_OPTIONS, comma-separated). Always includes VLM_MODEL. */
export function modelOptions(): string[] {
  const list = (process.env.VLM_MODEL_OPTIONS ?? "").split(",").map(m => m.trim()).filter(Boolean);
  const main = process.env.VLM_MODEL;
  return main && !list.includes(main) ? [main, ...list] : list;
}

/** `requested` (from the browser) is honoured only if it is in the allow-list; it applies to vision and chat. */
export function vlmConfig(kind: "vision" | "chat" = "vision", requested?: unknown): VlmConfig | null {
  const baseUrl = process.env.VLM_BASE_URL;
  const picked = typeof requested === "string" && modelOptions().includes(requested) ? requested : undefined;
  const model = picked ?? (kind === "chat" ? process.env.VLM_CHAT_MODEL || process.env.VLM_MODEL : process.env.VLM_MODEL);
  if (!baseUrl || !model) return null;
  let extraBody = defaultExtraBody(baseUrl);
  if (process.env.VLM_EXTRA_BODY) {
    try { extraBody = JSON.parse(process.env.VLM_EXTRA_BODY); } catch { /* ignore malformed override */ }
  }
  return { baseUrl, apiKey: process.env.VLM_API_KEY, model, extraBody, timeoutMs: 120_000 };
}

export function providerLabel(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname;
    return host.endsWith("openrouter.ai") ? "OpenRouter" : host === "localhost" || host === "127.0.0.1" ? "Local server" : host;
  } catch {
    return "Custom endpoint";
  }
}

export const notConfigured = {
  error: "No model is configured. Set VLM_BASE_URL and VLM_MODEL (and VLM_API_KEY for OpenRouter) in webapp/.env.local, then restart the dev server.",
};
