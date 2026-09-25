import { NextResponse } from "next/server";
import { systemSnapshot } from "@/lib/server/telemetry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const snapshot = await systemSnapshot();
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
