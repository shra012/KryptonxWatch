// Local yes/no scorer: the Qwen3.8-27B shoplifting LoRA (shra012/qwen3.8-27b-ucf-shoplifting-lora)
// served by zrt/vLLM on the GB10. Unlike the JSON analysis prompt, it answers one fixed question per
// 8 s clip (16 frames at 2 fps) and the score is P(yes) / (P(yes) + P(no)) of the first answer token.
// The prompt and window must match the adapter's training protocol (its code/qwen_model.py).
// No runtime imports, so scripts can reuse it.
import type { WindowResult } from "./analysis";

/** Model ids with this prefix are local scorers; the rest is the name the local server serves. */
export const SCORER_PREFIX = "local:";
export const SCORER_WINDOW = { windowSec: 8, strideSec: 4, fps: 2, frames: 16 } as const;

export const SCORER_PROMPT =
  "This is an 8-second clip from a store security camera. " +
  "Is someone shoplifting in this clip, meaning concealing or taking merchandise with evident " +
  "intent to leave without paying? Answer with exactly one word: yes or no.";

const YES = new Set(["yes", "Yes", " yes", " Yes"]);
const NO = new Set(["no", "No", " no", " No"]);

export const isScorerModel = (model?: string) => !!model?.startsWith(SCORER_PREFIX);
export const servedName = (model: string) => model.slice(SCORER_PREFIX.length);

/**
 * Local general models (`local-vlm:<served name>`) run the same JSON analysis, assistant and summary
 * prompts as OpenRouter models, on the GB10. Note "local-vlm:" does not start with SCORER_PREFIX.
 */
export const LOCAL_VLM_PREFIX = "local-vlm:";
export const isLocalVlmModel = (model?: string) => !!model?.startsWith(LOCAL_VLM_PREFIX);
export const localVlmName = (model: string) => model.slice(LOCAL_VLM_PREFIX.length);

/** Dropdown label: local models are marked so their provider and behaviour are clear. */
export function modelLabel(model: string) {
  if (isScorerModel(model)) return `${servedName(model)} — local GB10, shoplifting yes/no scorer`;
  if (isLocalVlmModel(model)) return `${localVlmName(model)} — local GB10, full analysis`;
  return model;
}

/** Window start times and frame times for a recording of `duration` seconds. */
export function planScorerWindows(duration: number) {
  const { windowSec, strideSec, fps, frames } = SCORER_WINDOW;
  const starts: number[] = [];
  for (let s = 0; s + windowSec <= duration + 1e-6; s += strideSec) starts.push(s);
  if (!starts.length && duration > 0) starts.push(0); // short clip: one window, frames clamped to the end
  return starts.map(start => ({
    start,
    end: Math.min(duration, start + windowSec),
    times: Array.from({ length: frames }, (_, i) => Math.min(duration - 0.05, start + i / fps)),
  }));
}

export function scorerBody(served: string, videoDataUrl: string) {
  return {
    model: served,
    messages: [{ role: "user", content: [
      { type: "video_url", video_url: { url: videoDataUrl } },
      { type: "text", text: SCORER_PROMPT },
    ] }],
    max_tokens: 1,
    temperature: 0,
    logprobs: true,
    top_logprobs: 20,
    chat_template_kwargs: { enable_thinking: false },
    // The clip already holds exactly the 16 frames at 2 fps; stop vLLM from resampling them.
    mm_processor_kwargs: { fps: SCORER_WINDOW.fps, do_sample_frames: false },
  };
}

/** P(yes | yes or no) from an OpenAI-compatible chat completion with top_logprobs. */
export function parseYesNo(payload: unknown): { pYes: number; mass: number } {
  const top = (payload as { choices?: { logprobs?: { content?: { top_logprobs?: { token: string; logprob: number }[] }[] } }[] })
    ?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs;
  if (!Array.isArray(top) || !top.length) throw new Error("The local server returned no logprobs. Start vLLM with logprobs enabled.");
  let yes = 0, no = 0;
  for (const t of top) {
    if (YES.has(t.token)) yes += Math.exp(t.logprob);
    else if (NO.has(t.token)) no += Math.exp(t.logprob);
  }
  const mass = yes + no;
  if (mass < 0.5) throw new Error(`The model did not answer yes or no (top token ${JSON.stringify(top[0].token)}).`);
  return { pYes: yes / mass, mass };
}

/** One scored window as the app's WindowResult. Model gives no location, so there is no box. */
export function scorerWindowResult(pYes: number, start: number, end: number, threshold: number): WindowResult {
  const pct = Math.round(pYes * 100);
  return {
    start, end,
    summary: `Shoplifting score ${pct}% (local LoRA, yes/no on this 8 s clip).`,
    incidents: pYes >= threshold ? [{
      category: "Shoplifting", severity: "medium", confidence: pYes, seconds: (start + end) / 2,
      description: `Suspected shoplifting in this clip (model P(yes) ${pct}%). Review the footage; the model gives no location.`,
    }] : [],
    score: pYes,
  };
}
