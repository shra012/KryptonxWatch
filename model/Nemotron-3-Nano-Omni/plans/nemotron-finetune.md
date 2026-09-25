# Fine-tune Nemotron-3-Nano-Omni to Gemini level (scene log, detection, objects)

Status: proposed 2026-09-25 · awaiting approval. Update this line as phases finish.

## Context
Nemotron-3-Nano-Omni-30B-A3B now serves locally for the web app ([nemotron-local-serving.md](nemotron-local-serving.md)). On the team's larger OpenRouter bake-offs it already **beats Gemini 2.5 Flash on overall Score** (full: 63% vs 57%, because Gemini false-alarms on 57% of normal clips), but it **trails on naming the right crime** (52% vs 71%) and on timed-event hits (60/93 vs 82/93). Its scene log and boxes have not been measured against human references yet. The goal: match or beat Gemini on **scene log, detection (category and timing) and object/person localisation**, running locally.

**Rules carried over from [local-vlm-quality.md](../../.plans/local-vlm-quality.md):**
- Gemini is only a benchmark, never a teacher (Google's terms restrict training on its outputs), so training data is human-written.
- Test videos (bake-off v1/v2/full, the study's locked cohort, UCA test) are never trained on.

## Fine-tuning route (NVIDIA's own)
[NeMo AutoModel's Nemotron-Omni recipe](https://docs.nvidia.com/nemo/automodel/recipes-e2e-examples/nemotron-omni):
- LoRA rank 64, alpha 128, learning rate 1e-3.
- **Frozen:** vision encoder (RADIO), audio encoder, all 128 MoE experts, the Mamba2 layers. **Trained:** the attention projections, giving an adapter of about 27 MB.
- Container: NeMo AutoModel ≥ 26.04 with `mamba_ssm`, `causal_conv1d`, `decord`.
- Base weights: **BF16** (`nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`, 62–66 GB). FP8/NVFP4 are serving formats, not trainable.
- NVIDIA ran it on 8× H100 (about 30 GiB/GPU with expert parallelism 8). On one GB10 (121 GiB shared) the whole BF16 model plus activations has to fit on one device, so **the pilot decides whether it is feasible** (LoRA on frozen weights, sequence ≤ 4k, batch 1, gradient checkpointing).
- Serving the result: merge the LoRA into BF16 (`W += (B@A)·scale`), then serve the merged BF16 or re-quantise to FP8 (ModelOpt) in the Spark vLLM container.

## Targets and measures
| What | Measure | Gemini now | Goal |
|---|---|---|---|
| Detection | M1: Score, right crime, false alarms, timed hits (`vlm-benchmark.ts score`) on **full** and v2 | full 57% / 71% / 57% FA / 82 of 93 | ≥ Gemini on Score **and** right crime ≥ 65% |
| Scene log | M3: CIDEr / METEOR / BERTScore of window summaries vs **UCA human sentences** (UCA test videos) | to measure (about $0.5 of API calls, ask first) | ≥ Gemini |
| Objects / people | M2: human-rated "right person/object boxed" on a 30-moment review page | to measure | ≥ Gemini |
| Blind review | M4: side-by-side scene logs, labels hidden | – | Preferred ≥ 50% |
| Speed | M5: s/window on the GB10 | 1.4 s (API) | ≤ 3 s |

All on held-out data, with 95% CIs from bootstrapping by video; 3 seeds for the final adapter.

## Phases (in order; each ends at a gate)

### F0: Baseline (no training)
Run the local Nemotron (served now) on v1, v2 and full, plus the UCA-test scene-log measure, and the same for Gemini (M3 only, **ask before spending**). Gate: a baseline table that the fine-tune must beat.

### F1: Training data (`model/study/vlm-ft-v1/`, frozen with checksums)
1. **Videos:** UCA-train ∩ UCF-train (1,165 UCA-train videos minus exclusions), UCF Training Normal (800, downloading), MERL train subjects (hard negatives). **Exclude** every test video above plus leak-audit neighbours (pHash/scene clusters).
2. **Windows:** 8 s, matching the app's analysis pipeline (4 frames per window).
3. **Targets** in the app's JSON schema (`summary`, `incidents[{category, severity, confidence, frame, description}]`):
   - **Scene log (`summary`):** the UCA sentence(s) overlapping the window, human-written.
   - **Detection:**
     - For shoplifting, windows inside the study's theft intervals (`train_shoplifting_events.csv`, after human review of the `claude-proposed` rows).
     - For other classes, UCA sentences marked as "the crime" by a **local** text model, with a 10% human check needing ≥ 90% agreement.
     - The category comes from the UCF class; normal windows get `incidents: []`.
   - **Objects:** descriptions name the object from the UCA sentence ("puts a phone in his pocket"). **Boxes are not trained**: the app's YOLO tracker places them on the person the model points at. Training boxes would need box labels we don't have.
4. Balance: negatives capped at 3:1. Validation = UCA val, built the same way.
5. Gate: a dataset card (counts per class, review agreement) and checksums.

### F2: Environment and pilot
1. Pull the NeMo AutoModel ≥ 26.04 arm64 image (check an arm64/sm_121 build exists; otherwise build `mamba_ssm`/`causal_conv1d` for sm_121 in the Spark image).
2. Download BF16 weights (62–66 GB) to `/srv/kryptonx-data/models/nemotron-omni-bf16/`.
3. **Stop Nemotron serving during training**, cap the GPU clock (`nvidia-smi -lgc 200,1800`), warn the team, and run the GPU monitor.
4. Pilot: 50 windows, 1 epoch. Record memory, s/step and loss; check the adapter saves, merges and serves with an identical score before/after merge.
5. Gate: fits in memory with no machine reset, and a total time estimate. **If single-GB10 LoRA doesn't fit or crashes: stop and decide** (shorter sequences, fewer LoRA targets, or rent one H100 for the training runs only).

### F3: Train
Learning rate × epochs chosen on **UCA val** (M3 + validation detection score), at most 4 configurations, then 3 seeds of the best. Checkpoints to `model/Nemotron-3-Nano-Omni/runs/`, adapters to `/srv/kryptonx-data/models/`.

### F4: Evaluate against Gemini
M1 on full and v2, M3 on UCA test, M2 on a 30-moment box/object review, M4 blind review. Gate: the targets table above, with CIs.

### F5: Ship
Merge the best adapter, serve in the Spark container (FP8 re-quantised if accuracy holds), and switch the web app's `local-vlm:nemotron-omni` to it. Keep the base model available for A/B comparison.

## Risks
- **Crashes:** Mamba/Triton kernels also run in training (forward and backward). Keep the clock cap on and train only when the GPU is otherwise idle.
- **Single-GPU memory:** the reference ran on 8 GPUs. The pilot decides feasibility.
- **Label quality:** incident windows for non-shoplifting classes depend on the text labeller plus the 10% human check.
- **Licences:** UCA is academic/research only, so a model trained on it may not be used commercially. The NVIDIA Open Model Agreement allows commercial use; check its terms for derivatives before shipping.

## Verification
- Every run writes raw replies and scores. Dataset, adapter and merged weights are checksummed.
- The leak check runs before each training run.
- In the web app, 3 uploaded clips show the fine-tuned scene log, detections and boxes next to the base model's.
