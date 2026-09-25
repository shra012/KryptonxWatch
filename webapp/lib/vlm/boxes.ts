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
function followPerson(previous: Rect, people: Rect[], maxStep = MAX_STEP): Rect | undefined {
  const similar = people.filter(p => Math.max(p.height / previous.height, previous.height / p.height) <= MAX_HEIGHT_RATIO);
  return matchPerson(previous, similar, maxStep);
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
  // Hold a box for half the keyframe spacing: 1 s for the analysis's 2 s frames, 0.25 s for a whole-video track
  // (0.5 s samples), so a box does not linger where the person has already left or not yet arrived.
  const gaps = kfs.slice(1).map((k, i) => k.seconds - kfs[i].seconds).sort((a, b) => a - b);
  const hold = gaps.length ? Math.min(KEYFRAME_HOLD, Math.max(0.25, gaps[Math.floor(gaps.length / 2)] / 2)) : KEYFRAME_HOLD;
  if (t < kfs[0].seconds - hold || t > kfs[kfs.length - 1].seconds + hold) return undefined;
  const after = kfs.findIndex(k => k.seconds >= t);
  if (after <= 0) return (after === 0 ? kfs[0] : kfs[kfs.length - 1]).box;
  const a = kfs[after - 1], b = kfs[after];
  const gap = b.seconds - a.seconds;
  // A long gap, or two far-apart boxes that are not one track (the person left and came back elsewhere):
  // hold each box briefly, and show nothing in between rather than sliding a box across the frame.
  const split = !(a.trackId && a.trackId === b.trackId) && distance(a.box, b.box) > SWITCH_DISTANCE;
  if (gap > MAX_GAP || (split && gap > 2 * hold)) return t - a.seconds <= hold ? a.box : b.seconds - t <= hold ? b.box : undefined;
  const f = gap > 0 ? (t - a.seconds) / gap : 0;
  if (split) return f < 0.5 ? a.box : b.box;
  const mix = (p: number, q: number) => p + (q - p) * f;
  return { x: mix(a.box.x, b.box.x), y: mix(a.box.y, b.box.y), width: mix(a.box.width, b.box.width), height: mix(a.box.height, b.box.height), label: a.box.label };
}

/** People found on one frame of the whole-video pass (every ~0.5 s). */
export interface PersonSample { seconds: number; persons: Rect[] }
/** Between dense samples (~0.5 s) the same person overlaps their last box strongly, or barely moves and keeps their size. */
const DENSE_MIN_IOU = 0.3;
const DENSE_MAX_MOVE = 0.08;
const DENSE_MAX_SIZE_RATIO = 1.4;
/** A followed person counts as gone once unseen this long (they left the frame or are hidden). */
const LOST_AFTER = 2;
/** How close (seconds) a sample must be to an analysis keyframe to re-anchor on it. */
const ANCHOR_WINDOW = 0.6;

/** The same person on the next dense sample, strictly: anyone else walking past or overlapping is rejected. */
function followDense(previous: Rect, people: Rect[]): Rect | undefined {
  const ratio = (a: number, b: number) => Math.max(a / b, b / a);
  const similar = people.filter(p => ratio(p.height, previous.height) <= DENSE_MAX_SIZE_RATIO && ratio(p.width, previous.width) <= DENSE_MAX_SIZE_RATIO * 1.3);
  if (!similar.length) return undefined;
  const best = similar.reduce((a, b) => (iou(previous, b) > iou(previous, a) ? b : a));
  if (iou(previous, best) >= DENSE_MIN_IOU) return best;
  const nearest = similar.reduce((a, b) => (distance(previous, b) < distance(previous, a) ? b : a));
  return distance(previous, nearest) <= DENSE_MAX_MOVE ? nearest : undefined;
}

/**
 * Follow a detection's suspect through the whole video: from the analysed keyframes, forwards to the end and
 * backwards to the start, one keyframe per sample while they stay in view. Keyframes from the analysis
 * re-anchor the track, so a mix-up between two people is corrected at the next analysed frame.
 * Returns undefined when there is nothing to follow (no box, or no samples).
 */
export function trackThroughVideo(d: Pick<Detection, "seconds" | "box" | "keyframes" | "category">, samples: PersonSample[]): Keyframe[] | undefined {
  const anchors = (d.keyframes?.length ? d.keyframes : d.box ? [{ seconds: d.seconds, box: d.box }] : []).slice().sort((a, b) => a.seconds - b.seconds);
  if (!anchors.length || !samples.length) return undefined;
  const label = anchors[0].box.label;
  const trackId = `${d.category}@${anchors[0].seconds}`;
  const nearest = (t: number) => samples.reduce((best, s, i) => (Math.abs(s.seconds - t) < Math.abs(samples[best].seconds - t) ? i : best), 0);
  const anchorAt = (t: number) => anchors.find(a => Math.abs(a.seconds - t) <= ANCHOR_WINDOW);
  const found = new Map<number, Rect>();
  const start = nearest(anchors[0].seconds);
  const lastAnchor = anchors[anchors.length - 1].seconds;

  for (const dir of [1, -1]) {
    let current: Rect | undefined = matchPerson(anchors[0].box, samples[start].persons, 0.15);
    let lastSeen = samples[start].seconds;
    if (current && dir === 1) found.set(start, current);
    for (let i = start + dir; i >= 0 && i < samples.length; i += dir) {
      const t = samples[i].seconds;
      const anchor = anchorAt(t);
      // While briefly hidden (someone walks in front), `current` keeps their last box, so they are picked up there again.
      const next = (anchor && matchPerson(anchor.box, samples[i].persons, 0.15)) || (current && followDense(current, samples[i].persons));
      if (next) { found.set(i, next); current = next; lastSeen = t; continue; }
      // Lost: stop, unless the analysis saw them again later (then pick them up at that keyframe).
      if (Math.abs(t - lastSeen) > LOST_AFTER) { if (dir === -1 || t >= lastAnchor) break; current = undefined; }
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([i, r]) => ({ seconds: samples[i].seconds, box: labelled(r, label), trackId }));
}

/** Boxes that cover the same person (IoU above 0.6) drawn once, with their labels joined, e.g. "Robbery · Gun". */
export function mergeOverlapping<T extends { box: BoundingBox }>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const same = out.find(o => iou(o.box, item.box) > 0.6);
    if (!same) { out.push(item); continue; }
    if (!same.box.label.split(" · ").includes(item.box.label)) same.box = { ...same.box, label: `${same.box.label} · ${item.box.label}` };
  }
  return out;
}
