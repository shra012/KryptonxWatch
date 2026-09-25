# Dashboard refresh, edge telemetry and owner SMS alerts

## Context
Three goals, in order:

1. **A dashboard that looks its own.** The current shell is close to the HawkWatch
   parity work in [hawkwatch-ui-parity.md](hawkwatch-ui-parity.md). We want a
   distinct, more sophisticated look: our own light/dark theme pair, a grouped
   sidebar, and a live edge-node chip in the header.
2. **A live Edge node page** (`/system`) in the spirit of the ZGX console MVP
   dashboard: gauges, sparklines, GPU process table. The box is an HP ZGX Nano
   (GB10, ARM, 128 GB unified memory) and all inference runs there.
3. **Owner SMS alerts through Twilio** so a shop owner is texted when a detection
   lands, not only when somebody is watching the screen.

Constraints that shape all three:
- `webapp/CLAUDE.md` rules hold: daisyUI semantic colours, no new UI libraries
  without asking, no credentials in browser code, keep visible labels the
  Playwright tests match on.
- Telemetry is read on the server only. The browser never shells out.
- Themes stay addressed as `data-theme="light"` / `"dark"` — the e2e test asserts
  those exact values — so the new palettes are defined *as* `light` and `dark`.

## Colour language
Teal is "all clear", amber is "attention", red stays for critical. Severity keeps
going through `SeverityBadge` / `StatusBadge`, so only the theme tokens change.

## Steps

### 1. Theme and shell
1. Define custom daisyUI 5 themes named `light` and `dark` in `app/globals.css`
   (teal primary, amber warning, deep slate dark base). No raw hex outside the
   theme block and the existing video-overlay rules.
2. Geist / Geist Mono through `next/font/google`, with a system-font fallback so
   an offline build still works.
3. `components/shell.tsx`: group the sidebar into Monitor / Library / System,
   add the `/system` entry, and put a live telemetry chip in the header.

### 2. Edge telemetry
1. `lib/telemetry-types.ts`: the shape the API returns. Every reading is
   nullable — an unreadable sensor is `null`, never a guess.
2. `lib/server/telemetry.ts`: read `nvidia-smi` and `/proc`, cache for 1 s,
   return `null` for anything that fails. Never throws.
3. `app/api/system/route.ts`: `GET` the snapshot, no-store.
4. `app/system/page.tsx`: gauges, sparklines (client-side history ring buffer),
   GPU process table. Tensor-core activity and memory bandwidth need DCGM, which
   is not installed, so those tiles say so instead of showing a number.

### 3. Owner SMS alerts
1. `lib/server/alerts.ts`: Twilio REST call, secrets from `webapp/.env.local`
   only. Alert rules by category and severity; one text per detection; at most
   10 per hour. Plain text, <=160 chars, prefixed `[SIMULATED]` for sample
   videos. `TWILIO_API_BASE` is overridable so tests point at a fake and cost
   nothing.
2. `app/api/alerts/route.ts`: accepts same-origin requests, or any request
   carrying `ALERT_API_TOKEN`. Returns the send result, never the credentials.
3. Preferences gets an alerts panel: owner number, a test-SMS button, and an
   opt-in auto-alert during playback. `app/detections` cards get "Alert owner".
4. A status band on the overview page: edge node state + alert state at a glance.

## Verification
- `npm run lint && npm run typecheck && npm run build`
- `npm run test:e2e` (port 3100 via `playwright.ci.config.ts`; port 3000 on the
  ZGX belongs to another service and the default config reuses whatever answers)
- `/api/system` on a box with no GPU returns nulls and the page says so rather
  than rendering zeroes.
- Alert tests run against the fake Twilio base; no live message is sent.
