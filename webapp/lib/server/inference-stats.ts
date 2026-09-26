// Server-only: a rolling record of model calls this web app made, so /api/system can
// report inference speed for whichever model (OpenRouter or local GB10) is in use.
import type { ChatResult } from "@/lib/vlm/client";
import type { ServerVlmConfig } from "@/lib/server/vlm-config";
import type { InferenceSnapshot } from "@/lib/telemetry-types";

type Sample = { at: number; local: boolean; tokens: number; ms: number };
/** The product name shown in the UI, whichever model (OpenRouter or local) actually served the call. */
export const PRODUCT_MODEL_NAME = "sentinel-machines-v1";
const WINDOW_MS = 60_000;
const KEEP = 200;
// Route handlers can be bundled separately in dev, so keep the samples on globalThis.
const store = globalThis as typeof globalThis & { __kxInferenceSamples?: Sample[] };

export function recordInference(config: ServerVlmConfig, reply: ChatResult) {
  if (!reply.completionTokens || reply.latencyMs <= 0) return;
  const samples = (store.__kxInferenceSamples ??= []);
  samples.push({ at: Date.now(), local: !!config.local, tokens: reply.completionTokens, ms: reply.latencyMs });
  if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
}

/** Output tokens per second of wall time (prefill included) over the last minute. */
export function inferenceSnapshot(): InferenceSnapshot {
  const samples = store.__kxInferenceSamples ?? [];
  const last = samples.at(-1) ?? null;
  const recent = samples.filter(s => Date.now() - s.at <= WINDOW_MS);
  const ms = recent.reduce((a, s) => a + s.ms, 0), tokens = recent.reduce((a, s) => a + s.tokens, 0);
  return {
    tokensPerSecond: ms > 0 ? tokens / (ms / 1000) : null,
    calls: recent.length,
    windowSeconds: WINDOW_MS / 1000,
    model: last ? PRODUCT_MODEL_NAME : null,
    local: recent.at(-1)?.local ?? last?.local ?? null,
    lastAt: last ? new Date(last.at).toISOString() : null,
  };
}
