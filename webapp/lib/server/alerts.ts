// Server-side only: this module holds the Twilio credentials. Import it from
// route handlers, never from a "use client" file. Secrets live in
// webapp/.env.local (git-ignored) and are never returned to the browser.
import type { AlertChannel, AlertRecipient, Category, Severity } from "@/lib/types";

export type AlertOutcome = "sent" | "duplicate" | "below_threshold" | "rate_limited" | "not_configured" | "failed";
export interface AlertRequest { detectionId: string; category: Category; severity: Severity; videoTitle: string; seconds: number; simulated: boolean; reviewPath?: string; test?: boolean; recipient?: AlertRecipient }
export interface AlertResult { outcome: AlertOutcome; message: string; body?: string; sid?: string; retryAfterMinutes?: number }
export interface AlertStatus { configured: boolean; missing: string[]; ownerMasked: string | null; sentLastHour: number; maxPerHour: number; minimumSeverity: Severity; sandbox: boolean; channels: Record<AlertChannel, boolean>; acceptsRecipient: boolean }

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
export function normaliseNumber(raw: string) { const t = raw.trim().replace(/^whatsapp:/i, "").replace(/[\s()\-.]/g, ""); return /^\+[1-9]\d{7,14}$/.test(t) ? t : null; }
function normaliseEmail(raw: string) { const t = raw.trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? t : null; }

/** Returns the recipient in the form its channel needs, or why it cannot be used. */
export function checkRecipient(r: AlertRecipient): { to: string } | { error: string } {
  if (r.channel === "email") { const to = normaliseEmail(r.to); return to ? { to } : { error: "That does not look like an email address." }; }
  const number = normaliseNumber(r.to);
  if (!number) return { error: "Enter the number in international form, for example +14085551234." };
  return { to: r.channel === "whatsapp" ? `whatsapp:${number}` : number };
}
function maskAny(value: string | null) {
  if (!value) return null;
  const bare = value.replace(/^whatsapp:/, "");
  if (bare.includes("@")) { const [user, domain] = bare.split("@"); return `${user.slice(0, 2)}${"\u2022".repeat(Math.max(1, user.length - 2))}@${domain}`; }
  return `${bare.slice(0, 3)}${"\u2022".repeat(Math.max(0, bare.length - 7))}${bare.slice(-4)}`;
}
const mask = maskAny;

function credentials() {
  const sid = env("TWILIO_ACCOUNT_SID"), token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER"), service = env("TWILIO_MESSAGING_SERVICE_SID");
  const owner = normaliseNumber(env("ALERT_OWNER_NUMBER"));
  const missing: string[] = [];
  if (!sid) missing.push("TWILIO_ACCOUNT_SID");
  if (!token) missing.push("TWILIO_AUTH_TOKEN");
  if (!from && !service) missing.push("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID");
  if (!owner) missing.push(env("ALERT_OWNER_NUMBER") ? "ALERT_OWNER_NUMBER (must be E.164, e.g. +14085551234)" : "ALERT_OWNER_NUMBER");
  const whatsappFrom = env("TWILIO_WHATSAPP_FROM") || (from.startsWith("whatsapp:") ? from : "");
  return { sid, token, from, service, owner, missing, whatsappFrom,
    sendgridKey: env("SENDGRID_API_KEY"), emailFrom: env("ALERT_EMAIL_FROM"),
    base: env("TWILIO_API_BASE") || "https://api.twilio.com",
    emailBase: env("SENDGRID_API_BASE") || "https://api.sendgrid.com" };
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

async function postToSendGrid(base: string, key: string, from: string, to: string, subject: string, body: string) {
  const res = await fetch(`${base.replace(/\/$/, "")}/v3/mail/send`, {
    method: "POST", cache: "no-store",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject, content: [{ type: "text/plain", value: body }] }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) return { ok: true, status: res.status, detail: "" };
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, detail: text.slice(0, 300) };
}

export function alertStatus(): AlertStatus {
  const c = credentials(); const now = Date.now(); prune(now);
  const twilioReady = Boolean(c.sid && c.token && (c.from || c.service));
  return { configured: c.missing.length === 0, missing: c.missing, ownerMasked: mask(c.owner), sentLastHour: sentAt.length, maxPerHour: maxPerHour(), minimumSeverity: minimumSeverity(), sandbox: Boolean(env("TWILIO_API_BASE")),
    channels: { sms: twilioReady, whatsapp: twilioReady && Boolean(c.whatsappFrom), email: Boolean(c.sendgridKey && c.emailFrom) },
    // Letting the browser name a recipient turns this into an open relay if the app
    // is ever reachable beyond localhost. On by default for the local workspace;
    // set ALERT_ALLOW_CLIENT_RECIPIENT=false before exposing it.
    acceptsRecipient: env("ALERT_ALLOW_CLIENT_RECIPIENT").toLowerCase() !== "false" };
}

export async function sendAlert(request: AlertRequest, origin: string): Promise<AlertResult> {
  const c = credentials();
  // Where this goes: the recipient the recording opted in with, else the owner in the environment.
  const wanted: AlertRecipient | null = request.recipient && alertStatus().acceptsRecipient ? request.recipient
    : c.owner ? { channel: "sms", to: c.owner } : null;
  if (!wanted) return { outcome: "not_configured", message: `No recipient. Either opt a recording in to alerts, or set ALERT_OWNER_NUMBER in webapp/.env.local and restart the server.` };

  const checked = checkRecipient(wanted);
  if ("error" in checked) return { outcome: "failed", message: checked.error };
  const to = checked.to, channel = wanted.channel;

  const needed = channel === "email"
    ? [!c.sendgridKey && "SENDGRID_API_KEY", !c.emailFrom && "ALERT_EMAIL_FROM"].filter(Boolean)
    : [!c.sid && "TWILIO_ACCOUNT_SID", !c.token && "TWILIO_AUTH_TOKEN",
       !c.from && !c.service && "TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID",
       channel === "whatsapp" && !c.whatsappFrom && "TWILIO_WHATSAPP_FROM"].filter(Boolean);
  if (needed.length) return { outcome: "not_configured", message: `${channel === "email" ? "Email" : channel === "whatsapp" ? "WhatsApp" : "SMS"} is not configured. Set ${needed.join(", ")} in webapp/.env.local and restart the server.` };

  if (!request.test && !shouldAlert(request.category, request.severity)) return { outcome: "below_threshold", message: `${request.severity} ${request.category} is below the ${minimumSeverity()} alert threshold, so nothing was sent.` };

  const now = Date.now(); prune(now);
  const key = `${request.detectionId}:${to}`;
  if (!request.test && sentDetections.has(key)) return { outcome: "duplicate", message: "This recipient has already been told about this detection." };
  const cap = maxPerHour();
  if (sentAt.length >= cap) { const mins = Math.ceil((WINDOW_MS - (now - sentAt[0])) / 60000); return { outcome: "rate_limited", message: `The hourly cap of ${cap} alerts is reached. The next one can go out in ${mins} minutes.`, retryAfterMinutes: mins }; }

  const reviewBase = env("ALERT_REVIEW_BASE") || origin;
  const link = request.reviewPath && reviewBase ? `${reviewBase.replace(/\/$/, "")}${request.reviewPath}` : "";
  // Email is not billed by the segment, so it carries the full description.
  const body = channel === "email"
    ? `${request.simulated ? "[SIMULATED] " : ""}Sentinel Machines flagged ${request.severity === "measurement" ? request.category : `a suspected ${request.category.toLowerCase()}`} at ${Math.floor(request.seconds / 60)}:${String(Math.floor(request.seconds % 60)).padStart(2, "0")} in "${request.videoTitle}".\n\nThis is a suspected incident and needs a person to confirm it.${link ? `\n\nReview: ${link}` : ""}`
    : composeBody(request, link);

  try {
    if (channel === "email") {
      const subject = `${request.simulated ? "[SIMULATED] " : ""}Sentinel Machines: suspected ${request.category.toLowerCase()}`;
      const { ok, status, detail } = await postToSendGrid(c.emailBase, c.sendgridKey, c.emailFrom, to, subject, body);
      if (!ok) return { outcome: "failed", message: `SendGrid refused the message (HTTP ${status}). ${detail || "No detail returned."}`, body };
    } else {
      const form = new URLSearchParams({ To: to, Body: body });
      if (channel === "whatsapp") form.set("From", c.whatsappFrom.startsWith("whatsapp:") ? c.whatsappFrom : `whatsapp:${c.whatsappFrom}`);
      else if (c.service) form.set("MessagingServiceSid", c.service);
      else form.set("From", c.from);
      const { ok, status, payload } = await postToTwilio(c.base, c.sid, c.token, form);
      if (!ok) {
        // 21608 is the trial "unverified number" error; 63007 is a WhatsApp sender that is not joined.
        const hint = payload.code === 21608 ? " On a Twilio trial the destination must be a verified number."
          : payload.code === 21610 ? " That number replied STOP and is unsubscribed."
          : payload.code === 63007 ? " Join the WhatsApp sandbox from that number first."
          : "";
        return { outcome: "failed", message: `Twilio refused the message (HTTP ${status}${payload.code ? `, code ${payload.code}` : ""}): ${payload.message ?? "no detail returned"}.${hint}`, body };
      }
      sentAt.push(now); sentDetections.set(key, now);
      return { outcome: "sent", message: `Sent by ${channel === "whatsapp" ? "WhatsApp" : "SMS"} to ${mask(to)}.`, body, sid: payload.sid };
    }
    sentAt.push(now); sentDetections.set(key, now);
    return { outcome: "sent", message: `Emailed ${mask(to)}.`, body };
  } catch (e) {
    const reason = (e as Error)?.name === "TimeoutError" ? "the service did not answer within 10 seconds" : (e as Error)?.message ?? "unknown error";
    return { outcome: "failed", message: `Could not reach the ${channel === "email" ? "email" : "messaging"} service: ${reason}.`, body };
  }
}

/** Test seam: the caps are process-global, so tests need a way back to a clean slate. */
export function resetAlertCounters() { sentAt.length = 0; sentDetections.clear(); }
