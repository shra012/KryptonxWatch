/** Shape of GET /api/system. Every reading is null when the node cannot report it. */
export interface Telemetry {
  sampledAt: string;
  gpu: { name: string; utilization: number | null; temperature: number | null; powerWatts: number | null; smClockMhz: number | null; smClockMaxMhz: number | null; pstate: string | null } | null;
  processes: { pid: number; name: string; gpuMemoryMiB: number | null }[];
  memory: { totalBytes: number; usedBytes: number } | null;
  cpu: { percent: number | null; load1: number | null };
  unavailable: { metric: string; reason: string }[];
  errors: string[];
}
