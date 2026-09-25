// Prompt, parsing and merging for vision-language-model video analysis.
// Pure functions with no runtime imports, so the web app (API routes, browser) and
// scripts/vlm-benchmark.ts run exactly the same logic.
import type { BoundingBox, Category, Detection, Keyframe, Severity } from "../types";

/** Frames sampled every `frameStep` seconds, grouped into windows of `framesPerWindow`. */
export const WINDOW = { frameStep: 2, framesPerWindow: 4 } as const;
export const INCIDENT_THRESHOLD = 0.5;

export const detectableCategories = [
  "Shoplifting", "Theft", "Robbery", "Pickpocketing", "Fighting", "Vandalism", "Gun",
  "Medical emergency", "Kiosk nonpayment", "Suspicious activity",
] as const satisfies readonly Category[];

export const defaultSeverity: Record<(typeof detectableCategories)[number], Severity> = {
  Shoplifting: "medium", Theft: "medium", Robbery: "critical", Pickpocketing: "medium", Fighting: "high",
  Vandalism: "medium", Gun: "critical", "Medical emergency": "critical", "Kiosk nonpayment": "medium",
  "Suspicious activity": "low",
};
const severities: Severity[] = ["critical", "high", "medium", "low"];

export interface Frame { seconds: number; image: string } // image: data URL (image/jpeg)
export interface WindowPlan { start: number; end: number; times: number[] }
export interface Incident {
  category: (typeof detectableCategories)[number];
  severity: Severity;
  confidence: number;
  seconds: number;
  description: string;
  box?: BoundingBox;
  /** Boxes over the window's frames; the VLM box alone, or the tracked YOLO person (app/api/analyze). */
  keyframes?: Keyframe[];
}
export interface WindowResult { start: number; end: number; summary: string; incidents: Incident[]; score: number }

/** Sample times for a video, grouped into analysis windows. */
export function planWindows(duration: number, step: number = WINDOW.frameStep, perWindow: number = WINDOW.framesPerWindow): WindowPlan[] {
  const times: number[] = [];
  for (let t = step / 2; t < duration; t += step) times.push(Math.round(t * 100) / 100);
  const windows: WindowPlan[] = [];
  for (let i = 0; i < times.length; i += perWindow) {
    const slice = times.slice(i, i + perWindow);
    windows.push({ start: Math.max(0, slice[0] - step / 2), end: Math.min(duration, slice[slice.length - 1] + step / 2), times: slice });
  }
  return windows;
}

export const SYSTEM_PROMPT = `You are a security analyst reviewing CCTV footage for a retail and public-safety monitoring system.
You receive consecutive frames from one camera with their timestamps. Judge what happens across the frames together, not each frame alone.

Report an incident only when the frames show visual evidence of it. Ordinary shopping, walking, talking, working at a counter, and empty scenes are NOT incidents. Low image quality alone is not suspicious.

Incident categories:
- Shoplifting: concealing merchandise, leaving a store with unpaid goods
- Theft: taking property that is not theirs outside a shop context (bags, bikes, packages, parked cars)
- Robbery: taking property by force or threat, e.g. at a counter or on the street
- Pickpocketing: stealing from a person's pockets or bag by close contact
- Fighting: physical assault, punching, kicking, shoving, wrestling
- Vandalism: deliberately damaging or defacing property
- Gun: a firearm is visible
- Medical emergency: collapse, fall, person lying motionless, seizure, choking
- Kiosk nonpayment: bypassing payment at a self-checkout
- Suspicious activity: concerning behaviour that fits none of the above

Answer with JSON only, no prose, in exactly this shape:
{"summary": "<one sentence describing what happens in these frames>",
 "incidents": [{"category": "<one category from the list>", "severity": "critical|high|medium|low", "confidence": <0.0-1.0>, "frame": <1-based index of the clearest frame>, "description": "<what the person does, max 25 words>", "box": [x1, y1, x2, y2] }]}
"box" is the region of the main person or object on that frame, as integers 0-1000 relative to image width and height; use null if unsure.
Use "incidents": [] when nothing concerning happens. Confidence is your probability that the incident is real.`;

export function userPrompt(frames: { seconds: number }[], context?: string) {
  const list = frames.map((f, i) => `Frame ${i + 1} at ${f.seconds.toFixed(1)} s`).join("\n");
  return `${context ? `Context: ${context}\n` : ""}${frames.length} frames in order:\n${list}\nReturn the JSON.`;
}

/** OpenAI-compatible chat messages for one analysis window. */
export function windowMessages(frames: Frame[], context?: string) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt(frames, context) },
        ...frames.map(f => ({ type: "image_url", image_url: { url: f.image } })),
      ],
    },
  ];
}

/** Extract the first JSON object from a model reply (handles code fences and thinking blocks). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("Model reply contains no JSON object");
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error("Model reply has an unterminated JSON object");
}

function toCategory(value: unknown): Incident["category"] {
  const v = String(value ?? "").trim().toLowerCase();
  const exact = detectableCategories.find(c => c.toLowerCase() === v);
  if (exact) return exact;
  if (/assault|fight|punch|violence/.test(v)) return "Fighting";
  if (/steal|burglar/.test(v)) return "Theft";
  if (/weapon|firearm|gun|pistol/.test(v)) return "Gun";
  if (/fall|faint|medical|collapse|injur/.test(v)) return "Medical emergency";
  if (/shoplift/.test(v)) return "Shoplifting";
  if (/robb/.test(v)) return "Robbery";
  if (/vandal|damag/.test(v)) return "Vandalism";
  return "Suspicious activity";
}

function toBox(value: unknown, label: string): BoundingBox | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const n = value.map(Number);
  if (n.some(x => !Number.isFinite(x))) return undefined;
  const scale = Math.max(...n) <= 1 ? 1 : 1000; // accept 0-1 as well as 0-1000
  const [x1, y1, x2, y2] = n.map(x => Math.min(1, Math.max(0, x / scale)));
  if (x2 - x1 < 0.01 || y2 - y1 < 0.01) return undefined;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, label };
}

/** Turn a model reply into a validated window result. Throws when the reply is not usable JSON. */
export function parseWindow(text: string, frames: { seconds: number }[], start: number, end: number): WindowResult {
  const raw = extractJson(text) as { summary?: unknown; incidents?: unknown };
  const list = Array.isArray(raw.incidents) ? raw.incidents : [];
  const incidents: Incident[] = list.flatMap((item): Incident[] => {
    if (!item || typeof item !== "object") return [];
    const i = item as Record<string, unknown>;
    const category = toCategory(i.category);
    const confidence = Math.min(1, Math.max(0, Number(i.confidence ?? 0.5) || 0));
    const frameIndex = Math.min(frames.length, Math.max(1, Math.round(Number(i.frame) || 1))) - 1;
    const severity = severities.includes(i.severity as Severity) ? (i.severity as Severity) : defaultSeverity[category];
    const seconds = frames[frameIndex]?.seconds ?? start;
    const box = toBox(i.box, category);
    return [{
      category, severity, confidence, seconds,
      description: String(i.description ?? "").slice(0, 300) || category,
      box, keyframes: box ? [{ seconds, box }] : [],
    }];
  });
  return {
    start, end,
    summary: String(raw.summary ?? "").slice(0, 400),
    incidents,
    score: incidents.reduce((m, i) => Math.max(m, i.confidence), 0),
  };
}

/**
 * Merge window incidents into detections: consecutive windows reporting the same category
 * become one detection spanning them. Only incidents at or above `threshold` are kept.
 */
export function mergeDetections(videoId: string, windows: WindowResult[], model: string, threshold = INCIDENT_THRESHOLD): Detection[] {
  const out: Detection[] = [];
  const open = new Map<string, Detection>();
  const ordered = [...windows].sort((a, b) => a.start - b.start);
  for (const w of ordered) {
    const seen = new Set<string>();
    for (const inc of w.incidents.filter(i => i.confidence >= threshold).sort((a, b) => b.confidence - a.confidence)) {
      if (seen.has(inc.category)) continue;
      seen.add(inc.category);
      const current = open.get(inc.category);
      if (current && (current.endSeconds ?? current.seconds) >= w.start - 0.01) {
        current.endSeconds = w.end;
        // Keep every window's boxes so the overlay follows the person through the whole detection.
        current.keyframes = [...(current.keyframes ?? []), ...(inc.keyframes ?? [])];
        if ((inc.confidence ?? 0) > (current.confidence ?? 0)) {
          Object.assign(current, { confidence: inc.confidence, description: inc.description, box: inc.box ?? current.box, severity: inc.severity });
        }
        continue;
      }
      const d: Detection = {
        id: `${videoId}-m${out.length + 1}`, videoId, seconds: inc.seconds, endSeconds: w.end,
        category: inc.category, severity: inc.severity, status: "new", description: inc.description,
        box: inc.box, confidence: inc.confidence, model,
        keyframes: [...(inc.keyframes ?? [])],
      };
      out.push(d);
      open.set(inc.category, d);
    }
    for (const cat of [...open.keys()]) if (!seen.has(cat)) open.delete(cat);
  }
  return out;
}
