"""Ground VLM incident boxes on YOLO person detections (plan: model/.plans/local-vlm-quality.md, Phase 3).

Reads a benchmark results file (model/openrouter-bakeoff/results/<model>.jsonl), runs a YOLO person
detector on each incident's key frame (the cached benchmark frame at incident.seconds), replaces the
VLM box with the best-matching person box, and writes <model>__yolo.jsonl for `vlm-benchmark.ts boxes`.
Detections, categories and scores are unchanged, only boxes move.

Matching: the person box with the highest IoU with the VLM box; if none overlap, the person whose
centre is nearest the VLM box centre; if no person is found (or the VLM gave no box), keep the VLM box.

  docker run --rm --runtime=nvidia --gpus all -v /srv/kryptonx-data/models/yolo:/weights:ro \
    -v "$PWD":/workspace -w /workspace kryptonx/yolo:dev \
    python model/YOLO/src/yolo_snap.py --results model/openrouter-bakeoff/results/qwen3-vl-30b-a3b__local.jsonl
"""

import argparse
import json
from pathlib import Path

import torch
from ultralytics import YOLO

# cuDNN 9.20 in the NGC 26.03 image returns no detections for YOLO on the GB10 (sm_121);
# with cuDNN off, results match the CPU (checked on ultralytics' bus.jpg: 4 persons) at ~10 ms/image.
torch.backends.cudnn.enabled = False

FRAMES = Path("data/bakeoff/frames")


def iou(a, b):
    ix = max(0.0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    iy = max(0.0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    inter = ix * iy
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / union if union > 0 else 0.0


def centre(b):
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def persons(model, image: Path, conf: float):
    r = model.predict(str(image), classes=[0], conf=conf, device=0, verbose=False)[0]
    return [{"x": float(x1), "y": float(y1), "width": float(x2 - x1), "height": float(y2 - y1)}
            for x1, y1, x2, y2 in r.boxes.xyxyn.tolist()]


def snap(vlm_box, people):
    if not people:
        return vlm_box, "kept:no-person"
    if not vlm_box:
        return None, "kept:no-vlm-box"
    best = max(people, key=lambda p: iou(vlm_box, p))
    if iou(vlm_box, best) > 0:
        return best, "iou"
    cx, cy = centre(vlm_box)
    return min(people, key=lambda p: (centre(p)[0] - cx) ** 2 + (centre(p)[1] - cy) ** 2), "nearest"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", type=Path, required=True)
    ap.add_argument("--weights", default="/weights/yolo11m.pt")
    ap.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()
    model = YOLO(args.weights)
    out = args.results.with_name(args.results.stem + "__yolo.jsonl")
    counts: dict[str, int] = {}
    with open(args.results) as src, open(out, "w") as dst:
        for line in src:
            row = json.loads(line)
            if row.get("ok"):
                row["model"] = row["model"] + " +yolo"
                for inc in row["result"]["incidents"]:
                    image = FRAMES / row["video"] / f"{float(inc['seconds']):.2f}.jpg"
                    if not image.exists():
                        counts["kept:no-frame"] = counts.get("kept:no-frame", 0) + 1
                        continue
                    box, how = snap(inc.get("box"), persons(model, image, args.conf))
                    counts[how] = counts.get(how, 0) + 1
                    if box:
                        inc["box"] = {**box, "label": inc["category"]}
            dst.write(json.dumps(row) + "\n")
    print(f"wrote {out}  box sources: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
