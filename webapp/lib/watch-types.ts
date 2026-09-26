// Shape of the feed log the watch agent reads and of the briefings it writes
// (ops/hermes/README.md). Shared by the server and the dashboard.

export type FeedKind = "live" | "upload" | "sample";
/** Which feed a window came from. `sample` footage is simulated and never reaches a briefing. */
export interface FeedSource { id: string; kind: FeedKind; title: string }

export interface WatchIncident { id: string; category: string; severity: string; confidence: number; seconds: number; description: string }

export type WatchEvent =
  | { type: "window"; id: string; at: string; source: FeedSource; start: number; end: number; model: string; summary: string; incidents: WatchIncident[] }
  | { type: "review"; id: string; at: string; source: FeedSource; detectionId: string; status: string; category?: string; seconds?: number }
  | { type: "alert"; id: string; at: string; detectionId: string; category: string; title: string; simulated: boolean; outcome: string };

/** One line of a briefing. The server fills `feed` and `seconds` from the first cited incident. */
export interface BriefingItem { text: string; detectionIds: string[]; severity?: string; feed?: FeedSource; seconds?: number }
export interface Briefing { id: string; at: string; kind: "update" | "digest"; summary: string; highlights: BriefingItem[]; attention: BriefingItem[]; quiet: boolean; model?: string }

export interface BriefingsResponse {
  configured: boolean;          // WATCH_AGENT_TOKEN is set, so the agent can connect
  latest: Briefing | null;
  latestDigest: Briefing | null;
  history: Briefing[];          // newest first
  lastEventAt: string | null;   // newest entry in the feed log
  feeds: number;                // feeds (not samples) seen in the last hour
}

export const FEED_KINDS: FeedKind[] = ["live", "upload", "sample"];

export function parseFeedSource(raw: unknown): FeedSource | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, kind, title } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim() || id.length > 120) return null;
  if (!FEED_KINDS.includes(kind as FeedKind)) return null;
  return { id: id.trim(), kind: kind as FeedKind, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : id.trim() };
}
