// Server-only model configuration. Imported by app/api routes, never by client components,
// so VLM_API_KEY stays on the server.
import { defaultExtraBody, type VlmConfig } from "@/lib/vlm/client";
import { isLocalVlmModel, isScorerModel, LOCAL_VLM_PREFIX, localVlmName, SCORER_PREFIX, servedName } from "@/lib/vlm/scorer";

/**
 * `scorer` configs answer yes/no over a video clip (lib/vlm/scorer.ts) instead of the JSON analysis prompt.
 * `local` marks models served on the GB10 (scorers and local general models).
 */
export type ServerVlmConfig = VlmConfig & { scorer?: boolean; local?: boolean; alias?: string };

// Qwen3.x thinks by default; per-window labels need a direct answer, as OpenRouter's reasoning:false gives.
// LOCAL_VLM_EXTRA_BODY (JSON) overrides this, e.g. Ollama wants {"reasoning_effort":"none"} to turn thinking off.
const LOCAL_EXTRA_BODY: Record<string, unknown> = (() => {
  try { if (process.env.LOCAL_VLM_EXTRA_BODY) return JSON.parse(process.env.LOCAL_VLM_EXTRA_BODY); } catch { /* ignore malformed override */ }
  return { chat_template_kwargs: { enable_thinking: false } };
})();

/** Local yes/no scorers (LOCAL_SCORER_MODELS, served names at LOCAL_SCORER_BASE_URL), as `local:<name>` ids. */
export function scorerModels(): string[] {
  if (!process.env.LOCAL_SCORER_BASE_URL) return [];
  return (process.env.LOCAL_SCORER_MODELS ?? "").split(",").map(m => m.trim()).filter(Boolean).map(m => SCORER_PREFIX + m);
}

/**
 * Local general models from LOCAL_VLM_MODELS, as `local-vlm:<name>` ids. Each entry is `name` (served at
 * LOCAL_VLM_BASE_URL, default the scorer URL) or `name=url` for a model on its own server, e.g. zrt on 8080
 * and a separate vLLM container on 8000.
 */
function localVlmEntries(): Map<string, string> {
  const fallback = process.env.LOCAL_VLM_BASE_URL || process.env.LOCAL_SCORER_BASE_URL;
  const out = new Map<string, string>();
  for (const entry of (process.env.LOCAL_VLM_MODELS ?? "").split(",").map(m => m.trim()).filter(Boolean)) {
    const [name, url] = entry.split("=", 2).map(x => x.trim());
    if (name && (url || fallback)) out.set(name, url || fallback!);
  }
  return out;
}
export function localVlmModels(): string[] {
  return [...localVlmEntries().keys()].map(m => LOCAL_VLM_PREFIX + m);
}

/**
 * Display names for OpenRouter models, from VLM_MODEL_ALIASES (`alias=provider/model,...`). The browser only
 * sees the alias (dropdown, "Model:" lines, results); requests go to the real model.
 */
function configuredModelAliases(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (process.env.VLM_MODEL_ALIASES ?? "").split(",").map(m => m.trim()).filter(Boolean)) {
    const [alias, model] = entry.split("=", 2).map(x => x.trim());
    if (alias && model) out.set(alias, model);
  }
  return out;
}

/** The product alias belongs only to the Qwen3-VL-30B-A3B model family. */
function allowedModelAlias(alias: string, model: string): boolean {
  return !/^sentin[ae]l-machines-v1$/i.test(alias)
    || /^(?:qwen\/)?qwen3-vl-30b-a3b(?:-|$)/i.test(model);
}

export function modelAliases(): Map<string, string> {
  return new Map([...configuredModelAliases()].filter(([alias, model]) => allowedModelAlias(alias, model)));
}

/** Keep an older endpoint mapping usable, but expose its real model when its product alias is invalid. */
function canonicalModelName(model: string): string {
  const real = configuredModelAliases().get(model);
  return real && !allowedModelAlias(model, real) ? real : model;
}

/** Models the browser may pick from (VLM_MODEL_OPTIONS plus local models). Always includes VLM_MODEL. */
export function modelOptions(): string[] {
  const list = (process.env.VLM_MODEL_OPTIONS ?? "").split(",").map(m => m.trim()).filter(Boolean);
  const main = process.env.VLM_MODEL;
  const all = [...(main && !list.includes(main) ? [main, ...list] : list), ...localVlmModels(), ...scorerModels()];
  return [...new Set(all.map(canonicalModelName))];
}

/**
 * `requested` (from the browser) is honoured only if it is in the allow-list. Scorers only do vision
 * analysis; chat (assistant, summary) keeps the server's chat model. Local general models do both.
 */
export function vlmConfig(kind: "vision" | "chat" = "vision", requested?: unknown): ServerVlmConfig | null {
  const requestedModel = typeof requested === "string" ? canonicalModelName(requested) : undefined;
  const picked = requestedModel && modelOptions().includes(requestedModel) ? requestedModel : undefined;
  if (kind === "vision" && (isScorerModel(picked) || (!picked && !process.env.VLM_MODEL && scorerModels().length))) {
    const model = picked ?? scorerModels()[0];
    return { baseUrl: process.env.LOCAL_SCORER_BASE_URL!, apiKey: process.env.LOCAL_SCORER_API_KEY, model: servedName(model), timeoutMs: 300_000, scorer: true, local: true };
  }
  if (isLocalVlmModel(picked)) {
    const name = localVlmName(picked!);
    return { baseUrl: localVlmEntries().get(name)!, apiKey: process.env.LOCAL_SCORER_API_KEY, model: name, extraBody: LOCAL_EXTRA_BODY, timeoutMs: 300_000, local: true };
  }
  const baseUrl = process.env.VLM_BASE_URL;
  const choice = picked && !isScorerModel(picked) && !isLocalVlmModel(picked) ? picked : undefined;
  const configured = choice ?? (kind === "chat" ? process.env.VLM_CHAT_MODEL || process.env.VLM_MODEL : process.env.VLM_MODEL);
  if (!baseUrl || !configured) return null;
  const model = canonicalModelName(configured);
  const real = modelAliases().get(model);
  let extraBody = defaultExtraBody(baseUrl, real ?? model);
  if (process.env.VLM_EXTRA_BODY) {
    try { extraBody = JSON.parse(process.env.VLM_EXTRA_BODY); } catch { /* ignore malformed override */ }
  }
  return { baseUrl, apiKey: process.env.VLM_API_KEY, model: real ?? model, alias: real ? model : undefined, extraBody, timeoutMs: 120_000 };
}

/** The id the browser knows a config's model by (with its local prefix), for responses and "last run used". */
export function modelId(config: ServerVlmConfig): string {
  return config.scorer ? SCORER_PREFIX + config.model : config.local ? LOCAL_VLM_PREFIX + config.model : config.alias ?? config.model;
}

export function providerLabel(baseUrl: string, local = false) {
  if (local) return "Local GB10";
  try {
    const host = new URL(baseUrl).hostname;
    return host.endsWith("openrouter.ai") ? "OpenRouter" : host === "localhost" || host === "127.0.0.1" ? "Local server" : host;
  } catch {
    return "Custom endpoint";
  }
}

export const notConfigured = {
  error: "No model is configured. Set VLM_BASE_URL and VLM_MODEL (and VLM_API_KEY for OpenRouter), or LOCAL_SCORER_BASE_URL and LOCAL_SCORER_MODELS, in webapp/.env.local, then restart the dev server.",
};
