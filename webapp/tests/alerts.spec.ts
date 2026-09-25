import { test, expect } from "@playwright/test";

const fake = "http://127.0.0.1:4010/__sent";
async function sentMessages(request: import("@playwright/test").APIRequestContext) { return (await request.get(fake)).json() as Promise<{ to: string; body: string }[]>; }

test("preferences reports Twilio state and sends a test text through the fake", async ({ page, request }) => {
  const before = (await sentMessages(request)).length;
  await page.goto("/settings");
  // The alert rail only renders once the server has answered, so wait on it rather
  // than on the panel, which exists in the loading state too.
  await expect(page.getByRole("heading", { name: "Alert rules" })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("+14•••••1234")).toBeVisible();
  await expect(page.getByText("Fake", { exact: true })).toBeVisible();   // the local stand-in, not Twilio

  await page.getByRole("button", { name: "Send a test text" }).click();
  await expect(page.getByText(/Texted the owner at/)).toBeVisible();

  const messages = await sentMessages(request);
  expect(messages.length).toBe(before + 1);
  const last = messages[messages.length - 1];
  expect(last.to).toBe("+14085551234");
  expect(last.body.length).toBeLessThanOrEqual(160);
  expect(last.body).toContain("[SIMULATED]");   // the test fires from sample data
});

test("alerting an owner from the detection log texts once and refuses the repeat", async ({ page, request }) => {
  await page.goto("/detections");
  await page.getByRole("combobox", { name: "Filter severity" }).selectOption("high");
  const row = page.locator("tbody tr").first();
  await expect(row).toBeVisible();

  const before = (await sentMessages(request)).length;
  await row.getByRole("button", { name: "Alert owner" }).click();
  await expect(page.getByText(/Texted the owner at/)).toBeVisible();
  const messages = await sentMessages(request);
  expect(messages.length).toBe(before + 1);
  const body = messages[messages.length - 1].body;
  expect(body.length).toBeLessThanOrEqual(160);
  expect(body).toMatch(/^\[SIMULATED\] Sentinel Machines: Suspected /);
  expect(body).toContain("/videos/");

  // Same detection again: the owner should not be texted twice.
  await row.getByRole("button", { name: "Alert owner" }).click();
  await expect(page.getByText("The owner has already been texted about this detection.")).toBeVisible();
  expect((await sentMessages(request)).length).toBe(messages.length);
});

test("a queue measurement is not worth a text", async ({ page }) => {
  await page.goto("/detections");
  await page.getByRole("combobox", { name: "Filter severity" }).selectOption("measurement");
  const row = page.locator("tbody tr").first();
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Alert owner" })).toHaveCount(0);
});
