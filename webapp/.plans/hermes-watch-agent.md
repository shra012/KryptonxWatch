# Hermes watch agent: consolidated feed briefings

Status: 2026-09-26 · built and running (container kryptonx-hermes) · agent model changed to qwen/qwen3.8-flash (Qwen3-VL-30B wrote tool calls as text) · verified end to end with two bake-off test clips.

## Context
We want an agent that keeps running, reads every feed the app analyses, filters out noise, and gives one consolidated view: a short summary, highlights, and the items that need a person's attention. The agent is [Hermes Agent](https://hermes-agent.nousresearch.com) (Nous Research, MIT licence).

What Hermes gives us (from its docs):
- **Tools over MCP.** `mcp_servers:` in `~/.hermes/config.yaml`, stdio or HTTP (`url` + `headers`), with `tools.include` / `exclude` filters. Tools appear as `mcp_<server>_<tool>`.
- **Scheduled runs.** `hermes cron create "every 5m" "<prompt>" --skill <name>`; a `continuity` option feeds the job its previous output, so it can report only what changed. Output goes to `~/.hermes/cron/output/` or to Telegram, Slack, email and others.
- **Always on.** Schedules fire only while `hermes gateway` runs (as a user service, or in Docker; the repo ships a `docker-compose.yml`).
- **Models.** Any OpenAI-compatible endpoint (base URL, model, key), including OpenRouter or our zrt proxy.

The gap on our side: **the server keeps no record of feeds.** Detections live in each browser's IndexedDB, and `/api/analyze` receives frames without saying which video or live feed they belong to. An agent on the server has nothing to read until we log what the server already sees.

## Design
```
browser ──/api/analyze, /api/detect (+ source)──▶ Next.js ──append──▶ data/watch/events.jsonl
browser ──review decision, alert outcome───────▶ Next.js ──append──▶      (same log)
Hermes gateway ──every 5 min──▶ /api/mcp (read tools) ──▶ consolidates ──▶ post_briefing ──▶ data/watch/briefings.jsonl
dashboard ◀── /api/briefings (poll 15 s) ── latest briefing, highlights, needs-attention
```

Rules the agent works under (enforced by the server, not only by the prompt):
- **Read-only on the world.** It cannot change reviews or send owner SMS. Owner alerts keep the existing policy (opt-in, capped, deduplicated, confirmed incidents).
- **No invented events.** Every highlight must cite detection IDs; `post_briefing` rejects IDs that are not in the log.
- **Honest labels.** Briefings show as "AI-consolidated · suspected until reviewed". Simulated samples are excluded, as in the AI summary today.
- **Token-protected.** `/api/mcp` needs `WATCH_AGENT_TOKEN` (in `.env.local`), and only the loopback agent uses it.

## Steps
1. **Feed log.** `lib/server/watch-log.ts`: append-only JSONL under `data/watch/` (git-ignored) with an in-memory index. `/api/analyze` and `/api/detect` record each window result with a `source` ({id, kind: live | upload | sample, title}); `lib/detection-client.ts` sends that source. New `POST /api/watch/events` records review decisions and alert outcomes from the browser.
2. **MCP endpoint.** `app/api/mcp/route.ts`: stateless Streamable-HTTP JSON-RPC (`initialize`, `tools/list`, `tools/call`), hand-rolled to avoid a new dependency. Tools:
   - `list_feeds()`: active feeds, last activity, model in use
   - `recent_events(since_minutes, min_confidence?, feed?, category?)`
   - `feed_activity(since_minutes)`: counts per feed and category
   - `get_incident(id)`
   - `system_status()`: the `/api/system` snapshot (GPU, memory, inference speed)
   - `last_briefing()`
   - `post_briefing({summary, highlights[], attention[]})`: the only write, validated against the log
3. **Hermes setup** in `ops/hermes/`: `config.yaml` (model endpoint, `mcp_servers.kryptonx` with `tools.include`), the skill `kryptonx-watch/SKILL.md` (filter rules: drop low confidence, fold repeated windows into one incident, cite IDs, say "suspected", report only changes), and the job: `hermes cron create "every 5m" … --skill kryptonx-watch`, plus an hourly digest that reuses the 5-minute output as context.
4. **Dashboard.** A "Watch briefing" panel on `/overview`: latest summary, highlights linking to `/videos/{id}?t=`, needs-attention list, agent status (last run, model), and history. Poll `/api/briefings`; handle loading, empty ("agent has not run yet") and error states.
5. **Docs.** Update `AGENTS.md` (how to start and stop the agent) and `.env.local.example` (`WATCH_AGENT_TOKEN`).

## Decisions (made 2026-09-26)
Chosen: **1b** OpenRouter model (summaries leave the machine; frames never do), **2** Docker, **3** dashboard only, **4** every 5 minutes plus an hourly digest.

Options that were considered:
1. **Agent model.** (a) Local Qwen3-VL-30B-A3B through zrt: keeps everything on the GB10 as `AGENTS.md` requires, but zrt must restart with tool calling on (`--enable-auto-tool-choice --tool-call-parser hermes`) and probably a longer context than 16k, which uses more shared memory. (b) An OpenRouter text model: no GPU cost, but feed summaries leave the machine.
2. **How Hermes runs.** Docker container (isolated, easy to remove) or the native installer, which puts Python 3.14 and Node under `~/.hermes`. Either way it is a long-running service on the shared machine.
3. **Delivery beyond the dashboard.** None, or Telegram / Slack / email through Hermes' gateway.
4. **Cadence.** Every 5 minutes plus an hourly digest (proposed), or something else.

## Verification
- Analyse a sample and an upload: `recent_events` returns their windows with the right source; simulated samples are flagged.
- `curl` the MCP endpoint: `initialize`, `tools/list`, one `tools/call`; no token gets 401.
- `post_briefing` with an unknown detection ID is rejected.
- `hermes cron run kryptonx-watch` once by hand: a briefing appears on `/overview` within 15 s, cites real IDs, and says "suspected".
- Stop the agent: the panel shows when the last briefing ran instead of stale data as current.
- `npm run lint && npm run typecheck`; e2e test for the panel with `/api/briefings` mocked.

## Out of scope
Feeds that run with no browser open (the cloud blueprint's edge boxes and Kafka). Here the agent sees what browsers analyse; the cloud design would feed it from `incidents.suspected` instead.
