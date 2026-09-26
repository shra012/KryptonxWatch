# Sentinel Machines web app

Sentinel Machines is the KryptonxWatch dashboard for retail security video. You upload a recording or point it at a live feed. A vision-language model (VLM) looks at sampled frames and reports suspected incidents (shoplifting, robbery, fighting and others) with times, a scene log and a box on the person involved. A person then reviews each one. It is a Next.js 15 app. The browser keeps recordings and review state; the server routes in `app/api/` hold every key and talk to the models.

The model can run on the HP ZGX Nano (NVIDIA GB10) through HP Z Runtime (`zrt`), or in the cloud through OpenRouter. The UI shows the model as **sentinel-machines-v1**. That name is a configurable alias (`VLM_MODEL_ALIASES`, see `lib/server/vlm-config.ts`) for whichever model serves it. It is not a fine-tuned model.

## Pages

| Route | What it shows |
|---|---|
| `/` | Landing page: what the product does and how it works, with a link into the console (no sidebar). |
| `/overview` | Monitor wall, open incidents, edge node status, and the **Watch briefing** panel written by the Hermes watch agent ([ops/hermes](../ops/hermes/README.md)). |
| `/upload` | Add an MP4 or WebM recording (up to 250 MB, stored in the browser). Analysis starts after saving. |
| `/videos` | Video library: search, filter and sort recordings; load the UCF-Crime demo clips. |
| `/videos/[id]` | Player with timeline and boxes, AI analysis progress, scene log, review controls and a context assistant. Link to a moment as `/videos/{id}?t={seconds}`. |
| `/live` | Live monitor: webcam or a replayed recording, analysed as it plays, with an incident feed and YOLO body joints. |
| `/detections` | Detection log: the review queue, filtered by recording, category, severity and review status. |
| `/analytics` | Counts, severity mix, categories, AI summary, inference cost (local GB10 vs API) and a live head-to-head run. |
| `/system` | Device operations: GPU, unified memory, SoC power, temperature and inference speed. |
| `/settings` | Preferences (model choice, theme) and owner SMS alert status. |

**Staged demo, not a benchmark:** the live head-to-head on `/analytics` (`components/live-run.tsx`) was staged for a demo video. Its two lanes are pinned and their labels are deliberately swapped: the lane labelled "Local · GB10" runs `sentinel-machines-v1` (an alias for a cloud model on OpenRouter) and the lane labelled "Cloud · OpenRouter" runs Qwen3-VL-30B-A3B on the GB10. Its numbers are not a real local-vs-cloud comparison; for real model numbers see the [bake-off](../model/openrouter-bakeoff/README.md). It also shows the clip's UCF-Crime ground-truth label and a "Named the crime" row.

## API routes

All routes are in `app/api/`. They are the only code that reads model or alert settings.

| Route | Purpose | Backed by |
|---|---|---|
| `POST /api/analyze` | Analyse one window of frames; returns incidents, summary, boxes and token usage. | The selected VLM; YOLO for boxes; the watch log |
| `GET /api/model` | Which models the server offers, their aliases and provider. Never returns a key. | `lib/server/vlm-config.ts` |
| `POST /api/chat` | Context assistant for one recording. | Chat model (`VLM_CHAT_MODEL` or `VLM_MODEL`) |
| `POST /api/summary` | AI summary for the Analytics page. | Chat model |
| `POST /api/track` | People on up to 16 frames, to follow a suspect through the whole video. | YOLO service |
| `POST /api/pose` | Body joints for one live frame. | YOLO pose model |
| `GET, POST /api/detect` | Proxy to an external per-frame detection service. Not used by the current pages. | `DETECTION_SERVICE_URL` |
| `GET, POST /api/alerts` | Alert policy status; send an owner SMS, WhatsApp or email for a detection. | Twilio / SendGrid (`lib/server/alerts.ts`) |
| `GET /api/system` | GPU, CPU, memory and inference-speed telemetry. | `nvidia-smi`, `/proc`, `lib/server/inference-stats.ts` |
| `GET /api/pricing` | Per-token prices from OpenRouter's public model list, cached for an hour. | OpenRouter |
| `GET /api/demo-clips` | List the demo clips on this server. | `../data/demo-clips` (or `DEMO_CLIPS_DIR`) |
| `GET /api/demo-clips/[file]` | Serve one demo clip; only names from the listing. | Same folder |
| `POST /api/mcp` | MCP server for the watch agent; needs the bearer token. | `lib/server/watch-tools.ts` |
| `GET /api/briefings` | Latest briefing, latest digest and history for the Watch briefing panel. | `data/watch/briefings.jsonl` |
| `POST /api/watch/events` | Log a review decision so the agent knows what a person confirmed or dismissed. | `data/watch/events.jsonl` |

## How analysis works

1. The browser samples one frame every 2 s and groups 4 frames into an 8 s window (`WINDOW` in `lib/vlm/analysis.ts`). Only these frames leave the browser.
2. `/api/analyze` sends the window to the model and asks for JSON incidents: category, severity, confidence, time, description and a box. If the reply is not valid JSON, it retries once; a second failure returns an error.
3. When `YOLO_BASE_URL` is set, each incident box is snapped to a YOLO person and followed across the window's frames (`lib/server/yolo.ts`, `lib/vlm/boxes.ts`). Without YOLO, or if it fails, the model's own boxes are kept.
4. The browser merges windows: incidents at or above confidence 0.5 in the same category and in touching windows become one detection (`mergeDetections`).
5. With YOLO on, a final pass samples people about every 0.5 s across the whole video and follows each suspect through it (`/api/track`, `trackThroughVideo`).

Model ids:

- `local-vlm:<name>`: a general model served on the GB10 by zrt (`LOCAL_VLM_BASE_URL`, `LOCAL_VLM_MODELS`). Full JSON analysis, assistant and summary.
- `local:<name>`: a yes/no shoplifting scorer (`LOCAL_SCORER_BASE_URL`, `LOCAL_SCORER_MODELS`). It takes 16 frames at 2 fps per window, works on recorded video only and gives no boxes.
- Anything else goes to `VLM_BASE_URL` (OpenRouter). Aliases from `VLM_MODEL_ALIASES` are shown instead of the real model name.

The server only honours a model the browser picks if it is in the allow-list (`VLM_MODEL`, `VLM_MODEL_OPTIONS` and the local models).

## Configuration

There are two example files: `.env.example` (cloud and local models, YOLO, demo clips) and `.env.local.example` (owner alerts and the watch agent, plus a short model block). Copy what you need into `.env.local` (git-ignored) and restart the dev server after any change. Never commit or print its values. The table below is the full list, including a few variables that are in neither example file (`LOCAL_SCORER_API_KEY`, `DEMO_EXCLUDED_DIR`, `DETECTION_SERVICE_URL`, `SENDGRID_API_BASE`, `NEXT_PUBLIC_DEMO_SAMPLES`):

| Group | Variables |
|---|---|
| Cloud model | `VLM_BASE_URL`, `VLM_API_KEY`, `VLM_MODEL`, `VLM_MODEL_OPTIONS`, `VLM_MODEL_ALIASES`, `VLM_CHAT_MODEL`, `VLM_EXTRA_BODY` |
| Local models (GB10) | `LOCAL_VLM_BASE_URL`, `LOCAL_VLM_MODELS`, `LOCAL_VLM_EXTRA_BODY`, `LOCAL_SCORER_BASE_URL`, `LOCAL_SCORER_MODELS`, `LOCAL_SCORER_API_KEY` |
| YOLO boxes and joints | `YOLO_BASE_URL` |
| Owner alerts | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_FROM`, `ALERT_OWNER_NUMBER`, `SENDGRID_API_KEY`, `ALERT_EMAIL_FROM` |
| Alert policy | `ALERT_MIN_SEVERITY`, `ALERT_MAX_PER_HOUR`, `ALERT_REVIEW_BASE`, `ALERT_API_TOKEN`, `ALERT_ALLOW_CLIENT_RECIPIENT`, `TWILIO_API_BASE`, `SENDGRID_API_BASE` (test sandboxes) |
| Watch agent | `WATCH_AGENT_TOKEN`, `WATCH_DATA_DIR` |
| Demo clips | `DEMO_CLIPS_DIR`, `DEMO_EXCLUDED_DIR` |
| Other | `DETECTION_SERVICE_URL`; `NEXT_PUBLIC_DEMO_SAMPLES=1` turns on simulated samples (the e2e tests set it) |

The server code that reads them: `lib/server/vlm-config.ts` (models), `lib/server/yolo.ts`, `lib/server/alerts.ts`, `lib/server/watch-log.ts` and `lib/server/demo-clips.ts`. Without any model configured, uploads save but are not analysed.

## Running

```bash
npm install
cp .env.example .env.local        # models; add alert and watch-agent lines from .env.local.example
npm run dev                        # http://localhost:3000, binds all interfaces
npm run lint && npm run typecheck  # before every commit
```

| Command | What it does |
|---|---|
| `npm run build` / `npm start` | Production build and server. |
| `npm run test:e2e` | Playwright against port 3000, reusing a server that already answers. First run `npx playwright install chromium`. |
| `npm run test:e2e:ci` | Owns its servers on port 3100 (builds into `.next-e2e/`) and points Twilio at `tests/fake-twilio.mjs`, so alert tests cost nothing. Restore `next-env.d.ts` afterwards with `git checkout next-env.d.ts`. Set `PW_CHROMIUM_PATH` if Chromium is outside Playwright's cache. |
| `npx --no-install jiti scripts/vlm-benchmark.ts frames\|run\|score` | Model bake-off using the app's own analysis code. |
| `python3 scripts/generate-samples.py` | Regenerate the synthetic sample WebMs (needs Pillow and ffmpeg). |

The GB10's system Node is v18, so run `.ts` scripts with `npx --no-install jiti <file.ts>`, not `node`. Opened by IP over plain HTTP, the browser is not a secure context: the webcam on `/live` needs `localhost` (for example through a port forward).

### Local model serving

- **VLM on the GB10:** the `zrt serve` command for Qwen3-VL-30B-A3B is in [model/README.md](../model/README.md#serving-on-the-gb10). zrt's proxy answers on `http://127.0.0.1:8080/v1`; set `LOCAL_VLM_BASE_URL` to it and list the served label in `LOCAL_VLM_MODELS`.
- **YOLO:** run `model/YOLO/src/yolo_server.py` in the `kryptonx-yolo` container (command in [model/README.md](../model/README.md#serving-on-the-gb10); a laptop option is in the script's docstring) and set `YOLO_BASE_URL=http://127.0.0.1:8090`.
- The GB10 is shared. Run one large model at a time and stop services you no longer need.

## Guardrails

- Samples and their annotations are always labelled simulated. Uploads only get detections from a real model run, labelled AI-suspected with the model name and confidence. The AI summary and the watch agent leave simulated samples out.
- Incidents are "suspected" until a person reviews them.
- Owner SMS is opt-in, capped per hour, deduplicated per detection, and prefixed `[SIMULATED]` for sample footage (`lib/server/alerts.ts`).
- The 911 call panel (`components/call-center.tsx`) is simulated for the demo. No real call is placed.
- A reading we cannot take is shown as unavailable with the reason, never as zero.
- No credentials in browser code. Keys live in `.env.local` and are read only in `app/api` and `lib/server`. Only sampled frames leave the browser.
- E2E tests never call a real model; they mock `/api/model`, `/api/analyze` and `/api/chat`.

## Project structure

| Path | Contents |
|---|---|
| `app/` | Pages (client components; state lives in the browser) and `app/api/` server routes. |
| `components/` | `app-provider.tsx` (the single client store, via `useApp()`), `shell.tsx` (sidebar and nav), `ui.tsx` (shared primitives), `watch-briefing.tsx`, `live-run.tsx`, `call-center.tsx` and others. |
| `lib/` | Browser-side logic: `detection-client.ts`, `analytics.ts` (all counts, charts and CSV), `storage.ts` (IndexedDB), `types.ts`, `watch-types.ts`. |
| `lib/vlm/` | Prompts, parsing, merging and box tracking, shared with the benchmark script. |
| `lib/server/` | Server-only: model config, YOLO client, telemetry, inference stats, alerts, watch log and MCP tools. Never import from a `"use client"` file. |
| `scripts/` | Bake-off benchmark and sample generator. |
| `tests/` | Playwright specs (`workflows.spec.ts`, `alerts.spec.ts`) and the fake Twilio server. |

More: [CLAUDE.md](CLAUDE.md) (conventions and UI rules), [data contract](../docs/data-contract.md), [model bake-off](../model/openrouter-bakeoff/README.md), watch agent plan (`webapp/.plans/hermes-watch-agent.md`, a local plan not in the repo). Finished plans were removed; they are in git history.
