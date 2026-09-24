"""Propose candidate positive windows in train-split Shoplifting videos and render them for review.

Training shoplifting videos only have a video-level label. For each one, the top --k windows by
zero-shot P(yes) (non-overlapping, at least 8 s apart) are proposed as candidates, and each candidate
is rendered as a 4x4 contact sheet of its 16 frames (2 fps) for a reviewer to accept or reject.
Accepted candidates become the training positives (see model/study/v1/positives_review.csv).

  python model/Qwen3.8-27B-INT4/src/candidates.py --scores /data/runs/qwen38/exp2/zeroshot_trainpool.csv \
      --k 3 --sheets /data/runs/qwen38/exp3/candidate_sheets --out model/study/v1/candidates.csv
"""

import argparse
import csv
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

from windows import FPS, WINDOW_SEC, decode_video, load_videos, window_frames  # noqa: E402

STUDY = Path(__file__).resolve().parent.parent.parent / "study/v1"


def sheet(frames: np.ndarray, start: float, title: str) -> Image.Image:
    h, w = frames.shape[1:3]
    img = Image.new("RGB", (4 * w, 4 * h + 24), "white")
    draw = ImageDraw.Draw(img)
    draw.text((6, 5), title, fill="black")
    for i, f in enumerate(frames):
        x, y = (i % 4) * w, 24 + (i // 4) * h
        img.paste(Image.fromarray(f), (x, y))
        draw.text((x + 4, y + 4), f"{start + i / FPS:.1f}s", fill="yellow")
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scores", type=Path, required=True)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--sheets", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    with open(STUDY / "splits.csv") as f:
        train = {r["video_id"] for r in csv.DictReader(f) if r["study_split"] == "train" and r["class"] == "Shoplifting"}
    scores: dict[str, list[tuple[float, float]]] = {}
    with open(args.scores) as f:
        for r in csv.DictReader(f):
            if r["video_id"] in train:
                scores.setdefault(r["video_id"], []).append((float(r["start_sec"]), float(r["p_yes"])))

    paths = {v.video_id: v.path for v in load_videos()}
    args.sheets.mkdir(parents=True, exist_ok=True)
    rows = []
    for vid in sorted(scores):
        picked: list[tuple[float, float]] = []
        for start, p in sorted(scores[vid], key=lambda x: -x[1]):
            if all(abs(start - s) >= WINDOW_SEC for s, _ in picked):
                picked.append((start, p))
            if len(picked) == args.k:
                break
        frames = decode_video(paths[vid])
        for rank, (start, p) in enumerate(picked, 1):
            name = f"{vid}_{int(start):05d}.jpg"
            sheet(window_frames(frames, start), start, f"{vid}  start {start:.0f}s  zero-shot P(yes)={p:.3f}").save(
                args.sheets / name, quality=90)
            rows.append({"video_id": vid, "start_sec": start, "rank": rank, "zeroshot_p_yes": round(p, 4),
                         "sheet": name})
    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} candidates from {len(scores)} videos -> {args.out}, sheets in {args.sheets}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
