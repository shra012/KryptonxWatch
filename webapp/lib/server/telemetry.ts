// Server-side only: this module shells out and reads /proc. Import it from route
// handlers and server components, never from a "use client" file.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { inferenceSnapshot } from "@/lib/server/inference-stats";
import type { GpuProcess, GpuSnapshot, HostSnapshot, SystemSnapshot } from "@/lib/telemetry-types";

const run = promisify(execFile);
const CACHE_MS = 1000;
let cached: { at: number; value: SystemSnapshot } | null = null;

function num(raw: string | undefined) { if (!raw) return null; const t = raw.trim(); if (!t || /^\[?N\/?A/i.test(t) || t === "[Not Supported]") return null; const n = Number.parseFloat(t); return Number.isFinite(n) ? n : null; }
function text(raw: string | undefined) { const t = raw?.trim(); return t && !/^\[?N\/?A/i.test(t) ? t : null; }

async function nvidiaSmi(args: string[]) { const { stdout } = await run("nvidia-smi", args, { timeout: 4000, maxBuffer: 1 << 20 }); return stdout; }

async function gpuProcesses(): Promise<GpuProcess[]> {
  try {
    const stdout = await nvidiaSmi(["--query-compute-apps=pid,process_name,used_gpu_memory", "--format=csv,noheader,nounits"]);
    return stdout.split("\n").map(l => l.split(",")).filter(c => c.length >= 3).map(c => ({ pid: num(c[0]) ?? 0, name: text(c[1]) ?? "unknown", memoryMb: num(c[2]) })).filter(p => p.pid > 0);
  } catch { return []; }
}

async function readGpu(): Promise<{ gpu: GpuSnapshot | null; reason: string }> {
  let stdout: string;
  const fields = ["name", "driver_version", "utilization.gpu", "memory.used", "memory.total", "temperature.gpu", "power.draw", "power.limit", "clocks.sm", "clocks.mem"];
  try { stdout = await nvidiaSmi([`--query-gpu=${fields.join(",")}`, "--format=csv,noheader,nounits"]); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return { gpu: null, reason: code === "ENOENT" ? "nvidia-smi is not on this host, so GPU telemetry is unavailable." : "nvidia-smi could not be read on this host." };
  }
  const row = stdout.split("\n").find(l => l.trim());
  if (!row) return { gpu: null, reason: "nvidia-smi returned no GPU rows." };
  const c = row.split(",");
  const memoryUsedMb = num(c[3]), memoryTotalMb = num(c[4]);
  return { gpu: { name: text(c[0]), driver: text(c[1]), utilisation: num(c[2]), memoryUsedMb, memoryTotalMb, memorySource: memoryUsedMb != null && memoryTotalMb != null ? "device" : null, temperatureC: num(c[5]), powerWatts: num(c[6]), powerLimitWatts: num(c[7]), graphicsClockMhz: num(c[8]), memoryClockMhz: num(c[9]), processes: await gpuProcesses() }, reason: "" };
}

// /proc/stat gives cumulative jiffies, so CPU load needs two samples. We keep the
// previous one and report the delta since the last poll; the first call is null.
let previousCpu: { idle: number; total: number } | null = null;
async function cpuLoad() {
  try {
    const line = (await readFile("/proc/stat", "utf8")).split("\n")[0];
    const parts = line.split(/\s+/).slice(1).map(Number).filter(Number.isFinite);
    if (parts.length < 4) return null;
    const idle = parts[3] + (parts[4] ?? 0), total = parts.reduce((a, b) => a + b, 0);
    const prev = previousCpu; previousCpu = { idle, total };
    if (!prev || total <= prev.total) return null;
    const busy = (total - prev.total) - (idle - prev.idle);
    return Math.min(100, Math.max(0, (busy / (total - prev.total)) * 100));
  } catch { return null; }
}

async function cpuModel() {
  try { const m = (await readFile("/proc/cpuinfo", "utf8")).match(/^(?:model name|Model)\s*:\s*(.+)$/m); return m?.[1]?.trim() ?? null; }
  catch { return os.cpus()[0]?.model ?? null; }
}

// os.totalmem/freemem miss page cache, which matters a lot on a 128 GB unified
// pool, so prefer MemAvailable from /proc/meminfo when it is there.
async function memory() {
  try {
    const info = await readFile("/proc/meminfo", "utf8");
    const field = (key: string) => { const m = info.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m")); return m ? Number(m[1]) / 1024 : null; };
    const total = field("MemTotal"), available = field("MemAvailable");
    if (total != null && available != null) return { memoryUsedMb: total - available, memoryTotalMb: total };
  } catch { /* fall through to the os module */ }
  const total = os.totalmem() / 1048576;
  return { memoryUsedMb: total - os.freemem() / 1048576, memoryTotalMb: total };
}

async function readHost(): Promise<HostSnapshot> {
  const [load, model, mem] = await Promise.all([cpuLoad(), cpuModel(), memory()]);
  let hostname: string | null = null; try { hostname = os.hostname(); } catch { hostname = null; }
  return { hostname, platform: os.platform(), arch: os.arch(), cpuModel: model, cpuCount: os.cpus().length || null, cpuLoad: load, loadAverage: os.loadavg(), ...mem, uptimeSeconds: os.uptime() };
}

// GB10 has no dedicated GPU memory, so nvidia-smi reports memory.used/total as N/A. Fall back to
// what compute processes hold, against the unified pool the GPU actually allocates from.
function withUnifiedMemory(gpu: GpuSnapshot | null, host: HostSnapshot): GpuSnapshot | null {
  if (!gpu || gpu.memorySource === "device" || !host.memoryTotalMb) return gpu;
  if (gpu.processes.some(p => p.memoryMb == null)) return gpu;
  return { ...gpu, memoryUsedMb: gpu.processes.reduce((a, p) => a + (p.memoryMb ?? 0), 0), memoryTotalMb: host.memoryTotalMb, memorySource: "processes" };
}

export async function systemSnapshot(): Promise<SystemSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const [{ gpu, reason }, host] = await Promise.all([readGpu(), readHost()]);
  const value: SystemSnapshot = { at: new Date().toISOString(), gpu: withUnifiedMemory(gpu, host), gpuUnavailableReason: reason, host, inference: inferenceSnapshot() };
  cached = { at: Date.now(), value };
  return value;
}
