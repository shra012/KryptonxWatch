"use client";
import { useEffect, useRef, useState } from "react";
import type { SystemSnapshot } from "@/lib/telemetry-types";

export interface TelemetryPoint { at: number; gpu: number | null; cpu: number | null; memory: number | null; power: number | null }
export interface Telemetry { snapshot: SystemSnapshot | null; history: TelemetryPoint[]; error: string; loading: boolean }
const HISTORY = 60; // points kept for the sparklines

function point(s: SystemSnapshot): TelemetryPoint {
  const share = (used: number | null, total: number | null) => used == null || !total ? null : (used / total) * 100;
  return { at: Date.parse(s.at) || Date.now(), gpu: s.gpu?.utilisation ?? null, cpu: s.host.cpuLoad, memory: share(s.host.memoryUsedMb, s.host.memoryTotalMb), power: s.gpu?.powerWatts ?? null };
}

/** Polls /api/system. Pass `0` as the interval to read once. */
export function useTelemetry(intervalMs = 5000): Telemetry {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let live = true; const controller = new AbortController();
    const tick = async () => {
      try {
        const res = await fetch("/api/system", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`Edge node telemetry returned ${res.status}.`);
        const data = (await res.json()) as SystemSnapshot;
        if (!live) return;
        setSnapshot(data); setError("");
        setHistory(h => [...h, point(data)].slice(-HISTORY));
      } catch (e) {
        if (!live || (e as Error).name === "AbortError") return;
        setError("Could not reach the edge node telemetry service. Check that the web app is running on the ZGX node.");
      } finally { if (live) { setLoading(false); if (intervalMs > 0) timer.current = setTimeout(tick, intervalMs); } }
    };
    tick();
    return () => { live = false; controller.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [intervalMs]);
  return { snapshot, history, error, loading };
}
