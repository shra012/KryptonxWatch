import { NextResponse } from "next/server";
import { recordWatchEvent, watchEnabled, watchId } from "@/lib/server/watch-log";
import { parseFeedSource } from "@/lib/watch-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Review decisions from the dashboard, so the watch agent knows what a person already confirmed or dismissed.
// Body: { type: "review", source, detectionId, status, category?, seconds? }
export async function POST(request: Request) {
  if (!watchEnabled()) return new Response(null, { status: 204 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const source = parseFeedSource(body?.source);
  const detectionId = typeof body?.detectionId === "string" ? body.detectionId.slice(0, 200) : "";
  const status = typeof body?.status === "string" ? body.status.slice(0, 40) : "";
  if (body?.type !== "review" || !source || !detectionId || !status) return NextResponse.json({ error: "Send { type: \"review\", source, detectionId, status }." }, { status: 400 });
  await recordWatchEvent({
    type: "review", id: watchId(), at: new Date().toISOString(), source, detectionId, status,
    ...(typeof body.category === "string" ? { category: body.category.slice(0, 60) } : {}),
    ...(typeof body.seconds === "number" && Number.isFinite(body.seconds) ? { seconds: body.seconds } : {}),
  });
  return new Response(null, { status: 204 });
}
