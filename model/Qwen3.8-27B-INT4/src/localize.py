"""Temporal localisation for the shoplifting study (Experiment 4): window scores -> events.

Each window at or above the threshold marks its central stride, [start + 2, start + 6] s, as suspect
(the central strides tile the video without overlap). Suspect spans separated by at most GAP_SEC are
merged into one event. An event's confidence is its highest window score and peakSec is the centre
of that window. The threshold is the 1 FP/h validation threshold from evaluate.py (pre-specified;
validation videos have no time stamps, so nothing else is tuned).

  metrics : event recall / precision at tIoU 0.3 and 0.5, median onset error, AP@tIoU on the test split
  payload : results JSON in the Detection format of docs/api/README.md, one job per video

  python model/Qwen3.8-27B-INT4/src/localize.py --scores ft_test.csv --threshold-from ft_val.csv --out loc.json \\
      --payload detections.json
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from evaluate import threshold_1fph, with_splits
from windows import STRIDE_SEC, WINDOW_SEC, load_events

GAP_SEC = 2.0
TIOUS = (0.3, 0.5)
MODEL = {"name": "qwen3.8-27b-shoplifting-lora", "version": "0.1.0"}


def video_events(w: pd.DataFrame, thr: float) -> list[dict]:
    """Merge the suspect windows of one video into events."""
    pad = (WINDOW_SEC - STRIDE_SEC) / 2
    hits = w[w.p_yes >= thr].sort_values("start_sec")
    events: list[dict] = []
    for r in hits.itertuples():
        a, b = r.start_sec + pad, r.start_sec + pad + STRIDE_SEC
        if events and a - events[-1]["endSec"] <= GAP_SEC:
            e = events[-1]
            e["endSec"] = b
            if r.p_yes > e["confidence"]:
                e["confidence"], e["peakSec"] = float(r.p_yes), r.start_sec + WINDOW_SEC / 2
        else:
            events.append({"startSec": a, "endSec": b, "confidence": float(r.p_yes),
                           "peakSec": r.start_sec + WINDOW_SEC / 2})
    return events


def tiou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    return inter / union if union > 0 else 0.0


def match(dets: list[tuple[str, dict]], gts: dict[str, list[tuple[float, float]]], t: float) -> list[bool]:
    """Greedy matching in descending confidence; returns a true-positive flag per detection."""
    used = {v: [False] * len(g) for v, g in gts.items()}
    flags = []
    for vid, d in sorted(dets, key=lambda x: -x[1]["confidence"]):
        best, bi = t, -1
        for i, g in enumerate(gts.get(vid, [])):
            iou = tiou((d["startSec"], d["endSec"]), g)
            if not used[vid][i] and iou >= best:
                best, bi = iou, i
        if bi >= 0:
            used[vid][bi] = True
        flags.append(bi >= 0)
    return flags


def average_precision(flags: list[bool], n_gt: int) -> float:
    tp = np.cumsum(flags)
    prec = tp / np.arange(1, len(flags) + 1)
    return float(np.sum(prec * np.array(flags)) / n_gt) if n_gt else float("nan")


def metrics(dets: list[tuple[str, dict]], gts: dict[str, list[tuple[float, float]]]) -> dict:
    n_gt = sum(len(g) for g in gts.values())
    res: dict = {"events_predicted": len(dets), "events_annotated": n_gt}
    for t in TIOUS:
        flags = match(dets, gts, t)
        res[f"recall@{t}"] = float(sum(flags) / n_gt)
        res[f"precision@{t}"] = float(sum(flags) / len(flags)) if flags else float("nan")
        res[f"ap@{t}"] = average_precision(flags, n_gt)
    onset = []
    for vid, g in gts.items():
        for a, b in g:
            cands = [d for v, d in dets if v == vid and tiou((d["startSec"], d["endSec"]), (a, b)) > 0]
            if cands:
                onset.append(min(abs(d["startSec"] - a) for d in cands))
    res["median_onset_error_sec"] = float(np.median(onset)) if onset else float("nan")
    res["events_with_overlapping_detection"] = len(onset)
    return res


def payload(vid: str, events: list[dict]) -> dict:
    job = f"job-{vid}"
    dets = [{"id": f"det-{vid}-{i:02d}", "videoId": vid, "jobId": job, "category": "shoplifting",
             "severity": "high", "confidence": round(e["confidence"], 4), "startSec": e["startSec"],
             "endSec": e["endSec"], "peakSec": e["peakSec"],
             "description": "Possible shoplifting; human review needed",
             # The model scores whole windows and gives no location, so the keyframe box is the full frame.
             "keyframes": [{"seconds": e["peakSec"],
                            "boxes": [{"x": 0, "y": 0, "width": 1, "height": 1, "label": "Scene"}]}],
             "model": MODEL} for i, e in enumerate(events)]
    return {"schemaVersion": "0.1",
            "job": {"id": job, "videoId": vid, "status": "complete", "models": [MODEL]}, "detections": dets}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scores", type=Path, required=True)
    ap.add_argument("--threshold-from", type=Path, help="Val scores for the 1 FP/h threshold")
    ap.add_argument("--threshold", type=float)
    ap.add_argument("--split", default="test")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--payload", type=Path, help="Write data-contract results JSON (list, one per video)")
    args = ap.parse_args()

    thr = args.threshold if args.threshold is not None else threshold_1fph(args.threshold_from)
    s = with_splits(args.scores)
    s = s[s.study_split == args.split]
    per_video = {vid: video_events(w, thr) for vid, w in s.groupby("video_id")}
    dets = [(vid, e) for vid, ev in per_video.items() for e in ev]
    events = load_events()
    gts = {vid: events.get(vid, []) for vid in per_video if vid in events}
    res = {"scores": str(args.scores), "split": args.split, "threshold": thr, "gap_sec": GAP_SEC,
           **metrics(dets, gts),
           "events_on_normal_videos": sum(len(ev) for vid, ev in per_video.items() if vid.startswith("Normal"))}
    print(json.dumps(res, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(res, indent=2))
    if args.payload:
        args.payload.parent.mkdir(parents=True, exist_ok=True)
        args.payload.write_text(json.dumps([payload(v, ev) for v, ev in per_video.items()], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
