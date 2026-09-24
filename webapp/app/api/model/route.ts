import { NextResponse } from "next/server";
import { modelOptions, providerLabel, vlmConfig } from "@/lib/server/vlm-config";

export const dynamic = "force-dynamic";

// Which model the server will use. Never returns the key.
export function GET() {
  const vision = vlmConfig("vision");
  if (!vision) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, model: vision.model, chatModel: vlmConfig("chat")?.model, provider: providerLabel(vision.baseUrl), options: modelOptions() });
}
