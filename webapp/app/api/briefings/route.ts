import { NextResponse } from "next/server";
import { watchBriefings, watchEnabled, watchEvents } from "@/lib/server/watch-log";
import type { BriefingsResponse } from "@/lib/watch-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Briefings from the Hermes watch agent, for the dashboard panel.
export async function GET() {
  const [briefings, events] = await Promise.all([watchBriefings(), watchEvents()]);
  const newest = [...briefings].reverse();
  const hour = Date.now() - 3_600_000;
  const feeds = new Set(events.filter(e => e.type === "window" && e.source.kind !== "sample" && Date.parse(e.at) >= hour).map(e => e.type === "window" ? e.source.id : ""));
  const body: BriefingsResponse = {
    configured: watchEnabled(),
    latest: newest[0] ?? null,
    latestDigest: newest.find(b => b.kind === "digest") ?? null,
    history: newest.slice(0, 24),
    lastEventAt: events.at(-1)?.at ?? null,
    feeds: feeds.size,
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
