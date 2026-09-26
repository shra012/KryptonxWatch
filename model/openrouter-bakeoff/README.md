# OpenRouter bake-off: which open model to run on the HP ZGX Nano (GB10)

Status: done 2026-09-24 · 12 models + HawkWatch baseline · total spend ≈ $0.87 on OpenRouter.

Outcome (2026-09-25): the app now runs **Qwen3-VL-30B-A3B-Instruct FP8 locally** through zrt (Score 69% on v1, in [`results/summary.md`](results/summary.md)); serving Nemotron locally through zrt reset the machine, so it was not adopted. Follow-up work: local-vlm-quality.md (`model/.plans/local-vlm-quality.md`, a local plan not in the repo).

## Question

KryptonxWatch should work like [HawkWatch](https://github.com/Grace-Shao/Treehacks2025) (upload analysis, timestamped incidents, live monitoring, assistant, AI summary), but at the hackathon it must run on one **HP ZGX Nano (NVIDIA GB10, 128 GB unified memory, ~273 GB/s)**. Which open-weight vision-language model should we download and serve locally?

We tested candidates through OpenRouter using **the web app's own analysis code** ([`webapp/lib/vlm/analysis.ts`](../../webapp/lib/vlm/analysis.ts)), so these numbers are what the app does, not a separate lab setup.

## Data (same source as HawkWatch)

All from UCF-Crime. Build it with `fetch_data.py` (videos are git-ignored under `data/bakeoff/`).

| Set | Videos | Minutes | Labels |
|---|---|---|---|
| `hawkwatch` | The 12 clips HawkWatch demoed (Shoplifting ×3, Stealing, Robbery ×3, Fighting ×4, Vandalism) | 11.7 | Crime type from the file name |
| `timed` | 6 UCF test videos (Shoplifting ×2, Robbery, Fighting, Stealing, Vandalism), first 64 s | 3.5 | Official start/end times |
| `normal` | 18 UCF test videos with no crime (shops, checkouts, offices, streets) | 5.4 | No incident |

## Method

- **Our pipeline:** 4 frames every 8 s (one every 2 s, ≤512 px), one request per window, JSON answer with category, severity, confidence, time and box. Consecutive windows with the same category merge into one detection. Default cut-off: confidence ≥ 0.5.
- **HawkWatch pipeline (baseline):** HawkWatch's verbatim prompt, 1 frame every 3 s, `isDangerous` flag, no categories, on Gemini 2.5 Flash (HawkWatch used Gemini 1.5 Flash, which has been retired).
- **Score (primary):** mean of (crime clips where the right crime is named) and (normal clips with no alarm). The HawkWatch pipeline cannot name crimes, so for it "any alarm" counts.
- **Balanced acc.:** the same, but any alarm counts as a catch. This is the like-for-like comparison with HawkWatch.
- **CV score:** the confidence cut-off chosen by 2-fold cross-validation over videos (chosen on one half, scored on the other), for models that over-alarm at 0.5.
- **Repeat run:** the top 5 were run twice. Answers are not fully deterministic even at temperature 0.

## Results

| Model (OpenRouter id) | Params (active) | Score | CV score | Balanced acc. | Crime clips alarmed | Right crime named | Normal clips false-alarmed | Timed events hit | p50 latency | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| *HawkWatch pipeline on gemini-2.5-flash (reference, not local)* | – | 81%* | 81%* | **81%** | 67% | – | 6% | 3/6 | 1.5 s | $0.16 |
| *gemini-2.5-flash, our pipeline (reference, not local)* | – | 75% / 72% | 75% / 78% | 81% / 78% | 94% | 83% | 33% / 39% | 5/6 | 1.5 s | $0.11 |
| **nvidia/nemotron-3-nano-omni-30b-a3b-reasoning** | 33B (3B) | **69% / 67%** | 69% / 64% | 78% / 78% | 78% / 72% | 61% / 50% | 22% / 17% | 3/6 | 1.6 s | free |
| google/gemma-4-31b-it | 31B dense | 67% / 64% | 67% / 64% | 69% / 64% | 39% / 28% | 33% / 28% | 0% | 2/6 | 1.1 s | $0.06 |
| **qwen/qwen3-vl-30b-a3b-instruct** | 31B (3B) | 64% / 64% | 64% / 64% | **81% / 81%** | 83% | 50% | 22% | 3/6 | 1.4 s | $0.02 |
| qwen/qwen3.8-27b | 28B dense | 64% | 64% | 69% | 39% | 28% | 0% | 1/6 | 1.3 s | $0.04 |
| z-ai/glm-4.6v | 108B (12B) | 39% / 44% | **69% / 64%** (cut-off 0.9) | 64% | 94% | 44% / 56% | 67% | 3/6 | 3.5 s | $0.03 |
| google/gemma-4-26b-a4b-it | 26B (4B) | 58% | 58% | 72% | 44% | 17% | 0% | 2/6 | 2.4 s | $0.02 |
| qwen/qwen3.6-35b-a3b | 36B (3B) | 58% | 58% | 69% | 39% | 17% | 0% | 1/6 | 1.7 s | $0.02 |
| qwen/qwen3.5-122b-a10b | 125B (10B) | 58% | 58% | 69% | 50% | 28% | 11% | 1/6 | 2.1 s | $0.06 |
| qwen/qwen3-vl-32b-instruct | 33B dense | 58% | 58% | 64% | 33% | 22% | 6% | 1/6 | 2.4 s | $0.02 |
| qwen/qwen3-vl-8b-instruct | 9B dense | 56% | 64% (0.9) | 75% | 83% | 44% | 33% | 3/6 | 0.9 s | $0.02 |
| mistralai/mistral-small-3.2-24b-instruct | 24B dense | 44% | 61% (0.9) | 58% | 94% | 67% | 78% | 5/6 | 3.8 s | $0.02 |

`a / b` = run 1 / run 2. \*No crime categories, so its Score equals Balanced acc. Full per-model detail, misses and false alarms: [`results/summary.md`](results/summary.md), [`results/summary.json`](results/summary.json); raw replies per window: `results/*.jsonl`.

### How to read this

- **Sample size is small:** 18 crime clips and 18 normal clips, so one clip is 5–6 points. Differences under about 10 points are noise. The top open models (Nemotron-3-Nano-Omni, Qwen3-VL-30B-A3B, Gemma-4-31B) are statistically tied.
- **Does it work as well as HawkWatch?** On the like-for-like measure (Balanced acc.), yes. Qwen3-VL-30B-A3B scored 81% in both runs, the same as HawkWatch's own pipeline on Gemini, and Nemotron scored 78%. The trade-off is different: HawkWatch's single-frame prompt rarely alarms (6% false alarms but misses a third of crimes), while our pipeline catches 72–83% and also names the crime and gives a time range, at 17–22% false alarms on normal footage.
- **No open model matches Gemini at naming the right crime** (83% vs 50–61%). Shoplifting in low-resolution footage is the hardest case for every model.
- **Two failure styles:**
  - **Too quiet:** Gemma 4 and Qwen 3.5–3.8 rarely false-alarm but miss most crimes.
  - **Too loud:** Mistral and GLM at the 0.5 cut-off flag most of the normal footage. GLM becomes competitive at a 0.9 cut-off.
- **Timing:** where a model hits a timed event, its onset is typically within about 4 s (one window is 8 s).

## Second benchmark on fresh videos (v2)

To check the ranking on videos no model had been scored on, and to compare Qwen3.8-27B head-to-head, we built a fresh set with `fetch_data.py --version v2`:
- **35 crime clips:** every other annotated UCF test video of the five classes (19 of them shoplifting), each a 64 s cut starting 16 s before the crime, with official times.
- **30 normal clips:** first 64 s of each.

That's 52 minutes in total, run with the same prompt and pipeline. Results are in `results-v2/`.

| Model | Score | CV score | Balanced acc. | Crime clips alarmed | Right crime named | Shoplifting right | Normal clips false-alarmed | Timed events hit | Window AUROC |
|---|---|---|---|---|---|---|---|---|---|
| **nemotron-3-nano-omni-30b-a3b** | **81%** | 81% | 87% | 94% | 83% | 16/19 | 20% | 32/42 | 0.81 |
| **qwen3-vl-30b-a3b-instruct** | **80%** | 77% | 87% | 94% | 80% | 15/19 | 20% | 28/42 | 0.75 |
| gemma-4-31b-it | 73% | 73% | 81% | 63% | 46% | 6/19 | 0% | 21/42 | 0.72 |
| *gemini-2.5-flash (reference)* | 69% | 83% (cut-off 0.9) | 73% | 100% | 91% | 19/19 | 53% | 38/42 | 0.78 |
| qwen3.8-27b | 65% | 55% | 77% | 60% | 37% | 5/19 | 7% | 15/42 | 0.66 |

- **Same ranking as v1:** Nemotron and Qwen3-VL-30B-A3B are the best local options and are tied.
- **v2 is easier:** every crime clip is cut around the crime, so all models score higher than on v1.
- **Qwen3.8-27B is the weakest here:** it is too cautious. It notices clues such as a masked person at the counter but calls them normal, and finds only 5 of 19 shoplifting clips.
- **Gemini is the most sensitive but the noisiest:** it names the right crime 91% of the time but false-alarms on half the normal clips at a 0.5 cut-off.

## Recommendation for the GB10

Download **Nemotron-3-Nano-Omni-30B-A3B** (primary) and **Qwen3-VL-30B-A3B-Instruct** (backup). Both fit in memory at the same time (about 20–35 GB each), so run the local benchmark on both and keep the winner.

| | Nemotron-3-Nano-Omni-30B-A3B | Qwen3-VL-30B-A3B-Instruct |
|---|---|---|
| Why | Best open Score in both runs; with Qwen, the lowest false-alarm rate among models that catch most crimes; built by NVIDIA; also takes audio and video (useful for HawkWatch-style transcripts later) | Same balanced accuracy as HawkWatch in both runs; most stable clip-level results; most mature vLLM support |
| Checkpoint | `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4` (Blackwell-native 4-bit, ~20 GB) or `-FP8` (~33 GB) | `Qwen/Qwen3-VL-30B-A3B-Instruct-FP8` (~31 GB) |
| Watch out | It's a reasoning model: switch thinking off (see below) or replies get slow and can overrun the 600-token limit. Occasional malformed JSON (the app retries once) | More false alarms per minute than Nemotron |

Why these fit the GB10 and why dense models don't: the GB10 is limited by memory bandwidth, so reply speed depends on the **active** parameters per token. Rough estimates to verify on the device:

| Model | Weights on GB10 | Est. reply speed | Real-time? (1 window per 8 s per camera, ~100 output tokens) |
|---|---|---|---|
| Nemotron-3-Nano-Omni 30B-A3B, NVFP4/FP8 | 20–33 GB | ~50–80 tok/s | Yes, several cameras with batching |
| Qwen3-VL-30B-A3B, FP8 | 31 GB | ~40–70 tok/s | Yes, several cameras |
| GLM-4.6V 108B-A12B, 4-bit | ~60 GB | ~20 tok/s | About 1 camera |
| Gemma-4-31B / Qwen3.8-27B dense, FP8 | 28–31 GB | ~8 tok/s | No (≈12 s per window) |

The benchmark keeps both models' answers per window, so you can recheck the cut-off locally without new API calls.

## Run it on the GB10

1. **Serve the model** with any OpenAI-compatible server. vLLM is the simplest; NVIDIA publishes GB10/DGX Spark builds. A starting point to adapt:
   ```bash
   vllm serve nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 \
     --served-model-name nemotron-omni --max-model-len 16384 \
     --limit-mm-per-prompt '{"image": 8}' --trust-remote-code --port 8000
   ```
2. **Point the app at it** in `webapp/.env.local`, then restart `npm run dev`:
   ```
   VLM_BASE_URL=http://localhost:8000/v1
   VLM_API_KEY=
   VLM_MODEL=nemotron-omni
   # Turn thinking off for reasoning models; check the model card for the exact switch.
   VLM_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}
   ```
3. **Re-run the benchmark locally.** This checks accuracy after quantization and gives real GB10 speed:
   ```bash
   python3 model/openrouter-bakeoff/fetch_data.py --hawkwatch <Treehacks2025>/public/videos
   cd webapp
   node scripts/vlm-benchmark.ts frames
   VLM_BASE_URL=http://localhost:8000/v1 VLM_API_KEY= node scripts/vlm-benchmark.ts run --models nemotron-omni --concurrency 4
   node scripts/vlm-benchmark.ts score
   ```
   If quality drops a lot versus the table above, try the FP8 checkpoint before switching models.

## Reproduce the OpenRouter runs

```bash
cd webapp                                   # needs VLM_API_KEY in .env.local
node scripts/vlm-benchmark.ts frames
node scripts/vlm-benchmark.ts run --models qwen/qwen3-vl-30b-a3b-instruct,google/gemma-4-31b-it
node scripts/vlm-benchmark.ts run --models google/gemini-2.5-flash --pipeline hawkwatch
node scripts/vlm-benchmark.ts run --models qwen/qwen3-vl-30b-a3b-instruct --repeat 2
node scripts/vlm-benchmark.ts score         # writes results/summary.{md,json}
```

## Limits

- 36 videos in total, so the results are indicative, not conclusive. Use the team's [shoplifting study](../Qwen3.8-27B-INT4/plans/shoplifting-study.md) protocol for a real evaluation.
- The HawkWatch clips have only crime-type labels (no times). Timing is scored on the 6 timed videos only.
- OpenRouter providers may serve other precisions than the local checkpoint. Re-run on the GB10 (step 3) before relying on these numbers.
- Model licences: Qwen and Gemma are Apache-2.0. Nemotron uses the NVIDIA Open Model License; check it allows your use.
