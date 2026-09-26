# Sentinel Machines v1

**Sentinel Machines v1** is the team's fine-tuned **Qwen3-VL-30B-A3B** model for retail security video analysis, running on the **HP ZGX Nano / NVIDIA GB10**.

It powers a workflow in which short video windows become scene descriptions and suspected incidents for human review. The application pairs model output with YOLO person boxes, a review timeline, analytics, and a contextual assistant.

## Task coverage

| Task | Application behavior |
| --- | --- |
| Incident understanding | Suspected shoplifting, theft, robbery, pickpocketing, fighting, vandalism, visible guns, kiosk nonpayment, medical emergencies, and suspicious activity |
| Scene descriptions | A concise description of each analyzed window |
| Temporal evidence | Model-selected moments mapped to video timestamps; matching windows merged into events |
| Actor localization | Initial model boxes optionally refined and followed by YOLO |
| Operator assistance | Questions and summaries grounded in the saved analysis context |

This is the supported workflow, not a claim that every category has been independently evaluated. Queue tracking is represented separately as a measurement in the application domain model.

## Deployment

The model is accessed through an OpenAI-compatible endpoint. Configure the app with the actual service identifier from the serving runtime; the team's local label has been `qwen3-vl-30b-a3b` at `http://127.0.0.1:8080/v1`.

The UI product identifier is `sentinel-machines-v1`. Display aliases do not select adapter weights by themselves. Verify the checkpoint or adapter loaded by the service when deploying or recording a benchmark.

See [web app configuration](../../webapp/README.md) and [GB10 operations](../../ops/README.md). The current deployed v1 checkpoint should be retained when restarting services; serving the public FP8 base model alone does not reproduce a fine-tuned v1 release.

## Release provenance

The fine-tuned model identity and GB10 deployment are described by the project owner. The repository currently contains the application integration and historical model experiments; it does not include the v1 adapter manifest, training configuration, or a dedicated v1 evaluation report.

For a reproducible release, attach the base revision, adapter or merged-checkpoint checksum, training-data manifest and split exclusions, training configuration, runtime version, and held-out evaluation results. Those details should come from the actual run rather than be inferred from the product name.

The earlier [Qwen3.8 shoplifting LoRA](../Qwen3.8-27B-INT4/README.md) is a different model. The [bake-off results](../openrouter-bakeoff/README.md) compare historical base models and are not Sentinel Machines v1 release scores.

## Inputs and outputs

The default app pipeline submits four frames sampled across eight seconds and asks for JSON containing a scene summary and incidents. Each incident carries a category, severity, confidence, selected frame, description, and optional box. The app normalizes this into timestamped events; see the [API contract](../../docs/api/README.md).

## Intended use and limitations

Use the model to prioritize footage for a human reviewer. Confidence estimates and boxes can be wrong, especially with occlusion, crowds, low resolution, or ambiguous actions. Descriptions do not establish a person's intent or prove an offense. Detections remain suspected until reviewed.

Dataset and checkpoint usage terms must accompany the release. The research datasets described elsewhere in this repository are not evidence of the exact v1 training mixture.
