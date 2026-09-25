// Prompts for the contextual assistant and the analytics summary.
import type { AssistantReply, Detection, Moment } from "../types";

export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface VideoContext {
  title: string;
  duration: number;
  analysis: string;
  detections: Pick<Detection, "seconds" | "endSeconds" | "category" | "severity" | "status" | "description" | "confidence">[];
  moments?: Moment[];
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const ASSISTANT_PROMPT = `You are the KryptonxWatch security assistant. You help a security operator understand recorded CCTV footage and decide what to do.
Use only the analysis provided below; do not invent events. Every automated detection is "suspected" until a human reviews it, so say so when it matters.
Cite moments as [mm:ss] so the operator can jump to them. Be concise (under 120 words) and practical.
For medical emergencies, weapons or violence, lead with safety steps: call local emergency services, keep distance, do not confront.`;

export function videoContextText(v: VideoContext) {
  const dets = v.detections.length
    ? v.detections.map(d => `- [${mmss(d.seconds)}${d.endSeconds ? `–${mmss(d.endSeconds)}` : ""}] suspected ${d.category} (${d.severity}${d.confidence != null ? `, confidence ${Math.round(d.confidence * 100)}%` : ""}, review status: ${d.status}): ${d.description}`).join("\n")
    : "- none";
  const moments = v.moments?.length ? v.moments.map(m => `- [${mmss(m.start)}] ${m.summary}`).join("\n") : "- not available";
  return `Recording: "${v.title}", ${Math.round(v.duration)} s, analysis: ${v.analysis}.\nDetections:\n${dets}\nScene log (one line per analysed window):\n${moments}`;
}

export function assistantMessages(v: VideoContext, history: ChatTurn[]) {
  return [
    // One system message: Qwen3.x chat templates (local vLLM) reject a second system message.
    { role: "system", content: `${ASSISTANT_PROMPT}\n\n${videoContextText(v)}` },
    ...history.slice(-12).map(t => ({ role: t.role, content: t.content.slice(0, 2000) })),
  ];
}

/** Pull [mm:ss] citations out of an assistant reply. */
export function withReferences(text: string): AssistantReply {
  const seen = new Set<number>();
  const references = [...text.matchAll(/\[(\d{1,2}):(\d{2})(?:\s*[–-]\s*\d{1,2}:\d{2})?\]/g)].flatMap(m => {
    const seconds = Number(m[1]) * 60 + Number(m[2]);
    if (seen.has(seconds)) return [];
    seen.add(seconds);
    return [{ seconds, label: `${m[1].padStart(2, "0")}:${m[2]}` }];
  });
  return { text: text.trim(), references };
}

export interface SummaryRow { video: string; seconds: number; category: string; severity: string; status: string; description: string }

export function summaryMessages(rows: SummaryRow[], totals: Record<string, number>) {
  const list = rows.slice(0, 150).map(r => `- ${r.video} [${mmss(r.seconds)}] ${r.category} (${r.severity}, ${r.status}): ${r.description}`).join("\n");
  return [
    { role: "system", content: "You summarise security detections for a store operations manager. Be factual and concise. All detections are suspected until reviewed; reviewed ones are confirmed by a human, dismissed ones are excluded." },
    { role: "user", content: `Totals: ${JSON.stringify(totals)}\nDetections:\n${list || "- none"}\n\nWrite three short sections with these headings:\nOverall summary (2–3 sentences)\nKey safety concerns\nNotable patterns and suggested next steps` },
  ];
}
