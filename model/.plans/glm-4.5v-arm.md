# GLM-4.5V arm of the shoplifting study

Status: started 2026-09-24 · G0 passed · G1 passed · G2 running · G3–G6 pending. Update this line as gates pass.

## Context
The main study ([shoplifting-study.md](shoplifting-study.md)) uses Qwen3.8-27B, which is blocked until the user can access the `zrt` model cache. This plan adds **GLM-4.5V** (zai-org, MIT licence) as a second model under the **same protocol**. It covers downloading and running GLM-4.5V on this machine, and how its results fit into the study. `shoplifting-study.md` is not modified. Everything in it (rules, definitions, the frozen cohort from Experiment 1, endpoints and the evaluation script) applies here unchanged, unless this file says otherwise.

## GLM-4.5V facts (model card, checked 2026-09-24)

| Item | Value |
|---|---|
| Model ID | `zai-org/GLM-4.5V` (bf16). Variants: `zai-org/GLM-4.5V-FP8`, `QuantTrio/GLM-4.5V-AWQ` (4-bit, community) |
| Architecture | Mixture of experts: 106B total parameters, **12B active per token**. Language model: GLM-4.5-Air |
| Input | Images and **video**. 64k-token context |
| Thinking | On by default. Disable with `chat_template_kwargs={"enable_thinking": False}` |
| Software | transformers ≥ 4.57.1, vLLM ≥ 0.10.2. Fine-tuning officially supported in LLaMA-Factory |
| Licence | MIT |
| Newer | GLM-4.6V (106B) and GLM-4.6V-Flash (9B) exist. Kept here as fallbacks, not the target |

## Will it fit on this machine? (GB10, about 121 GiB of memory shared by CPU and GPU)

| Precision | Weight memory (approx.) | Inference | LoRA training |
|---|---|---|---|
| bf16 | ~212 GB | ✗ does not fit | ✗ |
| FP8 | ~108 GB | Borderline: ~10 GB left for cache, frames and the OS | ✗ |
| 4-bit (NF4 / AWQ) | ~55–60 GB | ✓ | ✓ QLoRA, if 4-bit kernels run on this GPU (checked at gate G2) |

**Consequence:** the working mode is **4-bit weights for both scoring and training**, so the zero-shot and fine-tuned arms see identical weights. This makes GLM a 4-bit model while Qwen may run in bf16. That difference is recorded and reported as a caveat on any head-to-head comparison.

## Machine constraints found
- aarch64 CPU, GPU compute capability 12.1 (sm_121), CUDA 13.0, Python 3.12.3.
- None of torch, transformers, vLLM or huggingface_hub are installed.
- Docker 29.2 is installed, but `shravan` is not in the `docker` group.
- `/srv/kryptonx-data` is writable through the `workspace` group. Disk: 3.2 TB free.

## Pre-specified for this arm
- **Cohort, windows, labels and prompt protocol:** identical to the main study. They are built once in its Experiment 1 and shared.
- **Arm primary comparison:** GLM-4.5V LoRA vs GLM-4.5V zero-shot, as ΔAUROC on windows with a paired 95% CI from bootstrapping by video, over 3 seeds.
- **Cross-model comparison (secondary):** GLM vs Qwen, zero-shot vs zero-shot and LoRA vs LoRA. Each uses its own configuration frozen on validation; precision differences are noted.
- **Which model is primary:** decided at gate G4 **before** the main study's Experiment 1 is frozen, then written into both plan files. It is never switched after test scores exist.

---

## Steps and gates (in order)

### G0 — Access and environment
1. Add `shravan` to the `docker` group (`sudo usermod -aG docker shravan`, then log in again). This is the preferred route on aarch64 + CUDA 13, because prebuilt pip wheels for sm_121 are unreliable.
2. Pull NVIDIA's ARM64 CUDA 13 containers for this GPU class: an NGC PyTorch image for training and an NGC or vLLM image for serving. Record the image digests in `model/env/glm/images.lock`.
3. Inside the training container, install and pin transformers ≥ 4.57.1, peft, accelerate, bitsandbytes, LLaMA-Factory, huggingface_hub and PyAV/decord. Record them in `model/env/glm/requirements.lock`.

**Gate:** `torch.cuda.is_available()` is true in the container and a 4-bit matmul test (bitsandbytes) runs on the GPU.

**Result (2026-09-24): passed.** Base image `nvcr.io/nvidia/vllm:26.03.post1-py3` (already on the host; torch 2.11 with CUDA 13.2, transformers 4.57.5, vLLM 0.17.1, sees the GB10 as sm_121) plus peft 0.21.0, bitsandbytes 0.50.2 and accelerate 1.15.0 → `kryptonx/glm:dev`, built from `model/env/glm/Dockerfile`. The NF4 matmul runs on the GPU. Pins are in `images.lock` and `requirements.lock`. No NGC PyTorch image was needed.

### G1 — Download
1. Location chosen: `/srv/kryptonx-data/models/` (already shared through the `workspace` group).
2. Pinned revision `ed47433b37111465ec527affaaddceff371bca04` (46 shards, 215.4 GB, not gated), downloading to `/srv/kryptonx-data/models/glm-4.5v/<revision>/` with `hf download zai-org/GLM-4.5V --revision <sha>`.
   - The bf16 checkpoint (~216 GB) is the source of truth. It is quantised to 4-bit when loaded.
   - Optional: `zai-org/GLM-4.5V-FP8`, only if vLLM serving becomes necessary.
3. Write SHA-256 checksums of every safetensors shard to `model/env/glm/weights.sha256`, and the revision to `model/env/glm/model.json`. Weights are never committed; the root `.gitignore` already excludes model weights.

**Gate:** the checksums are recorded and the files load (`AutoConfig` plus the processor load without errors).

**Result (2026-09-24): passed.** 56 files, 201 GB on disk. All 47 large files match the Hub's SHA-256 (`model/env/glm/weights.sha256`). Config (`glm4v_moe`) and `Glm4vProcessor` load in `kryptonx/glm:dev`. An 8 s window (16 frames at 320×240) becomes 873 input tokens, and thinking is disabled through the template's `/nothink` plus an empty think block.

### G2 — Inference pilot (20 validation windows)
1. Load in 4-bit (NF4) with thinking off. Feed one 8 s window (16 frames at 2 fps, native resolution) using the main study's prompt.
2. Read P("yes") from the first answer token's log-probabilities, and check that the model answers directly (no thinking tokens, no `<|begin_of_box|>` output).
3. Measure seconds per window, peak memory and determinism (the same window scored twice gives the same score).
4. If 4-bit kernels fail on sm_121: try the AWQ variant for inference. If training is still impossible, stop at **G4-fallback**.

**Gate:** 20 windows scored deterministically, and throughput recorded.

### G3 — Training pilot
1. QLoRA with LLaMA-Factory on 50 training windows:
   - LoRA rank 16 on the attention projections and shared dense layers.
   - **Routed experts, router and vision encoder frozen**, which keeps memory bounded on the mixture of experts.
2. Run 1 epoch. Record step time and peak memory. Check that the loss decreases and that the adapter saves and reloads with the same scores.
3. Extrapolate the full budget: Experiment 3 grid (≤ 4 configurations) + 3 seeds + scoring for Experiments 2–5.

**Gate:** the adapter trains and reloads, and the budget is recorded.

### G4 — Decision: which model is primary
Compare the G2/G3 results against the Qwen pilot (if it has been unblocked) on: feasibility, total compute budget, and zero-shot **validation** AUROC on the same windows. Test data is never used.
- **Option A:** GLM is primary, Qwen secondary.
- **Option B:** Qwen is primary, GLM secondary.
- **Option C (G4-fallback):** GLM-4.5V is infeasible → try GLM-4.6V-Flash (9B, bf16, fits easily) as the GLM-family arm, or drop the arm.

Record the decision and its reasons at the top of this file and in the status line of `shoplifting-study.md`. That status line is the only edit to that file, and only once the decision is made.

### G5 — Run the study protocol with GLM
Run Experiments 2–5 of the main plan with GLM-4.5V on the **shared frozen cohort** (`model/study/v1/`):
1. Experiment 2 (zero-shot): prompt and frame sampling chosen on validation only, then frozen.
2. Experiment 3 (LoRA): grid on validation, 3 seeds, test scored once and unsealed together with the zero-shot scores.
3. Experiments 4–5: localisation, hard negatives (MERL), overlay masking, error review.
4. Outputs go to `model/runs/glm45v/<exp>/<seed>/` (configuration, adapter, raw scores, `env.json` with the container digest, revision, precision and versions).

### G6 — Report
- Results table: GLM zero-shot, GLM LoRA seeds 1–3 plus the mean, with the same columns as the main study's Experiment 3 table.
- Cross-model table (secondary): GLM vs Qwen, with a paired bootstrap ΔAUROC and a precision caveat.
- Export sample detections in data-contract JSON (`model.name = "glm-4.5v"`, with the revision), for display in the web app.

---

## Verification
- `weights.sha256` matches the downloaded files, and the revision is pinned in `model.json`.
- Scoring the same window twice gives identical P("yes"), and the adapter scores identically before and after reload.
- The cross-split overlap test from the main study passes before every GLM training run.
- No test-set metric is computed before the Experiment 2 and 3 configurations are both frozen.

## Needed from the user
1. ~~Docker access, the download and the model location~~ — done 2026-09-24.
2. Optional: a Hugging Face token (`HF_TOKEN`) for faster downloads. None is configured on this machine.

Sources: [GLM-4.5V model card](https://huggingface.co/zai-org/GLM-4.5V) · [GLM-4.5V-FP8](https://huggingface.co/zai-org/GLM-4.5V-FP8) · [GLM-4.5V-AWQ](https://huggingface.co/QuantTrio/GLM-4.5V-AWQ) · [GLM-4.6V-FP8 (family reference)](https://huggingface.co/zai-org/GLM-4.6V-FP8)
