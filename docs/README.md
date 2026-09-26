# Documentation

Project-wide documents for KryptonxWatch (Sentinel Machines). Start with the [root README](../README.md) for what the project is and how to run it.

| Document | What it covers |
|---|---|
| [data-contract.md](data-contract.md) | The JSON contract between the model and detection services and the web app: stores, cameras, videos, analysis jobs, detections, keyframes and review verdicts. Draft v0.1; propose changes in a PR that edits the file. |

## Documentation elsewhere in the repo

| Where | What |
|---|---|
| [webapp/README.md](../webapp/README.md) | Running and configuring the web app |
| [model/README.md](../model/README.md) | Model work, one folder per model |
| [model/openrouter-bakeoff/README.md](../model/openrouter-bakeoff/README.md) | Bake-off of 12 open models plus a Gemini / HawkWatch baseline on the app's pipeline |
| [model/Qwen3.8-27B-INT4/plans/shoplifting-study.md](../model/Qwen3.8-27B-INT4/plans/shoplifting-study.md) | Shoplifting study and the Qwen3.8-27B LoRA experiment |
| [ops/hermes/README.md](../ops/hermes/README.md) | Starting and stopping the watch agent |
| [data/README.md](../data/README.md) | Local, git-ignored data layout |
| [AGENTS.md](../AGENTS.md) | Handoff notes for coding agents: machine, serving commands, current state |

## Where new documents go

- Web app plans: `webapp/.plans/`
- Model plans: `model/<Model>/plans/`, or `model/.plans/` when they span models
- Project-wide references (contracts, conventions): `docs/`
- Finished, skipped or superseded plans: delete them; git history keeps them
