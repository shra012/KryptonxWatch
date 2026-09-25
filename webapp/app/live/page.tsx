"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, Check, CircleStop, Film, PersonStanding, Radio, Save, ShieldAlert } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { EmptyState, EventTime, Notice, PageTitle, Panel, SeverityBadge } from "@/components/ui";
import { analyzeWindow, grabFrame, useModelStatus } from "@/lib/detection-client";
import { INCIDENT_THRESHOLD, mergeDetections, WINDOW, type Frame, type WindowResult } from "@/lib/vlm/analysis";
import { timecode, type ResponseRecord, type VideoRecord } from "@/lib/types";
import { isScorerModel } from "@/lib/vlm/scorer";
import { newId } from "@/lib/id";
import { videoSource } from "@/components/video-source";
import { PoseOverlay, type Pose } from "@/components/pose-overlay";
import { ResponseDialog, type ResponseIncident } from "@/components/response-dialog";
import { fetchAlertStatus, type AlertStatus } from "@/lib/alert-client";
import { responseFor, responsePriority } from "@/lib/response";

type Source = { kind: "camera" } | { kind: "video"; id: string };
interface FeedItem { id: string; at: number; result: WindowResult; alert: boolean }

// One frame every 2 s; a window of 4 frames (8 s) is sent as soon as it fills, like the recorded-video analysis.
const FRAME_MS = WINDOW.frameStep * 1000;

export default function LiveMonitor() {
  const { videos, notify, saveVideo, alerts } = useApp();
  const model = useModelStatus();
  const scorerPicked = isScorerModel(model?.model);
  const player = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<Source>({ kind: "camera" });
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [recording, setRecording] = useState<Blob | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const buffer = useRef<Frame[]>([]);
  const results = useRef<WindowResult[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  // Body joints: a separate, faster loop than the 8 s analysis windows, drawn over the feed.
  const [showPose, setShowPose] = useState(true);
  const [jointNames, setJointNames] = useState(true);
  const [pose, setPose] = useState<Pose | null>(null);
  const [poseMs, setPoseMs] = useState(0);
  const [poseError, setPoseError] = useState("");
  const [ratio, setRatio] = useState(16 / 9);
  // Response pop-ups: one at a time, queued; the same kind of incident is not asked again within a minute of feed time.
  const [prompts, setPrompts] = useState<(ResponseIncident & { feedId: string })[]>([]);
  const [responses, setResponses] = useState<Record<string, ResponseRecord>>({});
  const [alertStatus, setAlertStatus] = useState<AlertStatus | null>(null);
  const lastPrompt = useRef<Record<string, number>>({});
  useEffect(() => { fetchAlertStatus().then(setAlertStatus).catch(() => {}); }, []);

  const recordings = videos.filter(v => v.source === "upload" && v.blob);

  const clock = useCallback(() => source.kind === "video" ? (player.current?.currentTime ?? 0) : (Date.now() - startedAt.current) / 1000, [source.kind]);

  const sendWindow = useCallback((frames: Frame[]) => {
    const signal = abort.current?.signal;
    const start = Math.max(0, frames[0].seconds - WINDOW.frameStep / 2), end = frames[frames.length - 1].seconds + WINDOW.frameStep / 2;
    setPending(p => p + 1);
    analyzeWindow(frames, start, end, signal, source.kind === "camera" ? "Live webcam feed." : undefined)
      .then(result => {
        results.current.push(result);
        const alert = result.incidents.some(i => i.confidence >= INCIDENT_THRESHOLD);
        setFeed(f => [{ id: `${start}`, at: Date.now(), result, alert }, ...f].slice(0, 50));
        const top = result.incidents.filter(i => i.confidence >= INCIDENT_THRESHOLD && responseFor(i.category)).sort((a, b) => responsePriority(b) - responsePriority(a))[0];
        if (top && !(top.seconds - (lastPrompt.current[top.category] ?? -Infinity) < 60)) {
          lastPrompt.current[top.category] = top.seconds;
          const place = source.kind === "camera" ? "Webcam feed" : `Replay: ${videos.find(v => v.id === source.id)?.title ?? "recording"}`;
          setPrompts(q => [...q, { feedId: `${start}`, place, detection: { id: `live-${start}-${top.category}`, videoId: "live", seconds: top.seconds, category: top.category, severity: top.severity, description: top.description, confidence: top.confidence } }]);
        }
        if (alert && alerts) {
          const top = [...result.incidents].sort((a, b) => b.confidence - a.confidence)[0];
          notify(`Suspected ${top.category.toLowerCase()} at ${timecode(top.seconds)} — review now`);
        }
      })
      .catch(e => { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Analysis request failed."); })
      .finally(() => setPending(p => p - 1));
  }, [alerts, notify, source, videos]);

  const tick = useCallback(() => {
    const el = player.current;
    if (!el || el.readyState < 2 || el.paused) return;
    const seconds = Math.round(clock() * 100) / 100;
    setElapsed(seconds);
    buffer.current.push({ seconds, image: grabFrame(el) });
    if (buffer.current.length >= WINDOW.framesPerWindow) {
      const frames = buffer.current;
      buffer.current = [];
      sendWindow(frames);
    }
  }, [clock, sendWindow]);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
  }, []);

  useEffect(() => () => { abort.current?.abort(); cleanup(); }, [cleanup]);

  // Ask the edge node for body joints on the current frame, then again as soon as it answers (a few per second).
  useEffect(() => {
    if (!running || !showPose) { setPose(null); return; }
    let stopped = false;
    const ctrl = new AbortController();
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    (async () => {
      while (!stopped) {
        const el = player.current;
        if (el && el.readyState >= 2 && !el.paused) {
          const t0 = performance.now();
          try {
            const res = await fetch("/api/pose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: grabFrame(el, 480) }), signal: ctrl.signal });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setPose(null); setPoseError(data.error ?? "Body joints are unavailable."); await wait(3000); continue; }
            setPoseError(""); setPose({ names: data.names, persons: data.persons }); setPoseMs(Math.round(performance.now() - t0));
          } catch { if (stopped) break; }
        }
        await wait(100);
      }
    })();
    return () => { stopped = true; ctrl.abort(); };
  }, [running, showPose]);

  async function start() {
    setError(""); setFeed([]); setRecording(null); results.current = []; buffer.current = []; chunks.current = [];
    const el = player.current!;
    abort.current = new AbortController();
    try {
      if (source.kind === "camera") {
        // Browsers expose the camera only on HTTPS or localhost; opening the app by IP over HTTP hides it.
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("The camera is only available on https:// or http://localhost. Open the app at http://localhost:3000 (e.g. through a VS Code port forward) or pick a recording as the source.");
        const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
        stream.current = media;
        el.srcObject = media;
        if (typeof MediaRecorder !== "undefined") {
          const rec = new MediaRecorder(media, MediaRecorder.isTypeSupported("video/webm") ? { mimeType: "video/webm" } : undefined);
          rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
          rec.onstop = () => setRecording(new Blob(chunks.current, { type: rec.mimeType || "video/webm" }));
          rec.start(1000);
          recorder.current = rec;
        }
      } else {
        const video = videos.find(v => v.id === source.id);
        const src = video && (videoSource(video) ?? (video.blob ? (objectUrl.current = URL.createObjectURL(video.blob)) : undefined));
        if (!src) throw new Error("That recording has no playable file.");
        el.srcObject = null;
        el.src = src;
        el.currentTime = 0;
        el.onended = () => stop();
      }
      await el.play();
      startedAt.current = Date.now();
      timer.current = setInterval(tick, FRAME_MS);
      setRunning(true);
    } catch (e) {
      cleanup();
      setError(e instanceof DOMException && e.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access for this site in your browser settings, then press Start again."
        : e instanceof Error ? e.message : "Could not start the feed.");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (buffer.current.length) { sendWindow(buffer.current); buffer.current = []; }
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    player.current?.pause();
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    setRunning(false);
  }

  async function saveCapture() {
    if (!recording) return;
    const id = newId();
    const windows = [...results.current].sort((a, b) => a.start - b.start);
    const record: VideoRecord = {
      id, title: `Live capture · ${new Date().toLocaleString()}`, recordedAt: new Date().toISOString(), duration: elapsed,
      source: "upload", analysis: windows.length ? "complete" : "not_analyzed", analysisModel: model?.model, blob: recording, size: recording.size,
      detections: mergeDetections(id, windows, model?.model ?? ""), moments: windows.map(w => ({ start: w.start, end: w.end, summary: w.summary })),
    };
    try { await saveVideo(record); notify("Capture saved to the video library"); setRecording(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the capture."); }
  }

  const alertsCount = feed.filter(f => f.alert).length;
  const latest = feed[0];

  return <>
    <PageTitle eyebrow="Real-time analysis" title="Live monitor" description="Watch a webcam or replay a recording as a camera feed. Frames are analysed every 8 seconds and suspected incidents appear in the feed for review."
      action={model?.configured ? <span className="font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/45">{model.provider} · {model.model}</span> : undefined} />
    {model && !model.configured && <div className="mb-6"><Notice tone="warning" role="alert">No analysis model is configured. Set VLM_BASE_URL and VLM_MODEL in webapp/.env.local and restart the dev server.</Notice></div>}
    {scorerPicked && <div className="mb-6"><Notice tone="warning" role="alert">The local shoplifting scorer works on recorded videos only. Pick another model in Preferences to use Live, or upload a recording and run AI analysis.</Notice></div>}
    <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)] gap-6">
      <div className="space-y-6">
        <Panel>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <label className="fieldset flex-1 min-w-52"><span className="fieldset-legend">Feed source</span>
              <select className="select w-full" disabled={running} value={source.kind === "camera" ? "camera" : source.id} onChange={e => setSource(e.target.value === "camera" ? { kind: "camera" } : { kind: "video", id: e.target.value })} aria-label="Feed source">
                <option value="camera">Webcam</option>
                {recordings.map(v => <option key={v.id} value={v.id}>Replay: {v.title}</option>)}
              </select>
            </label>
            {running
              ? <button className="btn btn-error" onClick={stop}><CircleStop size={17} />Stop</button>
              : <button className="btn btn-primary" onClick={start} disabled={!model?.configured || scorerPicked}>{source.kind === "camera" ? <Camera size={17} /> : <Film size={17} />}Start monitoring</button>}
          </div>
          <div className={`video-frame ${latest?.alert && running ? "ring-4 ring-error" : ""}`}>
            <div className="video-canvas" style={{ "--video-ratio": ratio } as React.CSSProperties}>
              <video ref={player} muted playsInline aria-label="Live feed" onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }} />
              {running && showPose && pose && <PoseOverlay pose={pose} labels={jointNames} />}
              {running && <span className="absolute top-3 left-3 flex items-center gap-1.5 bg-error text-error-content font-mono text-[.6rem] uppercase tracking-[.06em] px-2 py-1 rounded-md"><Radio size={11} />live · {timecode(elapsed)}</span>}
              {running && pending > 0 && <span className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/70 text-white font-mono text-[.6rem] uppercase tracking-[.06em] px-2 py-1 rounded-md"><span className="loading loading-spinner loading-xs" />analysing</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={showPose} onChange={e => setShowPose(e.target.checked)} /><PersonStanding size={15} />Body joints</label>
            <label className={`flex items-center gap-2 ${showPose ? "" : "opacity-50"}`}><input type="checkbox" className="checkbox checkbox-sm" checked={jointNames} disabled={!showPose} onChange={e => setJointNames(e.target.checked)} />Joint names</label>
            {running && showPose && !poseError && pose && <span className="font-mono text-xs text-base-content/50">{pose.persons.length} {pose.persons.length === 1 ? "person" : "people"} · {poseMs} ms · YOLO11 pose on the edge node</span>}
          </div>
          {running && showPose && poseError && <div className="mt-3"><Notice tone="warning">{poseError}</Notice></div>}
          {latest && <p className="text-sm mt-4"><span className="font-semibold">Latest scene:</span> <span className="text-base-content/70">{latest.result.summary}</span></p>}
          {error && <div className="mt-4"><Notice tone="error" role="alert">{error}</Notice></div>}
          {recording && !running && <div className="mt-4 border-l-2 border-primary pl-3.5 py-1 flex flex-wrap items-center gap-3 text-sm"><span>Webcam capture ready ({(recording.size / 1024 / 1024).toFixed(1)} MB, {results.current.length} analysed windows).</span><button className="btn btn-sm btn-primary" onClick={saveCapture}><Save size={15} />Save to library</button></div>}
        </Panel>
        <p className="text-xs text-base-content/55">Only sampled frames are sent to the analysis server. Detections are suspected until a person reviews them; no one is contacted automatically.</p>
      </div>
      <Panel title="Incident feed" action={<span className={`font-mono text-[.62rem] uppercase tracking-[.06em] ${alertsCount ? "text-error" : "text-base-content/45"}`}>{alertsCount} suspected</span>}>
        {!feed.length ? <EmptyState title={running ? "Waiting for the first window" : "Feed is idle"} description={running ? "The first analysis arrives about 8 seconds after start." : "Start monitoring to see each analysed window here."} action={!recordings.length && !running ? <Link href="/upload" className="btn btn-sm btn-outline">Upload a recording to replay</Link> : undefined} />
          : <ol className="max-h-[40rem] overflow-y-auto scroll-quiet border-t border-base-300" aria-live="polite">{feed.map(f => <li key={f.id} className={`border-b border-l-2 border-base-300 pl-3.5 pr-2 py-3 text-sm ${f.alert ? "border-l-error bg-error/5" : "border-l-transparent"}`}>
            <div className="flex justify-between gap-2 items-center"><span className="font-mono text-primary"><EventTime seconds={f.result.start} />–<EventTime seconds={f.result.end} /></span>{f.alert ? <ShieldAlert size={16} className="text-error" aria-label="Suspected incident" /> : <span className="text-xs text-base-content/50">clear</span>}</div>
            {f.result.incidents.filter(i => i.confidence >= INCIDENT_THRESHOLD).map((i, k) => <div key={k} className="mt-2"><div className="flex gap-2 items-center"><span className="font-semibold">Suspected {i.category.toLowerCase()}</span><SeverityBadge severity={i.severity} /><span className="text-xs text-base-content/50">{Math.round(i.confidence * 100)}%</span></div><p className="text-base-content/70">{i.description}</p></div>)}
            {!f.alert && <p className="text-base-content/60 mt-1">{f.result.summary}</p>}
            {responses[f.id] && <p className="flex items-center gap-1.5 text-xs text-base-content/60 mt-2"><Check size={12} />{responses[f.id].kind === "911" ? "911 called" : "Owner notified"} · <span className="font-mono">{responses[f.id].reference}</span></p>}
          </li>)}</ol>}
      </Panel>
    </div>
    {prompts[0] && <ResponseDialog key={prompts[0].detection.id} incident={prompts[0]} alertStatus={alertStatus} more={prompts.length - 1}
      onDone={r => setResponses(m => ({ ...m, [prompts[0].feedId]: r }))} onClose={() => setPrompts(q => q.slice(1))} />}
  </>;
}
