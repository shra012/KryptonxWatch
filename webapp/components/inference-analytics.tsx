"use client";
// Analytics: local inference (open models on the HP ZGX Nano's NVIDIA GB10, served with zrt) beside API inference
// (cloud models through OpenRouter). Usage from lib/usage.ts, prices from /api/pricing, accuracy from the bake-off
// (lib/benchmarks.ts) and from the reviews people made in this browser.
import { useEffect, useState } from "react";
import { Cloud, Cpu, Trash2 } from "lucide-react";
import { useApp } from "./app-provider";
import { Meter, Readout } from "./ui";
import { displayModel, useModelStatus } from "@/lib/detection-client";
import { benchmarkFor, BENCHMARK_SET } from "@/lib/benchmarks";
import { clearUsage, isLocalModel, useUsage, type UsageEntry } from "@/lib/usage";
import { timeLabel, dateLabel } from "@/lib/types";

type Prices = Record<string, { prompt: number; completion: number; pricedAs: string }>;

const tokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const usd = (n: number) => n === 0 ? "$0.00" : n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const price = (e: Pick<UsageEntry, "promptTokens" | "completionTokens">, p?: { prompt: number; completion: number }) => p ? e.promptTokens * p.prompt + e.completionTokens * p.completion : 0;

function totals(entries: UsageEntry[]) {
  const sum = (f: (e: UsageEntry) => number) => entries.reduce((a, e) => a + f(e), 0);
  const windows = sum(e => e.windows);
  return { runs: entries.length, windows, promptTokens: sum(e => e.promptTokens), completionTokens: sum(e => e.completionTokens), cost: sum(e => e.costUsd), perWindowMs: windows ? sum(e => e.latencyMs) / windows : null };
}

export function InferenceAnalytics() {
  const log = useUsage();
  const status = useModelStatus();
  const { videos } = useApp();
  const [pricing, setPricing] = useState<{ prices: Prices; reference: string | null } | null>(null);
  useEffect(() => { fetch("/api/pricing").then(r => r.json()).then(d => d.available && setPricing({ prices: d.prices, reference: d.reference })).catch(() => {}); }, []);

  const name = (m: string) => isLocalModel(m) ? `${m.replace(/^local(-vlm)?:/, "")} · GB10` : displayModel(m, status) ?? m;
  const realOf = (m: string) => Object.entries(status?.aliases ?? {}).find(([, alias]) => alias === m)?.[0] ?? m;
  // Review outcomes per side: of the detections a person decided on, how many they kept (reviewed) vs dismissed.
  const reviews = (local: boolean) => {
    const decided = videos.flatMap(v => v.detections.map(d => ({ d, model: d.model ?? v.analysisModel ?? "" })))
      .filter(x => x.model && isLocalModel(x.model) === local && (x.d.status === "reviewed" || x.d.status === "dismissed"));
    return { decided: decided.length, kept: decided.filter(x => x.d.status === "reviewed").length };
  };
  const options = status?.options ?? [];
  const reference = pricing?.reference ?? null;

  const side = (local: boolean) => {
    const entries = log.filter(e => e.local === local);
    const t = totals(entries);
    // One row per model as shown (an alias and its real model are the same row).
    const models = [...new Map([...options.filter(m => isLocalModel(m) === local), ...entries.map(e => e.model)].map(m => [name(m), m])).values()];
    const saved = local && reference ? entries.reduce((a, e) => a + price(e, pricing?.prices[reference]), 0) : 0;
    const hosted = local ? entries.reduce((a, e) => a + price(e, pricing?.prices[e.model]), 0) : 0;
    const gpus = entries.map(e => e.gpu).filter((g): g is NonNullable<typeof g> => !!g);
    const avg = (f: (g: (typeof gpus)[number]) => number | null) => { const v = gpus.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const peak = (f: (g: (typeof gpus)[number]) => number | null) => { const v = gpus.map(f).filter((x): x is number => x != null); return v.length ? Math.max(...v) : null; };
    const r = reviews(local);
    return <section className="rounded-xl border border-base-300 overflow-hidden min-w-0" aria-label={local ? "Local inference" : "API inference"}>
      <header className="px-5 py-4 border-b border-base-300 bg-base-200/60">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center size-8 rounded-lg bg-base-content text-base-100">{local ? <Cpu size={16} /> : <Cloud size={16} />}</span>
          <div className="min-w-0"><h3 className="font-semibold leading-tight">{local ? "Local · HP ZGX Nano (NVIDIA GB10)" : "API · OpenRouter (cloud)"}</h3>
            <p className="text-xs text-base-content/55 mt-0.5">{local ? "Open models served on site with zrt. Frames never leave the building; no per-token bill." : "Hosted and frontier models, billed per token; frames are sent to the provider."}</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 [&>*:nth-child(3n)]:sm:border-r-0">
        <Readout label="Runs" value={t.runs} hint={`${entries.filter(e => e.source === "live").length} live sessions`} />
        <Readout label="Windows analysed" value={t.windows} />
        <Readout label="Tokens in / out" value={`${tokens(t.promptTokens)} / ${tokens(t.completionTokens)}`} />
        <Readout label={local ? "Spent" : "Spent (billed)"} value={usd(local ? 0 : t.cost)} />
        {local
          ? <Readout label={reference ? `Saved vs ${name(reference)}` : "Saved vs API"} value={usd(saved)} hint={hosted ? `${usd(hosted)} at the same open model hosted` : undefined} />
          : <Readout label="Cost per window" value={t.windows ? usd(t.cost / t.windows) : "–"} />}
        <Readout label="Latency per window" value={t.perWindowMs == null ? "–" : secs(t.perWindowMs)} />
      </div>

      <div className="px-5 py-4 border-b border-base-300">
        <h4 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50 mb-3">{local ? "GB10 GPU during local runs" : "Compute"}</h4>
        {local ? gpus.length ? <div className="space-y-3">
            <Meter label="Average GPU utilisation" value={avg(g => g.avgUtil)} />
            <Meter label="Peak GPU utilisation" value={peak(g => g.peakUtil)} />
            <div className="grid grid-cols-2 gap-3 text-sm"><span className="text-base-content/65">Average power <span className="font-mono text-base-content">{avg(g => g.avgPowerW)?.toFixed(0) ?? "–"} W</span></span>
              <span className="text-base-content/65">Peak memory <span className="font-mono text-base-content">{peak(g => g.peakMemGb)?.toFixed(1) ?? "–"} GB</span> of 128 GB unified</span></div>
            <p className="text-xs text-base-content/45">{gpus.reduce((a, g) => a + g.samples, 0)} readings every 2 s from nvidia-smi on {gpus[0].name ?? "the GB10"}.</p>
          </div>
          : <p className="text-sm text-base-content/55">Not sampled yet. Run a local model with the app on the GB10, where nvidia-smi can see the GPU; readings are taken every 2 s during the run.</p>
        : <p className="text-sm text-base-content/55">Runs on the provider&apos;s GPUs in the cloud; no utilisation or power readings are available.</p>}
      </div>

      <div className="px-5 py-4 border-b border-base-300">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3"><h4 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50">Accuracy</h4><span className="text-[.68rem] text-base-content/45">{BENCHMARK_SET}</span></div>
        <div className="overflow-x-auto"><table className="table table-xs"><thead><tr><th>Model</th><th className="text-right">Score</th><th className="text-right">Crimes flagged</th><th className="text-right">Right crime</th><th className="text-right">False alarms</th></tr></thead>
          <tbody>{models.map(m => { const b = benchmarkFor(realOf(m)); return <tr key={m}><td className="max-w-48 truncate" title={b?.label}>{name(m)}</td>
            {b ? <><td className="text-right font-mono font-semibold">{b.score}%</td><td className="text-right font-mono">{b.flagged}%</td><td className="text-right font-mono">{b.rightCrime}%</td><td className="text-right font-mono">{b.falseAlarms}%</td></>
              : <td colSpan={4} className="text-right text-base-content/45">not benchmarked yet</td>}</tr>; })}</tbody></table></div>
        <p className="text-xs text-base-content/55 mt-3">Confirmed by reviewers here: {r.decided ? <span className="font-mono">{r.kept} of {r.decided} ({Math.round(r.kept / r.decided * 100)}%)</span> : "no reviewed detections yet"}.</p>
      </div>

      <div className="px-5 py-4">
        <h4 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50 mb-2">Recent runs</h4>
        {entries.length ? <ul className="divide-y divide-base-300 text-sm">{[...entries].reverse().slice(0, 5).map(e => <li key={e.id} className="py-2 flex items-baseline justify-between gap-3">
          <span className="min-w-0"><span className="block truncate">{e.title}</span><span className="block text-xs text-base-content/50 truncate">{name(e.model)} · {e.source} · {dateLabel(e.at)} {timeLabel(e.at)}</span></span>
          <span className="font-mono text-xs text-right shrink-0">{e.windows} win · {tokens(e.promptTokens + e.completionTokens)} tok<br />{local ? `saved ${usd(reference ? price(e, pricing?.prices[reference]) : 0)}` : usd(e.costUsd)}</span></li>)}</ul>
          : <p className="text-sm text-base-content/55">{local ? "No local runs yet. Pick a GB10 model in Preferences and analyse a recording." : "No API runs yet."}</p>}
      </div>
    </section>;
  };

  return <div>
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <p className="text-sm text-base-content/60 max-w-3xl">Every analysis and Live session, split by where the model ran. Local runs cost nothing per token; &ldquo;saved&rdquo; prices their tokens at {reference ? name(reference) : "the house API model"}.</p>
      {log.length > 0 && <button className="btn btn-ghost btn-xs" onClick={() => { if (window.confirm("Clear the inference usage log in this browser?")) clearUsage(); }}><Trash2 size={13} />Clear usage</button>}
    </div>
    <div className="grid lg:grid-cols-2 gap-6 items-start">{side(true)}{side(false)}</div>
  </div>;
}
