# Models

The model stack centers on **Sentinel Machines v1**, the team's fine-tuned **Qwen3-VL-30B-A3B** model running on the HP ZGX Nano / NVIDIA GB10. The web app calls it through an OpenAI-compatible endpoint. Person localization and pose are supplied by a separate YOLO service.

## Components

| Component | Role | Documentation |
| --- | --- | --- |
| Sentinel Machines v1 | Retail video understanding, scene descriptions, and suspected incident analysis | [Model overview](sentinel-machines-v1/README.md) |
| YOLO | Person boxes, box refinement, and pose | [Service guide](YOLO/README.md) |
| Qwen3.8-27B shoplifting LoRA | Earlier, separate yes/no scorer experiment | [Study and usage](Qwen3.8-27B-INT4/README.md) |
| GLM-4.5-VL | Earlier pilot and shared container environment | [Experiment guide](GLM-4.5-VL/README.md) |
| Model bake-off | Historical base-model comparisons through the app pipeline | [Evaluation guide](openrouter-bakeoff/README.md) |
| Study manifests | Splits, leakage checks, and theft intervals | [Data guide](study/README.md) |
| Data preparation | UCF-Crime and MERL download / indexing tools | [Tool guide](sonakshi/README.md) |

## Model identity

Product names, server labels, and checkpoint identifiers are distinct. The UI uses `sentinel-machines-v1`; the team's local service has used `qwen3-vl-30b-a3b`. The server configuration determines which weights answer a request. Record the deployed checkpoint and adapter revision when reporting a release result.

The project's deployment description identifies v1 as fine-tuned Qwen3-VL-30B-A3B. This repository does not currently include its adapter manifest, training-run configuration, or dedicated evaluation report. Historical base-model scores and the Qwen3.8 shoplifting adapter are separate evidence, not v1 metrics.

## Runtime and storage

The GB10 uses shared CPU/GPU memory, with approximately 121 GiB visible on the team's machine. Coordinate large training and serving jobs with other users. Check memory and active compute processes before starting a workload; see [operations](../ops/README.md).

Large datasets and weights live under `/srv/kryptonx-data/`; HP Z Runtime caches models under `/opt/hp/zrt/models`. Do not commit weights, videos, local credentials, or downloaded datasets. Small study manifests, environment locks, and evaluation summaries remain versioned.

## Evaluation practice

Use the same prompts, frames, threshold, and video cohort for comparisons. Preserve raw outputs and immutable model identifiers. Split by source video and audit related camera scenes for leakage. Bake-off clips and locked test cohorts are excluded from training; use validation or explicitly defined cross-validation for selection.

Human review is required to assess whether an incident box identifies the right actor. Agreement with another model's region box is not a substitute for that review. See [evaluation](openrouter-bakeoff/README.md).
