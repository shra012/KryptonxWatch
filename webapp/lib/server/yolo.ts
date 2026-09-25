// Client for the YOLO person-box service (model/YOLO/src/yolo_server.py). Server-only.
// Optional: without YOLO_BASE_URL, or if the service fails, analysis keeps the VLM's own boxes.
import type { Frame, WindowResult } from "@/lib/vlm/analysis";
import { trackIncident, type Rect } from "@/lib/vlm/boxes";

const TIMEOUT_MS = 15_000;

export const yoloConfigured = () => Boolean(process.env.YOLO_BASE_URL);

/** Person boxes per frame, or null when the service is not configured or does not answer. */
async function detectPersons(frames: Frame[], signal?: AbortSignal): Promise<Rect[][] | null> {
  const base = process.env.YOLO_BASE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: frames.map(f => f.image) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => ({}));
    return res.ok && Array.isArray(payload.persons) && payload.persons.length === frames.length ? payload.persons : null;
  } catch {
    return null;
  }
}

/**
 * Replace each incident's box with the YOLO person it points at, followed across the window's frames.
 * Returns the result unchanged (VLM boxes) when YOLO is off, unavailable, or there is nothing to ground.
 */
export async function groundBoxes<T extends WindowResult>(result: T, frames: Frame[], signal?: AbortSignal): Promise<T & { boxes: "yolo" | "vlm" }> {
  if (!result.incidents.some(i => i.box)) return { ...result, boxes: "vlm" };
  const persons = await detectPersons(frames, signal);
  if (!persons) return { ...result, boxes: "vlm" };
  const incidents = result.incidents.map(inc => ({ ...inc, ...trackIncident(inc.box, inc.seconds, frames, persons) }));
  return { ...result, incidents, boxes: "yolo" };
}
