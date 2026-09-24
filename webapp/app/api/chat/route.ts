import { NextResponse } from "next/server";
import { notConfigured, vlmConfig } from "@/lib/server/vlm-config";
import { assistantMessages, withReferences, type ChatTurn, type VideoContext } from "@/lib/vlm/assistant";
import { chat } from "@/lib/vlm/client";

export const dynamic = "force-dynamic";

// Contextual assistant for one recording. Body: { video: VideoContext, messages: ChatTurn[] }
export async function POST(request: Request) {
  let body: { video?: VideoContext; messages?: ChatTurn[]; model?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  const config = vlmConfig("chat", body.model);
  if (!config) return NextResponse.json(notConfigured, { status: 503 });
  const history = (Array.isArray(body.messages) ? body.messages : []).filter(m => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string");
  if (!body.video || !history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "Send the recording context and at least one user message." }, { status: 400 });
  }
  const video: VideoContext = {
    title: String(body.video.title ?? "Recording").slice(0, 120),
    duration: Number(body.video.duration) || 0,
    analysis: String(body.video.analysis ?? "unknown"),
    detections: Array.isArray(body.video.detections) ? body.video.detections.slice(0, 100) : [],
    moments: Array.isArray(body.video.moments) ? body.video.moments.slice(0, 200) : [],
  };
  try {
    const reply = await chat(config, assistantMessages(video, history), { maxTokens: 400, temperature: 0.3, signal: request.signal });
    return NextResponse.json({ ...withReferences(reply.text), model: config.model });
  } catch (e) {
    return NextResponse.json({ error: `Assistant request failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
