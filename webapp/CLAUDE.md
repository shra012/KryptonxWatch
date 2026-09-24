# KryptonxWatch web app

Next.js 15 dashboard for reviewing recorded security video. It has a local demo data layer only: no real detection, and live views are simulated or preview-only until a service connects. Another team builds the models; they integrate through [the data contract](../docs/data-contract.md). Roadmap: [webapp-roadmap.md](.plans/webapp-roadmap.md).

## Planning context
Before planning or changing the web app, read the recent plans in `.plans/` and use them alongside this guidance and the data contract. Keep the relevant plan there up to date when scope or decisions change. Save every new plan to `.plans/<topic>.md` with Context, ordered steps and Verification.

## Commands
- `npm run dev`: http://localhost:3000
- `npm run lint` / `npm run typecheck` / `npm run build`
- `npm run test:e2e`: Playwright; first run `npx playwright install chromium`
- `python3 scripts/generate-samples.py`: regenerate synthetic sample WebMs (needs Pillow, ffmpeg)

## Where things live
- `app/`: pages: `/` overview, `/upload`, `/videos`, `/videos/[id]` (player, timeline, boxes, assistant), `/detections`, `/analytics`, `/settings`. Pages are client components because state lives in the browser.
- `components/app-provider.tsx`: the single client store. Read and write videos, review status, theme and toasts through `useApp()` only.
- `components/ui.tsx`: shared primitives (`PageTitle`, `Panel`, `SeverityBadge`, `StatusBadge`, `EmptyState`, `EventTime`). Reuse or extend them before writing new ones.
- `components/shell.tsx`: sidebar and mobile nav. Register new pages in `nav`.
- `lib/types.ts`: domain types and the `DetectionService` / `AssistantService` integration points.
- `lib/analytics.ts`: all counts, chart data and CSV. `lib/storage.ts`: IndexedDB. `lib/demo.ts`: simulated samples.

## UI rules
- Tailwind 4 + daisyUI 5 classes, `lucide-react` icons, Recharts for charts. Ask before adding a UI library.
- Light and dark themes via `data-theme`. Use daisyUI semantic colours (`base-*`, `primary`, `error`, …), not raw hex, and check both themes.
- Page structure: `PageTitle`, then content in `Panel`s. Works at 375px wide with no horizontal scroll; wrap tables in `overflow-x-auto`.
- Every list or chart handles loading, empty (`EmptyState`) and error states. Errors use `role="alert"` and say how to fix the problem.
- Show severity and review status only through `SeverityBadge` / `StatusBadge` so colours stay consistent.
- Everything is keyboard reachable. Icon-only buttons and unlabelled inputs get `aria-label`.
- Link to an event moment as `/videos/{id}?t={seconds}`.

## Product guardrails
- Samples and their annotations are always labelled simulated. Uploads never get invented detections.
- Incidents are "suspected" until a human reviews them. Queue tracking is a measurement, not an incident.
- Totals, charts and CSV all derive from provider state via `lib/analytics.ts`.
- Uploads and review decisions survive reload. Revoke object URLs you create.
- No credentials or API keys in browser code. Backends plug in behind the service interfaces without changing UI types.

## Before finishing
Run `npm run lint && npm run typecheck`. Run `npm run test:e2e` when changing upload, review, detections, analytics or storage. Update selectors in `tests/workflows.spec.ts` if visible labels change.

## Git
Never add Claude as a co-author (`Co-Authored-By`) or "Generated with Claude Code" lines to commits or PRs.
