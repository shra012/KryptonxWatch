"""Build one round of multiple-instance training windows (Experiment 3, weak supervision).

Train-split Shoplifting videos only carry a video-level label, so each round takes the top --k
windows per video (non-overlapping, at least 8 s apart) under the current model's scores as
positives. Negatives are windows from train-split Normal videos, sampled at random up to
--neg-ratio negatives per positive. Validation, test and excluded videos are never used.

  python model/Qwen3.8-27B-INT4/src/mil_round.py --scores /data/runs/qwen38/exp2/zeroshot_trainpool.csv \
      --k 3 --neg-ratio 5 --seed 1 --out /data/runs/qwen38/exp3/lr1e-4/seed1/round1.csv
"""

import argparse
import csv
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from windows import WINDOW_SEC  # noqa: E402

STUDY = Path(__file__).resolve().parent.parent.parent / "study/v1"


def top_k(windows: list[tuple[float, float]], k: int) -> list[float]:
    picked: list[float] = []
    for start, _ in sorted(windows, key=lambda x: -x[1]):
        if all(abs(start - s) >= WINDOW_SEC for s in picked):
            picked.append(start)
        if len(picked) == k:
            break
    return picked


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scores", type=Path, required=True, help="Current-model scores for train-split videos")
    ap.add_argument("--neg-scores", type=Path,
                    help="Scores file listing the train Normal windows to sample negatives from (default: --scores). "
                         "Negatives are drawn at random, so any file covering every train Normal video works.")
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--neg-ratio", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    with open(STUDY / "splits.csv") as f:
        split = {r["video_id"]: (r["class"], r["study_split"]) for r in csv.DictReader(f)}
    pos_windows: dict[str, list[tuple[float, float]]] = {}
    neg_windows: list[tuple[str, float]] = []
    with open(args.scores) as f:
        for r in csv.DictReader(f):
            if split[r["video_id"]] == ("Shoplifting", "train"):
                pos_windows.setdefault(r["video_id"], []).append((float(r["start_sec"]), float(r["p_yes"])))
    with open(args.neg_scores or args.scores) as f:
        for r in csv.DictReader(f):
            if split[r["video_id"]] == ("Normal", "train"):
                neg_windows.append((r["video_id"], float(r["start_sec"])))
    if not pos_windows or not neg_windows:
        sys.exit(f"need train Shoplifting and train Normal windows: got {len(pos_windows)} positive videos, "
                 f"{len(neg_windows)} negative windows")

    positives = [(vid, s) for vid in sorted(pos_windows) for s in top_k(pos_windows[vid], args.k)]
    rng = random.Random(args.seed)
    negatives = rng.sample(neg_windows, min(len(neg_windows), int(args.neg_ratio * len(positives))))
    rows = [{"video_id": v, "start_sec": s, "target": 1} for v, s in positives]
    rows += [{"video_id": v, "start_sec": s, "target": 0} for v, s in negatives]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["video_id", "start_sec", "target"])
        w.writeheader()
        w.writerows(rows)
    print(f"{len(positives)} positives from {len(pos_windows)} videos, {len(negatives)} negatives -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
