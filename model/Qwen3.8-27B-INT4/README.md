# Qwen3.8-27B-INT4

Status (2026-09-26): this is the original edge-flow design. The app no longer uses Qwen3.8-27B; it runs Qwen3-VL-30B-A3B locally (see [model/README.md](../README.md)). This folder now mainly holds the shoplifting study ([plans/shoplifting-study.md](plans/shoplifting-study.md)): the LoRA result is not conclusive (ΔAUROC +0.027, every 95% CI includes 0) with about 3x the false positives per hour ([model card](runs/qwen38/exp3/MODEL_CARD.md)).

Edge flow for HawkWatch. The camera path stays on device. Qwen3.8-27B-INT4 reads a short set of frames only after a suspicious event is detected, then the result goes to the dashboard.

## Model assets

`src/` contains Qwen experiment and inference code, `env/qwen/` contains the pinned environment, `runs/qwen38/` contains run outputs, and `plans/` contains experiment plans. Shared study inputs remain in `../study/`. Run scripts from the KryptonxWatch repository root.

## HawkWatch edge AI flow

```
Camera Feed
   ↓
YOLO Detection
   ↓
Tracking + Pose / Motion Analysis
   ↓
Suspicious Event Detected?
   ↓
Yes
   ↓
Select 8–16 Important Frames
   ↓
Add Metadata
- Timestamp
- Camera ID
- Person/Object Track ID
- Bounding Boxes
- Motion Information
   ↓
Qwen3.8-27B-INT4
   ↓
Event Understanding
- What happened?
- Severity
- Confidence
- Evidence
- Recommended action
   ↓
Confidence / Evidence Check
   ↓
 ┌───────────────────────┐
 │                       │
High Confidence      Low Confidence
 │                       │
 ↓                       ↓
Handle Locally       More Local Analysis
 │                       ↓
 ↓                 Still Uncertain?
Local Alert                ↓
 │                     Yes
 ↓                       ↓
Store Event          Cloud Escalation
 │                       ↓
 ↓                 Refined Result
Dashboard                 ↓
 │                  Update Dashboard
 ↓
Security Team
```

## Long-term memory flow

```
Detected Event
   ↓
Create Event Summary
   ↓
Store:
- Timestamp
- Camera
- Track ID
- Event Type
- Severity
- Confidence
- Important Frames / Clip
- Embedding
   ↓
Local Database / Vector DB
   ↓
User asks:
"What happened near the entrance in the last hour?"
   ↓
Retrieve Relevant Events
   ↓
Qwen3.8-27B-INT4
   ↓
Final Incident Summary
```

## Model stack

```
Camera
   ↓
YOLO
   ↓
ByteTrack / BoT-SORT
   ↓
Pose + Motion Logic
   ↓
Qwen3.8-27B-INT4
   ↓
Local / Cloud Router
   ↓
Dashboard + Alerts
```

## 30 GB target

| Piece | Memory |
|---|---|
| Qwen3.8-27B-INT4 | ~20–24 GB |
| YOLO + tracking + pose | ~1–2 GB |
| KV cache + runtime | ~4–7 GB |
| Safety margin | ~2–4 GB |
| **Total** | **≤ 30 GB** |
