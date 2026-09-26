# Qwen3.8-27B shoplifting study

This directory contains the team's earlier Qwen3.8-27B shoplifting experiment. It is a **separate model from Sentinel Machines v1**, which is based on Qwen3-VL-30B-A3B.

The completed experiment trains a LoRA adapter to score eight-second clips for suspected shoplifting using a fixed yes/no prompt. It does not generate the general model's scene log, crime categories, or actor boxes.

## Contents

| Directory | Contents |
| --- | --- |
| [src](src) | Data acquisition, leakage audit, window sampling, MIL training, selection, scoring, and localization |
| [env/qwen](env/qwen) | Model metadata, environment locks, and weight checksums |
| [runs/qwen38](runs/qwen38) | Pilot outputs and study results |
| [runs/qwen38/exp3/README.md](runs/qwen38/exp3/README.md) | Detailed model card, methods, limitations, and results |
| [../study](../study/README.md) | Source-video splits and annotation manifests |

The directory name is historical; inspect the environment and run metadata for the precision used in a particular experiment.

## Protocol and findings

Scoring uses 16 frames at 2 fps, native resolution, thinking disabled, and the normalized probability of yes versus no on the first answer token. Evaluation scans eight-second windows at four-second stride.

Training used multiple-instance learning with model-selected positive windows, frozen vision parameters, LoRA rank 16, and three final seeds. The mean window AUROC gain over zero-shot was approximately 0.027, but the paired confidence intervals include zero. False positives increased and temporal localization worsened. These results do not establish a fine-tuning improvement for the review timeline.

Use the detailed [model card](runs/qwen38/exp3/README.md) and [final artifacts](runs/qwen38/exp3/final) for the exact results. Do not attribute them to Sentinel Machines v1.

## Local integration

The app lists this scorer as `local:shoplifting-s2` when configured with:

```dotenv
LOCAL_SCORER_BASE_URL=http://127.0.0.1:8081/v1
LOCAL_SCORER_MODELS=shoplifting-s2
```

It supports recorded video only and requires `ffmpeg` on the app server. Assistant and summary requests use the separately configured chat model.

The existing adapter deployment uses vLLM LoRA names `shoplifting-s1`, `shoplifting-s2`, and `shoplifting-s3`. HP Z Runtime's proxy routes its service label, so the adapter names require the direct localhost bridge to the underlying vLLM socket:

```bash
sg zrt -c 'socat TCP-LISTEN:8081,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/opt/hp/zrt/run/vllm-qwen38-shoplifting.sock'
```

This foreground bridge assumes the matching LoRA service is already running. Use a managed or detached process for persistent deployment. Serving configuration must register the adapter paths under `/srv/kryptonx-data/models/qwen3.8-27b-shoplifting-lora/` and retain the exact base revision in [env/qwen/model.json](env/qwen/model.json).

Score a local clip from the repository root:

```bash
python3 model/src/qwen_zrt_score.py \
  --endpoint http://127.0.0.1:8081/v1 \
  --model shoplifting-s2 --video /path/to/clip.mp4
```

The browser samples JPEG frames, which differ from the study's decoded-frame protocol. Do not assume identical scores. Coordinate GPU memory with other users before loading this model; see [operations](../../ops/README.md).
