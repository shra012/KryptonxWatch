#!/usr/bin/env bash
# Starts the Hermes watch agent in Docker and schedules its briefings
# (webapp/.plans/hermes-watch-agent.md). Safe to re-run. Never prints a secret.
#
#   ops/hermes/setup.sh          # set up, start, schedule
#   ops/hermes/stop.sh           # stop and remove the container (state is kept)
#
# Env overrides: HERMES_HOME (default ~/.hermes-kryptonx), HERMES_IMAGE, HERMES_MODEL,
# WEBAPP_URL (as seen from the container; default http://host.docker.internal:3000).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_LOCAL="$ROOT/webapp/.env.local"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes-kryptonx}"
IMAGE="${HERMES_IMAGE:-nousresearch/hermes-agent:v2026.9.24}"
MODEL="${HERMES_MODEL:-qwen/qwen3.8-flash}"   # an OpenRouter model id with reliable tool calling (Qwen3-VL-30B wrote calls as text)
WEBAPP_URL="${WEBAPP_URL:-http://host.docker.internal:3000}"
NAME="kryptonx-hermes"

docker_() { if docker info >/dev/null 2>&1; then docker "$@"; else sg docker -c "docker $(printf '%q ' "$@")"; fi; }
env_value() { grep -E "^$1=" "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

[ -f "$ENV_LOCAL" ] || { echo "Missing $ENV_LOCAL. Configure the web app first." >&2; exit 1; }

# 1. The token the agent presents to /api/mcp. Generated once, kept in .env.local.
if [ -z "$(env_value WATCH_AGENT_TOKEN)" ]; then
  printf '\n# Hermes watch agent (ops/hermes/setup.sh)\nWATCH_AGENT_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$ENV_LOCAL"
  echo "Added WATCH_AGENT_TOKEN to webapp/.env.local. Restart the web app so it picks it up."
fi
TOKEN="$(env_value WATCH_AGENT_TOKEN)"

# 2. The agent's model key: the web app's OpenRouter key.
KEY="$(env_value VLM_API_KEY)"
case "$(env_value VLM_BASE_URL)" in *openrouter.ai*) ;; *) KEY="";; esac
[ -n "$KEY" ] || { echo "VLM_API_KEY in webapp/.env.local must be an OpenRouter key (VLM_BASE_URL on openrouter.ai)." >&2; exit 1; }

# 3. Hermes home: secrets in .env, the MCP server in config.yaml, our skill.
umask 077
mkdir -p "$HERMES_HOME/skills"
printf 'OPENROUTER_API_KEY=%s\n' "$KEY" > "$HERMES_HOME/.env"
rm -rf "$HERMES_HOME/skills/kryptonx-watch"
cp -r "$ROOT/ops/hermes/skills/kryptonx-watch" "$HERMES_HOME/skills/"

run_once() { docker_ run --rm -e PUID="$(id -u)" -e PGID="$(id -g)" -v "$HERMES_HOME:/opt/data" "$IMAGE" "$@"; }
docker_ pull -q "$IMAGE" >/dev/null
run_once config set model "$MODEL" >/dev/null

CONFIG="$HERMES_HOME/config.yaml"
touch "$CONFIG"
python3 - "$CONFIG" "$WEBAPP_URL/api/mcp" "$TOKEN" "$MODEL" <<'PY'
import re, sys
path, url, token, model = sys.argv[1:]
text = open(path).read()
# The model block: a bare OpenRouter id, with the provider named explicitly.
text = re.sub(r'(?m)^(  default:\s*)".*"', lambda m: f'{m.group(1)}"{model}"', text, count=1)
text = re.sub(r'(?m)^(  provider:\s*)"auto"', r'\1"openrouter"', text, count=1)
# Replace any earlier kryptonx block so re-runs pick up a new token or URL.
text = re.sub(r"(?ms)^# kryptonx-watch MCP \(ops/hermes/setup\.sh\)\n.*?^# end kryptonx-watch\n", "", text)
block = f"""# kryptonx-watch MCP (ops/hermes/setup.sh)
mcp_servers:
  kryptonx:
    url: "{url}"
    headers:
      Authorization: "Bearer {token}"
    timeout: 60
    tools:
      prompts: false
      resources: false
# end kryptonx-watch
"""
if re.search(r"(?m)^mcp_servers:", text):
    sys.exit("config.yaml already has an mcp_servers block; add the kryptonx server to it by hand.")
open(path, "w").write(text.rstrip() + "\n\n" + block)
PY

# 4. The gateway: keeps running and fires the schedules. No ports are published.
docker_ rm -f "$NAME" >/dev/null 2>&1 || true
docker_ run -d --name "$NAME" --restart unless-stopped \
  -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ="$(cat /etc/timezone 2>/dev/null || echo UTC)" \
  --add-host host.docker.internal:host-gateway \
  --memory 2g --cpus 1 \
  -v "$HERMES_HOME:/opt/data" \
  "$IMAGE" gateway run >/dev/null
echo "Started $NAME ($IMAGE, model $MODEL)."

# 5. The schedules: created once, prompts refreshed on every run.
sleep 5
UPDATE_PROMPT="Run the kryptonx-watch 5-minute update: check the last 10 minutes of feeds, then publish by calling the post_briefing tool with kind update. Reply [SILENT] after it succeeds."
DIGEST_PROMPT="Run the kryptonx-watch hourly digest: summarise the last 60 minutes across all feeds, then publish by calling the post_briefing tool with kind digest. Reply [SILENT] after it succeeds."
JOBS="$(docker_ exec "$NAME" hermes cron list 2>/dev/null || true)"
schedule() { # name, schedule, prompt
  if grep -q "$1" <<<"$JOBS"; then docker_ exec "$NAME" hermes cron edit "$1" --schedule "$2" --prompt "$3" --skill kryptonx-watch >/dev/null
  else docker_ exec "$NAME" hermes cron create "$2" "$3" --skill kryptonx-watch --name "$1" >/dev/null; fi
}
schedule kryptonx-watch-update "every 5m" "$UPDATE_PROMPT"
schedule kryptonx-watch-digest "every 1h" "$DIGEST_PROMPT"
docker_ exec "$NAME" hermes cron list
echo "Run one now with: docker exec $NAME hermes cron run kryptonx-watch-update"
