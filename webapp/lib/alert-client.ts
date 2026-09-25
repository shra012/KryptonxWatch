// Browser side of owner SMS alerts. It only ever talks to our own /api/alerts —
// the Twilio credentials live on the server and never reach this file.
import type { Detection } from "./types";

export type AlertOutcome = "sent" | "duplicate" | "below_threshold" | "rate_limited" | "not_configured" | "failed";
export interface AlertResult { outcome: AlertOutcome; message: string; body?: string }
export interface AlertStatus { configured: boolean; missing: string[]; ownerMasked: string | null; sentLastHour: number; maxPerHour: number; minimumSeverity: string; sandbox: boolean }

export async function fetchAlertStatus(signal?: AbortSignal): Promise<AlertStatus> {
  const res = await fetch("/api/alerts", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`Alert settings returned ${res.status}.`);
  return res.json();
}

async function post(payload: Record<string, unknown>): Promise<AlertResult> {
  try {
    const res = await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return (await res.json()) as AlertResult;
  } catch { return { outcome: "failed", message: "Could not reach the alert service. Is the web app still running?" }; }
}

export type Alertable = Pick<Detection, "id" | "videoId" | "seconds" | "category" | "severity">;
export function alertForDetection(d: Alertable, videoTitle: string, simulated: boolean) {
  return post({ detectionId: d.id, category: d.category, severity: d.severity, videoTitle, seconds: d.seconds, simulated, reviewPath: `/videos/${d.videoId}?t=${Math.floor(d.seconds)}` });
}
export function sendTestAlert() { return post({ test: true, videoTitle: "a test from Preferences", seconds: 0, simulated: true, category: "Suspicious activity", severity: "high" }); }
