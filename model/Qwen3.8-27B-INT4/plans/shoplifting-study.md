# Study plan: shoplifting detection with Qwen3.8-27B (robbery to follow)

Status: approved 2026-09-24 · Exp 0-4 done 2026-09-24 · Exp 3 primary result: ΔAUROC +0.027 ± 0.005 (3 seeds), every 95% CI includes 0, so not conclusive; localisation worse than zero-shot · adapters public at https://huggingface.co/shra012/qwen3.8-27b-ucf-shoplifting-lora · Exp 5-6 not started.

## Context
KryptonxWatch needs a model that flags **shoplifting** (and later **robbery**) in store CCTV and says *when* it happens, so the web app timeline can show it. We will fine-tune Qwen3.8-27B, a dense vision-language model with video input, on UCF-Crime and MERL Shopping. The study follows the rigour of the reference study: a leakage-free benchmark first, pre-specified endpoints, three seeds, 95% confidence intervals clustered by video, and everything versioned. That way the reported result means something and isn't produced by leakage or by tuning on the test set.

## What is available (checked 2026-09-24)

| Resource | What is there | Gap |
|---|---|---|
| UCF-Crime `/srv/kryptonx-data/ucf-crime` | Shoplifting 50 videos (29 train / 21 test), Stealing 100 (95 / 5), Normal 150 (test only). All 320×240, 30 fps. `index/videos.csv`, `index/events.csv` | **Time-stamped events exist only for test videos** (25 shoplifting events in 21 videos, median length 6.5 s). **No normal training videos in the folder** (the official split lists 800). Robbery (150 videos, 2.97 GB) is being fetched to `~/kryptonx-data-staging/ucf-crime/raw` with `model/Qwen3.8-27B-INT4/src/fetch_ucf.py`, to move into `/srv` once writable |
| MERL Shopping `/srv/kryptonx-data/merl-shopping` | 106 videos, 41 subjects, 920×680. 5 normal shopping actions (5,377 labelled instances) with a subject-disjoint 60/18/28 split | Contains no theft. Used only as hard negatives |
| Model | Qwen3.8-27B in the HP Z Runtime cache (`/opt/hp/zrt`, served by vLLM) | The user is not in the `zrt` group, so the weights can't be read or served yet |
| Hardware | NVIDIA GB10, about 121 GiB of memory shared by CPU and GPU, 20 cores, 3.2 TB free | Enough for LoRA on 27B. Speed is set in the Experiment 0 pilot |

## Rules that apply to every experiment
- **Keep splits disjoint by source.** The unit that must not cross splits is the *source video and its scene/camera cluster*; for MERL it is the *subject*. Never tune thresholds, prompts, frame sampling or calibration on the test set.
- **Pre-specify** one primary endpoint and one primary comparison for each experiment. Everything else is labelled secondary or exploratory.
- **Every trainable model runs with at least 3 seeds.** Report effect sizes with 95% bootstrap confidence intervals, resampling **by video**, since windows from the same video are not independent.
- **Version everything:** manifests, checkpoint/adapter, prompt, frame-sampling configuration and evaluation script. Record the hardware, precision, batch size and software versions.
- **Honest labelling.** Model outputs are "suspected" events for human review. Results on UCF-Crime do not by themselves show that the model works in real stores.

## Pre-specified definitions
- **Positive (shoplifting):** a person conceals or takes merchandise in a retail setting with evident intent to leave without paying.
- **Prediction unit:** an 8 s window with a 4 s stride, 2 fps (16 frames), native resolution. A window is positive if at least 50% of it, or at least 2 s, overlaps an annotated event.
- **Model output:** the answer to a fixed yes/no question. The score is P("yes") from the token log-probabilities, with thinking off. Windows are merged into events (by threshold and 2 s gap merging) for localisation.
- **Stealing (UCF):** excluded from the primary endpoint because the label is ambiguous (bikes, cars, bags). Reported as a secondary hard-negative analysis.
- **Primary endpoint (whole study):** window-level AUROC for shoplifting vs everything else on the locked UCF test cohort.
- **Primary comparison:** Qwen3.8-27B with LoRA vs Qwen3.8-27B zero-shot (same prompt, same frames).

---

## Experiment 0: Environment and model access (prerequisite)
**Why:** No result can be reproduced until the weights, the software stack and the throughput are pinned.

**Steps**
1. **Access (user action):** `sudo usermod -aG zrt shravan`, then log in again. Confirm that `zrt models` lists Qwen3.8-27B, record the exact revision hash, and locate the HF-format weights for training.
2. Create `model/env/` with pinned versions (torch, transformers, peft, trl, accelerate, decord or PyAV) and a lockfile. Record the CUDA and driver versions (580.159 / CUDA 13.0).
3. **Pilot run** on 20 validation windows:
   - Inference through `zrt serve` (vLLM, OpenAI-compatible API with video input): measure windows per second and peak memory.
   - Training: one LoRA step in bf16. If it runs out of memory, use QLoRA (4-bit NF4). Record step time and memory.
4. Estimate the total compute budget for Experiments 2–5. If 3 seeds × planned runs exceed about 2 weeks, reduce the frame count or rank *before* Experiment 1 is frozen.

**Completion gate:** the model loads and generates on a video window, a LoRA step completes, and the precision mode and time budget are recorded.

## Experiment 1: Leakage-free benchmark and cohort reconstruction
**Why:** UCF-Crime has known problems: near-duplicate clips, the same store camera in several videos, and compilation or news footage with burned-in captions, logos and borders. Training videos have no time stamps. Until the cohort, labels and split can be reproduced exactly, any comparison is uninterpretable.

**How to perform the experiment**
1. **Freeze the label schema and data dictionary** (definitions above). Document how Normal, Stealing, uncertain segments and multi-event videos are handled.
2. **Complete the data** (the user reports it was downloaded, but it isn't in the folder):
   - Fetch with `python3 model/Qwen3.8-27B-INT4/src/fetch_ucf.py --classes <Folder> --out <raw>`. It reads only the needed files from the 103 GB official zip over HTTP range requests and checks each file's CRC. Robbery: fetched 2026-09-24 (staging). `Training_Normal_Videos_Anomaly` (800 videos): run `--list` first to check the size.
   - Rebuild `index/videos.csv` and `index/events.csv` from the original filenames and split files.
   - Verify the checksums.
3. **Time-stamp the training positives.** The 29 training shoplifting videos (about 3 h) only have a label for the whole video. Two annotators independently mark start and end times with the same tool and guideline. Report agreement (Cohen's κ on 1 s bins). A third reviewer resolves disagreements. *Clip-level training is impossible without this step.*
4. **Audit leakage.**
   - Perceptual hashes (pHash) on 1 fps keyframes, compared across all videos: near-duplicates and sub-clips.
   - Scene clusters from background embeddings of median frames: same camera or store.
   - Overlay detection: text, logos, borders, letterboxing.
   - Record every exclusion or merge in an inclusion/exclusion log.
5. **Build the splits.**
   - The official UCF test set stays the locked test, minus any videos that duplicate training videos.
   - Validation comes from the training pool: about 20% of positives and negatives, grouped by scene cluster, so no cluster crosses splits.
   - MERL: subjects 1–20 train, 21–26 validation, 27–41 test.
   - Class prevalence in validation and test stays natural (not rebalanced).
6. **Report input conditions.** Frame rate, resolution and presence of overlays, recorded for each video. The primary analysis uses unaltered frames. Overlay-masked frames are a secondary robustness condition and are never mixed into the primary result.
7. **Estimate precision.** Run the zero-shot model on validation only and compute the bootstrap CI width of AUROC. If the half-width is above 0.10, pre-register the primary comparison as exploratory and state it.
8. **Freeze and checksum** the manifests, data dictionary, exclusion log, annotation files and evaluation protocol (`model/study/v1/`) *before* any model comparison.

**Required deliverables**

| Split | Source videos | Scene clusters | Windows (pos / neg) | Shoplifting prevalence | Hours | Duplicates / overlap |
|---|---|---|---|---|---|---|
| Train | [Fill] | [Fill] | [Fill] | [Fill] | [Fill] | [Fill] |
| Val | [Fill] | [Fill] | [Fill] | [Fill] | [Fill] | [Fill] |
| Test (locked) | [Fill] | [Fill] | [Fill] | [Fill] | [Fill] | [Fill] |
| MERL test (hard negatives) | [Fill] | n/a | [Fill] | 0 | [Fill] | [Fill] |

**Required figures:** a video → window flow diagram with exclusions; a prevalence plot by split; a duplicate/scene-overlap audit (a heatmap of cross-split pHash matches, which must be empty); a histogram of annotator agreement.

**Completion gate:** the cohort can be rebuilt exactly from the scripts, there is zero cross-split overlap of videos or scene clusters, labels agree with the dictionary, and κ is at least 0.6.

## Experiment 2: Zero-shot baseline
**Why:** The fine-tuning claim needs a fixed and fair reference point.

**Steps**
1. Write 3 or more prompt candidates. Select one, and the frame sampling, on **validation only** by AUROC, then freeze them.
2. Score every test window once (deterministic decoding). Save raw scores.
3. Secondary: video-level AUROC (max over windows), false positives per hour on normal footage and on MERL test, and latency per window.

**Completion gate:** frozen prompt and configuration hash, and test scores saved. Test metrics are not viewed until Experiment 3 is also frozen (the two are compared together).

## Experiment 3: LoRA fine-tuning (primary comparison)
**Why:** This tests whether task-specific training improves detection beyond zero-shot.

**Steps**
1. **Data:**
   - Training windows from Experiment 1: positives from the annotated events.
   - Negatives from UCF normal videos, the non-event parts of shoplifting videos, and MERL train (hard negatives).
   - Negatives are subsampled to at most 5:1, documented.
2. **Adapter:** LoRA on the language model's attention and MLP layers, vision encoder frozen, rank 16. Precision as decided in Experiment 0. Same prompt as Experiment 2; the target is "yes"/"no".
3. **Hyperparameters:** a small grid (learning rate × epochs, at most 4 configurations) chosen on validation AUROC. Then 3 seeds of the chosen configuration.
4. **Evaluate on test once:**
   - Primary: ΔAUROC (fine-tuned − zero-shot) with a paired, video-clustered bootstrap 95% CI, reported for each seed and as the mean across seeds.
   - Secondary: AUPRC, sensitivity at the validation threshold for about 1 false positive per hour, and calibration (ECE, reliability plot).
5. Serve the adapter through `zrt`/vLLM LoRA loading to confirm that inference matches training-time scoring.

**Deliverables:**
- A results table with rows for zero-shot and fine-tuned seeds 1–3 plus the mean, and columns for AUROC [CI], AUPRC [CI], sensitivity at 1 FP/h, FP/h on normal footage, FP/h on MERL, and ECE.
- ROC and PR curves.

## Experiment 4: Temporal localisation (secondary)
**Why:** The product shows *when* something happened, not just whether it did.

**Steps:** Merge windows into events with parameters frozen on validation. Report event-level recall and precision at temporal IoU of 0.3 and 0.5, the median onset error in seconds, and mAP@tIoU. The output uses the `Detection` format in `docs/data-contract.md` (`startSec`, `endSec`, `peakSec`, `confidence`, `model`).

## Experiment 5: Robustness and failure analysis (exploratory)
- **Hard negatives:** MERL test FP/h for each action type (reach, retract, hand in shelf, inspect). Which normal actions trigger alarms?
- **Stealing videos:** how does the model score non-retail theft?
- **Overlay-masked frames:** does performance drop when captions and logos are removed? A large drop means the model learned shortcuts.
- **Error review:** a qualitative look at the 20 worst false positives and false negatives, with frames.

## Experiment 6: Robbery extension (after Experiments 1–5)
Repeat Experiments 1–4 for **robbery** (UCF Robbery, once downloaded and time-stamped), then train one two-label model (shoplifting, robbery) and compare it with the single-task models. This gets its own plan in `model/Qwen3.8-27B-INT4/plans/` when it starts.

---

## Execution log (deviations from the plan above)
- **Hardware:** runs on an NVIDIA H100 80 GB (RunPod) instead of the GB10. bf16 LoRA fits (G3 pilot: 56.6 GiB peak, about 20-25 s per 8-window step).
- **Training labels (Exp 1 step 3):** no human time stamps were made for the training shoplifting videos. A review of the top zero-shot candidate clips found only 1 of 9 clearly showed theft, so Experiment 3 uses **multiple-instance learning** instead: each round takes the current model's top 3 windows per training shoplifting video as positives, plus Normal negatives at 5:1 (`mil_round.py`, `run_mil.sh`).
- **Selection metric:** validation has no time stamps either, and zero-shot validation video AUROC is already 1.0 (12 videos), so the grid selects on validation MIL NLL (`evaluate.py val`), not window AUROC.
- **Grid:** learning rate {1e-4, 2e-4} × MIL rounds {1, 2, 3}, seed 1, then seeds 2 and 3 of the selected setting (`run_study.sh`, `select_config.py`).
- **Localisation (Exp 4):** threshold = 1 FP/h on validation Normal windows, 2 s gap merging, central 4 s of each window. Pre-specified, not tuned, because validation has no time stamps (`localize.py`).
- **Leakage audit:** 6 training videos shared a store camera with test videos and were excluded (`study/v1/exclusions.csv`). Study split: Shoplifting 21 / 5 / 21, Normal 30 / 7 / 150.
- **Zero-shot test scores** (5,808 windows) are sealed read-only, with the sha256 in `model/Qwen3.8-27B-INT4/runs/qwen38/exp2/`. They are read only after the adapters are frozen.
- **Publishing:** `publish_hf.py` builds the model card and uploads to a public `shra012/qwen3.8-27b-ucf-shoplifting-lora`.

- **Result (sealed test, 169 videos, 5,808 windows, 89 positive):** zero-shot window AUROC 0.895 [0.840, 0.946]. LoRA seeds 0.917 / 0.924 / 0.926, ΔAUROC +0.022 [-0.019, 0.067], +0.029 [-0.014, 0.072], +0.031 [-0.004, 0.073]. AUPRC 0.142 zero-shot vs 0.112 mean. Localisation AP@tIoU0.3 0.068 vs 0.027; predicted events are 3-6× longer after MIL training. The val 1 FP/h threshold (6 min of val normals) gives about 90 FP/h on test normals. Full tables: `model/Qwen3.8-27B-INT4/runs/qwen38/exp3/MODEL_CARD.md`.
- **Next (suggested):** human time stamps for the 21 training shoplifting videos to replace MIL labels, a larger normal validation pool for threshold setting, then Exp 5.

## Sequence
0 → 1 (freeze) → 2 and 3 (run; test scores unsealed together) → 4 → 5 → 6. Nothing after Experiment 1 starts until its completion gate passes.

## Repository layout (created during execution)
- `model/Qwen3.8-27B-INT4/plans/shoplifting-study.md`: this plan, with its status updated as experiments complete.
- `model/study/v1/`: frozen manifests, data dictionary, exclusion log, annotations, checksums.
- `model/Qwen3.8-27B-INT4/src/`: `build_manifest.py`, `leak_audit.py`, `windows.py`, `score_zeroshot.py`, `train_lora.py`, `evaluate.py` (bootstrap by video), `localize.py`.
- `model/runs/<exp>/<seed>/`: configuration, adapter, raw scores, `env.json` (hardware, versions, precision).

## Verification
- Rebuilding from `raw/` reproduces the manifests with identical checksums.
- A cross-split overlap test (pHash, scene, video ID) returns empty; it runs in CI and before every training run.
- The evaluation script is tested on synthetic scores with a known AUROC and CI coverage.
- Seed-to-seed spread is reported. Outputs round-trip into the web app as data-contract JSON and display on a sample video.

## Needed from the user before starting
1. Add your user to the `zrt` group so the model can be read and served.
2. Write access to `/srv/kryptonx-data` (join the `workspace` group) so the staged Robbery videos can be moved in, and approval to fetch the 800 normal training videos.
3. Confirm the time-stamp annotation of the 29 training shoplifting videos (two annotators), which clip-level training requires.
