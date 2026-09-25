"use client";
// Browser side of the model integration: samples frames with a canvas and calls the app's API routes.
// The API key never reaches the browser; the routes hold it.
import { useEffect, useState } from "react";
import type { AssistantReply, Detection, Moment, VideoRecord } from "./types";
import { mergeDetections, planWindows, type Frame, type WindowResult } from "./vlm/analysis";
import type { ChatTurn, SummaryRow } from "./vlm/assistant";
import { isScorerModel, planScorerWindows } from "./vlm/scorer";

export interface ModelStatus {
  configured: boolean; model?: string; chatModel?: string; provider?: string; options?: string[];
  /** Local yes/no scorers (`local:<name>`), which analyse recorded video only. */
  scorers?: string[]; scorerWindow?: { windowSec: number; strideSec: number; fps: number; frames: number };
  /** Models served on the GB10 (local general models and scorers) and their provider label. */
  localModels?: string[]; localProvider?: string;
}

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
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(body as object), model: selectedModel() }), signal });
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

export function analyzeWindow(frames: Frame[], start: number, end: number, signal?: AbortSignal, context?: string) {
  return post<WindowResult & { model: string }>("/api/analyze", { frames, start, end, context }, signal);
}

export interface AnalysisProgress { done: number; total: number; failed: number }
export interface AnalysisOutput { detections: Detection[]; moments: Moment[]; model: string; failed: number }

/** Analyze a whole recording window by window (a few requests in flight at once). */
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
  // A local scorer needs its training protocol: 8 s windows every 4 s, 16 frames at 2 fps, native size.
  const scorer = isScorerModel(withSelection(await fetchModelStatus()).model);
  const windows = scorer ? planScorerWindows(duration) : planWindows(duration);
  const frameWidth = scorer ? 640 : 512;
  const results: WindowResult[] = [];
  let model = "", failed = 0, done = 0, lastError = "";
  const inFlight = new Set<Promise<void>>();
  onProgress({ done, total: windows.length, failed });
  for (const w of windows) {
    if (signal.aborted) break;
    const frames: Frame[] = [];
    for (const t of w.times) { await seek(el, t); frames.push({ seconds: t, image: grabFrame(el, frameWidth) }); }
    const job = analyzeWindow(frames, w.start, w.end, signal)
      .then(r => { results.push(r); model = r.model; })
      .catch(e => { if (!signal.aborted) { failed++; lastError = e instanceof Error ? e.message : String(e); } })
      .finally(() => { done++; inFlight.delete(job); onProgress({ done, total: windows.length, failed }); });
    inFlight.add(job);
    if (inFlight.size >= 3) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  el.removeAttribute("src");
  el.load();
  if (signal.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  if (!results.length || failed > windows.length / 2) throw new Error(lastError || "Most analysis requests failed.");
  results.sort((a, b) => a.start - b.start);
  return {
    detections: mergeDetections(video.id, results, model),
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
