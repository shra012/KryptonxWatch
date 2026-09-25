# YOLO person boxes in the app

Status: 2026-09-25 · done and verified on a laptop (yolo11m on Apple GPU): live `/api/analyze` on Robbery2 8–16 s returns 4 tracked keyframes on the robber; e2e passes. Still to do: run `yolo_server.py` on the GB10 with the served weights.

## Context
Boxes on the video page were wrong or missing (reported on HawkWatch's Robbery2 at 0:11). Causes, found by replaying the bake-off's saved replies through `mergeDetections`:
1. **YOLO snapping never reached the app.** `model/YOLO/src/yolo_snap.py` only rewrites benchmark results files. The app drew the VLM's own boxes, which the bake-off found loose (median IoU about 0.1 between models). [local-vlm-quality.md](../../model/.plans/local-vlm-quality.md) Phase 3 found YOLO-snapped boxes the tightest on the acting person and planned moving snapping into `app/api/analyze`.
2. **One box per window, shown for the whole detection.** A detection kept a single box from its highest-confidence window, drawn unchanged for its whole time range while people moved.
3. **Boxes appeared only from the key frame.** A detection starts at its key frame (Qwen3-VL-30B-A3B: 13 s in the 8–16 s window), and the page drew boxes from 1.5 s before that, so nothing showed at 0:11 although the robber was in the window's frames.

## Steps
1. `model/YOLO/src/yolo_server.py`: a small HTTP service returning person boxes (normalised) for a batch of frames. Same weights and cuDNN workaround as `yolo_snap.py`. Configured in the app with `YOLO_BASE_URL`; without it the app keeps VLM boxes.
2. `lib/vlm/boxes.ts` (pure, shared with the benchmark): snapping rule copied from `yolo_snap.py` (highest IoU, else nearest centre), then follow that person across the window's other frames (IoU, else nearest centre within a distance limit), giving a keyframe per frame. `boxAt()` interpolates between keyframes for playback.
3. `Incident.keyframes` and `Detection.keyframes` (`{seconds, box}[]`, as in `docs/data-contract.md` and hawkwatch-ui-parity Phase 0.8). `parseWindow` seeds one keyframe from the VLM box; `mergeDetections` collects keyframes from every merged window, not only the highest-confidence one.
4. `app/api/analyze`: after the VLM reply, call YOLO on the window's frames and replace each incident's box and keyframes with the tracked person boxes.
5. Video page: draw `boxAt(detection, currentTime)`, shown from the first keyframe to the last (±1 s). Detections without keyframes (samples, older analyses) keep the static box.

## Verification
- Replay Robbery2 with saved Qwen3-VL-30B-A3B and Nemotron replies plus YOLO: a box on the robber at 0:11, following him through the window.
- `npm run lint && npm run typecheck`, `npm run test:e2e`.
- Old analyses need "Run AI analysis" again to get keyframes.
