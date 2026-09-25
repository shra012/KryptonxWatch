import { NextResponse } from "next/server";
import { readTelemetry } from "@/lib/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readTelemetry(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read node telemetry." }, { status: 500 });
  }
}
