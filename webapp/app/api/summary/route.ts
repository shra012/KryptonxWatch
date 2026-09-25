import { NextResponse } from "next/server";
import { modelId, notConfigured, vlmConfig } from "@/lib/server/vlm-config";
import { summaryMessages, type SummaryRow } from "@/lib/vlm/assistant";
import { chat } from "@/lib/vlm/client";

export const dynamic = "force-dynamic";

// AI summary for the analytics page. Body: { rows: SummaryRow[], totals: Record<string, number> }
export async function POST(request: Request) {
  let body: { rows?: SummaryRow[]; totals?: Record<string, number>; model?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const config = vlmConfig("chat", body.model);
  if (!config) return NextResponse.json(notConfigured, { status: 503 });
  const rows = Array.isArray(body.rows) ? body.rows : [];
  try {
    const reply = await chat(config, summaryMessages(rows, body.totals ?? {}), { maxTokens: 500, temperature: 0.3, signal: request.signal });
    return NextResponse.json({ summary: reply.text.trim(), model: modelId(config) });
  } catch (e) {
    return NextResponse.json({ error: `Summary request failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
