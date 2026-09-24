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

## Training and evaluation data

Datasets each model owner uses, and how they map onto this contract. Files live on the ZGX Nano in the shared folder `/srv/kryptonx-data/` (readable by every user; writable by the `workspace` group), outside every home folder and never committed to git. Copy or symlink from there.

### Shoplifting (owner: Sonakshi)

| Topic | Detail |
|---|---|
| Datasets | UCF-Crime (`Shoplifting`, `Stealing` classes only), MERL Shopping |
| Location | `/srv/kryptonx-data/ucf-crime/raw/`, `/srv/kryptonx-data/merl-shopping/raw/` |
| Used for | Training the shoplifting model; replaying test videos as simulated live cameras to measure time-to-alert, latency per stream, and false alarm rate |
| Contract mapping | Each dataset video becomes a `Video`. Ground-truth events are compared against `Detection` records with `category: shoplifting` |

#### UCF-Crime

| Topic | Detail |
|---|---|
| Source | https://www.crcv.ucf.edu/research/real-world-anomaly-detection-in-surveillance-videos/ |
| Size | Full set: 1,900 videos, 128 hrs, 103 GB. We keep only `Shoplifting` (50 videos: 29 train / 21 test), `Stealing` (100: 95 / 5) and `Testing_Normal_Videos_Anomaly` (150, for false alarm rate) — 10.4 GB, fetched by `model/sonakshi/data_prep/download_ucf_subset.py` |
| Labels | Train: one label per video. Test: event start/end as **frame numbers** (up to 2 events per video, `-1` = none); divide by the video's fps (30) to get `startSec` / `endSec` |
| Licence | Research use; cite Sultani, Chen & Shah, "Real-world Anomaly Detection in Surveillance Videos", CVPR 2018 |

#### MERL Shopping

| Topic | Detail |
|---|---|
| Source | https://www.merl.com/research/highlights/merl-shopping-dataset |
| Size | 106 videos, ~2 min each, overhead camera in a grocery-store setting |
| Labels | Time intervals per action: reach to shelf, retract from shelf, hand in shelf, inspect product, inspect shelf |
| Used for | Hand/shelf gesture model (pick-up vs. put-back). Contains no theft, so it produces no `Detection` categories by itself |
| Licence | Free for research; cite Singh et al., "A Multi-Stream Bi-Directional Recurrent Neural Network for Fine-Grained Action Detection", CVPR 2016 |

## Open questions

- Transport: REST polling, webhooks, or a message queue? Streaming for live cameras?
- Who hosts the media files, and do URLs expire?
- Does severity come from the models or from web app rules per category?
- Should the model service provide thumbnails, or does the web app extract frames?
- Face blurring: done by the model service before media reaches the web app, or in the web app?
- Retention period for videos, detections and review verdicts.
- UCF-Crime `Stealing` includes non-retail theft (e.g. bikes, cars). Should those detections be `shoplifting`, `theft`, or excluded?
