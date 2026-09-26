# Sentinel Machines web app

The Next.js 15 / React 19 dashboard for recorded-video analysis, live monitoring, incident review, and operational analytics. Styling uses Tailwind CSS 4 and daisyUI 5. Model calls and integration credentials stay on the server.

## Install and run

From this directory:

```bash
npm ci
test -f .env.local || cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`. Keep existing `.env.local` values when updating configuration; this file is ignored by Git. Restart the development server after changing environment variables.

For a production build:

```bash
npm run build
npm run start
```

## Configure inference

Use the endpoint and served name for the intended deployment. For the team's GB10 service:

```dotenv
VLM_BASE_URL=http://127.0.0.1:8080/v1
VLM_MODEL=qwen3-vl-30b-a3b
LOCAL_VLM_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_VLM_MODELS=qwen3-vl-30b-a3b
```

`VLM_BASE_URL` and `VLM_MODEL` establish the default model. `LOCAL_VLM_*` adds explicitly local options to Settings as `local-vlm:<served-name>`. Setting only `LOCAL_VLM_*` does not configure the default `/api/model` response in the current implementation; keep the default pair above configured too.

The project model is [Sentinel Machines v1](../model/sentinel-machines-v1/README.md). A configured service label or UI alias must resolve to the correct deployed weights; changing the label does not fine-tune or load a model.

| Variables | Purpose |
| --- | --- |
| `VLM_BASE_URL`, `VLM_MODEL`, `VLM_API_KEY` | Default OpenAI-compatible model endpoint, name, and optional authentication |
| `VLM_CHAT_MODEL` | Optional separate assistant / summary model |
| `VLM_MODEL_OPTIONS`, `VLM_MODEL_ALIASES` | Allowed choices and display aliases |
| `VLM_EXTRA_BODY` | Additional request options as JSON |
| `LOCAL_VLM_BASE_URL`, `LOCAL_VLM_MODELS`, `LOCAL_VLM_EXTRA_BODY` | Local general-model options and request settings |
| `LOCAL_SCORER_BASE_URL`, `LOCAL_SCORER_MODELS`, `LOCAL_SCORER_API_KEY` | Legacy yes/no scorer; the key is also used for explicitly local general models |
| `YOLO_BASE_URL` | Optional person detection and pose service, usually `http://127.0.0.1:8090` |
| `WATCH_AGENT_TOKEN` | Enables the watch feed and authenticates agent access |

The local scorer is recorded-video only. It uses 16 frames per eight-second clip and requires `ffmpeg` on the app server. Its assistant and summaries use the configured chat model. See the [Qwen3.8 guide](../model/Qwen3.8-27B-INT4/README.md).

For hosted comparisons, configure an OpenRouter base URL and model, supplying the API key privately. Sampled frames then leave the local machine. Full optional notification and watch settings are listed in [.env.local.example](.env.local.example); never put credentials in client code.

## Pages

| Route | Workflow |
| --- | --- |
| `/` | Product landing page |
| `/overview` | Console overview and watch briefings |
| `/upload` | Add a recording |
| `/live` | Webcam or replay monitoring |
| `/videos`, `/videos/[id]` | Library, player, timeline, scene log, and contextual assistant |
| `/detections` | Review queue |
| `/analytics` | Counts, charts, exports, and model comparisons |
| `/system` | Edge-node telemetry |
| `/settings` | Model and application preferences |

Video records and reviews persist in browser IndexedDB. Samples remain labelled simulated. Real uploads receive detections only from an actual analysis run. Emergency-call responses in the demo are simulated; owner notifications can be real when enabled.

## Code map

- [app/api](app/api): server routes for analysis and integrations.
- [components/app-provider.tsx](components/app-provider.tsx): application state; use `useApp()` to access it.
- [components/ui.tsx](components/ui.tsx): shared visual primitives.
- [lib/vlm](lib/vlm): analysis, prompts, parsing, and OpenAI-compatible client.
- [lib/server](lib/server): server configuration, telemetry, notifications, and watch feed.
- [lib/types.ts](lib/types.ts): application records and domain types.
- [tests](tests): Playwright workflows and fake notification service.

## Verification

```bash
npm run lint
npm run typecheck
npm run test:e2e:ci
```

The isolated E2E configuration uses port 3100 and `.next-e2e/`; model requests are mocked and notification tests use a fake service. Install the test browser with `npx playwright install chromium` if needed, or set `PW_CHROMIUM_PATH` to an existing compatible Chromium binary. Inspect `next-env.d.ts` after E2E runs because Next.js can update its generated build-directory reference.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Model is not configured | Set the default endpoint and model pair, restart, then inspect `/api/model` |
| Local inference fails | Confirm the service is running and that its `/v1/models` includes the requested served name |
| Boxes are unavailable | Confirm YOLO health; the VLM may also omit a box when uncertain |
| Webcam is unavailable over a LAN IP | Use HTTPS or forward the app to `localhost`; browsers require a secure context |
| Uploads disappear in another browser | Recordings are stored in the original browser's IndexedDB |
| Hermes briefings do not appear | Check the token, restart after setup, and inspect the [Hermes guide](../ops/hermes/README.md) |

See the [API contract](../docs/api/README.md), [architecture](../docs/architecture/README.md), and [operations guide](../ops/README.md).
