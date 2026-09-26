# Local working data

This directory holds local artifacts used by Sentinel Machines. Its working contents are ignored by Git; keep video, extracted frames, and watch logs out of commits.

| Directory | Purpose |
| --- | --- |
| `bakeoff/` | Benchmark clips, manifests, extracted frames, and visual reviews |
| `watch/` | Optional server feed events and briefings |

Large source datasets and model weights live in the shared `/srv/kryptonx-data/` area. Versioned study manifests are in [model/study](../model/study/README.md); saved evaluation summaries are in [model/openrouter-bakeoff](../model/openrouter-bakeoff/README.md).

Build benchmark inputs with the [evaluation tools](../model/openrouter-bakeoff/README.md). Check available disk space and shared-resource ownership before downloads. Local footage and feed logs may contain sensitive information; retain them according to the deployment's data policy.
