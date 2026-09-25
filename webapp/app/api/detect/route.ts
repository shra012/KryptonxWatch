import { NextResponse } from "next/server";
import { parseDetections, type DetectStatus } from "@/lib/live-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser never talks to the inference service directly: it may sit on
// another host or port on the ZGX, and its address is not the browser's business.
function service(): DetectStatus {
  const endpoint = process.env.DETECTION_SERVICE_URL?.trim();
  if (!endpoint) return { configured: false, reason: "No detection service is connected. Set DETECTION_SERVICE_URL in webapp/.env.local to the inference service on the ZGX, then restart the server.", endpoint: null };
  return { configured: true, reason: "", endpoint };
}

export async function GET() { const { configured, reason } = service(); return NextResponse.json({ configured, reason, endpoint: null } satisfies DetectStatus, { headers: { "cache-control": "no-store" } }); }

export async function POST(request: Request) {
  const { configured, reason, endpoint } = service();
  if (!configured) return NextResponse.json({ detections: [], modelMs: null, simulated: false, reason }, { status: 503 });

  const frame = await request.arrayBuffer();
  if (!frame.byteLength) return NextResponse.json({ detections: [], modelMs: null, simulated: false, reason: "Empty frame." }, { status: 400 });

  const started = Date.now();
  try {
    const res = await fetch(`${endpoint!.replace(/\/$/, "")}/detect`, {
      method: "POST", body: frame, cache: "no-store",
      headers: { "content-type": request.headers.get("content-type") ?? "image/jpeg", "x-camera-id": request.headers.get("x-camera-id") ?? "live" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ detections: [], modelMs: null, simulated: false, reason: `The detection service answered ${res.status}.` }, { status: 502 });
    const payload = await res.json().catch(() => null);
    const reported = (payload as { modelMs?: number })?.modelMs;
    return NextResponse.json({
      detections: parseDetections(payload),
      modelMs: typeof reported === "number" ? reported : Date.now() - started,
      // Only the service can say its findings are real; absent that, we do not claim it.
      simulated: (payload as { simulated?: boolean })?.simulated !== false,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError";
    return NextResponse.json({ detections: [], modelMs: null, simulated: false, reason: timedOut ? "The detection service did not answer within 8 seconds." : "Could not reach the detection service." }, { status: 504 });
  }
}
