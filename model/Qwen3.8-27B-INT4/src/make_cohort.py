"""Freeze the cohort: exclusions from the leakage audit and the train/validation split (Experiment 1, step 5).

The official UCF test split stays the locked test set, unchanged. Training-pool videos that share
frames or a scene with any test video (loose audit: pHash distance <= 10 on >= 5% of frames) are
excluded, so no scene crosses train/test. About 20% of the remaining training pool per class goes to
validation, picked at random by video (no scene overlaps exist inside the training pool).

  python model/Qwen3.8-27B-INT4/src/make_cohort.py
"""

import csv
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from windows import load_videos  # noqa: E402

STUDY = Path(__file__).resolve().parent.parent.parent / "study/v1"
VAL_FRACTION, SEED = 0.2, 0


def main() -> int:
    videos = load_videos()
    excluded = {}
    with open(STUDY / "leak_audit_loose.csv") as f:
        for r in csv.DictReader(f):
            if r["cross_split"] == "True":
                train_side = r["video_a"] if r["split_a"] == "train" else r["video_b"]
                test_side = r["video_b"] if train_side == r["video_a"] else r["video_a"]
                excluded.setdefault(train_side, []).append(f"{test_side} ({r['matched_frac_of_shorter']})")

    rng = random.Random(SEED)
    rows = []
    for cls in sorted({v.cls for v in videos}):
        pool = sorted(v.video_id for v in videos if v.cls == cls and v.split == "train" and v.video_id not in excluded)
        val = set(rng.sample(pool, round(VAL_FRACTION * len(pool))))
        for v in videos:
            if v.cls != cls:
                continue
            if v.split == "test":
                split = "test"
            elif v.video_id in excluded:
                split = "excluded"
            else:
                split = "val" if v.video_id in val else "train"
            rows.append({"video_id": v.video_id, "class": v.cls, "official_split": v.split, "study_split": split})

    with open(STUDY / "splits.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    with open(STUDY / "exclusions.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "reason"])
        for vid, matches in sorted(excluded.items()):
            w.writerow([vid, "shares frames/scene with test video(s): " + "; ".join(matches)])

    counts = {}
    for r in rows:
        counts[(r["class"], r["study_split"])] = counts.get((r["class"], r["study_split"]), 0) + 1
    for k, n in sorted(counts.items()):
        print(f"{k[0]:12s} {k[1]:9s} {n:4d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
