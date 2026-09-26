# Hermes watch agent

A small scheduled agent that reads what the Sentinel Machines web app has seen across all feeds and posts one short briefing to the dashboard. It runs [Hermes Agent](https://hermes-agent.nousresearch.com) in Docker. Plan and decisions: [webapp/.plans/hermes-watch-agent.md](../../webapp/.plans/hermes-watch-agent.md).

## What it does

- **Every 5 minutes (update):** reads the last 10 minutes of suspected incidents, drops noise (low confidence, repeats, anything a person already dismissed) and posts a briefing: a short summary, items that need a review now, and other highlights. If nothing changed, it posts a one-line quiet briefing.
- **Every hour (digest):** summarises the last 60 minutes per feed, lists incidents still waiting for review, and mentions the edge node only if something is wrong.
- Briefings appear in the **Watch briefing** panel on `/overview`, which polls `/api/briefings` every 15 s.

The rules the agent follows are in [skills/kryptonx-watch/SKILL.md](skills/kryptonx-watch/SKILL.md): cite incident ids for every claim, say "suspected" until a person reviews, never describe people by protected traits, and write times as local HH:MM.

## How it connects

1. The web app logs every analysed window, review decision and alert outcome to `data/watch/events.jsonl` (or `WATCH_DATA_DIR`). Nothing is logged unless `WATCH_AGENT_TOKEN` is set in `webapp/.env.local`.
2. The agent calls the web app's MCP endpoint, `POST /api/mcp`, with that token as a bearer token. Without the token the endpoint answers 401 (or 503 if the token is not configured).
3. It reads the log through these tools (`webapp/lib/server/watch-tools.ts`):

   | Tool | What it returns |
   |---|---|
   | `list_feeds` | Feeds analysed recently, their last activity and suspected incidents in the last hour. |
   | `recent_events` | Windows with suspected incidents, review decisions and alert outcomes, oldest first, each incident with an id. |
   | `feed_activity` | Counts per feed: windows, incidents per category with top confidence, reviews and alerts. Used for digests. |
   | `get_incident` | One suspected incident by id, with its window summary, feed and time range. |
   | `system_status` | GPU use, unified memory, inference speed and when the model was last called. |
   | `last_briefing` | The most recent update or digest, so the agent reports only what changed. |
   | `post_briefing` | Publishes the briefing to `data/watch/briefings.jsonl`. |

4. `post_briefing` rejects any incident id that is not in the log, so the agent cannot cite events that did not happen. Every other tool is read-only. The agent cannot review, dismiss or send alerts; owner alerts keep their own policy in `webapp/lib/server/alerts.ts`.
5. Simulated sample footage never reaches a briefing.

## Running it

Requirements: Docker access (the scripts fall back to `sg docker` if needed), a configured `webapp/.env.local` with an OpenRouter key in `VLM_API_KEY` and `VLM_BASE_URL` on openrouter.ai, and the web app running on port 3000.

```bash
ops/hermes/setup.sh    # set up, start and schedule (safe to re-run)
ops/hermes/stop.sh     # stop and remove the container; state is kept
```

`setup.sh` does the following:

- Generates `WATCH_AGENT_TOKEN` once and appends it to `webapp/.env.local`. **Restart the web app after the first run** so it picks up the token.
- Writes the OpenRouter key into `$HERMES_HOME/.env` and copies the `kryptonx-watch` skill into `$HERMES_HOME/skills/`. It never prints a secret.
- Sets the model to `qwen/qwen3.8-flash` on OpenRouter and adds the `kryptonx` MCP server to `$HERMES_HOME/config.yaml`.
- Starts the container `kryptonx-hermes` from `nousresearch/hermes-agent:v2026.9.24` with `--memory 2g --cpus 1`, no GPU and no published ports. It restarts unless stopped. It reaches the web app at `http://host.docker.internal:3000`.
- Creates or updates two cron jobs, `kryptonx-watch-update` (every 5m) and `kryptonx-watch-digest` (every 1h).

Run a job now:

```bash
sg docker -c 'docker exec kryptonx-hermes hermes cron run kryptonx-watch-update'
```

Environment overrides for `setup.sh`:

| Variable | Default |
|---|---|
| `HERMES_HOME` | `~/.hermes-kryptonx` (mounted at `/opt/data` in the container) |
| `HERMES_IMAGE` | `nousresearch/hermes-agent:v2026.9.24` |
| `HERMES_MODEL` | `qwen/qwen3.8-flash` |
| `WEBAPP_URL` | `http://host.docker.internal:3000` (as seen from the container) |

To remove the agent completely, run `stop.sh` and delete `HERMES_HOME`.

## Why qwen3.8-flash

Frames never leave the machine for the agent: it only sees text from the feed log. Qwen3-VL-30B-A3B served locally by zrt was tried first, but it wrote its tool calls as plain text under Hermes instead of calling the tools. `qwen/qwen3.8-flash` on OpenRouter calls tools reliably and costs no GPU memory on the shared GB10. The trade-off is that feed summaries (not video) go to OpenRouter.

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel says the agent is not set up | `WATCH_AGENT_TOKEN` must be in `webapp/.env.local`, and the web app must have been restarted since it was added. |
| No new briefings | `sg docker -c 'docker exec kryptonx-hermes hermes cron list'` shows the jobs and their last run. Each run's output is in `$HERMES_HOME/cron/output/`. Container logs: `sg docker -c 'docker logs kryptonx-hermes'`. |
| Only quiet briefings | The feed log is empty or only has samples. Analyse a real upload or live feed first; `recent_events` ignores simulated samples. |
| A briefing was rejected | The model cited an unknown incident id. The skill tells it to fix the ids and post again; check the run output. |
| Times look an hour off | Tools return `at` in UTC and `time` / `now` in the node's local time. Briefings must use `time`. The container gets `TZ` from `/etc/timezone`. |
| Token or URL changed | Re-run `setup.sh`; it replaces its own block in `config.yaml`. If `config.yaml` already has another `mcp_servers` block, add the `kryptonx` server by hand. |
