# KryptonxWatch data contract (high level)

This document defines the data that passes between the **model / detection services** and the **web app**. Either side can build against this contract before the other side is finished: the web app uses mock data in this shape, and the models produce output in this shape.

Status: **draft v0.1**. Propose changes in a PR that edits this file.

## Conventions

| Topic | Rule |
|---|---|
| Format | JSON, UTF-8 |
| Field names | `camelCase` |
| IDs | Strings, unique across the system (UUIDs recommended) |
| Wall-clock time | ISO 8601 in UTC, e.g. `2026-09-22T10:15:00.000Z` |
| Video time | Seconds (float) from the start of the video |
| Coordinates | Normalized `0–1` relative to frame width/height, origin top-left |
| Confidence | Float `0–1` |
| Versioning | Every payload carries `schemaVersion` (currently `"0.1"`) |
| Unknown values | Omit optional fields; never send placeholder strings |

## Entities

```
Store ─┬─ Camera ─── Video ─── AnalysisJob ─── Detection ─┬─ Keyframe
       └─ Zone ◄──────────────────────────────────────────┘   └─ ReviewVerdict (web app → models)
```

### Store
A physical site.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `timezone` | string | IANA, e.g. `America/Los_Angeles`; used for hour-of-day charts |
| `floorPlanUrl` | string? | Image used by the floor-plan map |

### Camera

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `storeId` | string | |
| `name` | string | e.g. "Checkout 2" |
| `position` | `{x, y}`? | Normalized position on the store floor plan |
| `status` | `online` \| `offline` \| `obstructed` \| `low_light` \| `blurry` | Camera health |

### Zone
A named area of the store (floor-plan polygon) and optionally of a camera view.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `storeId` | string | |
| `name` | string | e.g. "Self checkout", "Entrance" |
| `type` | `checkout` \| `entrance` \| `aisle` \| `kiosk` \| `queue` \| `other` | |
| `floorPolygon` | `{x, y}[]` | Normalized points on the floor plan |

### Video
A recording or a segment of a live stream.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `cameraId` | string? | Absent for ad-hoc uploads |
| `title` | string | |
| `recordedAt` | ISO datetime | Start of the recording |
| `duration` | number | Seconds |
| `fps` | number? | |
| `width`, `height` | number? | Pixels |
| `mediaUrl` | string | Where the web app can play it |
| `sha256` | string? | Hash of the source file, used for evidence chain-of-custody |

### AnalysisJob
One run of the models over one video.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `videoId` | string | |
| `status` | `queued` \| `processing` \| `complete` \| `failed` | |
| `progress` | number? | `0–1` while processing |
| `models` | `{name, version}[]` | Models that ran |
| `startedAt`, `finishedAt` | ISO datetime? | |
| `error` | string? | Human-readable reason when `failed` |

### Detection
One event found by a model. This is the core record.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `videoId` | string | |
| `jobId` | string | |
| `cameraId` | string? | |
| `zoneId` | string? | |
| `category` | Category | See enum below |
| `severity` | Severity | See enum below; models suggest, the web app may override |
| `confidence` | number | `0–1` |
| `startSec` | number | Event start in video time |
| `endSec` | number | Equal to `startSec` for instantaneous events |
| `peakSec` | number | Best moment to show as a thumbnail |
| `description` | string | Short, neutral wording ("possible", "review needed") |
| `keyframes` | Keyframe[] | Boxes over time; at least one, at `peakSec` |
| `trackIds` | string[]? | People/objects involved; enables cross-camera trails later |
| `metrics` | object? | Measurements, e.g. `{ "queueLength": 4, "estimatedWaitSec": 180 }` |
| `model` | `{name, version}` | Which model produced it |

### Keyframe

| Field | Type | Notes |
|---|---|---|
| `seconds` | number | Video time |
| `boxes` | `{x, y, width, height, label, trackId?}[]` | Normalized coordinates |
| `thumbnailUrl` | string? | Pre-cropped frame, if the model service provides it |

### ReviewVerdict (web app → model team)
Human review results. The model team uses these as labelled data and for measuring precision.

| Field | Type | Notes |
|---|---|---|
| `detectionId` | string | |
| `verdict` | `confirmed` \| `dismissed` \| `wrong_category` | |
| `reason` | string? | e.g. `false_positive_employee`, `bad_angle`, `duplicate` |
| `correctedCategory` | Category? | When `verdict` is `wrong_category` |
| `reviewerId` | string | |
| `reviewedAt` | ISO datetime | |

## Enums

**Category**: `robbery`, `theft`, `shoplifting`, `pickpocketing`, `gun`, `queue_tracking`, `kiosk_nonpayment`, `medical_emergency`, `suspicious_activity`

**Severity**: `critical`, `high`, `medium`, `low`, `measurement` (`measurement` is for non-incident metrics such as queue length)

Adding a category is a contract change: add it here first so the web app can give it a label, colour and playbook.

## Interfaces (high level)

Transport is still to be decided (REST vs. queue). The shape of the exchange:

| Direction | Operation | Payload |
|---|---|---|
| Web app → models | Submit video for analysis | `{ videoId, mediaUrl, cameraId?, models? }` → returns `AnalysisJob` |
| Web app → models | Get job status | `jobId` → `AnalysisJob` |
| Models → web app | Results | `{ schemaVersion, job: AnalysisJob, detections: Detection[] }` |
| Models → web app | Live event (future, streaming) | Single `Detection` pushed as it happens |
| Web app → models | Review feedback export | `ReviewVerdict[]` (batch, e.g. daily) |

## Example results payload

```json
{
  "schemaVersion": "0.1",
  "job": {
    "id": "job-8f2c",
    "videoId": "vid-checkout-0923",
    "status": "complete",
    "models": [{ "name": "kiosk-nonpayment", "version": "0.3.1" }],
    "startedAt": "2026-09-23T15:43:00.000Z",
    "finishedAt": "2026-09-23T15:44:10.000Z"
  },
  "detections": [
    {
      "id": "det-01",
      "videoId": "vid-checkout-0923",
      "jobId": "job-8f2c",
      "cameraId": "cam-checkout-2",
      "zoneId": "zone-self-checkout",
      "category": "kiosk_nonpayment",
      "severity": "high",
      "confidence": 0.82,
      "startSec": 6.2,
      "endSec": 9.8,
      "peakSec": 7.4,
      "description": "Possible item bypass at kiosk; human review needed",
      "keyframes": [
        { "seconds": 7.4, "boxes": [{ "x": 0.34, "y": 0.33, "width": 0.16, "height": 0.43, "label": "Person", "trackId": "trk-17" }] }
      ],
      "trackIds": ["trk-17"],
      "model": { "name": "kiosk-nonpayment", "version": "0.3.1" }
    }
  ]
}
```

## Open questions

- Transport: REST polling, webhooks, or a message queue? Streaming for live cameras?
- Who hosts the media files, and do URLs expire?
- Does severity come from the models or from web app rules per category?
- Should the model service provide thumbnails, or does the web app extract frames?
- Face blurring: done by the model service before media reaches the web app, or in the web app?
- Retention period for videos, detections and review verdicts.
