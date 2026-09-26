# Hermes watch agent

The optional Hermes agent turns the application's structured feed log into short briefings on `/overview`: an update every five minutes and an hourly digest. It reads detected events and review state through the app's MCP endpoint; it does not analyze raw video itself.

## Requirements

- A running web app reachable from the Docker container.
- Docker access for the current user.
- OpenRouter configured privately in `webapp/.env.local` using `VLM_BASE_URL` and `VLM_API_KEY`.

The setup script defaults to `qwen/qwen3.8-flash` through OpenRouter. Its hosted text-model calls are separate from local video inference.

## Start and stop

From the repository root:

```bash
ops/hermes/setup.sh
```

Setup creates `WATCH_AGENT_TOKEN` if absent, copies the runtime skill, configures MCP, starts `kryptonx-hermes`, and creates or updates its schedules. Restart the web app after the first setup so it reads the token. Re-running setup replaces the container while retaining its state directory.

```bash
# Run one update now.
sg docker -c 'docker exec kryptonx-hermes hermes cron run kryptonx-watch-update'
# Stop the container while preserving state.
ops/hermes/stop.sh
```

## Configuration

| Override | Default |
| --- | --- |
| `HERMES_HOME` | `~/.hermes-kryptonx` |
| `HERMES_IMAGE` | Image pinned in `setup.sh` |
| `HERMES_MODEL` | `qwen/qwen3.8-flash` |
| `WEBAPP_URL` | `http://host.docker.internal:3000` |

The container is capped at 2 GB RAM and one CPU, requests no GPU, and publishes no ports. Its private state contains credentials; do not commit or print it.

## Briefing behavior

The agent combines repeated events, excludes dismissed incidents, and cites exact incident identifiers. It can publish briefings, but cannot send alerts or change human reviews. Every incident remains suspected until reviewed.

[skills/kryptonx-watch/SKILL.md](skills/kryptonx-watch/SKILL.md) is executable agent configuration copied by `setup.sh`. Keep its filename and location intact.

## Verification

Check the container and scheduled jobs, then open `/overview` after an update. Feed logging requires `WATCH_AGENT_TOKEN`; analysis windows must include valid source metadata to enter the feed. If setup adds the token to a running app, restart the app before testing.
