import { NextResponse } from "next/server";
import { listDemoClips } from "@/lib/server/demo-clips";

export const dynamic = "force-dynamic";

// The demo clips this server can hand to the browser.
export async function GET() {
  const clips = await listDemoClips();
  if (!clips?.length) return NextResponse.json({ available: false, clips: [], reason: "No demo clips on this server. Build them with model/openrouter-bakeoff/fetch_data.py or set DEMO_CLIPS_DIR." });
  return NextResponse.json({ available: true, clips });
}
