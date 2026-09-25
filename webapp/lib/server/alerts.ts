// Server-side only: this module holds the Twilio credentials. Import it from
// route handlers, never from a "use client" file. Secrets live in
// webapp/.env.local (git-ignored) and are never returned to the browser.
import type { Category, Severity } from "@/lib/types";

export type AlertOutcome = "sent" | "duplicate" | "below_threshold" | "rate_limited" | "not_configured" | "failed";
export interface AlertRequest { detectionId: string; category: Category; severity: Severity; videoTitle: string; seconds: number; simulated: boolean; reviewPath?: string; test?: boolean }
export interface AlertResult { outcome: AlertOutcome; message: string; body?: string; sid?: string; retryAfterMinutes?: number }
export interface AlertStatus { configured: boolean; missing: string[]; ownerMasked: string | null; sentLastHour: number; maxPerHour: number; minimumSeverity: Severity; sandbox: boolean }

const MAX_BODY = 160;                       // one GSM-7 segment, so one billed message
const WINDOW_MS = 60 * 60 * 1000;
const env = (key: string) => process.env[key]?.trim() || "";
function maxPerHour() { const n = Number.parseInt(env("ALERT_MAX_PER_HOUR"), 10); return Number.isFinite(n) && n > 0 ? n : 10; }

// Severity ladder. Anything below the configured floor is not worth a text at
// 2am, and queue measurements are never an incident.
const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, measurement: 0 };
function minimumSeverity(): Severity { const v = env("ALERT_MIN_SEVERITY") as Severity; return v && v in rank ? v : "high"; }
// Categories that always text regardless of the floor: a weapon on the floor is
// not something to sit on.
const alwaysAlert: Category[] = ["Gun", "Robbery", "Medical emergency"];
// Queue length is a measurement whatever severity it arrives with, so it never texts.
const neverAlert: Category[] = ["Queue tracking"];
export function shouldAlert(category: Category, severity: Severity) { if (severity === "measurement" || neverAlert.includes(category)) return false; return alwaysAlert.includes(category) || rank[severity] >= rank[minimumSeverity()]; }

// A phone number Twilio will accept: E.164, 8-15 digits after the +.
export function normaliseNumber(raw: string) { const t = raw.trim().replace(/[\s()\-.]/g, ""); return /^\+[1-9]\d{7,14}$/.test(t) ? t : null; }
function mask(number: string | null) { return number ? `${number.slice(0, 3)}${"•".repeat(Math.max(0, number.length - 7))}${number.slice(-4)}` : null; }

function credentials() {
  const sid = env("TWILIO_ACCOUNT_SID"), token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER"), service = env("TWILIO_MESSAGING_SERVICE_SID");
  const owner = normaliseNumber(env("ALERT_OWNER_NUMBER"));
  const missing: string[] = [];
  if (!sid) missing.push("TWILIO_ACCOUNT_SID");
  if (!token) missing.push("TWILIO_AUTH_TOKEN");
  if (!from && !service) missing.push("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID");
  if (!owner) missing.push(env("ALERT_OWNER_NUMBER") ? "ALERT_OWNER_NUMBER (must be E.164, e.g. +14085551234)" : "ALERT_OWNER_NUMBER");
  return { sid, token, from, service, owner, missing, base: env("TWILIO_API_BASE") || "https://api.twilio.com" };
}

// Both caps are per process. A single Next.js server owns the alerting, and
// losing the counters on restart is the safe direction: worst case the owner
// gets one repeat, never a silent drop.
const sentDetections = new Map<string, number>();
const sentAt: number[] = [];
function prune(now: number) { while (sentAt.length && now - sentAt[0] > WINDOW_MS) sentAt.shift(); for (const [id, at] of sentDetections) if (now - at > WINDOW_MS * 24) sentDetections.delete(id); }

function timecode(seconds: number) { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }

/** Plain ASCII, one segment. Trims the least important part first: the link, then the title. */
export function composeBody(r: AlertRequest, reviewUrl: string) {
  const ascii = (v: string) => v.replace(/[^\x20-\x7E]/g, "").trim();
  const prefix = r.simulated ? "[SIMULATED] " : "";
  const what = r.severity === "measurement" ? ascii(r.category) : `Suspected ${ascii(r.category).toLowerCase()}`;
  const head = `${prefix}Sentinel Machines: ${what} (${r.severity}) at ${timecode(r.seconds)}`;
  const tail = reviewUrl ? ` ${reviewUrl}` : "";
  let title = ascii(r.videoTitle);
  let body = `${head} in ${title}.${tail}`;
  if (body.length > MAX_BODY) { const room = MAX_BODY - head.length - tail.length - " in .".length; title = room > 4 ? title.slice(0, room).trimEnd() : ""; body = title ? `${head} in ${title}.${tail}` : `${head}.${tail}`; }
  return body.length > MAX_BODY ? body.slice(0, MAX_BODY).trimEnd() : body;
}

async function postToTwilio(base: string, sid: string, token: string, form: URLSearchParams) {
  const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST", body: form, cache: "no-store",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10000),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, payload: payload as { sid?: string; message?: string; code?: number } };
}

export function alertStatus(): AlertStatus {
  const { missing, owner } = credentials(); const now = Date.now(); prune(now);
  return { configured: missing.length === 0, missing, ownerMasked: mask(owner), sentLastHour: sentAt.length, maxPerHour: maxPerHour(), minimumSeverity: minimumSeverity(), sandbox: Boolean(env("TWILIO_API_BASE")) };
}

export async function sendAlert(request: AlertRequest, origin: string): Promise<AlertResult> {
  const { sid, token, from, service, owner, missing, base } = credentials();
  if (missing.length) return { outcome: "not_configured", message: `Twilio is not configured. Set ${missing.join(", ")} in webapp/.env.local and restart the server.` };
  if (!request.test && !shouldAlert(request.category, request.severity)) return { outcome: "below_threshold", message: `${request.severity} ${request.category} is below the ${minimumSeverity()} alert threshold, so no text was sent.` };

  const now = Date.now(); prune(now);
  if (!request.test && sentDetections.has(request.detectionId)) return { outcome: "duplicate", message: "The owner has already been texted about this detection." };
  const cap = maxPerHour();
  if (sentAt.length >= cap) return { outcome: "rate_limited", message: `The hourly cap of ${cap} alerts is reached. The next text can go out in ${Math.ceil((WINDOW_MS - (now - sentAt[0])) / 60000)} minutes.`, retryAfterMinutes: Math.ceil((WINDOW_MS - (now - sentAt[0])) / 60000) };

  const reviewBase = env("ALERT_REVIEW_BASE") || origin;
  const body = composeBody(request, request.reviewPath && reviewBase ? `${reviewBase.replace(/\/$/, "")}${request.reviewPath}` : "");
  const form = new URLSearchParams({ To: owner!, Body: body });
  if (service) form.set("MessagingServiceSid", service); else form.set("From", from);

  try {
    const { ok, status, payload } = await postToTwilio(base, sid, token, form);
    if (!ok) {
      // 21608 is the trial-account "unverified number" error; it is the one people hit first.
      const hint = payload.code === 21608 ? " On a Twilio trial the destination must be a verified number." : payload.code === 21610 ? " That number replied STOP and is unsubscribed." : "";
      return { outcome: "failed", message: `Twilio refused the message (HTTP ${status}${payload.code ? `, code ${payload.code}` : ""}): ${payload.message ?? "no detail returned"}.${hint}`, body };
    }
    sentAt.push(now); sentDetections.set(request.detectionId, now);
    return { outcome: "sent", message: `Texted the owner at ${mask(owner)}.`, body, sid: payload.sid };
  } catch (e) {
    const reason = (e as Error)?.name === "TimeoutError" ? "Twilio did not answer within 10 seconds." : (e as Error)?.message ?? "unknown error";
    return { outcome: "failed", message: `Could not reach Twilio: ${reason}`, body };
  }
}

/** Test seam: the caps are process-global, so tests need a way back to a clean slate. */
export function resetAlertCounters() { sentAt.length = 0; sentDetections.clear(); }
