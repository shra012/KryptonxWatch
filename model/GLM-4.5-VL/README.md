# GLM-4.5-VL experiments

This directory preserves an earlier GLM-4.5V inference, quantization, and training pilot. The GLM model arm was skipped; it is not the Sentinel Machines v1 model.

## Contents

| Path | Purpose |
| --- | --- |
| [src](src) | Shared GLM helpers, inference pilot, quantization cache, and training pilot |
| [env/glm](env/glm) | Dockerfile, dependency locks, model metadata, and container launcher |
| [runs/glm45v](runs/glm45v) | Saved pilot logs and environment records |

The `kryptonx/glm:dev` container also supplies the base environment used by the YOLO image. Retaining this environment does not require serving the GLM weights.

## Environment

Build from the repository root after checking available resources:

```bash
docker build -t kryptonx/glm:dev model/GLM-4.5-VL/env/glm
```

The [run helper](env/glm/run.sh) configures the shared mounts and user identity for GPU work. Inspect its arguments and the pinned locks before reproducing an old pilot. Model weights belong in the shared data area, not Git.

See [models](../README.md) for the current stack and [operations](../../ops/README.md) for GB10 resource constraints.
