// Server-only: the append-only feed log the watch agent reads, and the briefings it writes back
// (webapp/.plans/hermes-watch-agent.md). JSONL under data/watch/ (git-ignored), newest entries
// kept in memory. Nothing is logged until WATCH_AGENT_TOKEN is set, so the app stores no feed
// history unless the agent is in use.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Briefing, WatchEvent } from "@/lib/watch-types";

const DIR = process.env.WATCH_DATA_DIR || path.resolve(process.cwd(), "..", "data", "watch");
const EVENTS_FILE = path.join(DIR, "events.jsonl");
const BRIEFINGS_FILE = path.join(DIR, "briefings.jsonl");
const KEEP_EVENTS = 5000;
const KEEP_BRIEFINGS = 300;

type Store = { events: WatchEvent[]; briefings: Briefing[]; loading: Promise<void> | null };
// Route handlers can be bundled separately in dev, so share one store through globalThis.
const g = globalThis as typeof globalThis & { __kxWatchLog?: Store };
const store = () => (g.__kxWatchLog ??= { events: [], briefings: [], loading: null });

export const watchToken = () => process.env.WATCH_AGENT_TOKEN?.trim() || "";
export const watchEnabled = () => Boolean(watchToken());
export const watchId = () => randomUUID();

async function readJsonl<T>(file: string, keep: number): Promise<T[]> {
  try {
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).slice(-keep);
    return lines.flatMap(line => { try { return [JSON.parse(line) as T]; } catch { return []; } });
  } catch { return []; }
}

async function load() {
  const s = store();
  s.loading ??= (async () => {
    const [events, briefings] = await Promise.all([readJsonl<WatchEvent>(EVENTS_FILE, KEEP_EVENTS), readJsonl<Briefing>(BRIEFINGS_FILE, KEEP_BRIEFINGS)]);
    s.events = [...events, ...s.events];
    s.briefings = [...briefings, ...s.briefings];
  })();
  return s.loading;
}

async function append(file: string, value: unknown) {
  await mkdir(DIR, { recursive: true });
  await appendFile(file, JSON.stringify(value) + "\n", "utf8");
}

function keepLast<T>(list: T[], keep: number) { if (list.length > keep) list.splice(0, list.length - keep); }

/** Adds one event to the log. A failed write is dropped: logging must never break analysis. */
export async function recordWatchEvent(event: WatchEvent) {
  if (!watchEnabled()) return;
  try {
    await load();
    const s = store();
    s.events.push(event);
    keepLast(s.events, KEEP_EVENTS);
    await append(EVENTS_FILE, event);
  } catch { /* the log is best effort */ }
}

export async function watchEvents(): Promise<WatchEvent[]> { await load(); return store().events; }
export async function watchBriefings(): Promise<Briefing[]> { await load(); return store().briefings; }

export async function saveBriefing(briefing: Briefing) {
  await load();
  const s = store();
  s.briefings.push(briefing);
  keepLast(s.briefings, KEEP_BRIEFINGS);
  await append(BRIEFINGS_FILE, briefing);
}
