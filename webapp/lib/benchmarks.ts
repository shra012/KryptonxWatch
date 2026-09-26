// Measured accuracy from the team's bake-off (model/openrouter-bakeoff, model/.plans/local-vlm-quality.md): the app's own
// analysis pipeline on test set v1, 36 UCF-Crime clips (18 crime, 18 normal). Differences under ~10 points are noise.
// score = mean of (crime clips with the right crime named) and (normal clips with no alarm).

export interface Benchmark { label: string; score: number; balanced: number; flagged: number; rightCrime: number; falseAlarms: number; note?: string }

export const BENCHMARK_SET = "Bake-off v1 · 36 UCF-Crime clips";

const BENCHMARKS: Record<string, Benchmark> = {
  "local-vlm:qwen3-vl-30b-a3b": { label: "Qwen3-VL-30B-A3B FP8 on the GB10 (zrt)", score: 69, balanced: 81, flagged: 83, rightCrime: 61, falseAlarms: 22, note: "2.1 s median per window; 163 windows in 146 s" },
  "qwen/qwen3-vl-30b-a3b-instruct": { label: "Qwen3-VL-30B-A3B (OpenRouter)", score: 64, balanced: 81, flagged: 83, rightCrime: 50, falseAlarms: 22 },
  "google/gemini-2.5-flash": { label: "Gemini 2.5 Flash (OpenRouter)", score: 75, balanced: 81, flagged: 94, rightCrime: 83, falseAlarms: 33 },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": { label: "Nemotron-3-Nano-Omni (OpenRouter)", score: 69, balanced: 78, flagged: 78, rightCrime: 61, falseAlarms: 22 },
  "qwen/qwen3.8-27b": { label: "Qwen3.8-27B (OpenRouter)", score: 64, balanced: 69, flagged: 39, rightCrime: 28, falseAlarms: 0 },
};

/** Measured accuracy for a model id (real id or local id), if it was in the bake-off. */
export function benchmarkFor(model: string): Benchmark | undefined { return BENCHMARKS[model]; }
