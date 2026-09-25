# Sentinel Machines web app

Next.js 15 dashboard for reviewing security video. A vision-language model behind `app/api/*` (any OpenAI-compatible endpoint: OpenRouter now, a local server on the GB10 later) analyses uploads and live feeds. Without a model configured, the app runs in demo mode. Another team builds the fine-tuned models; they integrate through [the data contract](../docs/data-contract.md). Roadmap: [webapp-roadmap.md](.plans/webapp-roadmap.md). Model choice: [bake-off](../model/openrouter-bakeoff/README.md).

## Planning context
Before planning or changing the web app, read the recent plans in `.plans/` and use them alongside this guidance and the data contract. Keep the relevant plan there up to date when scope or decisions change. Save every new plan to `.plans/<topic>.md` with Context, ordered steps and Verification.

## Commands
- `npm run dev`: http://localhost:3000. Model config lives in `.env.local` (see `.env.example`); restart after changing it.
- `npm run lint` / `npm run typecheck` / `npm run build`
- `npm run test:e2e`: Playwright against port 3000, reusing whatever already answers
- `npm run test:e2e:ci`: owns its servers on port 3100 (building into `.next-e2e/`, so a dev server on 3000 keeps working) and points Twilio at `tests/fake-twilio.mjs`, so alert tests never spend credit. It repoints the generated `next-env.d.ts` at `.next-e2e`; restore it with `git checkout next-env.d.ts`. Use this where port 3000 belongs to something else (the ZGX). Set `PW_CHROMIUM_PATH` if Chromium lives outside Playwright's cache.
- `python3 scripts/generate-samples.py`: regenerate synthetic sample WebMs (needs Pillow, ffmpeg)

## Where things live
- `app/`: pages: `/` landing page (no sidebar; `Shell` skips it), `/overview` console overview, `/upload`, `/videos`, `/videos/[id]` (player, timeline, boxes, assistant), `/detections`, `/analytics`, `/system` (edge node telemetry), `/settings`. Pages are client components because state lives in the browser.
- `npm run test:e2e`: Playwright; first run `npx playwright install chromium`
- `node scripts/vlm-benchmark.ts frames|run|score`: model bake-off using the app's analysis code (data from `../model/openrouter-bakeoff/fetch_data.py`)
- `python3 scripts/generate-samples.py`: regenerate synthetic sample WebMs (needs Pillow, ffmpeg)

## Where things live
- `app/`: pages: `/` landing page (no sidebar; `Shell` skips it), `/overview` console overview, `/upload`, `/live` (webcam or replay feed with live analysis), `/videos`, `/videos/[id]` (player, AI analysis, timeline, boxes, scene log, assistant), `/detections`, `/analytics`, `/settings`. Pages are client components because state lives in the browser.
- `app/api/`: server routes `model`, `analyze` (one window of frames), `chat`, `summary`. They are the only code that reads `VLM_*` env vars (via `lib/server/vlm-config.ts`).
- `lib/vlm/`: prompt, parsing and merging (`analysis.ts`), assistant/summary prompts (`assistant.ts`), OpenAI-compatible client (`client.ts`). No runtime imports, so the benchmark script shares them.
- `lib/detection-client.ts`: browser side: frame capture, windowed analysis, assistant and summary calls, `useModelStatus()`.
- `components/app-provider.tsx`: the single client store. Read and write videos, review status, theme and toasts through `useApp()` only.
- `components/ui.tsx`: shared primitives (`PageTitle`, `Panel`, `SeverityBadge`, `StatusBadge`, `EmptyState`, `EventTime`). Reuse or extend them before writing new ones.
- `components/shell.tsx`: sidebar and mobile nav. Register new pages in `nav`.
- `lib/types.ts`: domain types and the `DetectionService` / `AssistantService` integration points.
- `lib/analytics.ts`: all counts, chart data and CSV. `lib/storage.ts`: IndexedDB. `lib/demo.ts`: simulated samples.
- `lib/server/`: server-only modules. `telemetry.ts` reads nvidia-smi and `/proc`; `alerts.ts` holds the Twilio call and the alert policy. Never import these from a `"use client"` file — the browser talks to `/api/system` and `/api/alerts` instead, through `components/use-telemetry.ts` and `lib/alert-client.ts`.
- Secrets live in `webapp/.env.local` (git-ignored). `.env.local.example` lists every variable and what it does.

## UI rules
- Tailwind 4 + daisyUI 5 classes, `lucide-react` icons, Recharts for charts. Ask before adding a UI library.
- The look is a flat instrument console, not a card grid: sections are a mono label, a hairline and content (`Panel`), figures sit in hairline-ruled grids, and consequence is a rule in the margin (`Notice`) rather than a tinted callout box. Do not reintroduce `alert alert-*` boxes or rounded shadow cards.
- The palette is monochrome: dark is pitch black, light is paper. Amber and red are the only hues and are reserved for genuine attention and alarm — never decoration, and never to rank a severity. Do not add an accent hue.
- Type is Geist (sans) for prose, headings and controls, Geist Mono for anything read as data (figures, timecodes, identifiers, small uppercase labels). Both load via `next/font` in `app/layout.tsx`. Keep letter-spacing on uppercase labels at or under `.08em`; corners are soft (`rounded-lg` controls, `rounded-xl` framed groups).
- Severity and review state are typographic (`SeverityBadge` / `StatusBadge`): a swatch from the achromatic severity ramp plus the word. No coloured pills.
- Small live readings use the SVG primitives in `components/ui.tsx` (`Gauge`, `Sparkline`, `Meter`, `Readout`, `Unavailable`), not Recharts.
- Light and dark themes via `data-theme`. Use daisyUI semantic colours (`base-*`, `primary`, `error`, …), not raw hex, and check both themes.
- Page structure: `PageTitle`, then content in `Panel`s. Works at 375px wide with no horizontal scroll; wrap tables in `overflow-x-auto`.
- Every list or chart handles loading, empty (`EmptyState`) and error states. Errors use `role="alert"` and say how to fix the problem.
- Show severity and review status only through `SeverityBadge` / `StatusBadge` so colours stay consistent.
- Everything is keyboard reachable. Icon-only buttons and unlabelled inputs get `aria-label`.
- Link to an event moment as `/videos/{id}?t={seconds}`.

## Product guardrails
- Samples and their annotations are always labelled simulated. Uploads never get invented detections.
- A reading we cannot take is shown as unavailable with the reason, never as a zero. This holds for telemetry as much as for detections.
- Owner SMS is opt-in, capped, deduplicated per detection, and prefixed `[SIMULATED]` when it comes from sample footage.
- Samples and their annotations are always labelled simulated. Uploads only get detections from a real model run, labelled AI-suspected with model name and confidence. The AI summary excludes simulated samples.
- Incidents are "suspected" until a human reviews them. Queue tracking is a measurement, not an incident.
- Totals, charts and CSV all derive from provider state via `lib/analytics.ts`.
- Uploads and review decisions survive reload. Revoke object URLs you create.
- No credentials or API keys in browser code: keys live in `.env.local` and are read only in `app/api`. Only sampled frames leave the browser.
- E2E tests never call a real model: `tests/workflows.spec.ts` mocks `/api/model` (and `/api/analyze`, `/api/chat` where needed).

## Before finishing
Run `npm run lint && npm run typecheck`. Run `npm run test:e2e` when changing upload, review, detections, analytics or storage. Update selectors in `tests/workflows.spec.ts` if visible labels change.

## Git
Never add Claude as a co-author (`Co-Authored-By`) or "Generated with Claude Code" lines to commits or PRs.
