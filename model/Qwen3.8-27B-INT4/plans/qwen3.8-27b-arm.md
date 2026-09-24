# Qwen3.8-27B arm of the shoplifting study (RunPod H100)

Status: started 2026-09-24 · switched from GLM-4.5V to Qwen3.8-27B on 2026-09-24 · G1 passed · data partly downloaded · G0, G2–G6 pending. Update this line as gates pass.

## Context
The main study ([shoplifting-study.md](shoplifting-study.md)) uses Qwen3.8-27B, but was blocked because the weights sat in the `zrt` model cache on the GB10 machine. This arm first planned to use GLM-4.5V as a second model. **Decision (2026-09-24): we use Qwen3.8-27B instead of GLM-4.5V.** It is downloaded directly from the Hugging Face Hub onto a RunPod H100 machine, so the study no longer depends on `zrt` access.

This file covers setting up, downloading and running Qwen3.8-27B on this machine, and how its results fit into the study. `shoplifting-study.md` is not modified. Everything in it (rules, definitions, the frozen cohort from Experiment 1, endpoints and the evaluation script) applies here unchanged, unless this file says otherwise. The GLM-4.5V work done on the GB10 (`model/GLM-4.5-VL/env/glm/`, `model/GLM-4.5-VL/src/glm_pilot.py`, `model/GLM-4.5-VL/runs/glm45v/`) is kept as a record but is no longer followed.

## Qwen3.8-27B facts (model card and `config.json`, checked 2026-09-24)

| Item | Value |
|---|---|
| Model ID | `Qwen/Qwen3.8-27B` (bf16), revision `1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0`. Variant: `Qwen/Qwen3.8-27B-FP8` |
| Architecture | Dense, **27B parameters**. `Qwen3_5ForConditionalGeneration` (`model_type: qwen3_5`): 64 layers, hidden size 5120. Hybrid attention: 1 full-attention layer every 4 layers, linear attention in the rest. Includes its own vision encoder |
| Input | Images and **video** (`Qwen3VLProcessor` / `Qwen3VLVideoProcessor`, 2 fps by default). 262,144-token context |
| Thinking | On by default. Disable with `chat_template_kwargs={"enable_thinking": False}` |
| Software | Checkpoint written by transformers 5.8.0.dev0, so **transformers ≥ 5.8** is needed. vLLM and SGLang are supported (official recipes) |
| Licence | Apache-2.0 |

## Will it fit on this machine? (1× NVIDIA H100 PCIe, 80 GB)

| Precision | Weight memory (approx.) | Inference | LoRA training |
|---|---|---|---|
| bf16 | ~54 GB | ✓ (~25 GB left for cache and frames) | Likely ✓ with gradient checkpointing, because the windows are short (~1k tokens). Checked at gate G3 |
| FP8 | ~28 GB | ✓ | ✗ (not used for training) |
| 4-bit (NF4) | ~16 GB | ✓ | ✓ QLoRA. Fallback if bf16 LoRA runs out of memory |

**Consequence:** the working mode is **bf16 for both scoring and training**, so the zero-shot and fine-tuned arms see identical weights. If bf16 LoRA does not fit at G3, both arms switch to 4-bit together, and the precision is recorded and reported.

## This machine (checked 2026-09-24)
- RunPod container: x86_64, 128 CPU cores, ~2 TB RAM, 1× H100 PCIe 80 GB, driver 580.159.04, CUDA 13.0.
- Python 3.12.3. No Docker. Software goes in a venv at `/data/venv` (currently only `huggingface_hub`, `hf_transfer`, `requests` and `certifi`).
- `/data` is a network mount (MooseFS) with ~208 TB free, and it keeps data when the pod restarts. The container disk `/` is only 30 GB, so **all data, weights, venvs and run outputs go under `/data`**.
- Hugging Face is logged in with the user's token (stored only in the local HF cache, never in the repo).

## Data and model locations

| Item | Path | Status |
|---|---|---|
| Qwen3.8-27B weights | `/data/models/qwen3.8-27b/1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0/` | ✓ 32 files, 55.6 GB. Recorded in `model/Qwen3.8-27B-INT4/env/qwen/model.json`; SHA-256 in `model/Qwen3.8-27B-INT4/env/qwen/weights.sha256` |
| UCF-Crime Shoplifting | `/data/ucf-crime/raw/UCF_Crimes/Videos/Shoplifting/` | ✓ 50 videos, 2.65 GB, CRC-32 checked by `fetch_ucf.py` |
| UCF-Crime normal videos (`Training_Normal_Videos_Anomaly`, `Testing_Normal_Videos_Anomaly`) | `/data/ucf-crime/raw/` | ✗ Not downloaded. Needed as negatives |
| UCF-Crime Stealing (secondary hard negatives) | `/data/ucf-crime/raw/` | ✗ Not downloaded |
| UCF-Crime split files and test time stamps | `/data/ucf-crime/index/` (`videos.csv`, `events.csv`) | ✗ Not built yet on this machine |
| MERL Shopping (hard negatives) | `/data/merl-shopping/` | ✗ Not downloaded |
| Download logs | `/data/logs/` | — |
| Run outputs | `model/Qwen3.8-27B-INT4/runs/qwen38/<exp>/<seed>/` (adapters and large files in `/data/runs/qwen38/`) | — |

## Pre-specified for this arm
- **Cohort, windows, labels and prompt protocol:** identical to the main study. They are built once in its Experiment 1 and shared. With Qwen as the study model, this arm **is** the main study's primary comparison, run on this machine.
- **Primary comparison:** Qwen3.8-27B LoRA vs Qwen3.8-27B zero-shot, as ΔAUROC on windows with a paired 95% CI from bootstrapping by video, over 3 seeds.
- **GLM-4.5V:** dropped. A cross-model comparison is no longer planned.

---

## Steps and gates (in order)

### G0 — Environment
1. Install in `/data/venv`: torch (CUDA wheel matching driver 580 / CUDA 13), transformers ≥ 5.8, peft, accelerate, bitsandbytes (only for the 4-bit fallback), the linear-attention kernels transformers asks for with `qwen3_5` (flash-linear-attention and causal-conv1d), and PyAV or decord. vLLM in a separate venv (`/data/venv-vllm`) if serving is needed, because it pins its own torch.
2. Record the versions in `model/Qwen3.8-27B-INT4/env/qwen/requirements.lock`, and the driver, CUDA and GPU in `model/Qwen3.8-27B-INT4/env/qwen/env.json`.

**Gate:** `torch.cuda.is_available()` is true, and the `qwen3_5` config and `Qwen3VLProcessor` load from the local directory without errors.

### G1 — Download
1. Location chosen: `/data/models/` (it keeps data across pod restarts; the container disk is too small).
2. Pinned revision `1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0` (18 shards, 55.6 GB, not gated), downloaded with `hf download Qwen/Qwen3.8-27B --revision <sha> --local-dir /data/models/qwen3.8-27b/<sha>`.
3. SHA-256 of every large file in `model/Qwen3.8-27B-INT4/env/qwen/weights.sha256`, and the revision in `model/Qwen3.8-27B-INT4/env/qwen/model.json`. Weights are never committed; the root `.gitignore` already excludes model weights.

**Gate:** the checksums are recorded and the files load.

**Result (2026-09-24): download and checksums passed.** All 32 files match the Hub's sizes, and all 19 large files match the Hub's SHA-256 (`sha256sum -c model/Qwen3.8-27B-INT4/env/qwen/weights.sha256` in the model directory). The load check waits for the G0 software.

### D — Data needed before the cohort can be built
1. Done: `python model/Qwen3.8-27B-INT4/src/fetch_ucf.py --classes Shoplifting --out /data/ucf-crime/raw` (50 videos).
2. To do: fetch `Training_Normal_Videos_Anomaly` and `Testing_Normal_Videos_Anomaly` (run `--list` first to check size), plus `Stealing`, into `/data/ucf-crime/raw`.
3. To do: get the official split lists and test time stamps, and build `/data/ucf-crime/index/videos.csv` and `events.csv` (main study, Experiment 1).
4. To do: download MERL Shopping to `/data/merl-shopping/`.

**Gate:** the index files exist and the file checks pass. Experiment 1 of the main study (annotation, leakage audit, frozen cohort in `model/study/v1/`) then runs as written.

### G2 — Inference pilot (20 validation windows)
1. Load in bf16 with thinking off. Feed one 8 s window (16 frames at 2 fps, native resolution) using the main study's prompt.
2. Read P("yes") from the first answer token's log-probabilities, and check that the model answers directly (no thinking tokens in the answer).
3. Measure seconds per window, peak memory, input tokens per window and determinism (the same window scored twice gives the same score).

**Gate:** 20 windows scored deterministically, and throughput recorded.

### G3 — Training pilot
1. LoRA on 50 training windows (peft + transformers Trainer, or LLaMA-Factory if it supports `qwen3_5`):
   - LoRA rank 16 on the attention and MLP projections of the language model.
   - **Vision encoder frozen.** Gradient checkpointing on.
2. Run 1 epoch in bf16. If it runs out of memory, switch to QLoRA (NF4) and apply the precision rule above. Record step time and peak memory. Check that the loss decreases and that the adapter saves and reloads with the same scores.
3. Extrapolate the full budget: Experiment 3 grid (≤ 4 configurations) + 3 seeds + scoring for Experiments 2–5. If it exceeds about 2 weeks on this GPU, reduce the frame count or rank *before* Experiment 1 is frozen (main study, Experiment 0 step 4).

**Gate:** the adapter trains and reloads, and the precision and budget are recorded.

### G4 — Record the setup
Write the precision mode, throughput and budget into the main study's Experiment 0. Then set the status line of `shoplifting-study.md` to "Experiment 0 passed on RunPod H100 (see qwen3.8-27b-arm.md)". That status line is the only edit to that file.

### G5 — Run the study protocol
Run Experiments 2–5 of the main plan with Qwen3.8-27B on the **shared frozen cohort** (`model/study/v1/`):
1. Experiment 2 (zero-shot): prompt and frame sampling chosen on validation only, then frozen.
2. Experiment 3 (LoRA): grid on validation, 3 seeds, test scored once and unsealed together with the zero-shot scores.
3. Experiments 4–5: localisation, hard negatives (MERL), overlay masking, error review.
4. Outputs go to `model/Qwen3.8-27B-INT4/runs/qwen38/<exp>/<seed>/` (configuration, raw scores, `env.json` with the revision, precision and versions). Adapters are stored in `/data/runs/qwen38/<exp>/<seed>/`.

### G6 — Report
- Results table: Qwen zero-shot, Qwen LoRA seeds 1–3 plus the mean, with the same columns as the main study's Experiment 3 table.
- Export sample detections in data-contract JSON (`model.name = "qwen3.8-27b"`, with the revision), for display in the web app.

---

## Verification
- `weights.sha256` matches the downloaded files, and the revision is pinned in `model.json`.
- Scoring the same window twice gives identical P("yes"), and the adapter scores identically before and after reload.
- The cross-split overlap test from the main study passes before every training run.
- No test-set metric is computed before the Experiment 2 and 3 configurations are both frozen.

## Needed from the user
1. ~~Model download and HF token~~ — done 2026-09-24.
2. Approval to fetch the UCF normal videos (the 800 training normal videos are large; the size is checked with `--list` first) and Stealing.
3. A source for MERL Shopping.

Sources: [Qwen3.8-27B model card](https://huggingface.co/Qwen/Qwen3.8-27B) · [Qwen3.8-27B-FP8](https://huggingface.co/Qwen/Qwen3.8-27B-FP8) · [vLLM recipe](https://recipes.vllm.ai/Qwen/Qwen3.8-27B)
