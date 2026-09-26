"use client";
// Inference usage for the Analytics page: one entry per recording analysis or Live session, split into local
// (open models on the HP ZGX Nano's NVIDIA GB10, served with zrt) and API (cloud models through OpenRouter).
// Per browser (localStorage), like the recordings; nothing leaves the machine.
import { useEffect, useState } from "react";
import type { SystemSnapshot } from "./telemetry-types";

export interface GpuSummary { samples: number; avgUtil: number | null; peakUtil: number | null; avgPowerW: number | null; peakMemGb: number | null; name: string | null }
export interface UsageEntry {
  id: string; at: string; model: string; local: boolean; source: "recording" | "live"; title: string;
  windows: number; failed: number; promptTokens: number; completionTokens: number; costUsd: number;
  /** Sum of per-window model latencies, and wall-clock time for the whole run. */
  latencyMs: number; wallMs: number;
  /** GB10 GPU while a local model ran; null for API runs or when nvidia-smi is not visible (app not on the GB10). */
  gpu: GpuSummary | null;
}
export interface WindowUsage { promptTokens?: number; completionTokens?: number; cost?: number; local?: boolean }

const KEY = "sm-usage-log";
const EVENT = "sm-usage-change";
export const isLocalModel = (model: string) => model.startsWith("local-vlm:") || model.startsWith("local:");

export function readUsage(): UsageEntry[] { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
export function logUsage(entry: UsageEntry) {
  try { localStorage.setItem(KEY, JSON.stringify([...readUsage(), entry].slice(-300))); } catch { /* per-browser convenience only */ }
  window.dispatchEvent(new Event(EVENT));
}
/** Adds the entry, or replaces the one with the same id, so a run still in progress can be updated window by window. */
export function upsertUsage(entry: UsageEntry) {
  try { localStorage.setItem(KEY, JSON.stringify([...readUsage().filter(e => e.id !== entry.id), entry].slice(-300))); } catch { /* per-browser convenience only */ }
  window.dispatchEvent(new Event(EVENT));
}
export function clearUsage() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } window.dispatchEvent(new Event(EVENT)); }
export function useUsage(): UsageEntry[] {
  const [log, setLog] = useState<UsageEntry[]>([]);
  useEffect(() => { const load = () => setLog(readUsage()); load(); window.addEventListener(EVENT, load); window.addEventListener("storage", load); return () => { window.removeEventListener(EVENT, load); window.removeEventListener("storage", load); }; }, []);
  return log;
}

/** Adds up per-window usage for one run. */
export function usageTally() {
  const t = { windows: 0, failed: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0 };
  return {
    add(u: WindowUsage | undefined, latencyMs = 0) { t.windows++; t.promptTokens += u?.promptTokens ?? 0; t.completionTokens += u?.completionTokens ?? 0; t.costUsd += u?.cost ?? 0; t.latencyMs += latencyMs; },
    fail() { t.failed++; },
    get: () => ({ ...t }),
  };
}

/** Samples GB10 GPU readings from /api/system every 2 s until stopped (local runs only). */
export function gpuSampler() {
  const readings: SystemSnapshot["gpu"][] = [];
  let stopped = false;
  const tick = async () => {
    while (!stopped) {
      try { const s = await (await fetch("/api/system", { cache: "no-store" })).json() as SystemSnapshot; readings.push(s.gpu); } catch { readings.push(null); }
      await new Promise(r => setTimeout(r, 2000));
    }
  };
  tick();
  const summary = (): GpuSummary | null => {
    const gpus = readings.filter((g): g is NonNullable<typeof g> => !!g);
    if (!gpus.length) return null;
    const nums = (f: (g: (typeof gpus)[number]) => number | null) => gpus.map(f).filter((v): v is number => v != null);
    const avg = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    const util = nums(g => g.utilisation), power = nums(g => g.powerWatts), mem = nums(g => g.memoryUsedMb);
    return { samples: gpus.length, avgUtil: avg(util), peakUtil: util.length ? Math.max(...util) : null, avgPowerW: avg(power), peakMemGb: mem.length ? Math.max(...mem) / 1024 : null, name: gpus[0].name };
  };
  return {
    /** Readings so far, without stopping. */
    peek: summary,
    stop(): GpuSummary | null { stopped = true; return summary(); },
  };
}
