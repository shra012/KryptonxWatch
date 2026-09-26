"use client";
// Visual fingerprints, so the monitor walls never show the same footage twice: a trimmed or re-encoded copy
// (such as a short excerpt from a longer UCF recording) has a different size and length but the same frames.
// A fingerprint is one 64-bit difference hash (dHash) of a 9x8 greyscale frame every few seconds.
// Kept per browser in localStorage, apart from the recordings, so computing them never races an analysis save.
import { useEffect, useState } from "react";
import type { VideoRecord } from "./types";

export type Fingerprints = Record<string, string[]>;

const KEY = "sm-fingerprints";
const MAX_SAMPLES = 30;
/** Hashes this close (differing bits of 64) are the same view; different scenes differ by ~25-35 bits. */
const SAME_FRAME_BITS = 6;
/** Near-uniform frames (black, fades) look alike in any video, so they are not fingerprinted. */
const MIN_CONTRAST = 8;

function popcount(n: number) { n -= (n >>> 1) & 0x55555555; n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function hamming(a: string, b: string) { return popcount(parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) + popcount(parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)); }

/** Two recordings show the same footage when several of their sampled frames are near-identical. */
export function sameFootage(a?: string[], b?: string[]): boolean {
  if (!a?.length || !b?.length) return false;
  const matches = a.filter(h => b.some(g => hamming(h, g) <= SAME_FRAME_BITS)).length;
  return matches >= Math.max(2, Math.min(3, Math.ceil(Math.min(a.length, b.length) * 0.3)));
}

async function fingerprint(blob: Blob): Promise<string[]> {
  const url = URL.createObjectURL(blob);
  const el = document.createElement("video");
  el.muted = true; el.preload = "auto"; el.src = url;
  try {
    await new Promise<void>((resolve, reject) => { el.onloadeddata = () => resolve(); el.onerror = () => reject(new Error("unreadable")); });
    const canvas = document.createElement("canvas"); canvas.width = 9; canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const step = Math.max(3, el.duration / MAX_SAMPLES);
    const out: string[] = [];
    for (let t = step / 2; t < el.duration; t += step) {
      await new Promise<void>(resolve => { el.onseeked = () => resolve(); el.currentTime = t; });
      ctx.drawImage(el, 0, 0, 9, 8);
      const px = ctx.getImageData(0, 0, 9, 8).data;
      const grey = Array.from({ length: 72 }, (_, i) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
      const mean = grey.reduce((a, b) => a + b, 0) / 72;
      if (Math.sqrt(grey.reduce((a, b) => a + (b - mean) ** 2, 0) / 72) < MIN_CONTRAST) continue;
      let hi = 0, lo = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const bit = grey[y * 9 + x] > grey[y * 9 + x + 1] ? 1 : 0, i = y * 8 + x;
        if (i < 32) hi = (hi | (bit << i)) >>> 0; else lo = (lo | (bit << (i - 32))) >>> 0;
      }
      out.push(hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0"));
    }
    return out;
  } finally { el.removeAttribute("src"); el.load(); URL.revokeObjectURL(url); }
}

function load(): Fingerprints { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }

/** Fingerprints for these recordings, computing missing ones one at a time in the background. */
export function useFingerprints(videos: VideoRecord[]): Fingerprints {
  const [prints, setPrints] = useState<Fingerprints>({});
  const todo = videos.filter(v => v.blob).map(v => v.id).join(",");
  useEffect(() => {
    let cancelled = false;
    const known = load(); setPrints(known);
    (async () => {
      for (const v of videos) {
        if (cancelled) return;
        if (!v.blob || known[v.id]) continue;
        try { known[v.id] = await fingerprint(v.blob); } catch { known[v.id] = []; }
        if (cancelled) return;
        try { localStorage.setItem(KEY, JSON.stringify(known)); } catch { /* per-browser convenience only */ }
        setPrints({ ...known });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rerun only when the set of recordings changes
  }, [todo]);
  return prints;
}
