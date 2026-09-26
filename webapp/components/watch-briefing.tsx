"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, EventTime, Notice, Panel, SeverityBadge } from "@/components/ui";
import { timeLabel, type Severity } from "@/lib/types";
import { fetchBriefings } from "@/lib/watch-client";
import type { Briefing, BriefingItem, BriefingsResponse } from "@/lib/watch-types";

const POLL_MS = 15_000;
const STALE_MS = 15 * 60_000; // three missed 5-minute runs

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}
const href = (item: BriefingItem) => !item.feed || item.feed.kind === "live" ? "/live" : `/videos/${item.feed.id}${item.seconds != null ? `?t=${Math.floor(item.seconds)}` : ""}`;

function Item({ item, attention }: { item: BriefingItem; attention?: boolean }) {
  return <li className={`py-2.5 ${attention ? "border-l-2 border-warning pl-3.5" : ""}`}>
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {item.severity && <SeverityBadge severity={item.severity as Severity} />}
      <span className="text-sm">{item.text}</span>
    </div>
    {item.feed && <Link href={href(item)} className="text-xs text-base-content/55 link link-hover mt-0.5 inline-flex gap-1.5">
      {item.feed.title}{item.seconds != null && item.feed.kind !== "live" && <> · <EventTime seconds={item.seconds} /></>}{item.feed.kind === "live" && " · live"}
    </Link>}
  </li>;
}

function Summary({ briefing }: { briefing: Briefing }) {
  return <p className={`text-[.95rem] leading-relaxed ${briefing.quiet ? "text-base-content/60" : ""}`}>{briefing.summary}</p>;
}

/** The Hermes watch agent's consolidated view of every feed (webapp/.plans/hermes-watch-agent.md). */
export function WatchBriefing() {
  const [data, setData] = useState<BriefingsResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true; const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => fetchBriefings(controller.signal)
      .then(d => { if (live) { setData(d); setError(""); } })
      .catch(e => { if (live && (e as Error).name !== "AbortError") setError("Could not load briefings. Check that the web app server is running."); })
      .finally(() => { if (live) timer = setTimeout(tick, POLL_MS); });
    tick();
    return () => { live = false; controller.abort(); clearTimeout(timer); };
  }, []);

  const latest = data?.latest ?? null, digest = data?.latestDigest ?? null;
  const stale = latest ? Date.now() - Date.parse(latest.at) > STALE_MS : false;
  const action = latest && <span className={`font-mono text-xs ${stale ? "text-warning" : "text-base-content/50"}`}>{stale ? `agent quiet since ${timeLabel(latest.at)}` : `Hermes · ${ago(latest.at)}`}</span>;

  return <Panel title="Watch briefing" action={action}>
    {error ? <Notice tone="error" role="alert">{error}</Notice>
    : !data ? <p className="text-sm text-base-content/45">Loading the latest briefing…</p>
    : !data.configured ? <EmptyState title="The watch agent is not set up" description="Set WATCH_AGENT_TOKEN in webapp/.env.local, restart the web app, then start Hermes with ops/hermes/setup.sh. It reads every feed and posts a consolidated briefing here every 5 minutes." />
    : !latest ? <EmptyState title="No briefing yet" description={data.lastEventAt ? `Feeds are being logged (last activity ${ago(data.lastEventAt)}). The agent posts its first briefing on its next 5-minute run.` : "Analyse a recording or start a live feed. The agent consolidates what it sees here every 5 minutes."} />
    : <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 grid gap-5 content-start">
          <div className="grid gap-2">
            <Summary briefing={latest} />
            <p className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/45">AI-consolidated · {latest.kind === "digest" ? "hourly digest" : "5-minute update"} · {timeLabel(latest.at)} · suspected until reviewed</p>
          </div>
          {latest.attention.length > 0 && <div>
            <h3 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-warning mb-1">Needs attention</h3>
            <ul className="grid gap-1">{latest.attention.map((item, i) => <Item key={i} item={item} attention />)}</ul>
          </div>}
          {latest.highlights.length > 0 && <div>
            <h3 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50 mb-1">Highlights</h3>
            <ul className="divide-y divide-base-300">{latest.highlights.map((item, i) => <Item key={i} item={item} />)}</ul>
          </div>}
        </div>
        <div className="min-w-0 grid gap-5 content-start border-t lg:border-t-0 lg:border-l border-base-300 pt-5 lg:pt-0 lg:pl-8">
          <div className="grid grid-cols-2 border-t border-l border-base-300">
            <div className="border-r border-b border-base-300 px-4 py-3"><div className="font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/45">Feeds, last hour</div><div className="font-mono text-lg font-semibold tabular-nums mt-1">{data.feeds}</div></div>
            <div className="border-r border-b border-base-300 px-4 py-3"><div className="font-mono text-[.62rem] uppercase tracking-[.06em] text-base-content/45">Last feed activity</div><div className="font-mono text-lg font-semibold mt-1">{data.lastEventAt ? ago(data.lastEventAt) : "—"}</div></div>
          </div>
          {digest && digest.id !== latest.id && <div className="grid gap-1.5">
            <h3 className="font-mono text-[.66rem] uppercase tracking-[.06em] text-base-content/50">Hourly digest · {timeLabel(digest.at)}</h3>
            <p className="text-sm text-base-content/75 leading-relaxed">{digest.summary}</p>
          </div>}
          {data.history.length > 1 && <details className="group">
            <summary className="cursor-pointer text-sm text-base-content/60 hover:text-base-content">Earlier briefings ({data.history.length - 1})</summary>
            <ol className="mt-2 divide-y divide-base-300">{data.history.slice(1).map(b => <li key={b.id} className="py-2 text-sm">
              <span className="font-mono text-xs text-base-content/45 mr-2">{timeLabel(b.at)}</span><span className={b.quiet ? "text-base-content/55" : ""}>{b.summary}</span>
            </li>)}</ol>
          </details>}
        </div>
      </div>}
  </Panel>;
}
