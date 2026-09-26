# Documentation

Start with the [project README](../README.md) for the product overview and quick start.

| Guide | Purpose |
| --- | --- |
| [Architecture](architecture/README.md) | Video flow, storage, service boundaries, and external integrations |
| [API contract](api/README.md) | Implemented analysis payloads, detections, categories, and errors |
| [Web app](../webapp/README.md) | Installation, environment variables, routes, and troubleshooting |
| [Models](../model/README.md) | Model roles and component documentation |
| [Sentinel Machines v1](../model/sentinel-machines-v1/README.md) | Fine-tuned Qwen3-VL-30B-A3B model and deployment provenance |
| [Evaluation](../model/openrouter-bakeoff/README.md) | Reproducible benchmark methods and historical results |
| [Data](../model/study/README.md) | Dataset layout, study manifests, and split rules |
| [Operations](../ops/README.md) | GB10 resource checks and service lifecycle |
| [Contributing](contributing/README.md) | Development conventions and verification |

## Documentation layout

Each maintained component has a `README.md`. Keep setup instructions with the component, shared contracts here, and measured results beside their run artifacts. Link to a single authoritative description instead of duplicating status across planning documents.

Old handoffs and planning notes are excluded from Git. Historical implementation details remain in Git history; numerical evaluation artifacts remain with their experiments. Agent instruction files may be kept locally. The Hermes `SKILL.md` is retained because it is an input to the running agent, not a project guide.

The API guide describes current code. Experimental batch exports can use an older schema, documented separately in that guide. Do not substitute an old proposal for the implemented browser API.
