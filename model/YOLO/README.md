# YOLO person localization

YOLO supplies person detections and optional pose data to Sentinel Machines. The VLM identifies a suspected incident; the application can then associate its initial box with a detected person and follow boxes across sampled frames.

## Components

| File | Purpose |
| --- | --- |
| [src/yolo_server.py](src/yolo_server.py) | HTTP detection and pose service |
| [src/yolo_snap.py](src/yolo_snap.py) | Offline box refinement for benchmark outputs |
| [src/box_review.py](src/box_review.py) | Visual review pages for box comparisons |
| [env/Dockerfile](env/Dockerfile) | Container based on the shared `kryptonx/glm:dev` image |

## Run on the GB10

Use an existing `kryptonx/yolo:dev` image, or build it after preparing the [shared base image](../GLM-4.5-VL/README.md):

```bash
docker build -t kryptonx/yolo:dev model/YOLO/env
```

From the repository root, with `yolo11m.pt` already in the shared weights directory:

```bash
docker run -d --name kryptonx-yolo --restart unless-stopped \
  --runtime=nvidia --gpus all \
  --user "$(id -u):$(id -g)" -e USER -e LOGNAME \
  -p 127.0.0.1:8090:8090 \
  -v /srv/kryptonx-data/models/yolo:/weights:ro \
  -v "$PWD":/workspace -w /workspace \
  kryptonx/yolo:dev \
  python model/YOLO/src/yolo_server.py \
    --weights /weights/yolo11m.pt --host 0.0.0.0
```

Set `YOLO_BASE_URL=http://127.0.0.1:8090` in the web app's private environment and restart the app. For offline pose use, also supply `--pose-weights /weights/yolo11n-pose.pt` after placing that weight file in the shared directory. Otherwise the first pose request may attempt to download the default pose weights.

```bash
curl --fail http://127.0.0.1:8090/health
docker stop kryptonx-yolo
```

Use `sg docker -c '…'` when the current shell has not picked up Docker group membership. Check [GB10 resources](../../ops/README.md) before starting the service.

## HTTP interface

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | None | Service status, weights, and device |
| `POST /detect` | `{ "images": ["data:image/jpeg;base64,..."], "conf": 0.25 }` | One list of person boxes per image |
| `POST /pose` | Image list and optional confidence | Person boxes and 17 COCO keypoints per person |

Coordinates are normalized to 0–1. App-side calls are in [lib/server/yolo.ts](../../webapp/lib/server/yolo.ts); box association is in [lib/vlm/boxes.ts](../../webapp/lib/vlm/boxes.ts). If the service fails or is not configured, the application retains VLM boxes.

## Hardware and quality notes

The scripts disable cuDNN because the team's NGC 26.03 / cuDNN 9.20 combination returned empty detections on GB10 sm_121. Preserve that workaround unless the replacement environment has been verified.

A tight person box can still select the wrong actor. Crowds, occlusion, and keyframes chosen before the relevant person appears require human review. Agreement with another VLM's region box is not a valid person-localization ground truth.
