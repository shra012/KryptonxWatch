# Dashboard refresh, edge-node telemetry and owner SMS alerts

Status: in progress 2026-09-24 (Sonakshi) · branch `feat/dashboard-alerts`. Update this line as phases complete.

## Context
Basic review functionality exists. Three additions were requested:
1. A more sophisticated look that is clearly our own, not a HawkWatch copy.
2. A live view of the ZGX Nano, in the spirit of zgxconsole.bncvc.com's MVP dashboard (tensor activity, power, memory, resident models). The hackathon is judged on proving local inference with measured numbers, so this page shows only real readings.
3. Owner notifications through Twilio (Shravan's account, $20 credit). This replaces the "email/phone alerts deferred" decision in `hawkwatch-ui-parity.md` for SMS only.

What the box can report (checked on the ZGX Nano): `nvidia-smi` gives GPU utilisation, temperature, power draw, SM clock and per-process GPU memory; `/proc` gives unified memory, CPU and load. Tensor-core activity and memory bandwidth need NVIDIA DCGM, which is not installed, so the UI labels them unavailable instead of estimating.

## Steps
1. **Theme and shell.** Custom daisyUI `light`/`dark` themes (teal primary, amber attention), Geist fonts, grouped sidebar (Operate / Review / Insights), live telemetry chip in the header. Visible labels used by `tests/workflows.spec.ts` stay unchanged.
2. **Telemetry API.** `app/api/system/route.ts` → `lib/server/telemetry.ts`. Runs `nvidia-smi` with fixed arguments (no shell), reads `/proc`, caches for 1 s so several viewers share one sample, returns `null` for anything unreadable.
3. **Edge node page** `/system`: gauges, 2-minute sparklines, resident GPU processes, explicit "needs DCGM" tiles.
4. **Owner alerts API.** `app/api/alerts/route.ts` → `lib/server/alerts.ts`.
   - Credentials only from `webapp/.env.local` (gitignored). Never sent to the browser; status responses mask phone numbers.
   - Rules: categories and minimum severity (env, with safe defaults). Measurements never alert.
   - Cost guard: at most one SMS per detection, `ALERT_MAX_PER_HOUR` (default 10) across all sends.
   - Messages are ASCII/GSM-7 and ≤160 characters (one SMS segment), say "suspected … review needed", and start with `[SIMULATED]` for sample footage.
   - Callers: same-origin browser requests, or a machine caller (model service) presenting `ALERT_API_TOKEN`.
5. **Alerts UI.** Preferences panel (status, rules, "Send test SMS", opt-in auto-alert during sample playback), and an "Alert owner" action on each detection card.
6. **Overview refresh.** Status band (edge node, owner alerts, review queue) above the existing cards.

## Environment (`webapp/.env.local`, never committed)
See `.env.example`. Required for SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ALERT_TO`.

## Verification
- `npm run lint && npm run typecheck`
- `npm run test:e2e` (existing three workflows must still pass; new unit tests for parsing, rules, rate limit, message length; e2e for `/system` and alert settings against a local fake Twilio server, so tests never spend credit)
- Manual: one real test SMS once credentials are in `.env.local`.

## Open questions
- Twilio account type: trial accounts only text verified numbers; US numbers need A2P 10DLC or toll-free verification. WhatsApp sandbox works by setting `whatsapp:` prefixed numbers.
- Installing DCGM (needs sudo) would unlock tensor-core and memory-bandwidth readings.
