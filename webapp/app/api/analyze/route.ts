import { NextResponse } from "next/server";
import { notConfigured, vlmConfig } from "@/lib/server/vlm-config";
import { parseWindow, windowMessages, type Frame } from "@/lib/vlm/analysis";
import { chat, VlmError } from "@/lib/vlm/client";

export const dynamic = "force-dynamic";

const MAX_FRAMES = 8;
const MAX_IMAGE_CHARS = 2_000_000;

// Analyze one window of consecutive frames. Body: { frames: [{seconds, image}], start, end, context?, model? }
export async function POST(request: Request) {
  let body: { frames?: Frame[]; start?: number; end?: number; context?: string; model?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const config = vlmConfig("vision", body.model);
  if (!config) return NextResponse.json(notConfigured, { status: 503 });
  const frames = Array.isArray(body.frames) ? body.frames : [];
  if (!frames.length || frames.length > MAX_FRAMES) return NextResponse.json({ error: `Send 1–${MAX_FRAMES} frames.` }, { status: 400 });
  for (const f of frames) {
    if (!Number.isFinite(f?.seconds) || typeof f?.image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(f.image) || f.image.length > MAX_IMAGE_CHARS) {
      return NextResponse.json({ error: "Each frame needs finite seconds and a JPEG, PNG or WebP data URL under 1.5 MB." }, { status: 400 });
    }
  }
  const start = Number.isFinite(body.start) ? Number(body.start) : frames[0].seconds;
  const end = Number.isFinite(body.end) ? Number(body.end) : frames[frames.length - 1].seconds;
  const context = typeof body.context === "string" ? body.context.slice(0, 300) : undefined;

  try {
    let raw = "";
    // Small models occasionally emit malformed JSON; one retry fixes most cases.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await chat(config, windowMessages(frames, context), { maxTokens: 600, temperature: attempt ? 0.2 : 0, signal: request.signal });
      raw = reply.text;
      try {
        return NextResponse.json({ ...parseWindow(reply.text, frames, start, end), model: config.model, latencyMs: reply.latencyMs });
      } catch { /* retry */ }
    }
    return NextResponse.json({ error: "The model reply was not valid JSON twice in a row. Try again or choose another model.", raw: raw.slice(0, 500) }, { status: 502 });
  } catch (e) {
    const status = e instanceof VlmError && e.status === 429 ? 429 : 502;
    return NextResponse.json({ error: `Model request failed: ${e instanceof Error ? e.message : String(e)}` }, { status });
  }
}
