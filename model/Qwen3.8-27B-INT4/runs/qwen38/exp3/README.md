---
base_model: Qwen/Qwen3.8-27B
library_name: peft
license: apache-2.0
pipeline_tag: video-text-to-text
tags: [lora, peft, video-anomaly-detection, shoplifting, ucf-crime, multiple-instance-learning]
---

# Qwen3.8-27B shoplifting LoRA (UCF-Crime, weakly supervised)

A LoRA adapter for [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) (revision `1d4bf0f2ff60`) that scores
8-second CCTV clips for **suspected shoplifting**. It was built for KryptonxWatch, where detections
are shown on a timeline **for a person to review**. It is not an automated decision system.

## Result

The difference from zero-shot is not conclusive: at least one seed's 95% CI for ΔAUROC includes 0, so this study does not show that fine-tuning helps.

Point estimates favour the adapter on AUROC for every seed, but window AUPRC fell (0.142 zero-shot vs 0.112 mean); event localisation got worse (AP@tIoU0.3 0.068 vs 0.027 mean; median onset error 3 s vs 15 s). Its events on shoplifting videos are much longer (median 4 s zero-shot vs 12 / 18 / 24 s for seeds 1-3), so it marks long stretches around a theft, not just the theft itself. **For the timeline use case, the zero-shot model is currently at least as good.**

Primary endpoint: window-level AUROC on the locked UCF-Crime test cohort (169 videos with at least one
full window (2 normal test videos are shorter than 8 s), 5808 windows, 89 positive),
fine-tuned vs zero-shot with the same prompt and frames.
95% CIs come from a paired bootstrap (2000 resamples) that **resamples whole videos**,
because windows from the same video are not independent.

| Model | Window AUROC [95% CI] | ΔAUROC vs zero-shot [95% CI] | Window AUPRC | Video AUROC | Sensitivity at 1 FP/h (val threshold) | FP/h on normal test |
|---|---|---|---|---|---|---|
| Zero-shot | 0.895 [0.840, 0.946] | — | 0.142 | 0.860 | 0.393 | 29.1 |
| LoRA seed 1 | 0.917 [0.853, 0.968] | +0.022 [-0.019, 0.067] | 0.100 | 0.929 | 0.843 | 90.6 |
| LoRA seed 2 | 0.924 [0.865, 0.968] | +0.029 [-0.014, 0.072] | 0.110 | 0.940 | 0.820 | 93.7 |
| LoRA seed 3 | 0.926 [0.878, 0.965] | +0.031 [-0.004, 0.073] | 0.125 | 0.949 | 0.876 | 91.8 |
| LoRA mean ± SD (3 seeds) | 0.923 ± 0.005 | 0.027 ± 0.005 | 0.112 ± 0.013 | 0.939 ± 0.010 | 0.846 ± 0.028 | 92.1 |

The threshold for sensitivity and FP/h is set on validation Normal footage at about 1 false positive per hour,
never on the test set. **It does not transfer:** validation has only about 6 minutes of Normal footage
(7 videos, 85 windows), so the "1 FP/h" threshold is simply its highest-scoring normal window, and on the
150 test Normal videos it gives the FP/h shown above. Before deployment, set the threshold on a much larger
sample of in-domain normal footage. The zero-shot test scores were sealed (checksum committed) before any fine-tuned
model was frozen, and were read only for this comparison.

### Temporal localisation (secondary)
Windows at or above the threshold are merged into events (2 s gap merging). Parameters were pre-specified,
not tuned: validation videos have no time stamps. With 4 s window resolution and a median annotated event
length of 6.5 s, even perfect window scores give only about 0.56 recall at tIoU 0.5, so read the 0.5 columns
with that ceiling in mind.

| Model | Recall@tIoU0.3 | Precision@0.3 | AP@0.3 | Recall@0.5 | Precision@0.5 | AP@0.5 | Median onset error (s) | Events on normal videos |
|---|---|---|---|---|---|---|---|---|
| Zero-shot | 0.320 | 0.058 | 0.068 | 0.240 | 0.043 | 0.037 | 3.000 | 79 |
| LoRA seed 1 | 0.320 | 0.050 | 0.039 | 0.080 | 0.013 | 0.002 | 13.000 | 100 |
| LoRA seed 2 | 0.280 | 0.050 | 0.033 | 0.080 | 0.014 | 0.002 | 15.000 | 97 |
| LoRA seed 3 | 0.160 | 0.027 | 0.009 | 0.080 | 0.014 | 0.002 | 18.000 | 111 |

## How it was trained

- **Data:** UCF-Crime Shoplifting and Normal videos, split by source video and store camera. A leakage audit
  (perceptual hashes and scene clusters) removed 6 training videos that shared a camera with test videos.
  Study split: Shoplifting 21 train / 5 val / 21 test, Normal 30 / 7 / 150. Split lists are in [the study manifests](../../../../study/README.md).
- **Labels: multiple-instance learning (MIL).** UCF-Crime training videos only have a video-level label, and no
  human time stamps exist for them. Each round takes the model's own top 3 windows of every training
  shoplifting video as positives (round 1 uses zero-shot scores), plus random Normal windows at 5:1, trains one
  epoch continuing the previous adapter, then rescores. **Training labels are therefore model-chosen, not
  human-verified.**
- **Adapter:** LoRA rank 16, alpha 32, dropout 0.05 on every language-model projection (full attention,
  linear attention, MLP). Vision encoder frozen. bf16, batch 4 × accumulation 2.
- **Selection (validation only):** learning rate × MIL round by MIL negative log-likelihood (lowest max-window
  NLL on shoplifting videos plus window NLL on normal windows). Selected: lr 1e-4, round 3.

| Learning rate | Round | Val MIL NLL | Val video AUROC |
|---|---|---|---|
| 1e-4 | 1 | 0.0043 | 1.000 |
| 1e-4 | 2 | 0.0015 | 1.000 |
| 1e-4 | 3 | 0.0006 | 1.000 |
| 2e-4 | 1 | 0.0046 | 1.000 |
| 2e-4 | 2 | 0.0088 | 1.000 |
| 2e-4 | 3 | 0.0202 | 1.000 |

- **Seeds:** the selected setting was trained with seeds 1, 2 and 3. The published adapter repository holds seed 1 at its root and all three seeds in
  `seed1/`, `seed2/`, `seed3/`. Local SHA-256 checksums are in [final/adapters.sha256](final/adapters.sha256).
- **Environment:** NVIDIA H100 PCIe, 580.159.04, 81559 MiB, torch 2.14.0+cu130, transformers
  5.17.0, peft 0.21.0.

## Usage

The model answers one fixed yes/no question per 8-second window (16 frames at 2 fps, native resolution), and the
score is P("yes") from the answer-token log-probabilities with thinking off. Use the exact prompt and scoring in
[qwen_model.py](../../../src/qwen_model.py), since other prompts or frame rates were not evaluated.

```python
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoProcessor
import torch
processor = AutoProcessor.from_pretrained("Qwen/Qwen3.8-27B", revision="1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0")
model = AutoModelForImageTextToText.from_pretrained("Qwen/Qwen3.8-27B", revision="1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0", dtype=torch.bfloat16, device_map="auto")
model = PeftModel.from_pretrained(model, "<adapter-repository-or-local-path>")
```

[localize.py](../../../src/localize.py) turns window scores into events in the KryptonxWatch `Detection` format (`startSec`, `endSec`,
`peakSec`, `confidence`). The [final outputs](final/) contain detections for the evaluated seeds. The model gives no
location in the frame, so each keyframe box is the full frame.

## Limitations

- **UCF-Crime only.** Results are measured on UCF-Crime, which is low-resolution (320×240) footage, much of it
  compiled from online sources. They do not show that the model works on real store cameras. That needs a
  separate evaluation on in-domain footage.
- **Detections are suspected events for human review.** Do not use them to accuse, detain or take action
  against anyone without a person reviewing the footage.
- **MIL training labels** (see above) can reinforce the zero-shot model's own mistakes.
- **Small test set:** 89 positive windows from 21 shoplifting videos, hence the wide CIs.
- Not evaluated: MERL Shopping hard negatives, calibration (ECE) and overlay-masked robustness (Experiment 5).
- UCF-Crime videos are not redistributed here; use the official dataset under its terms.
