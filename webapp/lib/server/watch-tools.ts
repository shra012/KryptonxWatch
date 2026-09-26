// Server-only: the tools the Hermes watch agent calls over MCP (app/api/mcp/route.ts).
// All but post_briefing are read-only. The agent cannot review, dismiss or send alerts;
// owner alerts keep their own policy in lib/server/alerts.ts.
import { systemSnapshot } from "@/lib/server/telemetry";
import { saveBriefing, watchBriefings, watchEvents, watchId } from "@/lib/server/watch-log";
import { INCIDENT_THRESHOLD } from "@/lib/vlm/analysis";
import type { Briefing, BriefingItem, FeedSource, WatchEvent, WatchIncident } from "@/lib/watch-types";

type Args = Record<string, unknown>;
export interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }

const num = (v: unknown, fallback: number, min: number, max: number) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const since = (minutes: number) => Date.now() - minutes * 60_000;
const newer = (e: WatchEvent, from: number) => Date.parse(e.at) >= from;
// Local wall-clock time on the edge node, so briefings say 04:09 rather than the UTC 03:09 in `at`.
const local = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
// Simulated sample footage never reaches a briefing (same rule as the AI summary).
const real = (e: WatchEvent) => e.type === "alert" ? !e.simulated : e.source.kind !== "sample";

const sinceProp = (fallback: number) => ({ type: "number", description: `How far back to look, in minutes (default ${fallback}, max 1440).` });
const feedProp = { type: "string", description: "Only this feed id (from list_feeds)." };

export const watchTools: ToolDefinition[] = [
  { name: "list_feeds", description: "Feeds the app has analysed recently: live cameras, replays and uploaded recordings, with their last activity and how many suspected incidents they had in the last hour. Simulated samples are left out.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "recent_events", description: "Analysis windows with suspected incidents, review decisions and alert outcomes, oldest first. Windows with nothing above min_confidence are counted, not listed. Each incident has an id to cite in post_briefing.", inputSchema: { type: "object", properties: { since_minutes: sinceProp(10), min_confidence: { type: "number", description: `Drop incidents below this confidence (default ${INCIDENT_THRESHOLD}).` }, feed_id: feedProp, category: { type: "string", description: "Only this category, e.g. Shoplifting." }, limit: { type: "number", description: "Most events to return (default 100, max 300)." } }, additionalProperties: false } },
  { name: "feed_activity", description: "Counts per feed: windows analysed, windows with suspected incidents, incidents per category with the highest confidence, review decisions and alerts. Use it for digests.", inputSchema: { type: "object", properties: { since_minutes: sinceProp(60) }, additionalProperties: false } },
  { name: "get_incident", description: "One suspected incident by id, with its window summary, feed and time range.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "system_status", description: "Health of the edge node: GPU use, unified memory, inference speed and when the model was last called.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "last_briefing", description: "The most recent briefing of the given kind, so you can report only what changed since.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["update", "digest"] } }, additionalProperties: false } },
  { name: "post_briefing", description: "Publish the consolidated briefing to the dashboard. Every highlight and attention item must cite incident ids from recent_events or get_incident; unknown ids are rejected. Say 'suspected', never 'confirmed', unless a review event confirms it. Set quiet=true with a one-line summary when nothing notable happened.", inputSchema: { type: "object", properties: {
    kind: { type: "string", enum: ["update", "digest"], description: "update: the 5-minute check. digest: the hourly summary." },
    summary: { type: "string", description: "Two to four plain sentences on what is happening across feeds." },
    highlights: { type: "array", maxItems: 8, items: { type: "object", properties: { text: { type: "string" }, detection_ids: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["text", "detection_ids"] } },
    attention: { type: "array", maxItems: 8, description: "Suspected incidents a person should review now, most urgent first.", items: { type: "object", properties: { text: { type: "string" }, severity: { type: "string", enum: ["critical", "high", "medium", "low"] }, detection_ids: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["text", "severity", "detection_ids"] } },
    quiet: { type: "boolean" },
  }, required: ["kind", "summary"], additionalProperties: false } },
];

function incidentIndex(events: WatchEvent[]) {
  const index = new Map<string, { incident: WatchIncident; window: Extract<WatchEvent, { type: "window" }> }>();
  for (const e of events) if (e.type === "window" && e.source.kind !== "sample") for (const incident of e.incidents) index.set(incident.id, { incident, window: e });
  return index;
}

async function listFeeds() {
  const hour = since(60), feeds = new Map<string, { feed: FeedSource; lastActivityAt: string; windowsLastHour: number; incidentsLastHour: number; model: string }>();
  for (const e of await watchEvents()) {
    if (e.type !== "window" || !real(e)) continue;
    const f = feeds.get(e.source.id) ?? { feed: e.source, lastActivityAt: e.at, windowsLastHour: 0, incidentsLastHour: 0, model: e.model };
    f.lastActivityAt = e.at; f.feed = e.source; f.model = e.model;
    if (Date.parse(e.at) >= hour) { f.windowsLastHour++; f.incidentsLastHour += e.incidents.filter(i => i.confidence >= INCIDENT_THRESHOLD).length; }
    feeds.set(e.source.id, f);
  }
  return { now: local(new Date().toISOString()), feeds: [...feeds.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).map(f => ({ ...f, lastActivity: local(f.lastActivityAt) })) };
}

async function recentEvents(args: Args) {
  const from = since(num(args.since_minutes, 10, 1, 1440)), minConfidence = num(args.min_confidence, INCIDENT_THRESHOLD, 0, 1);
  const feedId = str(args.feed_id), category = str(args.category)?.toLowerCase(), limit = num(args.limit, 100, 1, 300);
  let quietWindows = 0;
  const out: unknown[] = [];
  for (const e of await watchEvents()) {
    if (!newer(e, from) || !real(e)) continue;
    if (feedId && (e.type === "alert" || e.source.id !== feedId)) continue;
    if (e.type === "window") {
      const incidents = e.incidents.filter(i => i.confidence >= minConfidence && (!category || i.category.toLowerCase() === category));
      if (!incidents.length) { quietWindows++; continue; }
      out.push({ type: "window", at: e.at, time: local(e.at), feed: e.source, start: e.start, end: e.end, summary: e.summary, incidents });
    } else if (!category || e.category?.toLowerCase() === category) out.push({ ...e, time: local(e.at) });
  }
  return { now: local(new Date().toISOString()), events: out.slice(-limit), truncated: out.length > limit, quietWindows };
}

async function feedActivity(args: Args) {
  const from = since(num(args.since_minutes, 60, 1, 1440));
  type Row = { feed: FeedSource; windows: number; windowsWithIncidents: number; categories: Record<string, { count: number; maxConfidence: number }>; reviews: Record<string, number> };
  const rows = new Map<string, Row>();
  const alerts: Record<string, number> = {};
  for (const e of await watchEvents()) {
    if (!newer(e, from) || !real(e)) continue;
    if (e.type === "alert") { alerts[e.outcome] = (alerts[e.outcome] ?? 0) + 1; continue; }
    const row = rows.get(e.source.id) ?? { feed: e.source, windows: 0, windowsWithIncidents: 0, categories: {}, reviews: {} };
    if (e.type === "window") {
      row.windows++;
      const hits = e.incidents.filter(i => i.confidence >= INCIDENT_THRESHOLD);
      if (hits.length) row.windowsWithIncidents++;
      for (const i of hits) { const c = (row.categories[i.category] ??= { count: 0, maxConfidence: 0 }); c.count++; c.maxConfidence = Math.max(c.maxConfidence, i.confidence); }
    } else row.reviews[e.status] = (row.reviews[e.status] ?? 0) + 1;
    rows.set(e.source.id, row);
  }
  return { now: local(new Date().toISOString()), feeds: [...rows.values()], alerts };
}

async function getIncident(args: Args) {
  const id = str(args.id);
  const hit = id ? incidentIndex(await watchEvents()).get(id) : undefined;
  if (!hit) throw new Error(`No incident with id ${id ?? "(missing)"}. Use ids from recent_events.`);
  return { incident: hit.incident, feed: hit.window.source, window: { at: hit.window.at, time: local(hit.window.at), start: hit.window.start, end: hit.window.end, summary: hit.window.summary, model: hit.window.model } };
}

async function status() {
  const s = await systemSnapshot();
  return { gpu: s.gpu && { utilisation: s.gpu.utilisation, memoryUsedMb: s.gpu.memoryUsedMb, temperatureC: s.gpu.temperatureC, powerWatts: s.gpu.powerWatts, processes: s.gpu.processes.length }, unifiedMemory: { usedMb: s.host.memoryUsedMb, totalMb: s.host.memoryTotalMb }, inference: s.inference };
}

async function lastBriefing(args: Args) {
  const kind = str(args.kind);
  const list = await watchBriefings();
  return { briefing: [...list].reverse().find(b => !kind || b.kind === kind) ?? null };
}

function items(raw: unknown, index: ReturnType<typeof incidentIndex>, attention: boolean): BriefingItem[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 8) throw new Error("highlights and attention must be arrays of at most 8 items.");
  return raw.map((item, n) => {
    const { text, detection_ids, severity } = (item ?? {}) as Args;
    const line = str(text)?.slice(0, 300);
    const ids = Array.isArray(detection_ids) ? detection_ids.filter((d): d is string => typeof d === "string") : [];
    if (!line || !ids.length) throw new Error(`Item ${n + 1} needs text and at least one detection id.`);
    const unknown = ids.filter(id => !index.has(id));
    if (unknown.length) throw new Error(`Unknown detection ids: ${unknown.join(", ")}. Cite only ids returned by recent_events or get_incident.`);
    const first = index.get(ids[0])!;
    const sev = str(severity);
    if (attention && !["critical", "high", "medium", "low"].includes(sev ?? "")) throw new Error(`Attention item ${n + 1} needs a severity: critical, high, medium or low.`);
    return { text: line, detectionIds: ids.slice(0, 10), ...(sev ? { severity: sev } : {}), feed: first.window.source, seconds: first.incident.seconds };
  });
}

async function postBriefing(args: Args) {
  const kind = args.kind === "digest" ? "digest" : args.kind === "update" ? "update" : null;
  const summary = str(args.summary)?.slice(0, 1200);
  if (!kind || !summary) throw new Error("post_briefing needs kind (update or digest) and a summary.");
  const index = incidentIndex(await watchEvents());
  const briefing: Briefing = { id: watchId(), at: new Date().toISOString(), kind, summary, highlights: items(args.highlights, index, false), attention: items(args.attention, index, true), quiet: args.quiet === true };
  await saveBriefing(briefing);
  return { saved: briefing.id, at: briefing.at };
}

const handlers: Record<string, (args: Args) => Promise<unknown>> = {
  list_feeds: listFeeds, recent_events: recentEvents, feed_activity: feedActivity, get_incident: getIncident,
  system_status: status, last_briefing: lastBriefing, post_briefing: postBriefing,
};

export async function callWatchTool(name: string, args: Args): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool ${name}.`);
  return handler(args ?? {});
}
