# HawkWatch UI parity and improvement plan

Status: approved 2026-09-24 · not started. Update this line as phases complete.

## Context
The KryptonxWatch web app should cover every UI capability of HawkWatch (github.com/Grace-Shao/Treehacks2025) and improve on it. The models are built by another team, so this plan covers only the UI. Where a feature needs a model, the UI is built against the service interfaces and clearly marked as simulated or not connected.

User decisions:
- **Live view:** build a simulated camera wall from the sample videos, plus a webcam capture page. Neither runs live analysis until the model service connects.
- **Auth and email/phone alerts:** deferred to the backend phase. For now, build only an in-app notification centre and an alert-rules UI.
- **Plans location:** always saved in `webapp/.plans/`.

---

## Gap matrix (HawkWatch UI → ours)

| HawkWatch UI | Ours today | Verdict |
|---|---|---|
| Landing hero with particles | Goes straight to the overview | Skip. An internal tool doesn't need a landing page; add a first-run welcome in the empty state instead |
| Header nav (4 links) | Sidebar and mobile nav, 6 pages | ✅ Better |
| Theme: light, dark and system | Light and dark only | Gap: add a System option |
| Route progress bar (NProgress) | None | Gap: `loading.tsx` skeletons and a top progress bar |
| Multi-camera wall (grid, hover dims the other tiles, location overlay, status icons) | None | **Gap: Monitor page** |
| Camera modal (enlarged feed, boxes, incident pill, clock) | None | **Gap** |
| Live incident feed (animated, "Xs ago", icon per type, Dismiss, Alert security) | Static "Recent detections" list | **Gap** |
| Camera stats (total and online) | None | Gap |
| "Calling security" modal | None | Gap: escalation dialog, labelled simulated |
| Webcam page (start/stop, REC indicator, face/pose overlay, transcript, save) | None | **Gap: Capture page** (overlays wait for models) |
| Upload with automatic analysis and a progress bar | Upload with no analysis | Partial: show analysis job states driven by `DetectionService` |
| Library (grid, search, hover zoom, delete) | Search, filter, sort, confirm delete | ✅ Better. Gaps: thumbnails for uploads, hover preview |
| Timeline (event length bars, tick labels, playhead, hover tooltip) | Point markers only | Gap |
| Per-frame bounding boxes | One static box shown within ±2s of the event | Gap: interpolate between keyframes |
| Key moments list (danger/safe colours, expand long text) | Detection cards with review actions | Mostly ✅. Gap: expandable descriptions |
| Download MP4 | None | Gap |
| Floating chat with history | One-question panel on the video page only | Gap |
| Statistics (3 charts, sortable table, CSV, AI summary) | 4 charts, table, CSV, demo summary | Mostly ✅. Gaps: sortable column headers, time-of-day chart |
| Sign-in/sign-up, email alerts | None | Deferred (backend phase) |

Where we are already ahead: review workflow (reviewed/dismissed), filters, IndexedDB storage (their blob URLs in localStorage break on reload), safe CSV quoting, accessibility, both themes, Playwright tests, and honest "simulated" labelling.

---

## Build sequence

Each phase must be complete before the next one starts. Reuse `PageTitle`, `Panel`, `SeverityBadge`, `StatusBadge`, `EmptyState` and `EventTime` from `components/ui.tsx`, and `allDetections`, `counts` and `downloadCsv` from `lib/analytics.ts`. No new UI libraries: daisyUI `modal`, `dropdown`, `tooltip`, `progress` and `skeleton` cover everything, and animation is CSS only.

### Phase 0: Foundations and bug fixes
1. **Formatting.** Add Prettier as a dev dependency with an `npm run format` script and run it once in a standalone commit. The current one-line files are unreviewable.
2. **URL filters.** `app/detections/page.tsx` should read `category`, `severity`, `status` and `video` from the URL with `useSearchParams` (wrapped in `Suspense`) and write filter changes back with `router.replace`. The overview's "High priority" link should use `severity=high,critical`.
3. **Shared filtering and sorting.** Move the filter and sort logic repeated across the detections, analytics and overview pages into `lib/analytics.ts` as `filterDetections(rows, filters)` and `sortDetections(rows, key)`. Remove analytics' own copy of the severity order.
4. **Storage.** In `lib/storage.ts`, split IndexedDB into a `videos` store (metadata) and a `blobs` store (video files), with DB version 2 and a migration. Load a video file only when `/videos/[id]` needs it. Review updates then no longer rewrite the file.
5. **Review update race.** In `components/app-provider.tsx`, make `setReviewStatus` compute its result from the latest state (functional `setVideos`) and persist only the metadata.
6. **Aspect ratio.** In `app/videos/[id]/page.tsx`, store the video dimensions in state on `loadedmetadata` instead of reading the ref during render.
7. **Deleted samples.** Add "Restore sample recordings" to Settings. It clears `kryptonxwatch-hidden-samples`.
8. **Type prep for later phases** in `lib/types.ts`:
   - `Camera { id, name, location, videoPath, status }`
   - Optional on `Detection`: `endSeconds`, `confidence`, `keyframes: {seconds, box}[]`
   - `VideoRecord.thumbnail?: Blob`

   These mirror `docs/data-contract.md`. Update the samples in `lib/demo.ts`, including a simulated keyframe path for each detection.

### Phase 1: Video review (match HawkWatch, then do better)
1. **`components/timeline.tsx`.** Events drawn as bars (start to end), colour by category, tick labels, a moving playhead, tooltips on hover and focus, and click to seek. Arrow keys move between events. Replace the inline timeline in `app/videos/[id]/page.tsx`.
2. **`components/box-overlay.tsx`.** Interpolate the box between keyframes at the current playback time, show the label chip, and fade outside the event. Use it on the review page and on camera tiles.
3. **Expandable descriptions.** Long text in the detection cards gets a "show more" toggle using `line-clamp`.
4. **Download.** A "Download video" button: the object URL for uploads, the file path for samples.
5. **Thumbnails for uploads.** Capture one frame at about 10% of the duration on upload (canvas → JPEG `Blob`), store it, and show it in the library grid. Hover-to-preview (muted autoplay) on library cards.

### Phase 2: Monitor page (simulated camera wall)
1. **Demo cameras.** Add `sampleCameras` to `lib/demo.ts`, 4–6 cameras that loop the sample WebMs, each with a zone name and status. Include one offline tile to show that state.
2. **`app/monitor/page.tsx`.** Register it in `nav` in `components/shell.tsx` with an icon such as `MonitorPlay`. A responsive grid of `CameraTile` components; hovering one dims the others. A "Simulated feeds" badge.
3. **`components/camera-tile.tsx`.** A muted looping video with the box overlay, name and zone, a status dot, a clock, and a red pulse border while a detection's time range is playing.
4. **Camera modal.** An enlarged feed in a daisyUI `<dialog class="modal">`, time-synced to the tile, with an incident pill and prev/next camera navigation.
5. **Incident feed sidebar.** As the loops pass detection timestamps, push cards (newest first, capped at 20) with a category icon, "Xs ago", the camera name, and Dismiss / Open / Escalate. Cards slide in with CSS, except under `prefers-reduced-motion`. Hovering a card highlights its tile.
6. **Stats strip.** Cameras online/total, events in the last 5 minutes, and number of unreviewed events.
7. **Escalation dialog.** A step-by-step checklist chosen by category (for example gun → lockdown steps; medical → call emergency services). It closes by logging an "escalated" note on the detection. Labelled "Simulated — no one is contacted".

### Phase 3: Capture page (webcam)
1. **`app/capture/page.tsx`.**
   - Camera and microphone device pickers (`enumerateDevices`).
   - A permission prompt with an error state that explains how to fix it.
   - Live preview, then Start/Stop recording (`MediaRecorder` → WebM), a REC indicator and an elapsed timer.
2. **Saving.** After stopping: a preview, a name field and "Save to library". Saving reuses the upload save path (`saveVideo`) with `source: "upload"` and `analysis: "not_analyzed"`.
3. **Optional transcript panel.** Uses the browser Web Speech API where it's available (Chrome); otherwise hidden with a note. The transcript is stored on the record, and it's real speech-to-text, not an invented finding.
4. **Overlay placeholder.** "Live detection overlay: connect the model service". No fake boxes.

### Phase 4: Assistant, analytics and polish
1. **`components/assistant-drawer.tsx`.** A floating button that opens a daisyUI drawer on every page. It keeps the conversation history and uses the current page as context (a video, or the whole workspace). Timestamp chips seek the video or deep-link to it. Replace the panel on the video page and keep `demoAssistantService`, extending its interface with `history`.
2. **Analytics.**
   - Sortable column headers in both tables.
   - A time-of-day × weekday heatmap and incidents by camera.
   - Chart colours from daisyUI theme variables, not hex.
   - An "AI summary" card that uses `AssistantService` (demo text for now).
3. **Theme.** Add a System option (`prefers-color-scheme`) to Settings and the header toggle.
4. **Loading states.** A `loading.tsx` skeleton for each page, and a thin top progress bar on route change.

### Phase 5: Analysis job UX (ready for the model team)
1. **Upload and video pages.** Show `AnalysisStatus` as an explicit state: Not analysed → Queued → Processing (progress) → Complete / Failed, with a "Run analysis" button that calls `DetectionService.analyze`.
2. **Current behaviour.** The demo service throws "not connected", so the UI shows the Failed state with guidance. Uploads never get invented detections.
3. **Swapping in the real service.** It's a one-file change in `lib/demo.ts`, or a new `lib/detection-client.ts`. Match the payload shape in `docs/data-contract.md`.

### Phase 6: Beyond HawkWatch
1. **Review inbox** (`/detections?mode=review`). One detection at a time with its clip auto-playing, and shortcuts `J/K` (move), `C` (confirm), `D` (dismiss with reason), `W` (wrong category).
2. **Verdict model.** Extend `ReviewStatus` with a reason and a corrected category (matching `ReviewVerdict` in the data contract), and add a CSV/JSON export for the model team.
3. **Evidence packet.** A printable page (`/videos/[id]/evidence/[detectionId]`) with keyframe stills, box, timestamps, reviewer notes and a SHA-256 of the file (`crypto.subtle`). Printed with `window.print` and print CSS.
4. **Notification centre.** A bell in the header listing escalations and new high-severity events, plus an alert-rules panel in Settings (category × severity → in-app / sound). Email and SMS stay deferred.

### Deferred (backend phase)
Sign-in and accounts, email/phone alerts, real streaming and live model overlays. See `.plans/webapp-roadmap.md`.

---

## Critical files
- New: `components/timeline.tsx`, `box-overlay.tsx`, `camera-tile.tsx`, `assistant-drawer.tsx`; `app/monitor/`, `app/capture/`; `loading.tsx` files.
- Changed: `lib/types.ts`, `lib/demo.ts`, `lib/storage.ts`, `lib/analytics.ts`, `components/app-provider.tsx`, `components/shell.tsx`, `app/videos/[id]/page.tsx`, `app/detections/page.tsx`, `app/analytics/page.tsx`, `app/settings/page.tsx`, `CLAUDE.md`.

## Verification (every phase)
- `npm run lint && npm run typecheck && npm run build`.
- Extend `tests/workflows.spec.ts` for each phase:
  - URL filters apply
  - review survives reload
  - timeline seek and tooltip
  - Monitor: tile opens the modal; the feed receives an event
  - Capture: uses Chromium's fake device (`--use-fake-device-for-media-stream`); record → save → appears in the library
  - assistant history
  - print view renders
- Manual: light and dark themes, 375px width with no horizontal scroll, keyboard-only pass on the new pages, `prefers-reduced-motion`.
- Guardrail check: uploads and captures show no detections, and every simulated surface carries a label.
