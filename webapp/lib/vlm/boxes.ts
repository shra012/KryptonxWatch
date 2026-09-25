// Person-grounded boxes: snap a VLM incident box to a YOLO person, follow that person across the
// window's frames, and interpolate between keyframes during playback. Pure functions with no runtime
// imports, shared by app/api/analyze, the video page and scripts/vlm-benchmark.ts.
// Plan: .plans/yolo-boxes-in-app.md; snapping rule from model/YOLO/src/yolo_snap.py.
import type { BoundingBox, Detection, Keyframe } from "../types";

export type Rect = Pick<BoundingBox, "x" | "y" | "width" | "height">;

/** Max centre distance (fraction of the frame) a followed person may move between frames (2 s apart by default). */
const MAX_STEP = 0.5;
/** A followed person keeps roughly the same height between frames; this rejects e.g. a small figure behind a counter. */
const MAX_HEIGHT_RATIO = 1.6;
/** Keyframe boxes further apart than this, without a shared track, are treated as different people. */
const SWITCH_DISTANCE = 0.3;

export function iou(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function distance(a: Rect, b: Rect): number {
  return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
}

/** The person that best matches `box`: highest IoU, else the nearest centre (within `maxDistance` if given). */
export function matchPerson(box: Rect, people: Rect[], maxDistance = Infinity): Rect | undefined {
  if (!people.length) return undefined;
  const best = people.reduce((a, b) => (iou(box, b) > iou(box, a) ? b : a));
  if (iou(box, best) > 0) return best;
  const nearest = people.reduce((a, b) => (distance(box, b) < distance(box, a) ? b : a));
  return distance(box, nearest) <= maxDistance ? nearest : undefined;
}

/** The same person on the next frame: best overlap, else nearest centre, among people of similar height. */
function followPerson(previous: Rect, people: Rect[]): Rect | undefined {
  const similar = people.filter(p => Math.max(p.height / previous.height, previous.height / p.height) <= MAX_HEIGHT_RATIO);
  return matchPerson(previous, similar, MAX_STEP);
}

const labelled = (r: Rect, label: string): BoundingBox => ({ x: r.x, y: r.y, width: r.width, height: r.height, label });

/**
 * Ground one incident on YOLO persons. `persons[i]` are the people found on frame `frames[i]`.
 * The VLM box on the key frame picks the person; that person is then followed frame by frame in both
 * directions until lost. Returns the snapped key box and one keyframe per frame where the person was found.
 * Without a VLM box or any person on the key frame, the VLM box is kept as the only keyframe.
 */
export function trackIncident(box: BoundingBox | undefined, keySeconds: number, frames: { seconds: number }[], persons: Rect[][]): { box?: BoundingBox; keyframes: Keyframe[] } {
  const key = frames.findIndex(f => Math.abs(f.seconds - keySeconds) < 0.01);
  const seed = box && key >= 0 ? matchPerson(box, persons[key] ?? []) : undefined;
  if (!box || !seed) return { box, keyframes: box ? [{ seconds: keySeconds, box }] : [] };
  const label = box.label;
  const trackId = `${label}@${keySeconds}`;
  const keyframes: Keyframe[] = [{ seconds: frames[key].seconds, box: labelled(seed, label), trackId }];
  for (const step of [1, -1]) {
    let previous = seed;
    for (let i = key + step; i >= 0 && i < frames.length; i += step) {
      const next = followPerson(previous, persons[i] ?? []);
      if (!next) break;
      keyframes.push({ seconds: frames[i].seconds, box: labelled(next, label), trackId });
      previous = next;
    }
  }
  keyframes.sort((a, b) => a.seconds - b.seconds);
  return { box: labelled(seed, label), keyframes };
}

/** How long a box stays on screen before the first and after the last keyframe, in seconds. */
export const KEYFRAME_HOLD = 1;
/** Keyframes further apart than this are not interpolated (the person may have left in between). */
const MAX_GAP = 4.5;

/**
 * The box to draw for a detection at playback time `t`, or undefined when none should show.
 * With keyframes: linear interpolation between the surrounding keyframes. Without (samples, older
 * analyses): the detection's single box over its time range, as before.
 */
export function boxAt(d: Pick<Detection, "seconds" | "endSeconds" | "box" | "keyframes">, t: number): BoundingBox | undefined {
  const kfs = d.keyframes;
  if (!kfs?.length) return d.box && t >= d.seconds - 1.5 && t <= (d.endSeconds ?? d.seconds) + 1.5 ? d.box : undefined;
  if (t < kfs[0].seconds - KEYFRAME_HOLD || t > kfs[kfs.length - 1].seconds + KEYFRAME_HOLD) return undefined;
  const after = kfs.findIndex(k => k.seconds >= t);
  if (after <= 0) return (after === 0 ? kfs[0] : kfs[kfs.length - 1]).box;
  const a = kfs[after - 1], b = kfs[after];
  const gap = b.seconds - a.seconds;
  if (gap > MAX_GAP) return t - a.seconds <= KEYFRAME_HOLD ? a.box : b.seconds - t <= KEYFRAME_HOLD ? b.box : undefined;
  const f = gap > 0 ? (t - a.seconds) / gap : 0;
  // Different people (no shared track and far apart): switch at the midpoint instead of sliding across the frame.
  if (!(a.trackId && a.trackId === b.trackId) && distance(a.box, b.box) > SWITCH_DISTANCE) return f < 0.5 ? a.box : b.box;
  const mix = (p: number, q: number) => p + (q - p) * f;
  return { x: mix(a.box.x, b.box.x), y: mix(a.box.y, b.box.y), width: mix(a.box.width, b.box.width), height: mix(a.box.height, b.box.height), label: a.box.label };
}
