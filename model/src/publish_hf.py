"""Build the model card and publish the frozen Experiment 3 adapters to the Hugging Face Hub.

Reads the outputs of run_study.sh (selection, per-seed test reports, localisation reports, detections)
and uploads: seed-1 adapter at the repo root (loadable with PeftModel.from_pretrained(repo)), all three
seeds under seed{1,2,3}/, results/*.json, a sample of Detection JSON, the study code and split lists.

  python model/src/publish_hf.py --dry-run            # build the card in /data/runs/qwen38/hf_stage only
  python model/src/publish_hf.py --repo shra012/qwen3.8-27b-ucf-shoplifting-lora
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

SRC = Path(__file__).resolve().parent
STUDY = SRC.parent / "study/v1"
EXP3 = Path("/data/runs/qwen38/exp3")
FINAL = EXP3 / "final"
STAGE = Path("/data/runs/qwen38/hf_stage")
BASE = "Qwen/Qwen3.8-27B"
REVISION = "1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0"


def load(p: Path) -> dict:
    return json.loads(p.read_text())


def f3(x) -> str:
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.3f}"


def ci(x) -> str:
    return f"[{x[0]:.3f}, {x[1]:.3f}]"


def results_table(zs: dict, seeds: list[dict]) -> str:
    head = ("| Model | Window AUROC [95% CI] | ΔAUROC vs zero-shot [95% CI] | Window AUPRC | Video AUROC | "
            "Sensitivity at 1 FP/h (val threshold) | FP/h on normal test |\n|---|---|---|---|---|---|---|\n")
    rows = [f"| Zero-shot | {f3(zs['window_auroc'])} {ci(seeds[0]['baseline_window_auroc_ci'])} | — | "
            f"{f3(zs['window_auprc'])} | {f3(zs['video_auroc'])} | {f3(zs['sensitivity_at_thr'])} | "
            f"{zs['fp_per_hour_normal_test']:.1f} |"]
    for i, s in enumerate(seeds, 1):
        rows.append(f"| LoRA seed {i} | {f3(s['window_auroc'])} {ci(s['window_auroc_ci'])} | "
                    f"{s['delta_auroc']:+.3f} {ci(s['delta_auroc_ci'])} | {f3(s['window_auprc'])} | "
                    f"{f3(s['video_auroc'])} | {f3(s['sensitivity_at_thr'])} | {s['fp_per_hour_normal_test']:.1f} |")

    def ms(k):
        v = np.array([s[k] for s in seeds])
        return f"{v.mean():.3f} ± {v.std(ddof=1):.3f}"
    rows.append(f"| LoRA mean ± SD (3 seeds) | {ms('window_auroc')} | {ms('delta_auroc')} | {ms('window_auprc')} | "
                f"{ms('video_auroc')} | {ms('sensitivity_at_thr')} | "
                f"{np.mean([s['fp_per_hour_normal_test'] for s in seeds]):.1f} |")
    return head + "\n".join(rows)


def loc_table(zs: dict, seeds: list[dict]) -> str:
    head = ("| Model | Recall@tIoU0.3 | Precision@0.3 | AP@0.3 | Recall@0.5 | Precision@0.5 | AP@0.5 | "
            "Median onset error (s) | Events on normal videos |\n|---|---|---|---|---|---|---|---|---|\n")
    rows = []
    for name, r in [("Zero-shot", zs)] + [(f"LoRA seed {i}", s) for i, s in enumerate(seeds, 1)]:
        rows.append(f"| {name} | {f3(r['recall@0.3'])} | {f3(r['precision@0.3'])} | {f3(r['ap@0.3'])} | "
                    f"{f3(r['recall@0.5'])} | {f3(r['precision@0.5'])} | {f3(r['ap@0.5'])} | "
                    f"{f3(r['median_onset_error_sec'])} | {r['events_on_normal_videos']} |")
    return head + "\n".join(rows)


def verdict(seeds: list[dict]) -> str:
    lows = [s["delta_auroc_ci"][0] for s in seeds]
    highs = [s["delta_auroc_ci"][1] for s in seeds]
    if all(lo > 0 for lo in lows):
        return "Fine-tuning improved window-level AUROC over zero-shot for every seed (all 95% CIs exclude 0)."
    if all(hi < 0 for hi in highs):
        return "Fine-tuning made window-level AUROC worse than zero-shot for every seed (all 95% CIs below 0)."
    return ("The difference from zero-shot is not conclusive: at least one seed's 95% CI for ΔAUROC includes 0, "
            "so this study does not show that fine-tuning helps.")


def card(sel: dict, zs: dict, seeds: list[dict], zs_loc: dict, seed_loc: list[dict], env: dict) -> str:
    s = sel["selected"]
    grid = "\n".join(f"| {g['lr']} | {g['round']} | {g['mil_nll']:.4f} | {g['video_auroc']:.3f} |"
                     for g in sel["grid"])
    n_test = seeds[0]
    return f"""---
base_model: {BASE}
library_name: peft
license: apache-2.0
pipeline_tag: video-text-to-text
tags: [lora, peft, video-anomaly-detection, shoplifting, ucf-crime, multiple-instance-learning]
---

# Qwen3.8-27B shoplifting LoRA (UCF-Crime, weakly supervised)

A LoRA adapter for [{BASE}](https://huggingface.co/{BASE}) (revision `{REVISION[:12]}`) that scores
8-second CCTV clips for **suspected shoplifting**. It was built for KryptonxWatch, where detections
are shown on a timeline **for a person to review**. It is not an automated decision system.

## Result

{verdict(seeds)}

Primary endpoint: window-level AUROC on the locked UCF-Crime test cohort ({n_test['videos']} videos,
{n_test['windows']} windows, {n_test['positives']} positive), fine-tuned vs zero-shot with the same prompt and frames.
95% CIs come from a paired bootstrap ({n_test['bootstrap_resamples']} resamples) that **resamples whole videos**,
because windows from the same video are not independent.

{results_table(zs, seeds)}

The threshold for sensitivity and FP/h is set on validation Normal footage at about 1 false positive per hour,
never on the test set. The zero-shot test scores were sealed (checksum committed) before any fine-tuned
model was frozen, and were read only for this comparison.

### Temporal localisation (secondary)
Windows at or above the threshold are merged into events (2 s gap merging). Parameters were pre-specified,
not tuned: validation videos have no time stamps. With 4 s window resolution and a median annotated event
length of 6.5 s, even perfect window scores give only about 0.56 recall at tIoU 0.5, so read the 0.5 columns
with that ceiling in mind.

{loc_table(zs_loc, seed_loc)}

## How it was trained

- **Data:** UCF-Crime Shoplifting and Normal videos, split by source video and store camera. A leakage audit
  (perceptual hashes and scene clusters) removed 6 training videos that shared a camera with test videos.
  Study split: Shoplifting 21 train / 5 val / 21 test, Normal 30 / 7 / 150. Split lists are in `study/`.
- **Labels: multiple-instance learning (MIL).** UCF-Crime training videos only have a video-level label, and no
  human time stamps exist for them. Each round takes the model's own top 3 windows of every training
  shoplifting video as positives (round 1 uses zero-shot scores), plus random Normal windows at 5:1, trains one
  epoch continuing the previous adapter, then rescores. **Training labels are therefore model-chosen, not
  human-verified.**
- **Adapter:** LoRA rank 16, alpha 32, dropout 0.05 on every language-model projection (full attention,
  linear attention, MLP). Vision encoder frozen. bf16, batch 4 × accumulation 2.
- **Selection (validation only):** learning rate × MIL round by MIL negative log-likelihood (lowest max-window
  NLL on shoplifting videos plus window NLL on normal windows). Selected: lr {s['lr']}, round {s['round']}.

| Learning rate | Round | Val MIL NLL | Val video AUROC |
|---|---|---|---|
{grid}

- **Seeds:** the selected setting was trained with seeds 1, 2 and 3. The repo root holds seed 1; all three are in
  `seed1/`, `seed2/`, `seed3/`. SHA-256 checksums are in `results/adapters.sha256`.
- **Environment:** {env.get('gpu', 'NVIDIA H100 80GB')}, torch {env.get('torch', '')}, transformers
  {env.get('transformers', '')}, peft {env.get('peft', '')}.

## Usage

The model answers one fixed yes/no question per 8-second window (16 frames at 2 fps, native resolution), and the
score is P("yes") from the answer-token log-probabilities with thinking off. Use the exact prompt and scoring in
`code/qwen_model.py`, since other prompts or frame rates were not evaluated.

```python
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoProcessor
import torch
processor = AutoProcessor.from_pretrained("{BASE}", revision="{REVISION}")
model = AutoModelForImageTextToText.from_pretrained("{BASE}", revision="{REVISION}", dtype=torch.bfloat16, device_map="auto")
model = PeftModel.from_pretrained(model, "<this repo>")
```

`code/localize.py` turns window scores into events in the KryptonxWatch `Detection` format (`startSec`, `endSec`,
`peakSec`, `confidence`). `results/detections_sample.json` shows the output for a few test videos. The model gives no
location in the frame, so each keyframe box is the full frame.

## Limitations

- **UCF-Crime only.** Results are measured on UCF-Crime, which is low-resolution (320×240) footage, much of it
  compiled from online sources. They do not show that the model works on real store cameras. That needs a
  separate evaluation on in-domain footage.
- **Detections are suspected events for human review.** Do not use them to accuse, detain or take action
  against anyone without a person reviewing the footage.
- **MIL training labels** (see above) can reinforce the zero-shot model's own mistakes.
- **Small test set:** {n_test['positives']} positive windows from 21 shoplifting videos, hence the wide CIs.
- Not evaluated: MERL Shopping hard negatives, calibration (ECE) and overlay-masked robustness (Experiment 5).
- UCF-Crime videos are not redistributed here; use the official dataset under its terms.
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default="shra012/qwen3.8-27b-ucf-shoplifting-lora")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sel = load(EXP3 / "selection.json")
    lr, r = sel["selected"]["lr"], sel["selected"]["round"]
    seeds = [load(FINAL / f"test_seed{i}.json") for i in (1, 2, 3)]
    seed_loc = [load(FINAL / f"localize_seed{i}.json") for i in (1, 2, 3)]
    zs, zs_loc = load(FINAL / "test_zeroshot.json"), load(FINAL / "zeroshot_localize.json")
    env_path = SRC.parent / "env/qwen/env.json"
    env = load(env_path) if env_path.exists() else {}
    from importlib.metadata import version
    env.update({k: version(k) for k in ("transformers", "peft")})

    if STAGE.exists():
        shutil.rmtree(STAGE)
    (STAGE / "results").mkdir(parents=True)
    for i in (1, 2, 3):
        src = EXP3 / f"lr{lr}/seed{i}/round{r}/adapter"
        for dst in [STAGE / f"seed{i}"] + ([STAGE] if i == 1 else []):
            dst.mkdir(exist_ok=True)
            shutil.copy(src / "adapter_model.safetensors", dst)
            cfg = load(src / "adapter_config.json")
            cfg["base_model_name_or_path"] = BASE
            cfg["revision"] = REVISION
            (dst / "adapter_config.json").write_text(json.dumps(cfg, indent=2))
    for p in [EXP3 / "selection.json", FINAL / "adapters.sha256", *FINAL.glob("test_*.json"),
              *FINAL.glob("*localize*.json")]:
        shutil.copy(p, STAGE / "results")
    dets = load(FINAL / "detections_seed1.json")
    sample = [d for d in dets if d["detections"]][:5]
    (STAGE / "results/detections_sample.json").write_text(json.dumps(sample, indent=1))
    shutil.copytree(SRC, STAGE / "code", ignore=shutil.ignore_patterns("__pycache__", "*glm*", "fetch_ucf.py"))
    (STAGE / "study").mkdir()
    for name in ("splits.csv", "exclusions.csv"):
        shutil.copy(STUDY / name, STAGE / "study")
    (STAGE / "README.md").write_text(card(sel, zs, seeds, zs_loc, seed_loc, env))
    print(f"staged {STAGE}")
    if args.dry_run:
        return 0

    from huggingface_hub import HfApi
    api = HfApi()
    api.create_repo(args.repo, private=False, exist_ok=True)
    api.upload_folder(repo_id=args.repo, folder_path=str(STAGE),
                      commit_message=f"Frozen adapters (lr {lr}, MIL round {r}, seeds 1-3), results and model card")
    print(f"https://huggingface.co/{args.repo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
