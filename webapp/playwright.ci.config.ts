import { defineConfig, devices } from "@playwright/test";
// A config that owns its servers. The default one reuses whatever already
// answers on port 3000, which on the ZGX is somebody else's service.
// Alert tests point Twilio at the local fake, so they never cost a message.
const base = "http://127.0.0.1:3100";
const alertEnv = {
  TWILIO_ACCOUNT_SID: "ACfaketestaccount0000000000000000",
  TWILIO_AUTH_TOKEN: "fake-token",
  TWILIO_FROM_NUMBER: "+15005550006",
  ALERT_OWNER_NUMBER: "+14085551234",
  TWILIO_API_BASE: "http://127.0.0.1:4010",
  ALERT_REVIEW_BASE: base,
  // The demo recordings are hidden in the app now; the tests still drive them.
  NEXT_PUBLIC_DEMO_SAMPLES: "1",
  // Its own build folder, so it cannot clobber the .next of a dev server running on port 3000.
  NEXT_DIST_DIR: ".next-e2e",
};
export default defineConfig({
  testDir: "./tests", timeout: 60000, workers: 1,
  // Dev-mode cold compiles (the Recharts page is the slow one) outrun the 5s default.
  expect: { timeout: 15000 },
  use: { baseURL: base, ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } },
  webServer: [
    // The alert tests count messages as a delta, so a fake you started by hand for a
    // demo is safe to reuse. The dev server is not: it carries this config's Twilio env.
    { command: "node tests/fake-twilio.mjs 4010", url: "http://127.0.0.1:4010/__sent", reuseExistingServer: true, timeout: 30000 },

    { command: "npm run dev -- --hostname 127.0.0.1 --port 3100", url: base, reuseExistingServer: false, timeout: 180000, env: alertEnv },
  ],
});
