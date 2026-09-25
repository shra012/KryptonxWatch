import { NextResponse } from "next/server";
import { alertStatus, sendAlert, type AlertRequest } from "@/lib/server/alerts";
import { categories, severityOrder } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser posts here from the dashboard, and the detection service on the
// ZGX posts here with a token. Nothing else gets to spend the SMS budget.
function authorised(request: Request) {
  const token = process.env.ALERT_API_TOKEN?.trim();
  const presented = request.headers.get("x-alert-token")?.trim();
  if (token && presented && presented === token) return true;
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  if (origin && host) { try { return new URL(origin).host === host; } catch { return false; } }
  return false; // no origin and no token: a server-to-server caller must present ALERT_API_TOKEN
}

function parse(value: unknown): { request: AlertRequest } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Send a JSON object describing the detection." };
  const b = value as Record<string, unknown>;
  const test = b.test === true;
  const detectionId = typeof b.detectionId === "string" && b.detectionId ? b.detectionId : test ? `test-${Date.now()}` : "";
  if (!detectionId) return { error: "detectionId is required." };
  const category = b.category as AlertRequest["category"];
  if (!test && !categories.includes(category)) return { error: `category must be one of: ${categories.join(", ")}.` };
  const severity = b.severity as AlertRequest["severity"];
  if (!test && !severityOrder.includes(severity)) return { error: `severity must be one of: ${severityOrder.join(", ")}.` };
  const seconds = Number(b.seconds);
  return { request: {
    detectionId, test,
    category: category ?? "Suspicious activity",
    severity: severity ?? "high",
    videoTitle: typeof b.videoTitle === "string" ? b.videoTitle.slice(0, 120) : "a recording",
    seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    simulated: b.simulated !== false,       // default to the honest label
    reviewPath: typeof b.reviewPath === "string" && b.reviewPath.startsWith("/") ? b.reviewPath : undefined,
  } };
}

export async function GET() { return NextResponse.json(alertStatus(), { headers: { "cache-control": "no-store" } }); }

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ outcome: "failed", message: "This request is not allowed to send alerts. Call it from the dashboard, or present ALERT_API_TOKEN in the x-alert-token header." }, { status: 403 });
  const parsed = parse(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ outcome: "failed", message: parsed.error }, { status: 400 });
  const origin = request.headers.get("origin") || (request.headers.get("host") ? `http://${request.headers.get("host")}` : "");
  const result = await sendAlert(parsed.request, origin);
  const status = result.outcome === "sent" ? 200 : result.outcome === "failed" ? 502 : result.outcome === "rate_limited" ? 429 : result.outcome === "not_configured" ? 503 : 200;
  return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } });
}
