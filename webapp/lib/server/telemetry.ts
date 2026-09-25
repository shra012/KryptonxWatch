import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { Telemetry } from "../telemetry-types";

const run = promisify(execFile);
const GPU_FIELDS = "name,utilization.gpu,temperature.gpu,power.draw,clocks.sm,clocks.max.sm,pstate";

/** nvidia-smi prints "[N/A]", "N/A" or "[Not Supported]" for unreadable fields. */
export function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function parseGpu(csvLine: string): Telemetry["gpu"] {
  const f = csvLine.split(",").map(s => s.trim());
  if (f.length < 7 || !f[0]) return null;
  return { name: f[0], utilization: num(f[1]), temperature: num(f[2]), powerWatts: num(f[3]), smClockMhz: num(f[4]), smClockMaxMhz: num(f[5]), pstate: /^P\d+$/.test(f[6]) ? f[6] : null };
}

export function parseProcesses(csv: string): Telemetry["processes"] {
  return csv.split("\n").map(l => l.trim()).filter(Boolean).flatMap(line => {
    const [pid, name, mem] = line.split(",").map(s => s.trim());
    const p = num(pid);
    if (p === null) return [];
    // Show only the executable name, not the full path of another user's process.
    return [{ pid: p, name: (name ?? "").split("/").pop() || "unknown", gpuMemoryMiB: num(mem) }];
  });
}

export function parseMeminfo(text: string): Telemetry["memory"] {
  const kb = (key: string) => { const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m")); return m ? Number(m[1]) * 1024 : null; };
  const total = kb("MemTotal"), available = kb("MemAvailable");
  if (total === null || available === null || total <= 0) return null;
  return { totalBytes: total, usedBytes: Math.max(0, total - available) };
}

/** First line of /proc/stat -> [busy, total] jiffies. */
export function parseCpuStat(text: string): [number, number] | null {
  const line = text.split("\n").find(l => l.startsWith("cpu "));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  if (v.length < 4 || v.some(x => !Number.isFinite(x))) return null;
  const idle = v[3] + (v[4] ?? 0);
  const total = v.reduce((a, b) => a + b, 0);
  return [total - idle, total];
}

export function cpuPercent(prev: [number, number] | null, next: [number, number] | null): number | null {
  if (!prev || !next) return null;
  const dt = next[1] - prev[1];
  return dt > 0 ? Math.min(100, Math.max(0, ((next[0] - prev[0]) / dt) * 100)) : null;
}

type State = { cache?: { at: number; value: Telemetry }; inflight?: Promise<Telemetry>; lastCpu: [number, number] | null };
const g = globalThis as unknown as { __kxTelemetry?: State };
const state: State = (g.__kxTelemetry ??= { lastCpu: null });

async function sample(): Promise<Telemetry> {
  const errors: string[] = [];
  const smi = (args: string[]) => run("nvidia-smi", args, { timeout: 3000 }).then(r => r.stdout).catch((e: NodeJS.ErrnoException) => { errors.push(e.code === "ENOENT" ? "nvidia-smi is not installed on this server" : "nvidia-smi did not respond"); return ""; });
  const [gpuCsv, procCsv, meminfo, stat, loadavg] = await Promise.all([
    smi([`--query-gpu=${GPU_FIELDS}`, "--format=csv,noheader,nounits"]),
    smi(["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"]),
    readFile("/proc/meminfo", "utf8").catch(() => ""),
    readFile("/proc/stat", "utf8").catch(() => ""),
    readFile("/proc/loadavg", "utf8").catch(() => ""),
  ]);
  const cpu = parseCpuStat(stat);
  const percent = cpuPercent(state.lastCpu, cpu);
  state.lastCpu = cpu;
  return {
    sampledAt: new Date().toISOString(),
    gpu: parseGpu(gpuCsv.split("\n")[0] ?? ""),
    processes: parseProcesses(procCsv),
    memory: parseMeminfo(meminfo),
    cpu: { percent, load1: num(loadavg.split(" ")[0]) },
    unavailable: [
      { metric: "Tensor core activity", reason: "Needs NVIDIA DCGM profiling, which is not installed on this node." },
      { metric: "Memory bandwidth", reason: "Needs NVIDIA DCGM profiling, which is not installed on this node." },
    ],
    errors: [...new Set(errors)],
  };
}

/** One shared sample per second, however many dashboards are polling. */
export function readTelemetry(maxAgeMs = 1000): Promise<Telemetry> {
  const now = Date.now();
  if (state.cache && now - state.cache.at < maxAgeMs) return Promise.resolve(state.cache.value);
  state.inflight ??= sample().then(value => { state.cache = { at: Date.now(), value }; return value; }).finally(() => { state.inflight = undefined; });
  return state.inflight;
}
