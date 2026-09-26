"use client";
// Browser side of the model integration: samples frames with a canvas and calls the app's API routes.
// The API key never reaches the browser; the routes hold it.
import { useEffect, useState } from "react";
import { isSecurityDetection, type AssistantReply, type Detection, type Moment, type VideoRecord } from "./types";
import { trackThroughVideo, type PersonSample } from "./vlm/boxes";
import { curatedFor, type CuratedAnalysis } from "./demo/curated";
import { gpuSampler, isLocalModel, logUsage, usageTally, type WindowUsage } from "./usage";
import { mergeDetections, planWindows, type Frame, type WindowResult } from "./vlm/analysis";
import type { ChatTurn, SummaryRow } from "./vlm/assistant";
import { isScorerModel, planScorerWindows } from "./vlm/scorer";
import { feedSource } from "@/lib/watch-client";
import type { FeedSource } from "@/lib/watch-types";

export interface ModelStatus {
  configured: boolean; model?: string; chatModel?: string; provider?: string; options?: string[];
  /** Local yes/no scorers (`local:<name>`), which analyse recorded video only. */
  scorers?: string[]; scorerWindow?: { windowSec: number; strideSec: number; fps: number; frames: number };
  /** Models served on the GB10 (local general models and scorers) and their provider label. */
  localModels?: string[]; localProvider?: string;
  /** Real model -> display name (VLM_MODEL_ALIASES). */
  aliases?: Record<string, string>;
}

/** A saved model name as the UI shows it (its alias, if the server gives one). */
export const displayModel = (name: string | undefined, status: ModelStatus | null) => name && (status?.aliases?.[name] ?? name);

let statusPromise: Promise<ModelStatus> | null = null;
export function fetchModelStatus(): Promise<ModelStatus> {
  statusPromise ??= fetch("/api/model").then(r => r.json()).catch(() => ({ configured: false }));
  return statusPromise;
}

// The model picked in Preferences (per browser). The server only honours models in its allow-list.
const modelKey = "kryptonxwatch-model";
const modelEvent = "kryptonxwatch-model-change";
function storedModel(): string | undefined {
  try { return localStorage.getItem(modelKey) ?? undefined; } catch { return undefined; }
}
export function setSelectedModel(model: string) {
  try { localStorage.setItem(modelKey, model); } catch { /* per-browser convenience only */ }
  window.dispatchEvent(new Event(modelEvent));
}
function withSelection(status: ModelStatus): ModelStatus {
  const picked = storedModel();
  if (!status.configured || !picked || !status.options?.includes(picked)) return status;
  const provider = status.localModels?.includes(picked) ? status.localProvider ?? status.provider : status.provider;
  // Scorers only analyse video; the assistant and summary stay on the server's chat model.
  return isScorerModel(picked) ? { ...status, model: picked, provider } : { ...status, model: picked, chatModel: picked, provider };
}
/** The model requests from this browser should use, if it picked one the server allows. */
function selectedModel(): string | undefined { return storedModel(); }

export function useModelStatus() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  useEffect(() => {
    const load = () => fetchModelStatus().then(s => setStatus(withSelection(s)));
    load();
    window.addEventListener(modelEvent, load);
    return () => window.removeEventListener(modelEvent, load);
  }, []);
  return status;
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  // A request can name its model (the Analytics comparison runs two at once); otherwise the browser's pick.
  const payload = { ...(body as Record<string, unknown>) };
  payload.model ??= selectedModel();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Draw the element's current frame to a JPEG data URL, at most `maxWidth` wide. */
export function grabFrame(video: HTMLVideoElement, maxWidth = 512): string {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
  canvas.height = Math.max(1, Math.round((video.videoHeight || maxWidth * 0.75) * scale));
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function seek(video: HTMLVideoElement, seconds: number) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("The browser could not decode this video to sample frames.")); };
    const cleanup = () => { video.removeEventListener("seeked", done); video.removeEventListener("error", fail); };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = seconds;
  });
}

/** `model` overrides the browser's pick; `source` names the feed, so the server can add the window to the watch agent's feed log. */
export function analyzeWindow(frames: Frame[], start: number, end: number, signal?: AbortSignal, context?: string, model?: string, source?: FeedSource) {
  return post<WindowResult & { model: string; latencyMs?: number; usage?: WindowUsage }>("/api/analyze", { frames, start, end, context, model, source }, signal);
}

export interface AnalysisProgress { done: number; total: number; failed: number; phase?: "windows" | "tracking" }
export interface AnalysisOutput { detections: Detection[]; moments: Moment[]; model: string; failed: number; curated?: boolean }

/** Analyze a whole recording window by window (a few requests in flight at once). */
/** A demo clip's verified analysis, paced like a live run (about a second per window, then the tracking pass). */
async function replayCurated(video: VideoRecord, duration: number, curated: CuratedAnalysis, onProgress: (p: AnalysisProgress) => void, signal: AbortSignal): Promise<AnalysisOutput> {
  const wait = (ms: number) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Analysis cancelled", "AbortError")); }, { once: true }); });
  const windows = planWindows(duration);
  for (let i = 0; i < windows.length; i++) { onProgress({ done: i, total: windows.length, failed: 0 }); await wait(1100); }
  const samples = Math.ceil(duration / 0.5);
  for (let i = 0; i < samples; i += 16) { onProgress({ done: i, total: samples, failed: 0, phase: "tracking" }); await wait(350); }
  return {
    detections: curated.detections.map((d, i) => ({ ...d, id: `${video.id}-demo-${i}`, videoId: video.id, status: "new" as const })),
    moments: curated.moments, model: curated.model, failed: 0, curated: true,
  };
}

/** People every ~0.5 s across the video (at most 400 samples), then each detection's suspect followed through them. */
async function trackAcrossVideo(el: HTMLVideoElement, duration: number, detections: Detection[], onProgress: (p: AnalysisProgress) => void, signal: AbortSignal): Promise<Detection[]> {
  const step = Math.max(0.5, duration / 400);
  const times: number[] = [];
  for (let t = step / 2; t < duration; t += step) times.push(Math.round(t * 100) / 100);
  const samples: PersonSample[] = [];
  for (let i = 0; i < times.length; i += 16) {
    if (signal.aborted) return detections;
    onProgress({ done: i, total: times.length, failed: 0, phase: "tracking" });
    const frames: Frame[] = [];
    for (const t of times.slice(i, i + 16)) { await seek(el, t); frames.push({ seconds: t, image: grabFrame(el, 512) }); }
    try {
      const res = await fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frames }), signal });
      if (!res.ok) return detections; // YOLO off or down: keep the analysed boxes
      const { persons } = await res.json() as { persons: PersonSample["persons"][] };
      frames.forEach((f, k) => samples.push({ seconds: f.seconds, persons: persons[k] ?? [] }));
    } catch { return detections; }
  }
  onProgress({ done: times.length, total: times.length, failed: 0, phase: "tracking" });
  return detections.map(d => {
    if (!d.box || !isSecurityDetection(d)) return d;
    const keyframes = trackThroughVideo(d, samples);
    return keyframes?.length ? { ...d, keyframes } : d;
  });
}

export async function analyzeRecording(video: VideoRecord, src: string, onProgress: (p: AnalysisProgress) => void, signal: AbortSignal): Promise<AnalysisOutput> {
  const el = document.createElement("video");
  el.muted = true;
  el.preload = "auto";
  el.playsInline = true;
  el.src = src;
  await new Promise<void>((resolve, reject) => {
    el.onloadeddata = () => resolve();
    el.onerror = () => reject(new Error("The browser could not load this video for analysis."));
  });
  const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : video.duration;
  const curated = curatedFor(video, duration);
  if (curated) { el.removeAttribute("src"); el.load(); return replayCurated(video, duration, curated, onProgress, signal); }
  // A local scorer needs its training protocol: 8 s windows every 4 s, 16 frames at 2 fps, native size.
  const scorer = isScorerModel(withSelection(await fetchModelStatus()).model);
  const windows = scorer ? planScorerWindows(duration) : planWindows(duration);
  const frameWidth = scorer ? 640 : 512;
  const results: WindowResult[] = [];
  let model = "", failed = 0, done = 0, lastError = "";
  // Usage for the Analytics page; GB10 GPU readings only while a local (zrt) model runs.
  const tally = usageTally(); const started = Date.now();
  const picked = withSelection(await fetchModelStatus()).model ?? "";
  const gpu = isLocalModel(picked) ? gpuSampler() : null;
  const inFlight = new Set<Promise<void>>();
  onProgress({ done, total: windows.length, failed });
  for (const w of windows) {
    if (signal.aborted) break;
    const frames: Frame[] = [];
    for (const t of w.times) { await seek(el, t); frames.push({ seconds: t, image: grabFrame(el, frameWidth) }); }
    const job = analyzeWindow(frames, w.start, w.end, signal, undefined, undefined, feedSource(video))
      .then(r => { results.push(r); model = r.model; tally.add(r.usage, r.latencyMs); })
      .catch(e => { if (!signal.aborted) { failed++; lastError = e instanceof Error ? e.message : String(e); } })
      .finally(() => { done++; inFlight.delete(job); onProgress({ done, total: windows.length, failed }); });
    inFlight.add(job);
    if (inFlight.size >= 3) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  results.sort((a, b) => a.start - b.start);
  const gpuSummary = gpu?.stop() ?? null;
  if (results.length) logUsage({ id: `${video.id}@${started}`, at: new Date().toISOString(), model: model || picked, local: isLocalModel(model || picked), source: "recording", title: video.title,
    ...tally.get(), failed, wallMs: Date.now() - started, gpu: gpuSummary });
  let detections = mergeDetections(video.id, results, model);
  // Follow each suspect through the whole video, not only the analysed frames (needs the YOLO service; skipped without it).
  if (!signal.aborted && !scorer && detections.some(d => d.box)) detections = await trackAcrossVideo(el, duration, detections, onProgress, signal);
  el.removeAttribute("src");
  el.load();
  if (signal.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  if (!results.length || failed > windows.length / 2) throw new Error(lastError || "Most analysis requests failed.");
  return {
    detections,
    moments: results.map(r => ({ start: r.start, end: r.end, summary: r.summary })),
    model,
    failed,
  };
}

export function askAssistant(video: VideoRecord, messages: ChatTurn[], signal?: AbortSignal) {
  return post<AssistantReply & { model: string }>("/api/chat", {
    video: {
      title: video.title, duration: video.duration, analysis: video.analysis,
      detections: video.detections.filter(d => d.status !== "dismissed").map(({ seconds, endSeconds, category, severity, status, description, confidence }) => ({ seconds, endSeconds, category, severity, status, description, confidence })),
      moments: video.moments,
    },
    messages,
  }, signal);
}

export function requestSummary(rows: SummaryRow[], totals: Record<string, number>, signal?: AbortSignal) {
  return post<{ summary: string; model: string }>("/api/summary", { rows, totals }, signal);
}
