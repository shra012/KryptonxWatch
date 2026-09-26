# API and detection contract

This guide describes the implemented web app. Source definitions are [lib/types.ts](../../webapp/lib/types.ts), [lib/vlm/analysis.ts](../../webapp/lib/vlm/analysis.ts), and the [API routes](../../webapp/app/api). The browser API does not use the old proposed `schemaVersion` / `AnalysisJob` envelope.

## Conventions

| Value | Representation |
| --- | --- |
| Video time | Seconds from the start of the video |
| Wall-clock timestamps | ISO 8601 strings |
| Application boxes | `{ x, y, width, height, label }`, normalized to 0–1, top-left origin |
| Confidence | Number from 0 to 1; a model estimate, not an independently calibrated probability |
| Review status | `new`, `reviewed`, or `dismissed` |
| Missing optional fields | Omitted |

## Analyze a window

`POST /api/analyze` accepts:

```typescript
{
  frames: { seconds: number; image: string }[];
  start?: number;
  end?: number;
  context?: string;
  model?: string;
  source?: unknown; // Validated feed metadata; see lib/watch-types.ts.
}
```

Each image is a JPEG, PNG, or WebP base64 data URL. General analysis accepts 1–8 frames, each with at most 2,000,000 characters in the data URL. The default browser pipeline sends four frames. The legacy local scorer requires exactly 16 frames at 2 fps. Model selection is restricted to server-configured options.

A general-model response has this shape:

```typescript
{
  start: number;
  end: number;
  summary: string;
  incidents: {
    category: string;
    severity: "critical" | "high" | "medium" | "low";
    confidence: number;
    seconds: number;
    description: string;
    box?: { x: number; y: number; width: number; height: number; label: string };
    keyframes?: { seconds: number; box: BoundingBox; trackId?: string }[];
  }[];
  score: number;
  boxes: "yolo" | "vlm";
  model: string;
  latencyMs: number;
  usage: { promptTokens?: number; completionTokens?: number; cost?: number; local: boolean };
}
```

`BoundingBox` is the application box shape above. The scorer response has the same window-result core but does not include the general model's `boxes` field. Empty incidents are valid and mean no incident was returned for that window.

The model's raw JSON is a different format: it selects a **1-based frame index** and uses `[x1, y1, x2, y2]` coordinates on a 0–1000 scale. `parseWindow` translates these into the API format. Model integrations should follow the prompt and parser together.

## Stored detections

After window results are merged, the browser stores:

```typescript
interface Detection {
  id: string;
  videoId: string;
  seconds: number;
  category: Category;
  severity: Severity;
  status: "new" | "reviewed" | "dismissed";
  description: string;
  endSeconds?: number;
  confidence?: number;
  model?: string;
  box?: BoundingBox;
  keyframes?: { seconds: number; box: BoundingBox; trackId?: string }[];
  response?: { kind: "911" | "owner"; at: string; reference: string; outcome: string };
}
```

`Category` values are `Robbery`, `Theft`, `Shoplifting`, `Pickpocketing`, `Fighting`, `Vandalism`, `Gun`, `Queue tracking`, `Kiosk nonpayment`, `Medical emergency`, and `Suspicious activity`. Preserve capitalization and spaces.

`Severity` values are `critical`, `high`, `medium`, `low`, and `measurement`. Queue tracking belongs to the broader domain model; it is not one of the VLM incident prompt's categories. Measurements are not security incidents.

A scene-log entry is `{ start, end, summary }`. A recording stores these as `moments`, alongside detections and analysis state. Link to an event with `/videos/{id}?t={seconds}`.

## Other endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/model` | Configured model, allowed options, aliases, and scorer metadata; no API keys |
| `POST /api/chat` | Recording context and conversation → text with timestamp references |
| `POST /api/summary` | Detection rows and totals → an aggregate summary |
| `/api/detect`, `/api/track`, `/api/pose` | Person detection, box tracking, and pose helpers |
| `/api/alerts` | Optional owner notifications under server policy |
| `/api/system` | Machine telemetry and inference measurements |
| `/api/watch/events`, `/api/briefings`, `/api/mcp` | Watch feed, briefings, and agent access |
| `/api/demo-clips` | Configured local demonstration clips |

The chat and summary request types are in their route files and [assistant.ts](../../webapp/lib/vlm/assistant.ts). Watch feed metadata and event types are in [watch-types.ts](../../webapp/lib/watch-types.ts).

## Errors

Analysis errors return `{ "error": "message" }`: `400` for malformed inputs, `503` for missing model configuration, `429` when the general-model provider reports rate limiting, and `502` for upstream or parsing failures. The scorer reports upstream failures as `502`. A malformed general-model response is retried once before failing.

## Legacy study exports

The Qwen3.8 study's [localize.py](../../model/Qwen3.8-27B-INT4/src/localize.py) produces batch evaluation records using `startSec`, `endSec`, `peakSec`, job metadata, and the older detection envelope. Those artifacts remain useful for evaluation, but are not directly interchangeable with browser `Detection` records. Adapt timestamps, category values, keyframes, and model metadata explicitly when importing them.
