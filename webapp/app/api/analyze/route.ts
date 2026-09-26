import { NextResponse } from "next/server";
import { framesToMp4DataUrl } from "@/lib/server/frames-to-video";
import { modelId, notConfigured, vlmConfig, type ServerVlmConfig } from "@/lib/server/vlm-config";
import { groundBoxes } from "@/lib/server/yolo";
import { INCIDENT_THRESHOLD, parseWindow, windowMessages, type Frame } from "@/lib/vlm/analysis";
import { chat, VlmError } from "@/lib/vlm/client";
import { parseYesNo, SCORER_WINDOW, scorerBody, scorerWindowResult } from "@/lib/vlm/scorer";
import { recordInference } from "@/lib/server/inference-stats";
import { recordWatchEvent, watchId } from "@/lib/server/watch-log";
import { parseFeedSource } from "@/lib/watch-types";

export const dynamic = "force-dynamic";

const MAX_FRAMES = 8;
const MAX_IMAGE_CHARS = 2_000_000;

/** Local yes/no scorer: exactly one 16-frame, 2 fps window, sent as a video clip. */
async function scoreWindow(config: ServerVlmConfig, frames: Frame[], start: number, end: number, signal: AbortSignal) {
  if (frames.length !== SCORER_WINDOW.frames) {
    return NextResponse.json({ error: `The local shoplifting scorer needs exactly ${SCORER_WINDOW.frames} frames at ${SCORER_WINDOW.fps} fps per window. It runs on recorded videos; pick another model for Live.` }, { status: 400 });
  }
  const started = Date.now();
  try {
    const video = await framesToMp4DataUrl(frames.map(f => f.image), SCORER_WINDOW.fps);
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify(scorerBody(config.model, video)),
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 300_000)]),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.error) {
      const message = payload.error?.message ?? payload.message ?? `HTTP ${res.status}`;
      return NextResponse.json({ error: `Local scorer request failed: ${message}. Is zrt serving ${config.model} at ${config.baseUrl}?` }, { status: 502 });
    }
    const { pYes } = parseYesNo(payload);
    return NextResponse.json({ ...scorerWindowResult(pYes, start, end, INCIDENT_THRESHOLD), model: modelId(config), latencyMs: Date.now() - started, usage: { local: true } });
  } catch (e) {
    return NextResponse.json({ error: `Local scorer request failed: ${e instanceof Error ? e.message : String(e)}. Is zrt running at ${config.baseUrl}?` }, { status: 502 });
  }
}

// Analyze one window of consecutive frames. Body: { frames: [{seconds, image}], start, end, context?, model?, source? }
// `source` names the feed; with it, the window goes into the watch agent's feed log.
export async function POST(request: Request) {
  let body: { frames?: Frame[]; start?: number; end?: number; context?: string; model?: string; source?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const config = vlmConfig("vision", body.model);
  if (!config) return NextResponse.json(notConfigured, { status: 503 });
  const frames = Array.isArray(body.frames) ? body.frames : [];
  const maxFrames = config.scorer ? SCORER_WINDOW.frames : MAX_FRAMES;
  if (!frames.length || frames.length > maxFrames) return NextResponse.json({ error: `Send 1–${maxFrames} frames.` }, { status: 400 });
  for (const f of frames) {
    if (!Number.isFinite(f?.seconds) || typeof f?.image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(f.image) || f.image.length > MAX_IMAGE_CHARS) {
      return NextResponse.json({ error: "Each frame needs finite seconds and a JPEG, PNG or WebP data URL under 1.5 MB." }, { status: 400 });
    }
  }
  const start = Number.isFinite(body.start) ? Number(body.start) : frames[0].seconds;
  const end = Number.isFinite(body.end) ? Number(body.end) : frames[frames.length - 1].seconds;
  const context = typeof body.context === "string" ? body.context.slice(0, 300) : undefined;
  if (config.scorer) return scoreWindow(config, frames, start, end, request.signal);

  try {
    let raw = "";
    // Small models occasionally emit malformed JSON; one retry fixes most cases.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await chat(config, windowMessages(frames, context), { maxTokens: 600, temperature: attempt ? 0.2 : 0, signal: request.signal });
      recordInference(config, reply);
      raw = reply.text;
      let result;
      try { result = parseWindow(reply.text, frames, start, end); } catch { continue; /* retry */ }
      // Snap boxes to YOLO persons and follow them across the frames (VLM boxes if YOLO is not configured).
      const grounded = await groundBoxes(result, frames, request.signal);
      const source = parseFeedSource(body.source);
      if (source) {
        const id = watchId();
        await recordWatchEvent({ type: "window", id, at: new Date().toISOString(), source, start: grounded.start, end: grounded.end, model: modelId(config), summary: grounded.summary,
          incidents: grounded.incidents.map((i, n) => ({ id: `${id}:${n}`, category: i.category, severity: i.severity, confidence: i.confidence, seconds: i.seconds, description: i.description })) });
      }
      // Usage for the Analytics page: tokens and cost as the endpoint reports them; `local` = served on the GB10 via zrt.
      return NextResponse.json({ ...grounded, model: modelId(config), latencyMs: reply.latencyMs,
        usage: { promptTokens: reply.promptTokens, completionTokens: reply.completionTokens, cost: reply.cost, local: !!config.local } });
    }
    return NextResponse.json({ error: "The model reply was not valid JSON twice in a row. Try again or choose another model.", raw: raw.slice(0, 500) }, { status: 502 });
  } catch (e) {
    const status = e instanceof VlmError && e.status === 429 ? 429 : 502;
    return NextResponse.json({ error: `Model request failed: ${e instanceof Error ? e.message : String(e)}` }, { status });
  }
}
