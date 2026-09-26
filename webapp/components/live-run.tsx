"use client";
// Analytics: one clip played in place, analysed by a local GB10 model and a cloud (OpenRouter) model at once. While it
// plays, every 8 s of video (4 frames, 2 s apart) goes to both, the way Live monitor does it, and a head-to-head table
// shows what each costs as it happens: latency against real time, tokens, dollars, findings. This machine's CPU /
// memory / GPU sit beside it. Each lane writes its usage and findings after every window, so the rest of the
// Analytics page moves while the clip plays.
import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, Cpu, Gauge as GaugeIcon, Play } from "lucide-react";
import { useApp } from "./app-provider";
import { useTelemetry } from "./use-telemetry";
import { EventTime, Meter, Notice, SeverityBadge, Sparkline } from "./ui";
import { analyzeWindow, displayModel, grabFrame, useModelStatus } from "@/lib/detection-client";
import { INCIDENT_THRESHOLD, mergeDetections, WINDOW, type Frame, type Incident, type WindowResult } from "@/lib/vlm/analysis";
import { gpuSampler, isLocalModel, upsertUsage, usageTally } from "@/lib/usage";
import { benchmarkFor } from "@/lib/benchmarks";
import { pct, gb } from "@/lib/telemetry-types";
import { boxAt } from "@/lib/vlm/boxes";
import { categories, type BoundingBox, type Category, type Detection, type VideoRecord } from "@/lib/types";

type Clip = { url: string; title: string; simulated: boolean };
type Phase = "idle" | "running" | "paused" | "finishing" | "done";
type Side = "local" | "cloud";
const SIDES: Side[] = ["local", "cloud"];
interface WindowStat { latencyMs: number; promptTokens: number; completionTokens: number; cost: number }
interface Lane { stats: WindowStat[]; findings: Incident[]; named: string[]; inFlight: number; failed: number; error: string; model: string }
/** What a lane keeps between events, in a ref so a late reply never reads stale state. */
interface LaneRun { id: string; started: number; model: string; record: VideoRecord; results: WindowResult[]; tally: ReturnType<typeof usageTally>; gpu: ReturnType<typeof gpuSampler> | null; pending: number }

const WINDOW_SEC = WINDOW.frameStep * WINDOW.framesPerWindow;
const OFF = "";
/** The local Qwen service; the comparison lane uses a configured hosted model. */
const LOCAL_MODEL = "local-vlm:qwen3-vl-30b-a3b";
/** A box on the player: the lane's newest finding while the clip plays (the analysis runs a few seconds behind). */
interface LiveBox { box: BoundingBox; label: string; until: number }
/** The last position a window saw the person at: its latest keyframe, else the incident's own box. */
const latestBox = (i: Incident) => [...(i.keyframes ?? [])].sort((a, b) => b.seconds - a.seconds)[0]?.box ?? i.box;
const emptyLane = (): Lane => ({ stats: [], findings: [], named: [], inFlight: 0, failed: 0, error: "", model: "" });
/** A UCF-Crime demo clip's ground truth, from its folder name (Shoplifting0 → Shoplifting; UCF's Stealing is our Theft). */
function truthFor(title: string): Category | null {
  const name = title.replace(/\d+$/, "");
  const mapped = name === "Stealing" ? "Theft" : name;
  return categories.includes(mapped as Category) ? mapped as Category : null;
}
const usd = (n: number) => n === 0 ? "$0.00" : n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
const tokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const avg = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;

/** Per-lane figures for the head-to-head table. */
function figures(lane: Lane, local: boolean) {
  const latencies = lane.stats.map(s => s.latencyMs).filter(n => n > 0);
  const mean = avg(latencies);
  const cost = local ? 0 : lane.stats.reduce((a, s) => a + s.cost, 0);
  const videoSec = lane.stats.length * WINDOW_SEC;
  return {
    latencies, mean, last: latencies.at(-1) ?? null, realtime: mean == null ? null : mean / (WINDOW_SEC * 1000), cost,
    perHour: videoSec ? cost / videoSec * 3600 : null,
    tokIn: lane.stats.reduce((a, s) => a + s.promptTokens, 0), tokOut: lane.stats.reduce((a, s) => a + s.completionTokens, 0),
  };
}

export function LiveRun() {
  const { saveVideo } = useApp();
  const status = useModelStatus();
  const telemetry = useTelemetry(2000);
  const player = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [clipError, setClipError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lanes, setLanes] = useState<Record<Side, Lane>>({ local: emptyLane(), cloud: emptyLane() });
  const [liveBoxes, setLiveBoxes] = useState<Record<Side, LiveBox[]>>({ local: [], cloud: [] });
  const [laneDetections, setLaneDetections] = useState<Record<Side, Detection[]>>({ local: [], cloud: [] });
  const [time, setTime] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);

  const blob = useRef<Blob | null>(null);
  const buffer = useRef<Frame[]>([]);
  const nextFrame = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const runs = useRef<Partial<Record<Side, LaneRun>>>({});
  const ended = useRef(false);

  // The clip: the first server demo clip, else the bundled synthetic sample. Loaded as a blob so frames can be read
  // back from the canvas and each lane's findings can be saved as a playable recording.
  useEffect(() => {
    let url: string | null = null, live = true;
    (async () => {
      const list = await fetch("/api/demo-clips").then(r => r.json()).catch(() => null) as { available?: boolean; clips?: { file: string; title: string }[] } | null;
      const first = list?.available ? list.clips?.[0] : undefined;
      const pick: Clip = first ? { url: `/api/demo-clips/${first.file}`, title: first.title, simulated: false } : { url: "/samples/self-checkout.webm", title: "Self checkout", simulated: true };
      try {
        const data = await (await fetch(pick.url)).blob();
        if (!live) return;
        blob.current = data; url = URL.createObjectURL(data);
        setClip(pick); setSrc(url);
      } catch { if (live) setClipError("The demo clip could not be loaded. Check that the web app can read data/demo-clips (or DEMO_CLIPS_DIR)."); }
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, []);

  // Keep local inference on the GB10 lane and hosted comparisons on the cloud lane.
  const offered = status?.options ?? [];
  const realOf = (m: string) => Object.entries(status?.aliases ?? {}).find(([, alias]) => alias === m)?.[0] ?? m;
  const model: Record<Side, string> = {
    local: offered.includes(LOCAL_MODEL) ? LOCAL_MODEL : OFF,
    cloud: status?.provider === "OpenRouter" ? offered.find(m => !isLocalModel(m) && realOf(m).includes("/")) ?? OFF : OFF,
  };
  const active = SIDES.filter(s => model[s]);
  const name = (m: string) => isLocalModel(m) ? m.replace(/^local(-vlm)?:/, "") : displayModel(m, status) ?? m;
  const canRun = !!status?.configured && active.length > 0;
  const busy = phase === "running" || phase === "finishing";

  const patch = useCallback((side: Side, f: (l: Lane) => Partial<Lane>) => setLanes(all => ({ ...all, [side]: { ...all[side], ...f(all[side]) } })), []);

  /** Writes one lane so far: its usage entry (Inference panel) and its findings as a recording (charts and table). */
  const persist = useCallback((side: Side, final: boolean) => {
    const r = runs.current[side];
    if (!r) return;
    const used = r.tally.get();
    const gpuSummary = final ? r.gpu?.stop() ?? null : r.gpu?.peek() ?? null;
    if (used.windows) upsertUsage({ id: r.id, at: new Date().toISOString(), model: r.model, local: side === "local", source: "live", title: `Analytics replay: ${r.record.title}`, ...used, wallMs: Date.now() - r.started, gpu: gpuSummary });
    const ordered = [...r.results].sort((a, b) => a.start - b.start);
    r.record = { ...r.record, detections: mergeDetections(r.record.id, ordered, r.model), moments: ordered.map(w => ({ start: w.start, end: w.end, summary: w.summary })),
      analysis: final ? "complete" : "processing", analysisModel: r.model, analyzedAt: new Date().toISOString() };
    setLaneDetections(d => ({ ...d, [side]: r.record.detections }));
    saveVideo(r.record).catch(() => { /* the provider already shows storage errors */ });
    if (final) delete runs.current[side];
  }, [saveVideo]);

  const settle = useCallback(() => {
    if (!ended.current) return;
    for (const side of SIDES) if (runs.current[side]?.pending === 0) persist(side, true);
    if (!Object.keys(runs.current).length) setPhase("done");
  }, [persist]);

  const send = useCallback((frames: Frame[]) => {
    const signal = abort.current?.signal;
    const start = Math.max(0, frames[0].seconds - WINDOW.frameStep / 2), end = frames[frames.length - 1].seconds + WINDOW.frameStep / 2;
    for (const side of SIDES) {
      const r = runs.current[side];
      if (!r) continue;
      r.pending++; patch(side, () => ({ inFlight: r.pending }));
      analyzeWindow(frames, start, end, signal, undefined, r.model)
        .then(res => {
          r.results.push(res); r.tally.add(res.usage, res.latencyMs);
          // Show this window's people until the next window replaces them.
          const boxed = res.incidents.filter(i => i.confidence >= INCIDENT_THRESHOLD && latestBox(i));
          setLiveBoxes(b => ({ ...b, [side]: boxed.map(i => ({ box: latestBox(i)!, label: i.category, until: Date.now() + WINDOW_SEC * 1000 + 2000 })) }));
          const hits = res.incidents.filter(i => i.confidence >= INCIDENT_THRESHOLD);
          patch(side, l => ({ model: res.model || l.model, stats: [...l.stats, { latencyMs: res.latencyMs ?? 0, promptTokens: res.usage?.promptTokens ?? 0, completionTokens: res.usage?.completionTokens ?? 0, cost: res.usage?.cost ?? 0 }],
            findings: hits.length ? [...hits, ...l.findings].slice(0, 4) : l.findings, named: [...new Set([...l.named, ...hits.map(h => h.category)])] }));
          persist(side, false);
        })
        .catch(e => { if (!signal?.aborted) { r.tally.fail(); patch(side, l => ({ failed: l.failed + 1, error: e instanceof Error ? e.message : "Analysis request failed." })); } })
        .finally(() => { r.pending--; patch(side, () => ({ inFlight: r.pending })); settle(); });
    }
  }, [patch, persist, settle]);

  function begin() {
    const el = player.current, data = blob.current;
    if (!el || !clip || !data) return;
    abort.current?.abort();
    abort.current = new AbortController();
    buffer.current = []; nextFrame.current = el.currentTime; ended.current = false;
    const started = Date.now();
    runs.current = {};
    for (const side of active) {
      const m = model[side];
      runs.current[side] = { id: `analytics-live@${started}-${side}`, started, model: m, results: [], pending: 0, tally: usageTally(), gpu: side === "local" ? gpuSampler() : null, record: {
        id: `live-run-${clip.title}-${side}`, title: `${clip.title} · live run · ${side === "local" ? "local" : "cloud"}${clip.simulated ? " · simulated" : ""}`, recordedAt: new Date().toISOString(),
        duration: el.duration || 0, source: "upload", analysis: "processing", blob: data, size: data.size, detections: [], analysisModel: m } };
    }
    setLanes({ local: { ...emptyLane(), model: model.local }, cloud: { ...emptyLane(), model: model.cloud } });
    setLiveBoxes({ local: [], cloud: [] }); setLaneDetections({ local: [], cloud: [] });
    setPhase("running");
  }

  // Frames by video time, not wall time: pausing pauses the run, seeking starts a fresh window.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => {
      const el = player.current;
      if (!el || el.paused || el.readyState < 2 || el.currentTime + 0.01 < nextFrame.current) return;
      buffer.current.push({ seconds: Math.round(el.currentTime * 100) / 100, image: grabFrame(el) });
      nextFrame.current = el.currentTime + WINDOW.frameStep;
      if (buffer.current.length >= WINDOW.framesPerWindow) send(buffer.current.splice(0));
    }, 200);
    return () => clearInterval(timer);
  }, [phase, send]);

  // Leaving the page keeps what was measured and cancels what was not.
  useEffect(() => () => { ended.current = true; for (const side of SIDES) persist(side, true); abort.current?.abort(); }, [persist]);

  const onPlay = () => { if (!canRun) return; if (phase === "idle" || phase === "done") begin(); else if (phase === "paused") setPhase("running"); };
  const onPause = () => { if (phase === "running" && !player.current?.ended) setPhase("paused"); };
  const onSeeked = () => { buffer.current = []; nextFrame.current = player.current?.currentTime ?? 0; };
  const onEnded = () => {
    if (!Object.keys(runs.current).length) return;
    if (buffer.current.length >= 2) send(buffer.current.splice(0)); else buffer.current = [];
    ended.current = true; setPhase("finishing"); settle();
  };

  // While a run plays: each lane's newest boxes. Afterwards (paused, scrubbing, replaying): the box at the playhead,
  // exactly as the recording page draws it.
  const now = Date.now();
  const overlay = SIDES.flatMap(side => phase === "running"
    ? liveBoxes[side].filter(b => b.until > now).map(b => ({ side, box: b.box, label: b.label }))
    : laneDetections[side].flatMap(d => { const box = boxAt(d, time); return box ? [{ side, box, label: d.category }] : []; }));
  const fig = { local: figures(lanes.local, true), cloud: figures(lanes.cloud, false) };
  // Ground truth for UCF-Crime demo clips: did each lane name the clip's real crime at least once (≥ 50%)?
  const truth = clip && !clip.simulated ? truthFor(clip.title) : null;
  const named = (s: Side) => !!truth && lanes[s].named.includes(truth);
  const on = { local: !!(busy ? lanes.local.model : model.local), cloud: !!(busy ? lanes.cloud.model : model.cloud) };
  const shown = (side: Side) => lanes[side].model || model[side];
  // Marks the better of two measured values in a row; nothing is marked until both lanes have a number.
  const better = (a: number | null, b: number | null, lower = true): Side | null => a == null || b == null || !on.local || !on.cloud || a === b ? null : (lower ? a < b : a > b) ? "local" : "cloud";
  const snap = telemetry.snapshot, hist = telemetry.history;
  const memPct = pct(snap?.host.memoryUsedMb ?? null, snap?.host.memoryTotalMb ?? null);
  const phaseLabel: Record<Phase, string> = { idle: "Ready · press play", running: "Analysing", paused: "Paused", finishing: "Finishing last windows", done: "Run complete" };
  const windows = Math.max(lanes.local.stats.length, lanes.cloud.stats.length);

  const rows: { label: string; cell: (s: Side) => React.ReactNode; best?: Side | null }[] = [
    { label: "Latency / window", best: better(fig.local.mean, fig.cloud.mean),
      cell: s => <><span>{fig[s].last == null ? "—" : `${(fig[s].last! / 1000).toFixed(1)} s`}</span>{fig[s].mean != null && <span className="block text-[.68rem] font-sans text-base-content/45">avg {(fig[s].mean! / 1000).toFixed(1)} s</span>}{fig[s].latencies.length > 1 && <Sparkline values={fig[s].latencies} height={18} label={`${s} latency`} />}</> },
    { label: "Speed vs real time", best: better(fig.local.realtime, fig.cloud.realtime),
      cell: s => <><span>{fig[s].realtime == null ? "—" : `${fig[s].realtime!.toFixed(2)}×`}</span>{fig[s].realtime != null && <span className="block text-[.68rem] font-sans text-base-content/45">{fig[s].realtime! <= 1 ? "keeps up live" : "falls behind"}</span>}</> },
    { label: "Tokens in / out", cell: s => lanes[s].stats.length ? `${tokens(fig[s].tokIn)} / ${tokens(fig[s].tokOut)}` : "—" },
    { label: "Spent", best: lanes.local.stats.length && lanes.cloud.stats.length ? better(fig.local.cost, fig.cloud.cost) : null,
      cell: s => <><span>{lanes[s].stats.length ? usd(fig[s].cost) : "—"}</span>{s === "local" && lanes[s].stats.length > 0 && <span className="block text-[.68rem] font-sans text-base-content/45">no per-token bill</span>}</> },
    { label: "Per camera-hour", cell: s => fig[s].perHour == null ? "—" : usd(fig[s].perHour!) },
    { label: "Windows", cell: s => <>{lanes[s].stats.length}{lanes[s].inFlight ? <span className="text-base-content/45"> +{lanes[s].inFlight}</span> : null}{lanes[s].failed ? <span className="text-error"> · {lanes[s].failed} failed</span> : null}</> },
    { label: "Findings ≥ 50%", cell: s => lanes[s].stats.length ? String(lanes[s].findings.length) : "—" },
    ...(truth ? [{ label: "Named the crime", best: on.local && on.cloud && lanes.local.stats.length && lanes.cloud.stats.length && named("local") !== named("cloud") ? (named("local") ? "local" : "cloud") as Side : null,
      cell: (s: Side) => { if (!lanes[s].stats.length) return "—"; const other = lanes[s].named.filter(c => c !== truth);
        return <><span>{named(s) ? "Yes" : "No"}</span>{other.length > 0 && <span className="block text-[.68rem] font-sans text-base-content/45">{named(s) ? "also " : "said "}{other.join(", ").toLowerCase()}</span>}</>; } }] : []),
    { label: "Bake-off score", best: better(benchmarkFor(realOf(shown("local")))?.score ?? null, benchmarkFor(realOf(shown("cloud")))?.score ?? null, false),
      cell: s => { const b = benchmarkFor(realOf(shown(s))); return b ? `${b.score}%` : <span className="text-base-content/40 font-sans text-xs">not benchmarked</span>; } },
  ];


  return <div className="space-y-6">
    <div className="grid xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 items-start">
      <div className="min-w-0">
        <div className="video-frame">
          {src ? <div className="video-canvas" style={{ "--video-ratio": ratio } as React.CSSProperties}>
            <video ref={player} src={src} controls playsInline muted preload="auto" className="bg-black"
              onPlay={onPlay} onPause={onPause} onSeeked={onSeeked} onEnded={onEnded} onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight); }}
              aria-label={`Demo clip ${clip?.title ?? ""}`} />
            {overlay.map((b, i) => <div key={i} className={`video-box ${b.side === "cloud" ? "video-box-alt" : ""}`} style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.width * 100}%`, height: `${b.box.height * 100}%` }}>
              <span className="video-box-label">{b.label} · {b.side === "local" ? "Local" : "Cloud"}</span></div>)}
          </div>
            : <div className="aspect-video grid place-items-center text-sm text-white/60">{clipError ? "Clip unavailable" : <span className="loading loading-spinner loading-md" />}</div>}
          {phase === "running" && <span className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 text-white px-2.5 py-1 font-mono text-[.62rem] uppercase tracking-[.06em]"><span className="size-1.5 rounded-full bg-error animate-pulse" />Live analysis · {active.length} model{active.length === 1 ? "" : "s"}</span>}
        </div>
        <div className="mt-3">
          <div className="font-medium truncate">{clip?.title ?? "Loading clip…"}{clip && <span className="text-base-content/45 font-normal"> · {clip.simulated ? "simulated sample" : "UCF-Crime demo clip"}</span>}</div>
          {truth && <div className="text-xs mt-0.5"><span className="font-mono uppercase tracking-[.06em] text-base-content/45">UCF-Crime label · </span><span className="font-medium">{truth}</span></div>}
          <div className="text-xs text-base-content/55 mt-0.5 flex items-center gap-2">{phase === "running" && <span className="size-1.5 rounded-full bg-base-content animate-pulse" />}{phaseLabel[phase]} · {windows} window{windows === 1 ? "" : "s"} analysed</div>
        </div>

        <div className="mt-5 rounded-xl border border-base-300 px-4 py-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2"><h4 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50 flex items-center gap-1.5"><GaugeIcon size={12} />This machine · live</h4><span className="text-[.68rem] text-base-content/45 truncate">{snap?.host.hostname ?? (telemetry.error ? "telemetry unreachable" : "connecting…")}</span></div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            <Meter label="CPU load" value={snap?.host.cpuLoad ?? null} />
            <Meter label="Memory" value={memPct} caption={snap?.host.memoryUsedMb != null ? `${gb(snap.host.memoryUsedMb)!.toFixed(1)} / ${gb(snap.host.memoryTotalMb)?.toFixed(0) ?? "?"} GB` : undefined} />
            {snap?.gpu && <>
              <div><Meter label={`GPU · ${snap.gpu.name ?? "accelerator"}`} value={snap.gpu.utilisation} /><Sparkline values={hist.map(h => h.gpu)} height={20} label="GPU utilisation" /></div>
              <div><div className="flex items-baseline justify-between text-sm"><span className="text-base-content/70">GPU power</span><span className="font-mono">{snap.gpu.powerWatts?.toFixed(0) ?? "—"} W</span></div><Sparkline values={hist.map(h => h.power)} height={20} label="GPU power" /></div>
            </>}
          </div>
          {!snap?.gpu && <p className="text-xs text-base-content/50">GPU: unavailable. {snap?.gpuUnavailableReason || "No GPU reading from this host."} Local models report GPU use when the app runs on the GB10.</p>}
          <p className="text-xs text-base-content/45">Cloud models run on the provider&apos;s GPUs; these readings are the machine running this app.</p>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="rounded-xl border border-base-300 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-base-300 bg-base-200/60">
            <div className="px-4 py-3 self-end font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/45">Head to head</div>
            {SIDES.map(side => <div key={side} className="px-3 py-3 border-l border-base-300 min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">{side === "local" ? <Cpu size={14} /> : <Cloud size={14} />}{side === "local" ? "Local · GB10" : "Cloud · OpenRouter"}</div>
              {model[side] ? <p className="font-mono text-xs text-base-content/60 mt-2 break-all">{name(model[side])}</p> : <p className="text-xs text-base-content/50 mt-2">{PINNED[side]} is not configured.</p>}
            </div>)}
          </div>
          {rows.map(row => <div key={row.label} className="grid grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-base-300 last:border-b-0">
            <div className="px-4 py-2.5 text-sm text-base-content/60">{row.label}</div>
            {SIDES.map(side => <div key={side} className={`px-3 py-2.5 border-l border-base-300 font-mono text-sm tabular-nums min-w-0 ${!on[side] ? "text-base-content/30" : ""} ${row.best === side ? "font-semibold bg-base-200/70" : ""}`}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1">{on[side] ? row.cell(side) : "off"}</div>
                {row.best === side && <span className="shrink-0 rounded-full bg-base-content text-base-100 px-1.5 py-px font-sans text-[.58rem] font-semibold uppercase tracking-[.06em]">best</span>}</div>
            </div>)}
          </div>)}
        </div>
        {SIDES.map(side => lanes[side].error && <Notice key={side} tone="error" role="alert">{side === "local" ? "Local" : "Cloud"} model: {lanes[side].error}</Notice>)}
        {!status?.configured && status && <Notice tone="warning">No model is configured, so playing the clip analyses nothing. Set VLM_BASE_URL and VLM_MODEL in webapp/.env.local and restart the app.</Notice>}
        {status?.configured && !active.length && <Notice tone="warning">No comparison model is configured. Configure the local Qwen3-VL-30B-A3B service or a hosted comparison model in Settings.</Notice>}
        {phase === "idle" && canRun && <p className="text-xs text-base-content/50 flex items-start gap-1.5"><Play size={12} className="mt-0.5 shrink-0" />Press play: every {WINDOW_SEC} s of video goes to {active.map(s => name(model[s])).join(" and ")} at once. Each run also lands in the Inference panel and the charts below.</p>}
      </div>
    </div>

    <div className="grid md:grid-cols-2 gap-6">
      {SIDES.map(side => <div key={side} className="min-w-0">
        <h4 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50 mb-2">Latest findings · {side === "local" ? "local" : "cloud"}{shown(side) ? ` · ${name(shown(side))}` : ""}</h4>
        {lanes[side].findings.length ? <ul className="space-y-2">{lanes[side].findings.map((f, i) => <li key={`${f.seconds}-${f.category}-${i}`} className="flex items-center gap-3 text-sm">
          <span className="font-mono text-xs text-base-content/55 w-11 shrink-0"><EventTime seconds={f.seconds} /></span>
          <span className="flex-1 min-w-0 truncate">Suspected {f.category.toLowerCase()}{truth && f.category === truth && <span className="ml-2 font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/55">✓ label</span>}</span>
          <SeverityBadge severity={f.severity} /><span className="font-mono text-xs text-base-content/55 w-9 text-right">{Math.round(f.confidence * 100)}%</span>
        </li>)}</ul>
          : <p className="text-sm text-base-content/50">{!on[side] ? "Off." : phase === "idle" ? "Findings the model is at least 50% sure of appear here as the clip plays." : "No incident above 50% confidence so far."}</p>}
      </div>)}
    </div>
  </div>;
}
