// Bake-off of vision-language models on the Sentinel Machines analysis pipeline.
// Uses the app's own prompt, parser and merge logic (lib/vlm), so a score here is what the app would do.
//
//   node scripts/vlm-benchmark.ts frames   (once; extracts JPEG frames with ffmpeg)
//   node scripts/vlm-benchmark.ts run   --models qwen/qwen3-vl-8b-instruct,google/gemma-4-31b-it [--sets hawkwatch,timed,normal] [--limit 1]
//   node scripts/vlm-benchmark.ts run   --models google/gemini-2.5-flash --pipeline hawkwatch   (HawkWatch's own prompt, 1 frame / 3 s)
//   node scripts/vlm-benchmark.ts score
//   node scripts/vlm-benchmark.ts boxes [--ref google/gemini-2.5-flash]   (box agreement with a reference model)
//   add --dataset v2 (fresh test set) or --dataset full (every in-scope UCF test video) to any command; build with fetch_data.py --version v2/full
//
// Pipeline options for `run` (defaults = the app's pipeline, so existing results stay comparable):
//   --frames-per-window 4 --frame-step 2 --max-width 512 --tag <suffix for the results file, e.g. local-8f768>
//   --max-tokens 600 (raise for models whose reasoning cannot be disabled)
//   --reverse (work from the last window, so a second endpoint can split the remaining windows with a forward run)
//
// Reads VLM_BASE_URL / VLM_API_KEY from the environment or webapp/.env.local.
// Data: data/bakeoff/manifest.json (model/openrouter-bakeoff/fetch_data.py). Results: model/openrouter-bakeoff/results/.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { INCIDENT_THRESHOLD, extractJson, mergeDetections, parseWindow, planWindows, windowMessages, type WindowResult } from "../lib/vlm/analysis.ts";
import { chat } from "../lib/vlm/client.ts";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
// --dataset v2 uses the fresh test set (data/bakeoff-v2) and writes to results-v2/.
const dataset = process.argv.includes("--dataset") ? process.argv[process.argv.indexOf("--dataset") + 1] : "v1";
const dataDir = join(repo, dataset === "v1" ? "data/bakeoff" : `data/bakeoff-${dataset}`);
const outDir = join(repo, "model/openrouter-bakeoff", dataset === "v1" ? "results" : `results-${dataset}`);

interface Item { id: string; set: "hawkwatch" | "timed" | "normal"; path: string; label: string; duration: number; events: [number, number][] | null }
interface Row { model: string; video: string; set: string; start: number; end: number; ok: boolean; pipeline?: { frameStep: number; framesPerWindow: number; maxWidth: number }; error?: string; latencyMs?: number; cost?: number; promptTokens?: number; completionTokens?: number; raw?: string; result?: WindowResult }

function env(name: string): string | undefined {
  if (name in process.env) return process.env[name] || undefined; // an explicitly empty value means "unset", e.g. VLM_API_KEY= for a local server
  const file = join(here, "../.env.local");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find(l => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim();
}

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const slug = (model: string) => model.replace(/[/:]/g, "__");

async function frame(item: Item, seconds: number, maxWidth = 512): Promise<string> {
  // 512 px keeps the original cache path so earlier runs reuse their frames.
  const cache = join(dataDir, maxWidth === 512 ? "frames" : `frames-${maxWidth}`, item.id, `${seconds.toFixed(2)}.jpg`);
  if (!existsSync(cache)) {
    mkdirSync(dirname(cache), { recursive: true });
    const tmp = `${cache}.${process.pid}.tmp.jpg`; // write then rename, so parallel runs never read a partial file
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(seconds), "-i", join(dataDir, item.path), "-frames:v", "1",
      "-vf", `scale='min(${maxWidth},iw)':-2`, "-pix_fmt", "yuvj420p", "-q:v", "4", tmp]);
    renameSync(tmp, cache);
  }
  return `data:image/jpeg;base64,${readFileSync(cache).toString("base64")}`;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) await fn(items[next++]); }));
}

async function runModels() {
  const models = (arg("models") ?? "").split(",").filter(Boolean);
  const sets = (arg("sets") ?? "hawkwatch,timed,normal").split(",");
  const limit = Number(arg("limit", "0"));
  const concurrency = Number(arg("concurrency", "6"));
  const baseUrl = env("VLM_BASE_URL") ?? "https://openrouter.ai/api/v1";
  const apiKey = env("VLM_API_KEY");
  const extraJson = env("VLM_EXTRA_BODY");
  const extraBody = extraJson ? JSON.parse(extraJson) as Record<string, unknown> : undefined; // e.g. thinking off for local reasoning models
  const frameStep = Number(arg("frame-step", "2")), framesPerWindow = Number(arg("frames-per-window", "4")), maxWidth = Number(arg("max-width", "512"));
  const maxTokens = Number(arg("max-tokens", "600"));
  const tag = arg("tag");
  const plan = (duration: number) => planWindows(duration, frameStep, framesPerWindow);
  const manifest: { items: Item[] } = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const items = manifest.items.filter(i => sets.includes(i.set));
  mkdirSync(outDir, { recursive: true });

  const hawkwatch = arg("pipeline") === "hawkwatch";
  const repeat = arg("repeat"); // e.g. --repeat 2 writes a second, independent run to measure run-to-run stability
  for (const baseModel of models) {
    const model = (hawkwatch ? baseModel + HAWKWATCH_SUFFIX : baseModel) + (repeat ? ` #${repeat}` : "");
    const file = join(outDir, `${slug(baseModel)}${hawkwatch ? "__hawkwatch-pipeline" : ""}${repeat ? `__r${repeat}` : ""}${tag ? `__${tag}` : ""}.jsonl`);
    const done = new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { const r: Row = JSON.parse(l); return r.ok ? `${r.video}@${r.start}` : ""; }) : []);
    const jobs = items.flatMap(item => (hawkwatch ? hawkwatchWindows(item.duration) : plan(item.duration)).map(w => ({ item, w })))
      .filter(j => !done.has(`${j.item.id}@${j.w.start}`));
    if (process.argv.includes("--reverse")) jobs.reverse();
    jobs.splice(limit || jobs.length);
    let cost = 0, fails = 0, n = 0;
    const started = Date.now();
    await pool(jobs, concurrency, async ({ item, w }) => {
      const frames = await Promise.all(w.times.map(async t => ({ seconds: t, image: await frame(item, t, maxWidth) })));
      const row: Row = { model: model + (tag ? ` [${tag}]` : ""), video: item.id, set: item.set, start: w.start, end: w.end, ok: false, pipeline: { frameStep, framesPerWindow, maxWidth } };
      try {
        const reply = await chat({ baseUrl, apiKey, model: baseModel, extraBody, timeoutMs: 300_000 }, hawkwatch ? hawkwatchMessages(frames[0].image) : windowMessages(frames), { maxTokens });
        Object.assign(row, { latencyMs: reply.latencyMs, cost: reply.cost, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens, raw: reply.text });
        row.result = hawkwatch ? parseHawkwatch(reply.text, frames[0].seconds, w.start, w.end) : parseWindow(reply.text, frames, w.start, w.end);
        row.ok = true;
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
        fails++;
      }
      cost += row.cost ?? 0;
      appendFileSync(file, JSON.stringify(row) + "\n");
      if (++n % 20 === 0) console.error(`${model}: ${n}/${jobs.length} windows, $${cost.toFixed(4)}, ${fails} failed`);
    });
    console.error(`${model}: done ${n} windows in ${((Date.now() - started) / 1000).toFixed(0)} s, $${cost.toFixed(4)}, ${fails} failed`);
  }
}

// ---------- HawkWatch reference pipeline ----------
// Verbatim prompt from github.com/Grace-Shao/Treehacks2025 app/pages/upload/actions.ts: one frame every 3 s,
// "isDangerous" events, no categories. Used only as a baseline.
const HAWKWATCH_PROMPT = `Analyze this frame and determine if any of these specific dangerous situations are occurring:

1. Medical Emergencies:
- Person unconscious or lying motionless
- Person clutching chest/showing signs of heart problems
- Seizures or convulsions
- Difficulty breathing or choking

2. Falls and Injuries:
- Person falling or about to fall
- Person on the ground after a fall
- Signs of injury or bleeding
- Limping or showing signs of physical trauma

3. Distress Signals:
- Person calling for help or showing distress
- Panic attacks or severe anxiety symptoms
- Signs of fainting or dizziness
- Headache or unease
- Signs of unconsciousness

4. Violence or Threats:
- Physical altercations
- Threatening behavior
- Weapons visible

5. Suspicious Activities:
- Shoplifting
- Vandalism
- Trespassing

Return a JSON object in this exact format:

{
    "events": [
        {
            "timestamp": "mm:ss",
            "description": "Brief description of what's happening in this frame",
            "isDangerous": true/false // Set to true if the event involves a fall, injury, unease, pain, accident, or concerning behavior
        }
    ]
}`;
const HAWKWATCH_SUFFIX = " (HawkWatch pipeline)";
const isHawkwatch = (model: string) => model.endsWith(HAWKWATCH_SUFFIX);
const hawkwatchWindows = (duration: number) => planWindows(duration, 3, 1);

function hawkwatchMessages(image: string) {
  return [{ role: "user", content: [{ type: "text", text: HAWKWATCH_PROMPT }, { type: "image_url", image_url: { url: image } }] }];
}

function parseHawkwatch(text: string, seconds: number, start: number, end: number): WindowResult {
  const raw = extractJson(text) as { events?: { description?: string; isDangerous?: boolean }[] };
  const events = Array.isArray(raw.events) ? raw.events : [];
  const incidents = events.filter(e => e?.isDangerous === true).map(e => ({
    category: "Suspicious activity" as const, severity: "high" as const, confidence: 1, seconds, description: String(e.description ?? ""),
  }));
  return { start, end, summary: String(events[0]?.description ?? ""), incidents, score: incidents.length ? 1 : 0 };
}

// ---------- scoring ----------

// Categories accepted as a correct call for each UCF-Crime label.
const accepted: Record<string, string[]> = {
  Shoplifting: ["Shoplifting", "Theft", "Kiosk nonpayment"],
  Stealing: ["Theft", "Shoplifting", "Robbery", "Pickpocketing"],
  Robbery: ["Robbery", "Gun"],
  Fighting: ["Fighting"],
  Vandalism: ["Vandalism"],
  // --dataset full adds the other UCF classes the app can name
  Burglary: ["Theft", "Robbery", "Vandalism"],
  Shooting: ["Gun"],
  Assault: ["Fighting"],
  Abuse: ["Fighting"],
};

function auroc(pos: number[], neg: number[]) {
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
const pct = (x: number) => Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "–";
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

/** Clip-level score at a confidence threshold: mean of (right category on anomalous clips) and (no detection on normal clips). */
function clipScore(items: Item[], perVideo: Map<string, WindowResult[]>, threshold: number, hw: boolean) {
  const res = items.map(i => {
    const dets = mergeDetections(i.id, perVideo.get(i.id) ?? [], "m", threshold);
    return { normal: i.set === "normal", hit: i.set === "normal" ? dets.length === 0 : hw ? dets.length > 0 : dets.some(d => accepted[i.label]?.includes(d.category)) };
  });
  const a = res.filter(r => !r.normal), n = res.filter(r => r.normal);
  return { correct: a.filter(r => r.hit).length, anomalous: a.length, silent: n.filter(r => r.hit).length, normals: n.length };
}

/** 2-fold cross-validation of the threshold: choose it on one half of the videos, score the other half, swap. */
function crossValidated(items: Item[], perVideo: Map<string, WindowResult[]>, hw: boolean) {
  const folds = [0, 1].map(k => items.filter((_, idx) => idx % 2 === k));
  let correct = 0, anomalous = 0, silent = 0, normals = 0;
  const chosen: number[] = [];
  for (let k = 0; k < 2; k++) {
    const train = folds[1 - k], test = folds[k];
    const rate = (c: ReturnType<typeof clipScore>) => (c.correct / c.anomalous + c.silent / c.normals) / 2;
    const best = THRESHOLDS.reduce((b, t) => rate(clipScore(train, perVideo, t, hw)) > rate(clipScore(train, perVideo, b, hw)) ? t : b, INCIDENT_THRESHOLD);
    chosen.push(best);
    const c = clipScore(test, perVideo, best, hw);
    correct += c.correct; anomalous += c.anomalous; silent += c.silent; normals += c.normals;
  }
  return { cvScore: (correct / anomalous + silent / normals) / 2, cvThresholds: chosen };
}

function score() {
  const manifest: { items: Item[] } = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const files = (arg("models") ?? "").split(",").filter(Boolean).map(m => join(outDir, `${slug(m)}.jsonl`));
  const list = files.length ? files : readdir(outDir).filter(f => f.endsWith(".jsonl")).map(f => join(outDir, f));
  const summaries = [];
  for (const file of list) {
    const rows: Row[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    // keep the last attempt per window
    const last = new Map<string, Row>();
    for (const r of rows) last.set(`${r.video}@${r.start}`, r);
    const final = [...last.values()];
    const model = final[0]?.model ?? file;
    const hw = isHawkwatch(model);
    const pl = final[0]?.pipeline;
    const expected = manifest.items.reduce((n, i) => n + (hw ? hawkwatchWindows(i.duration) : planWindows(i.duration, pl?.frameStep, pl?.framesPerWindow)).length, 0);
    const okRows = final.filter(r => r.ok);
    const perVideo = new Map<string, WindowResult[]>();
    for (const r of okRows) perVideo.set(r.video, [...(perVideo.get(r.video) ?? []), r.result!]);

    const anomalous = manifest.items.filter(i => i.set !== "normal");
    const normals = manifest.items.filter(i => i.set === "normal");
    const clip = anomalous.map(i => {
      const dets = mergeDetections(i.id, perVideo.get(i.id) ?? [], model);
      return { id: i.id, label: i.label, detected: dets.length > 0, correct: dets.some(d => accepted[i.label]?.includes(d.category)), categories: [...new Set(dets.map(d => d.category))] };
    });
    const normalDets = normals.map(i => ({ id: i.id, dets: mergeDetections(i.id, perVideo.get(i.id) ?? [], model) }));
    const normalMinutes = normals.reduce((s, i) => s + i.duration, 0) / 60;

    // window-level on timed + normal videos (official temporal labels)
    const pos: number[] = [], neg: number[] = [];
    let hits = 0, events = 0; const onsetErr: number[] = [];
    for (const i of manifest.items.filter(i => i.set !== "hawkwatch")) {
      const ws = perVideo.get(i.id) ?? [];
      for (const w of ws) {
        const overlap = (i.events ?? []).some(([a, b]) => Math.min(b, w.end) - Math.max(a, w.start) > 0.5);
        (overlap ? pos : neg).push(w.score);
      }
      for (const [a, b] of i.events ?? []) {
        events++;
        const d = mergeDetections(i.id, ws, model).find(d => Math.min(b, d.endSeconds ?? d.seconds) - Math.max(a, d.seconds - 1) > 0);
        if (d) { hits++; onsetErr.push(Math.abs(d.seconds - a)); }
      }
    }
    const flaggedNeg = neg.filter(s => s >= INCIDENT_THRESHOLD).length, flaggedPos = pos.filter(s => s >= INCIDENT_THRESHOLD).length;
    const detectRate = clip.filter(c => c.detected).length / clip.length;
    const correctRate = hw ? NaN : clip.filter(c => c.correct).length / clip.length;
    const normalFaClips = normalDets.filter(n => n.dets.length).length / normalDets.length;
    const lat = okRows.map(r => r.latencyMs ?? 0);
    // interleave sets so each fold gets a mix of hawkwatch / timed / normal videos
    const cv = crossValidated([...manifest.items].sort((a, b) => a.set.localeCompare(b.set) || a.id.localeCompare(b.id)), perVideo, hw);
    summaries.push({
      model,
      windows: `${okRows.length}/${expected}`,
      parseFailures: final.filter(r => !r.ok).length,
      clipDetect: detectRate,
      clipCorrectCategory: correctRate,
      normalFalseAlarmClips: normalFaClips,
      falseAlarmsPerMin: normalDets.reduce((s, n) => s + n.dets.length, 0) / normalMinutes,
      balancedAccuracy: (detectRate + (1 - normalFaClips)) / 2,
      // Primary: right crime named on anomalous clips, and silence on normal clips (HawkWatch pipeline has no categories).
      score: ((hw ? detectRate : correctRate) + (1 - normalFaClips)) / 2,
      ...cv,
      windowAuroc: auroc(pos, neg),
      windowPrecision: flaggedPos + flaggedNeg ? flaggedPos / (flaggedPos + flaggedNeg) : NaN,
      eventHit: `${hits}/${events}`,
      medianOnsetErrorS: quantile(onsetErr, 0.5),
      latencyP50s: quantile(lat, 0.5) / 1000,
      latencyP90s: quantile(lat, 0.9) / 1000,
      costUsd: final.reduce((s, r) => s + (r.cost ?? 0), 0),
      clips: clip,
      normalFalseAlarms: normalDets.filter(n => n.dets.length).map(n => ({ id: n.id, categories: n.dets.map(d => d.category) })),
      errors: [...new Set(final.filter(r => !r.ok).map(r => r.error))].slice(0, 3),
    });
  }
  summaries.sort((a, b) => b.score - a.score || b.balancedAccuracy - a.balancedAccuracy);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summaries, null, 1));
  const header = "| Model | Windows | Score @0.5 | CV score (tuned threshold) | Balanced acc. | Clips detected | Right category | Normal clips false-alarmed | False alarms / min | Window AUROC | Timed events hit | Median onset error | p50 latency | Cost |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = summaries.map(s => `| ${s.model} | ${s.windows} | ${pct(s.score)} | ${pct(s.cvScore)} (${s.cvThresholds.join("/")}) | ${pct(s.balancedAccuracy)} | ${pct(s.clipDetect)} | ${pct(s.clipCorrectCategory)} | ${pct(s.normalFalseAlarmClips)} | ${s.falseAlarmsPerMin.toFixed(2)} | ${Number.isFinite(s.windowAuroc) ? s.windowAuroc.toFixed(2) : "–"} | ${s.eventHit} | ${Number.isFinite(s.medianOnsetErrorS) ? s.medianOnsetErrorS.toFixed(1) + " s" : "–"} | ${s.latencyP50s.toFixed(1)} s | $${s.costUsd.toFixed(3)} |`);
  writeFileSync(join(outDir, "summary.md"), [header, ...lines].join("\n") + "\n");
  console.log([header, ...lines].join("\n"));
  for (const s of summaries) console.log(`\n${s.model}\n  misses: ${s.clips.filter(c => !c.correct).map(c => `${c.id}[${c.categories.join("/") || "none"}]`).join(", ") || "none"}\n  normal false alarms: ${s.normalFalseAlarms.map(n => `${n.id}[${n.categories.join("/")}]`).join(", ") || "none"}${s.errors.length ? `\n  errors: ${s.errors.join(" | ")}` : ""}`);
}

// ---------- box agreement with a reference model ----------
// UCF-Crime has no box labels, so boxes are compared with a reference model's (default Gemini 2.5 Flash).
// Matched by time, not window, so pipeline variants with other window sizes are comparable.

type Box = { x: number; y: number; width: number; height: number };
function iou(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy, union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function incidentsOf(file: string, threshold = INCIDENT_THRESHOLD) {
  const last = new Map<string, Row>();
  for (const l of readFileSync(file, "utf8").split("\n").filter(Boolean)) { const r: Row = JSON.parse(l); last.set(`${r.video}@${r.start}`, r); }
  const out = new Map<string, { seconds: number; category: string; box?: Box }[]>();
  for (const r of last.values()) {
    if (!r.ok) continue;
    for (const i of r.result!.incidents) if (i.confidence >= threshold) out.set(r.video, [...(out.get(r.video) ?? []), { seconds: i.seconds, category: i.category, box: i.box }]);
  }
  return { model: [...last.values()][0]?.model ?? file, byVideo: out };
}

function boxes() {
  const ref = arg("ref", "google/gemini-2.5-flash")!;
  const refFile = join(outDir, `${slug(ref)}.jsonl`);
  const reference = incidentsOf(refFile);
  const files = readdir(outDir).filter(f => f.endsWith(".jsonl") && join(outDir, f) !== refFile && !f.includes("hawkwatch-pipeline"));
  const rows = files.map(f => {
    const cand = incidentsOf(join(outDir, f));
    let refBoxes = 0, matched = 0, sameCat = 0; const ious: number[] = [];
    for (const [video, refs] of reference.byVideo) {
      for (const r of refs.filter(r => r.box)) {
        refBoxes++;
        const near = (cand.byVideo.get(video) ?? []).filter(c => Math.abs(c.seconds - r.seconds) <= 2);
        if (!near.length) continue;
        matched++;
        const best = near.reduce((b, c) => Math.abs(c.seconds - r.seconds) < Math.abs(b.seconds - r.seconds) ? c : b);
        if (best.category === r.category) sameCat++;
        ious.push(best.box ? iou(r.box!, best.box) : 0); // a missing box counts as no overlap
      }
    }
    return { model: cand.model, refBoxes, matched, sameCat, iou30: ious.filter(x => x >= 0.3).length, medianIou: quantile(ious, 0.5) };
  }).sort((a, b) => b.iou30 - a.iou30);
  const header = `| Model | ${ref} boxes matched in time (±2 s) | Same category | Box IoU ≥ 0.3 (of matched) | Median IoU |\n|---|---|---|---|---|`;
  const lines = rows.map(r => `| ${r.model} | ${r.matched}/${r.refBoxes} | ${pct(r.matched ? r.sameCat / r.matched : NaN)} | ${pct(r.matched ? r.iou30 / r.matched : NaN)} | ${Number.isFinite(r.medianIou) ? r.medianIou.toFixed(2) : "–"} |`);
  writeFileSync(join(outDir, "boxes.md"), [header, ...lines].join("\n") + "\n");
  console.log([header, ...lines].join("\n"));
}

function readdir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

async function extractFrames() {
  const manifest: { items: Item[] } = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const jobs = manifest.items.flatMap(item => planWindows(item.duration).flatMap(w => w.times.map(t => ({ item, t }))));
  await pool(jobs, 8, async ({ item, t }) => { await frame(item, t); });
  console.error(`${jobs.length} frames ready`);
}

const command = process.argv[2];
if (command === "frames") await extractFrames();
else if (command === "run") await runModels();
else if (command === "score") score();
else if (command === "boxes") boxes();
else console.error("usage: node scripts/vlm-benchmark.ts frames | run --models a,b | score | boxes");
