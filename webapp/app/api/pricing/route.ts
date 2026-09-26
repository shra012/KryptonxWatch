import { NextResponse } from "next/server";
import { modelAliases, modelOptions } from "@/lib/server/vlm-config";

export const dynamic = "force-dynamic";

// USD per token from OpenRouter's public model list, for pricing API runs and what local tokens would have cost.
// Local GB10 models are priced at the same open model hosted on OpenRouter ("equivalent"). Cached for an hour.
const LOCAL_EQUIVALENT: Record<string, string> = {
  "local-vlm:qwen3-vl-30b-a3b": "qwen/qwen3-vl-30b-a3b-instruct",
  "local-vlm:nemotron-omni": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "local:shoplifting-s2": "qwen/qwen3.8-27b",
};
let cache: { at: number; prices: Record<string, { prompt: number; completion: number }> } | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at > 3_600_000) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000) });
      const { data } = await res.json() as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
      cache = { at: Date.now(), prices: Object.fromEntries(data.map(m => [m.id, { prompt: Number(m.pricing.prompt) || 0, completion: Number(m.pricing.completion) || 0 }])) };
    } catch {
      if (!cache) return NextResponse.json({ available: false, reason: "OpenRouter's price list could not be fetched." });
    }
  }
  const aliases = modelAliases();
  const prices: Record<string, { prompt: number; completion: number; pricedAs: string }> = {};
  const add = (id: string, real: string) => { const p = cache!.prices[real]; if (p) prices[id] = { ...p, pricedAs: real }; };
  for (const id of modelOptions()) add(id, aliases.get(id) ?? LOCAL_EQUIVALENT[id] ?? id);
  for (const [real, alias] of [...aliases].map(([a, r]) => [r, a])) if (prices[alias]) prices[real] = prices[alias];
  // What "saved vs API" compares against: the first aliased (house) API model, else the default model.
  const reference = [...aliases.keys()][0] ?? process.env.VLM_MODEL ?? null;
  return NextResponse.json({ available: true, prices, reference, localEquivalent: LOCAL_EQUIVALENT });
}
