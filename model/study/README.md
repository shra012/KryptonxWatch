# Study data and annotations

This directory contains small, versioned study manifests. Source videos, extracted frames, and model weights live outside Git in `/srv/kryptonx-data/`.

## Version 1 manifests

| File | Purpose |
| --- | --- |
| [v1/splits.csv](v1/splits.csv) | Frozen train, validation, and test membership |
| [v1/exclusions.csv](v1/exclusions.csv) | Exclusions from the study cohort |
| [v1/leak_audit.csv](v1/leak_audit.csv) | Perceptual and scene-based leakage review |
| [v1/leak_audit_loose.csv](v1/leak_audit_loose.csv) | Broader candidate matches for review |
| [v1/candidates.csv](v1/candidates.csv) | Candidate video inventory |
| [v1/train_shoplifting_events.csv](v1/train_shoplifting_events.csv) | Proposed and reviewed theft intervals in training videos |

Entries marked `claude-proposed` are not human ground truth. Preserve their provenance and obtain human review before using them as verified labels.

## Shared datasets

| Dataset | Location under `/srv/kryptonx-data/` | Role |
| --- | --- | --- |
| UCF-Crime | `ucf-crime/raw/` | Crime and normal footage; source labels and test temporal annotations |
| UCA | `uca/` | Human-written timestamped descriptions of UCF-Crime videos |
| MERL Shopping | `merl-shopping/raw/` | Normal-shopping actions and hard negatives; contains no theft |
| Model weights | `models/` | Separately managed checkpoint and adapter files |

The repository's existing records identify UCA as academic/research-use data and MERL as research data. Consult the source notices stored with the datasets before reuse or distribution. Dataset availability here does not establish the exact Sentinel Machines v1 training mixture; that belongs in its release manifest.

## Time conventions

UCF test temporal annotations use frame numbers: divide by the video's frame rate to obtain seconds. MERL annotations use 1-based inclusive frame intervals: at 30 fps, convert `[start, end]` to `[(start - 1) / 30, end / 30]` seconds.

Maintain source-video and camera-scene separation when making splits. Exclude bake-off v1/v2/full videos, locked study test videos, and leak-audit neighbors from training. Keep validation and test separate; choose settings on validation data or declared cross-validation, then evaluate once on held-out test data.

## Tools and results

The maintained UCF tools are [fetch_ucf.py](../Qwen3.8-27B-INT4/src/fetch_ucf.py) for archive downloads and [build_index.py](../Qwen3.8-27B-INT4/src/build_index.py) for video and event indexing. The indexer requires `ffprobe`; run it with `--root /srv/kryptonx-data/ucf-crime` when using the shared dataset. The [Qwen3.8 study](../Qwen3.8-27B-INT4/README.md) documents the completed earlier shoplifting experiment. [Benchmark tooling](../openrouter-bakeoff/README.md) evaluates the application's general VLM pipeline.
