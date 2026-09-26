# Architecture

Sentinel Machines runs a browser dashboard, a Next.js API server, and local inference services on the HP ZGX Nano / NVIDIA GB10. [Sentinel Machines v1](../../model/sentinel-machines-v1/README.md) interprets the video; the optional [YOLO service](../../model/YOLO/README.md) refines person boxes.

## Video analysis

1. The browser opens an upload, webcam, or replay feed and captures timestamped frames.
2. The default analysis groups four frames sampled two seconds apart into an eight-second window.
3. `/api/analyze` validates the frames and resolves the selected, allowed model through server configuration.
4. The model returns a scene summary and suspected incidents in JSON. The parser converts frame indices and coordinates into video timestamps and normalized boxes.
5. When configured, YOLO detects people in the window's frames. The app associates the incident box with a person and follows boxes across those frames.
6. The browser merges neighboring matching incidents and displays them beside the video and scene log.
7. A reviewer marks detections reviewed or dismissed. Counts, charts, and exports derive from this application state.

The recorded-video shoplifting scorer is a separate legacy path: it sends 16 frames at 2 fps as an eight-second clip and returns a yes/no score. It does not produce the general model's scene descriptions or actor boxes.

## Components

| Component | Responsibility | Entry point |
| --- | --- | --- |
| Browser store | Video records, review state, notifications | [app-provider.tsx](../../webapp/components/app-provider.tsx) |
| Browser persistence | IndexedDB storage | [storage.ts](../../webapp/lib/storage.ts) |
| Analysis client | Frame capture and window requests | [detection-client.ts](../../webapp/lib/detection-client.ts) |
| VLM pipeline | Prompts, parsing, and event merging | [analysis.ts](../../webapp/lib/vlm/analysis.ts) |
| Model routing | Endpoint, allow-list, and alias resolution | [vlm-config.ts](../../webapp/lib/server/vlm-config.ts) |
| Person grounding | Optional YOLO calls and box association | [yolo.ts](../../webapp/lib/server/yolo.ts) |
| Assistant | Questions over existing detections and scene logs | [assistant.ts](../../webapp/lib/vlm/assistant.ts) |
| Watch agent | Scheduled briefings over the feed log | [Hermes guide](../../ops/hermes/README.md) |

## Storage and data boundaries

Uploaded media and review records are stored in the browser's IndexedDB. Sampled frames go to the Next.js server for inference. Browser state is not a shared, multi-user evidence database; clearing browser storage can remove saved recordings and review decisions.

With local endpoints, core model inference stays on the GB10. Selecting OpenRouter sends the model input to that provider. The assistant receives the recording's analysis context rather than independently rewatching the original recording.

When the watch feed is enabled, the server records structured events under `data/watch/`. Hermes reads that feed through `/api/mcp`; its default text model is hosted through OpenRouter. Notification integrations send alert content to Twilio or SendGrid. These optional paths mean that an installation's data boundary depends on its configuration.

## Failure behavior

- Without model configuration, real uploads receive no invented detections.
- Invalid analysis requests produce a JSON error. Malformed model JSON is retried once.
- When YOLO is absent or unavailable, analysis retains VLM boxes.
- Unavailable system telemetry is presented as unavailable rather than zero.
- The UI labels simulated samples and simulated emergency responses.

## Deployment scope

The repository supplies a working single-node application and research tooling. Multi-store orchestration, a centralized evidence database, and validated camera-scale capacity are not implied by this architecture. Use measured results from the intended deployment when sizing workloads.

See [operations](../../ops/README.md) for resource limits and [API contract](../api/README.md) for payloads.
