# Local model as good as Gemini 2.5 Flash (detection, scene log, boxes)

Status: 2026-09-25 · Phase 0 done · Phase 1 result in (Qwen3-VL-30B-A3B local) · Phase 2 done (defaults kept) · Phase 3 done (YOLO snapping built; visual review pending) · data consolidation downloading (UCF crime classes, then training normals) · Phases 2–7 pending. Update this line as phases finish.

## Context
Local analysis in the web app gives weaker detections, scene log and boxes than `google/gemini-2.5-flash` via OpenRouter. The team's [OpenRouter bake-off](../openrouter-bakeoff/README.md) (the app's own pipeline, 36 UCF clips) shows the first model we served, Qwen3.8-27B, is among the weakest open options: it flagged 39% of crime clips against Gemini's 94%. Open models also draw boxes that barely overlap Gemini's (median IoU about 0.1). No open model matches Gemini at naming the crime (50–61% vs 83%).

The goal is to match or beat Gemini **on our task** (crime detection in store CCTV, scene log, boxes), running entirely on the GB10. We use:
1. the best open VL model,
2. a pipeline that uses tokens that are free locally,
3. specialist tools for boxes,
4. **fine-tuning on human-written data (UCA + the study's theft times)**, so Gemini is only ever a benchmark, never a teacher. This avoids the Gemini terms that restrict training competing models on its outputs.

## Assets (all under `/srv/kryptonx-data`, group `workspace`)
| Asset | Status |
|---|---|
| UCF-Crime Shoplifting 50, Stealing 100, test Normal 150, **Robbery 150** | On disk (Robbery moved in 2026-09-25) |
| UCF-Crime Fighting, Vandalism, Abuse, Arrest, Arson, Assault, Burglary, Explosion, RoadAccidents, Shooting (17 GB) | Downloading (`ucf-crime/download-2026-09-25.log`) |
| UCF-Crime Training Normal, 800 videos (73.4 GB) | Downloading after the crime classes |
| **UCA** (`uca/`): 1,854 videos, about 23.5k human-written timestamped sentences (train 1,165 / val 379 / test 310) | On disk. **Licence: academic and research use only**; see `uca/SOURCE.txt` |
| Study labels (`model/study/v1/`): 34 theft intervals in 17 training shoplifting videos, study splits, leak audit | In repo. Some intervals are `claude-proposed` and need human review before training |
| MERL Shopping (hard negatives) | On disk |
| Bake-off test set v1 (36 clips) in `data/bakeoff/`, plus saved Gemini replies with summary and box per window | Ready |
| Models in the zrt cache: Qwen3-VL-30B-A3B-Instruct-FP8, Qwen3.8-27B (+ LoRA) | Ready |

## Measures (fixed now, before any tuning)
| # | Measure | Data | Reference |
|---|---|---|---|
| M1 | Detection: Score, balanced accuracy, right crime named, false alarms on normal clips, timed events hit (`vlm-benchmark.ts score`) | Bake-off v1 (36 clips); final check on **v2** (fresh, about 60 clips, `fetch_data.py --version v2`) | Official UCF labels; Gemini as comparator |
| M2 | Box agreement with Gemini: IoU ≥ 0.3 share and median IoU (`vlm-benchmark.ts boxes`) | v1 / v2 | Gemini (no box ground truth in UCF) |
| M3 | Scene-log text vs **human** references: CIDEr, METEOR and BERTScore of window summaries against UCA sentences in the same time span | UCA **test** videos not used anywhere in training | UCA human sentences; Gemini scored the same way |
| M4 | Blind human review of the scene log: 5–10 clips, both models side by side, labels hidden | v2 | Rater's judgement |
| M5 | Speed: seconds per window and windows/s on the GB10 | Any | Must stay below one window per 8 s per camera |

Differences under about 10 points on 36 clips are noise. Headline claims use v2 (and UCA test for M3), with 95% CIs from bootstrapping by video.

## Phases (in order; each ends at a gate)

### Phase 0: Data and benchmark tooling ✅
Bake-off v1 built (36 clips, 614 frames). `vlm-benchmark.ts` now has pipeline options (`--frames-per-window`, `--frame-step`, `--max-width`, `--tag`), `VLM_EXTRA_BODY`, and the `boxes` command. Run it with `npx jiti scripts/vlm-benchmark.ts …` (the host Node is v18).

### Phase 1: Pick the base model (running)
1. Qwen3-VL-30B-A3B-Instruct-FP8 via zrt (label `qwen3-vl-30b-a3b`), 36 clips, app pipeline, tag `local`. Then M1, M2, M5.
2. Nemotron-3-Nano-Omni-30B-A3B (NVFP4, thinking off), same run.
3. Gate: pick the winner on M1 (primary) and M2. Local numbers should sit within noise of the same model's OpenRouter row, which confirms FP8/NVFP4 lost nothing.
4. Put the winner in the web app (`LOCAL_VLM_MODELS`) right away, so it's usable while the rest proceeds.

**Result (2026-09-25), 36 clips, app pipeline:**

| Model | Score @0.5 | Balanced acc. | Crime clips detected | Right crime | Normal clips false-alarmed | Timed hits | Box IoU ≥ 0.3 vs Gemini | Median IoU |
|---|---|---|---|---|---|---|---|---|
| Gemini 2.5 Flash (OpenRouter) | 75% | 81% | 94% | 83% | 33% | 5/6 | (ref) | (ref) |
| **Qwen3-VL-30B-A3B FP8, local (zrt)** | **69%** | **81%** | 83% | 61% | 22% | 3/6 | 15% | 0.11 |
| Qwen3-VL-30B-A3B (OpenRouter, run 1/2) | 64% | 81% | 83% | 50% | 22% | 3/6 | 14–17% | 0.06–0.07 |
| Qwen3.8-27B (OpenRouter) | 64% | 69% | 39% | 28% | 0% | 1/6 | 21% | 0.15 |

Local FP8 is at least as good as the OpenRouter-served model. It ties Gemini on balanced accuracy but trails on naming the crime (61% vs 83%) and timed hits. Boxes remain far from Gemini's, which Phase 3 addresses. Speed: 163 windows in 146 s at concurrency 4 (about 0.9 s/window throughput, 2.1 s p50 latency). Added to the web app as `local-vlm:qwen3-vl-30b-a3b`. All bake-off clips are 320×240, so resolution is already native; Phase 2 varies frame density instead.

### Phase 2: Tune the pipeline (no training)
Options, each run on v1 with its own `--tag`: 8 frames per window, 768 px or native resolution, frames sent as one video clip, a "second look" (more frames, thinking on) for flagged windows only, and a two-model vote. Settings are chosen by **2-fold cross-validation over videos**. Gate: CV Score up by at least 10 points, or keep the defaults.

**Result (2026-09-25):** 8 frames per window (1 per second) instead of 4: Score 69% (unchanged), window AUROC 0.72 (was 0.60, level with Gemini), timed hits 4/6 (was 3/6), normal clips false-alarmed 17% (was 22%). But right crime 56% (was 61%) and box IoU ≥ 0.3 10% (was 15%). Below the +10-point gate, so **the default 4-frame pipeline stays**. A 16-frame run was rejected by the server's 8-image limit (`--limit-mm-per-prompt`); it was not rerun because 8 frames showed no Score gain. The failed file was deleted. Resolution is already native (320×240). Levers left for this phase, if needed later: video input instead of separate images, and a Thinking-model second look.

### Phase 3: Boxes via a person detector
1. YOLO11 person detector (about 1–2 GB) on the window's key frame. Snap the VLM box to the best-overlapping person, or the nearest one if none overlap.
2. Later: ByteTrack across frames, so a detection follows the same person through the window.
3. Gate: M2 improves on v1. Then add it to the app's analysis path, server-side, after the VLM reply.

**Result (2026-09-25):**
- Tooling: `model/YOLO/env/Dockerfile` (`kryptonx/yolo:dev`), `model/YOLO/src/yolo_snap.py` (writes `<results>__yolo.jsonl`), `model/YOLO/src/box_review.py` (visual page `data/bakeoff/review/boxes.html`). Weights: `/srv/kryptonx-data/models/yolo/` (YOLO11n/m, SHA-256 in `weights.sha256`).
- **GB10 gotcha:** cuDNN 9.20 in the NGC 26.03 image makes YOLO return no detections on sm_121. With `torch.backends.cudnn.enabled = False`, results match the CPU at about 10 ms/image (CPU 42 ms). Watch for the same issue in any conv model on this box.
- **M2 (agreement with Gemini) cannot judge person-snapping.** Snapping moves local boxes only slightly (Qwen3-VL IoU ≥ 0.3: 15% → 12%), and snapping *Gemini's own* boxes drops its self-agreement from 97% to 39%. Gemini draws loose region boxes (person plus object or area), not person boxes. M2 is therefore dropped as a box-quality measure.
- **Visual review of 12 matched moments** (Claude's read, pending the user's): YOLO-snapped Qwen3-VL boxes are usually the tightest on the acting person (robberies, tunnel fight, vandalism); Gemini's are often large regions or empty areas. Failures: a wrong-person snap in hw-Fighting0, ambiguity in a crowded fisheye view, and a different person chosen in hw-Shoplifting2. Next: the user rates the page. If confirmed, move YOLO snapping into the app's analysis route (Phase 7) early.

### Phase 4: Build the fine-tuning dataset (UCA + study labels)
1. **Splits and leakage:**
   - Training uses only videos in **UCA train and the UCF training split**.
   - Exclude every video in bake-off v1/v2, the study's locked test cohort, UCA val/test, and anything the study's leak audit (pHash and scene clusters) links to them.
   - Freeze the manifest with checksums in `model/study/vlm-ft-v1/`.
2. **Windows:** 8 s windows, frames at 2 fps, matching whatever pipeline Phase 2 picks.
3. **Targets:** in the app's JSON schema (`summary`, `incidents[{category, severity, confidence, frame, description}]`), no boxes (Phase 3 adds those).
   - `summary`: the UCA sentence(s) overlapping the window. Windows with no UCA sentence are dropped.
   - `incidents`: from the video's UCF class, marked only on windows showing the crime:
     - **Shoplifting:** the 34 study intervals (after human review of the `claude-proposed` ones).
     - **Other classes:** a *local* text model labels which UCA sentences describe the crime. A person reviews a random 10% sample; the labeller must reach at least 90% agreement.
     - Normal videos and non-crime windows get `incidents: []`.
4. **Balance:** cap negatives at 3:1 and keep every positive. Validation is UCA val, filtered the same way.
5. Gate: dataset card (counts per class, positives per class, review agreement) and a frozen checksum.

### Phase 5: Fine-tune (LoRA)
1. Base: the Phase 1 winner in **bf16** (for Qwen3-VL-30B-A3B, download `Qwen/Qwen3-VL-30B-A3B-Instruct`, 62 GB; FP8 weights are not trainable).
2. Setup:
   - Container `kryptonx/glm:dev` (transformers 4.57.5 supports Qwen3-VL-MoE; PEFT, bitsandbytes).
   - LoRA rank 16 on attention and shared layers; vision encoder frozen at first. QLoRA 4-bit if bf16 does not fit next to other jobs.
   - Loss on the JSON answer tokens only.
3. Selection: learning rate × epochs on **UCA val** (M3 plus a validation detection score), then 3 seeds of the chosen setting.
4. Serve with vLLM LoRA (as with the shoplifting adapter; direct LoRA names need the localhost bridge, since zrt's proxy routes only its label).
5. Gate: on v2, the fine-tuned model beats the Phase 2 pipeline on M1 and M3, with CIs.

### Phase 6: Final evaluation against Gemini
1. Run Gemini once on v2 and on the UCA-test windows used for M3. Estimated about $0.5 on OpenRouter; **confirm before spending**.
2. Report M1–M5 for Gemini, the Phase 2 pipeline, and the fine-tuned model with Phase 3 boxes. Blind review (M4).
3. Write it up as `model/openrouter-bakeoff/README.md`-style results, plus a model card if published. UCA terms mean research use only.

### Phase 7: Web app
The winning stack becomes the default local option: model plus YOLO boxes, server-side in `app/api/analyze`, with the Phase 2 window settings for local models. The Live page uses the same path. Keep OpenRouter models selectable for comparison.

## Resource plan
- **GB10 memory is shared with other users** (Chaitanya's fine-tuning). Run one large job at a time: serving (about 35–55 GB) *or* training (about 70–110 GB for bf16 LoRA on a 30B MoE), never both. Stop services after each run.
- **Disk:** about 90 GB of UCF downloads plus 62 GB of bf16 weights, well within the 2.8 TB free.
- **Rough time:**
  - Phases 1–3: 1–2 days.
  - Phase 4: 1–2 days, including human review.
  - Phase 5: 1–3 days of GPU time for 3 seeds.
  - Phase 6: half a day.

## Risks
- UCA sentences describe what people do, not whether it is a crime. Incident labels depend on the text labeller and the review in Phase 4.3.
- The UCA licence (academic/research only) limits commercial use of a model trained on it. Decide before shipping.
- Small test sets: headline claims only on v2 and UCA test, with CIs.
- Qwen3-VL LoRA through vLLM needs checking. Fallback: merge the LoRA into the weights and serve the merged model.

## Verification
- Every run writes raw replies to `model/openrouter-bakeoff/results/*.jsonl`, so all tables can be recomputed with `score` and `boxes`.
- Dataset and adapter manifests are checksummed. The leak check runs before each training run.
- In-app check at the end: 2–3 uploaded clips show the scene log, boxes and detections from the local stack.
