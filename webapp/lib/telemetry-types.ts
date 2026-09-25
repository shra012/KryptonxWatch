// Shape of GET /api/system. Every reading is nullable on purpose: a sensor we
// cannot read is `null` so the UI can say "unavailable" instead of showing a
// zero that looks like a real measurement.
export interface GpuProcess { pid: number; name: string; memoryMb: number | null }
export interface GpuSnapshot {
  name: string | null;
  driver: string | null;
  utilisation: number | null;   // percent
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
  powerWatts: number | null;
  powerLimitWatts: number | null;
  graphicsClockMhz: number | null;
  memoryClockMhz: number | null;
  processes: GpuProcess[];
}
export interface HostSnapshot {
  hostname: string | null;
  platform: string;
  arch: string;
  cpuModel: string | null;
  cpuCount: number | null;
  cpuLoad: number | null;        // percent, from /proc/stat between samples
  loadAverage: number[] | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  uptimeSeconds: number | null;
}
// Readings that need NVIDIA DCGM. It is not installed on the ZGX yet, so these
// carry a reason rather than a number.
export interface DcgmSnapshot { available: boolean; reason: string; tensorActivity: number | null; memoryBandwidthPct: number | null }
export interface SystemSnapshot {
  at: string;                    // ISO timestamp of the reading
  gpu: GpuSnapshot | null;       // null when nvidia-smi is absent or failed
  gpuUnavailableReason: string;
  host: HostSnapshot;
  dcgm: DcgmSnapshot;
}
export const unifiedMemory = true; // GB10 shares one memory pool between CPU and GPU
export function pct(used: number | null, total: number | null) { return used == null || !total ? null : Math.min(100, Math.max(0, (used / total) * 100)); }
export function gb(mb: number | null) { return mb == null ? null : mb / 1024; }
