# Models

Everything KryptonxWatch does with models lives here: which vision-language model (VLM) we run, how we measured it, how it is served on the HP ZGX Nano (NVIDIA GB10), and the data behind it. The web app calls these models through `webapp/app/api/*`. For the machine, services and team rules, read the root [AGENTS.md](../AGENTS.md) first.

## Current line-up

In the app, detections come from **`sentinel-machines-v1`**. This is the product's display name, not a separate or fine-tuned model. It is an alias (`VLM_MODEL_ALIASES` in `webapp/.env.local`) for whichever model is configured to serve it.

| Model | Where it runs | Role | Bake-off v1 Score | Status |
|---|---|---|---|---|
| Qwen3-VL-30B-A3B-Instruct FP8 | GB10, served by zrt (vLLM) | Local VLM: detection, scene log, incident boxes | 69% | **Production local model** (`local-vlm:qwen3-vl-30b-a3b`). Zero-shot, not fine-tuned |
| Gemini 2.5 Flash | OpenRouter | Benchmark; can serve the app via the alias | 75% | Reference to beat. **Never used as a teacher**: Google's terms restrict training on its outputs |
| Nemotron-3-Nano-Omni-30B-A3B | OpenRouter (local attempt archived) | Candidate | 69% / 67% (2 runs) | Statistically tied with Qwen3-VL. Served through zrt it reset the machine twice; no local benchmark result recorded. Plans archived |
| Qwen3.8-27B | OpenRouter; GB10 with the shoplifting LoRA | First model we served; research scorer | 64% | Weakest option: misses most crimes. Not in the current app |
| YOLO11m | GB10, container `kryptonx-yolo` on 127.0.0.1:8090 | Person boxes and tracking | – | In the app: snaps the VLM's incident box to a detected person |

Sources: [openrouter-bakeoff/results/summary.md](openrouter-bakeoff/results/summary.md), `model/.plans/local-vlm-quality.md` (local plan, not in the repo).

### The Qwen3.8-27B shoplifting LoRA (what was trained)

The team's only fine-tune so far is a LoRA on **Qwen3.8-27B** that answers yes/no to "is someone shoplifting in this 8 s clip?" (weakly supervised on UCF-Crime, 3 seeds). On the locked test cohort (169 videos, 5,808 windows):

- ΔAUROC vs zero-shot: **+0.027 ± 0.005** (mean of 3 seeds). **Every seed's 95% CI includes 0**, so the gain is not shown.
- False positives per hour on normal test footage: 92.1 vs 29.1 zero-shot, **about 3x more**.
- Event localisation got worse (AP@tIoU0.3 0.027 vs 0.068).

Details: [Qwen3.8-27B-INT4/runs/qwen38/exp3/MODEL_CARD.md](Qwen3.8-27B-INT4/runs/qwen38/exp3/MODEL_CARD.md) and [Qwen3.8-27B-INT4/plans/shoplifting-study.md](Qwen3.8-27B-INT4/plans/shoplifting-study.md). The scorer is not part of the current app architecture.

## Results

All runs use **the web app's own analysis pipeline** (4 frames per 8 s window, JSON answer, merge consecutive windows). Score = mean of "crime clips with the right crime named" and "normal clips with no alarm".

**v1: 36 UCF-Crime clips** (18 crime, 18 normal). One clip is 5 to 6 points, so **differences under about 10 points are noise**.

| Model | Score | Balanced acc. | Right crime | Normal clips false-alarmed | Timed hits |
|---|---|---|---|---|---|
| Gemini 2.5 Flash (OpenRouter) | 75% | 81% | 83% | 33% | 5/6 |
| **Qwen3-VL-30B-A3B FP8, local (zrt)** | **69%** | **81%** | 61% | 22% | 3/6 |
| Nemotron-3-Nano-Omni (OpenRouter) | 69% | 78% | 61% | 22% | 3/6 |
| Qwen3-VL-30B-A3B (OpenRouter) | 64% | 81% | 50% | 22% | 3/6 |
| Qwen3.8-27B (OpenRouter) | 64% | 69% | 28% | 0% | 1/6 |

Source: [openrouter-bakeoff/results/summary.md](openrouter-bakeoff/results/summary.md).

**v2: 65 fresh clips** (35 crime cut around the crime, 30 normal; none from v1). Headline claims should use this set.

| Model (OpenRouter) | Score | Balanced acc. | Right crime | Normal clips false-alarmed | Timed hits | Window AUROC |
|---|---|---|---|---|---|---|
| Nemotron-3-Nano-Omni | 81% | 87% | 83% | 20% | 32/42 | 0.81 |
| Qwen3-VL-30B-A3B | 80% | 87% | 80% | 20% | 28/42 | 0.75 |
| Gemma-4-31B | 73% | 81% | 46% | 0% | 21/42 | 0.72 |
| Gemini 2.5 Flash | 69% | 73% | 91% | 53% | 38/42 | 0.78 |
| Qwen3.8-27B | 65% | 77% | 37% | 7% | 15/42 | 0.66 |

Source: [openrouter-bakeoff/results-v2/summary.md](openrouter-bakeoff/results-v2/summary.md). On the larger **full** set (1,489 windows) the open models bunch together (Gemma-4-31B 65%, Nemotron 63%, Qwen3-VL 59%) and Gemini scores 57%: it names the crime best (71%) but false-alarms on 57% of normal clips. See [openrouter-bakeoff/results-full/summary.md](openrouter-bakeoff/results-full/summary.md).

In short: the local Qwen3-VL ties Gemini on balanced accuracy and false-alarms less, but names the crime less often and hits fewer timed events.

## How we evaluate

The bake-off ([openrouter-bakeoff/README.md](openrouter-bakeoff/README.md)) drives `webapp/scripts/vlm-benchmark.ts`, which calls the same code the app uses, so the numbers describe the product. Raw replies per window are kept in `openrouter-bakeoff/results*/*.jsonl`, so every table can be recomputed without new model calls. Measures, fixed before any tuning (`model/.plans/local-vlm-quality.md` (local plan, not in the repo)):

| # | Measure | Notes |
|---|---|---|
| M1 | Detection: Score, balanced accuracy, right crime, false alarms, timed hits | `npx --no-install jiti scripts/vlm-benchmark.ts score` in `webapp/` |
| M2 | Boxes on the right person | Human review page (`model/YOLO/src/box_review.py`). Automatic agreement with Gemini was dropped: Gemini draws loose region boxes, not person boxes |
| M3 | Scene-log text vs human UCA sentences (CIDEr, METEOR, BERTScore) | Not built yet |
| M4 | Blind side-by-side human review of the scene log | Not run yet |
| M5 | Speed on the GB10 | Local Qwen3-VL: 163 windows in 146 s at concurrency 4 (about 0.9 s/window) |

## Roadmap

From `model/.plans/local-vlm-quality.md` (local plan, not in the repo). Goal: a local model as good as Gemini 2.5 Flash on detection, scene log and boxes, with Gemini as the benchmark and never as a training teacher.

| Phase | What | Status |
|---|---|---|
| 0 | Data and benchmark tooling | Done |
| 1 | Pick the base model | Done: Qwen3-VL-30B-A3B FP8 served locally and added to the app |
| 2 | Tune the pipeline without training | Done: 8 frames per window gave no Score gain; defaults kept |
| 3 | Person boxes via YOLO11 | Done: snapping and tracking run in `app/api/analyze`; box ratings await final user confirmation |
| 4 | Fine-tuning dataset from human-written UCA sentences and hand-marked theft times | Not started |
| 5 | LoRA fine-tune of bf16 `Qwen/Qwen3-VL-30B-A3B-Instruct` | **Not started** (bf16 weights not downloaded) |
| 6 | Final comparison with Gemini on bake-off v2 and UCA test | Not started (spend needs approval) |
| 7 | Winning stack as the app's default local option | Partly done: local model and YOLO boxes are in the app |

## Serving on the GB10

The GB10 has **121 GiB of memory shared by CPU and GPU** and is shared with other users. Run **one large job at a time** (a served model or training), check `free -h` and `nvidia-smi` first, and stop services when done.

Qwen3-VL-30B-A3B FP8 through HP Z Runtime (`zrt`, a vLLM wrapper), about 55 GB with KV cache, about 3 minutes to start:

```bash
sg zrt -c 'zrt serve hf:Qwen/Qwen3-VL-30B-A3B-Instruct-FP8@d9748a51ae66 --label qwen3-vl-30b-a3b --gpu-memory-fraction 0.45 -- --max-model-len 16384 --limit-mm-per-prompt '"'"'{"image":8,"video":1}'"'"''
sg zrt -c 'zrt services'        # status; OpenAI-compatible proxy at http://127.0.0.1:8080/v1
```

YOLO person boxes, as the container `kryptonx-yolo` (server: [YOLO/src/yolo_server.py](YOLO/src/yolo_server.py); the app reads `YOLO_BASE_URL=http://127.0.0.1:8090`). Run from the repo root; `-e USER -e LOGNAME` are needed with `--user`, or PyTorch fails its user lookup:

```bash
docker run -d --name kryptonx-yolo --restart unless-stopped --runtime=nvidia --gpus all \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e USER -e LOGNAME \
  -p 127.0.0.1:8090:8090 -v /srv/kryptonx-data/models/yolo:/weights:ro -v "$PWD":/workspace -w /workspace \
  kryptonx/yolo:dev python model/YOLO/src/yolo_server.py --weights /weights/yolo11m.pt --host 0.0.0.0
```

**cuDNN gotcha:** in the NGC 26.03 image, cuDNN 9.20 makes conv models such as YOLO silently return no detections on the GB10 (sm_121). The YOLO scripts set `torch.backends.cudnn.enabled = False`, which gives correct results at about 10 ms per image.

## Folder map

| Path | Contents |
|---|---|
| `model/.plans` (local plan, not in the repo) | Cross-model plans. Active: local-vlm-quality.md (`model/.plans/local-vlm-quality.md`, a local plan not in the repo) |
| [`openrouter-bakeoff/`](openrouter-bakeoff/README.md) | Model bake-off: `fetch_data.py` builds the test sets, `results*/` hold raw replies and summaries |
| [`Qwen3.8-27B-INT4/`](Qwen3.8-27B-INT4/README.md) | Shoplifting study: data fetch (`src/fetch_ucf.py`), leak audit, LoRA training and evaluation, run outputs and model card |
| [`YOLO/`](YOLO/src/) | `kryptonx/yolo:dev` image, box snapping (`yolo_snap.py`), review page (`box_review.py`), app server (`yolo_server.py`) |
| [`GLM-4.5-VL/`](GLM-4.5-VL/README.md) | GLM-4.5V arm, **skipped** 2026-09-25. Its `env/glm/` image `kryptonx/glm:dev` is the planned container for Phase 5 training |
| `Nemotron-3-Nano-Omni/` | No tracked files. Its plans were removed (git history) |
| [`study/v1/`](study/v1/) | Study splits, leak audit, exclusions and hand-marked theft times (`train_shoplifting_events.csv`) |
| [`src/`](src/) | `qwen_zrt_score.py`: runs the shoplifting scorer through a zrt endpoint |
| [`sonakshi/`](sonakshi/CLAUDE.md) | Sonakshi's UCF and MERL indexing scripts with tests, and her own working rules |
| `certs/` | CA certificate used by the UCF download scripts |

Earlier plans (GLM arm, Nemotron serving and fine-tune proposal, Qwen3.8-27B arm, first bake-off, LoRA serving runbook) were removed in commit d79bacd and are in git history.

## Datasets and licences

Large data lives on the GB10 in `/srv/kryptonx-data` (group `workspace`), not in git. Local working copies are under [`data/`](../data/README.md).

| Dataset | Location | Contents | Licence / use |
|---|---|---|---|
| UCF-Crime | `ucf-crime/raw/UCF_Crimes/Videos/` | 13 crime classes (for example Shoplifting 50, Stealing 100, Robbery 150), test Normal 150, training Normal 800 | Academic research dataset from UCF CRCV |
| UCA (UCF-Crime Annotation, CVPR 2024) | `uca/` | 1,854 videos, about 23.5k human-written timestamped sentences (train 1,165 / val 379 / test 310) | **Academic and research use only** (`uca/SOURCE.txt`). A model trained on it cannot be shipped commercially without a separate decision |
| MERL Shopping | `merl-shopping/` | 106 normal-shopping videos used as hard negatives | Research and educational use (`merl-shopping/raw/ReadMe.md`) |
| Study labels | [`study/v1/`](study/v1/) (copy in `labels-v1/`) | Splits, leak audit, 34 theft intervals in 17 training shoplifting videos | 31 of the 34 intervals are `claude-proposed` and need human review before training |
| Model weights | `models/` | YOLO11n/m, the Qwen3.8-27B shoplifting LoRA (3 seeds), GLM-4.5V bf16, Nemotron FP8 | Per model card |

**Test hygiene:** the bake-off clips (v1, v2, full) and the study's locked test cohort are test data. They are never trained on; settings are tuned only by cross-validation or on validation data.
