# Model backend integration (HawkWatch parity with open models)

Status: done 2026-09-24 (OpenRouter). Next: switch to local inference on the GB10.

## Context
The web app had no backend: uploads were never analysed, and the assistant and summary were canned. HawkWatch (Treehacks2025) sends frames to Gemini, runs a GPT assistant and summary, and has a live webcam page. For the hackathon, inference must run on one HP ZGX Nano (GB10, 128 GB). We therefore:
- added a server backend that talks to any OpenAI-compatible endpoint (OpenRouter now, a local vLLM/SGLang/llama.cpp server on the GB10 later), switched by environment variables only;
- benchmarked 12 open models that fit the GB10, plus a Gemini/HawkWatch baseline, with the app's own analysis code. Results and recommendation: [model/openrouter-bakeoff/README.md](../../model/openrouter-bakeoff/README.md).

Decisions:
- Analysis unit: a window of 4 frames every 8 s (1 per 2 s). Consecutive windows with the same category merge into one detection with a time range.
- Frames are sampled in the browser (canvas) and sent to `/api/analyze`, so video files stay in IndexedDB and the API key stays on the server.
- Model detections are always labelled AI-suspected, with the model name and confidence. Samples stay simulated. The AI summary covers analysed uploads only.
- New categories "Fighting" and "Vandalism", which HawkWatch detects.
- Email/SMS alerts and accounts stay deferred (roadmap phase 2). Live alerts are in-app toasts only.

## Steps
1. `lib/vlm/analysis.ts`: window plan, prompt, JSON extraction/validation, merge. `lib/vlm/client.ts`: OpenAI-compatible client with retries and cost. Both free of runtime imports, so Node scripts can reuse them.
2. `lib/server/vlm-config.ts` + routes `app/api/model`, `app/api/analyze`, `app/api/chat`, `app/api/summary`. Config: `VLM_BASE_URL`, `VLM_API_KEY`, `VLM_MODEL`, optional `VLM_CHAT_MODEL` and `VLM_EXTRA_BODY`.
3. `lib/detection-client.ts`: browser frame capture, windowed analysis with 3 requests in flight, progress and cancel, assistant and summary calls, and `useModelStatus`.
4. Types: `Detection.endSeconds/confidence/model`, `VideoRecord.analysisModel/analysisError/moments`.
5. UI:
   - Video page: AI analysis panel (run, progress, cancel, errors), time-range timeline bars, boxes shown over the range, scene log, multi-turn AI assistant.
   - Upload page: "Run AI analysis after saving".
   - Analytics page: "Generate AI summary".
   - Header badge; Settings model panel.
6. `app/live`: webcam or replay of a library recording as a camera. Analyses every 8 s, shows an incident feed and alert toasts, and saves webcam captures with their detections.
7. `scripts/vlm-benchmark.ts`: `frames` / `run` (with `--pipeline hawkwatch` and `--repeat`) / `score` (clip, window, timing, cross-validated cut-off). Data from `model/openrouter-bakeoff/fetch_data.py`.

## Verification
- `npm run lint && npm run typecheck && npm run build`. No `sk-or` string in `.next/static`.
- `npm run test:e2e`: the existing tests run with `/api/model` mocked to "not configured"; a new test covers the full AI flow with mocked analyze and chat routes.
- Manual run with a real model (Nemotron via OpenRouter) in Chrome:
  - upload HawkWatch `Robbery3.mp4` → auto analysis → "Suspected robbery 00:19–00:24, 95%";
  - scene log, assistant citing [00:16] with safety steps;
  - results survive reload;
  - AI summary of analysed uploads only;
  - live replay feed and webcam capture saved.
- Benchmark: see the bake-off README.

## Next
- Serve the chosen model on the GB10, set `VLM_BASE_URL`, and re-run `scripts/vlm-benchmark.ts` locally to confirm accuracy and speed after quantization.
- Remaining UI parity items in [hawkwatch-ui-parity.md](hawkwatch-ui-parity.md) (camera wall, box interpolation, loading states).
