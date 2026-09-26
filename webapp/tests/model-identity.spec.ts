import { test, expect } from "@playwright/test";
import { modelAliases, modelId, modelOptions, vlmConfig } from "../lib/server/vlm-config";
import { inferenceSnapshot, recordInference } from "../lib/server/inference-stats";

const PRODUCT = "sentinel-machines-v1";
const QWEN = "qwen3-vl-30b-a3b";
const COMPARATOR = "google/gemini-2.5-flash";
const keys = ["VLM_BASE_URL", "VLM_MODEL", "VLM_CHAT_MODEL", "VLM_MODEL_OPTIONS", "VLM_MODEL_ALIASES", "VLM_EXTRA_BODY", "LOCAL_VLM_MODELS", "LOCAL_SCORER_MODELS"];
let saved: Record<string, string | undefined>;

test.beforeEach(() => {
  saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
});
test.afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("an incompatible product alias exposes the real model for default and saved selections", () => {
  process.env.VLM_BASE_URL = "https://openrouter.ai/api/v1";
  process.env.VLM_MODEL = PRODUCT;
  process.env.VLM_MODEL_ALIASES = `${PRODUCT}=${COMPARATOR}`;
  process.env.VLM_MODEL_OPTIONS = `${PRODUCT},${COMPARATOR}`;
  expect(modelAliases().has(PRODUCT)).toBe(false);
  expect(modelOptions()).toEqual([COMPARATOR]);
  for (const requested of [undefined, PRODUCT, COMPARATOR]) {
    const config = vlmConfig("vision", requested)!;
    expect(config.model).toBe(COMPARATOR);
    expect(modelId(config)).toBe(COMPARATOR);
  }
  expect(modelId(vlmConfig("chat")!)).toBe(COMPARATOR);
});

test("the product alias resolves to its Qwen service", () => {
  process.env.VLM_BASE_URL = "http://127.0.0.1:8080/v1";
  process.env.VLM_MODEL = PRODUCT;
  process.env.VLM_MODEL_ALIASES = `${PRODUCT}=${QWEN}`;
  expect(modelOptions()).toEqual([PRODUCT]);
  expect(modelAliases().get(PRODUCT)).toBe(QWEN);
  expect(vlmConfig()!.model).toBe(QWEN);
  expect(modelId(vlmConfig()!)).toBe(PRODUCT);
});

test("unrelated display aliases continue working", () => {
  process.env.VLM_BASE_URL = "https://openrouter.ai/api/v1";
  process.env.VLM_MODEL = "comparison";
  process.env.VLM_MODEL_ALIASES = `comparison=${COMPARATOR}`;
  expect(modelAliases().get("comparison")).toBe(COMPARATOR);
  expect(vlmConfig()!.model).toBe(COMPARATOR);
  expect(modelId(vlmConfig()!)).toBe("comparison");
});

test("telemetry reports the actual model that answered each call", () => {
  const reply = { text: "", latencyMs: 100, completionTokens: 10 };
  recordInference({ baseUrl: "https://openrouter.ai/api/v1", model: COMPARATOR }, reply);
  expect(inferenceSnapshot()).toMatchObject({ model: COMPARATOR, local: false });
  recordInference({ baseUrl: "http://127.0.0.1:8080/v1", model: QWEN, alias: PRODUCT, local: true }, reply);
  expect(inferenceSnapshot()).toMatchObject({ model: QWEN, local: true });
});

test("the live comparison keeps Qwen on the local lane and the comparator on the cloud lane", async ({ page }) => {
  await page.route("**/api/model", route => route.fulfill({ json: {
    configured: true, model: COMPARATOR, provider: "OpenRouter",
    options: [COMPARATOR, `local-vlm:${QWEN}`], aliases: {},
    localModels: [`local-vlm:${QWEN}`],
  } }));
  await page.route("**/api/demo-clips", route => route.fulfill({ json: { available: false } }));
  await page.route("**/api/analyze", route => route.abort());
  await page.goto("/analytics");
  const local = page.getByText("Local · GB10", { exact: true }).locator("..");
  const cloud = page.getByText("Cloud · OpenRouter", { exact: true }).locator("..");
  await expect(local).toContainText(QWEN);
  await expect(local).not.toContainText(COMPARATOR);
  await expect(cloud).toContainText(COMPARATOR);
  await expect(cloud).not.toContainText(QWEN);
});
