"""Evaluation for the shoplifting study: validation metrics and the paired test comparison.

val  : metrics on study-split validation videos (video-level labels only, see model/study/v1/splits.csv)
       - mil_nll: mean of (a) -log max P(yes) over each Shoplifting video and (b) mean -log(1 - P(yes))
         over Normal windows. Lower is better; this is the pre-specified selection metric.
       - video_auroc: AUROC of max P(yes) per video.
test : window-level metrics on the locked test set for one or two score files. With two files
       (--baseline zero-shot, --scores fine-tuned) it reports the primary endpoint, ΔAUROC, with a
       paired bootstrap 95% CI that resamples videos (windows of a video are not independent).

  python model/Qwen3.8-27B-INT4/src/evaluate.py val --scores /data/runs/qwen38/exp3/.../val_scores.csv
  python model/Qwen3.8-27B-INT4/src/evaluate.py test --scores ft.csv --baseline zeroshot.csv --out report.json
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

STUDY = Path(__file__).resolve().parent.parent.parent / "study/v1"
EPS = 1e-6


def with_splits(path: Path) -> pd.DataFrame:
    s = pd.read_csv(path)
    sp = pd.read_csv(STUDY / "splits.csv")[["video_id", "study_split"]]
    return s.merge(sp, on="video_id")


def val_metrics(s: pd.DataFrame) -> dict:
    s = s[s.study_split == "val"]
    vmax = s.groupby(["video_id", "class"]).p_yes.max().reset_index()
    pos = vmax[vmax["class"] == "Shoplifting"].p_yes.clip(EPS, 1 - EPS)
    neg = s[s["class"] == "Normal"].p_yes.clip(EPS, 1 - EPS)
    return {"mil_nll": float(0.5 * (-np.log(pos).mean() + -np.log(1 - neg).mean())),
            "video_auroc": float(roc_auc_score(vmax["class"] == "Shoplifting", vmax.p_yes)),
            "pos_video_max_mean": float(pos.mean()), "neg_window_mean": float(neg.mean()),
            "videos": int(len(vmax)), "windows": int(len(s))}


def fp_per_hour(neg: pd.DataFrame, thr: float) -> float:
    hours = len(neg) * 4.0 / 3600  # 4 s stride: each window adds 4 s of new footage
    return float((neg.p_yes >= thr).sum() / hours)


def threshold_1fph(val_scores: Path) -> float:
    """Score threshold giving about 1 false positive per hour on validation Normal windows."""
    v = with_splits(val_scores)
    vneg = v[(v.study_split == "val") & (v["class"] == "Normal")].p_yes.sort_values(ascending=False)
    hours = len(vneg) * 4.0 / 3600
    return float(vneg.iloc[max(int(np.floor(hours)) - 1, 0)]) if len(vneg) else 0.5


def window_metrics(t: pd.DataFrame) -> dict:
    y, p = t.label.values, t.p_yes.values
    vmax = t.groupby(["video_id", "class"]).p_yes.max().reset_index()
    return {"window_auroc": float(roc_auc_score(y, p)), "window_auprc": float(average_precision_score(y, p)),
            "video_auroc": float(roc_auc_score(vmax["class"] == "Shoplifting", vmax.p_yes)),
            "windows": int(len(t)), "positives": int(y.sum()), "videos": int(t.video_id.nunique())}


def bootstrap(t: pd.DataFrame, cols: list[str], n: int, seed: int) -> dict[str, np.ndarray]:
    """Video-clustered bootstrap of window AUROC for each score column."""
    rng = np.random.default_rng(seed)
    groups = {vid: g for vid, g in t.groupby("video_id")}
    vids = np.array(list(groups))
    out = {c: [] for c in cols}
    for _ in range(n):
        sample = pd.concat([groups[v] for v in rng.choice(vids, len(vids), replace=True)])
        if sample.label.nunique() < 2:
            continue
        for c in cols:
            out[c].append(roc_auc_score(sample.label, sample[c]))
    return {c: np.array(v) for c, v in out.items()}


def ci(x: np.ndarray) -> list[float]:
    return [float(np.percentile(x, 2.5)), float(np.percentile(x, 97.5))]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["val", "test"])
    ap.add_argument("--scores", type=Path, required=True)
    ap.add_argument("--baseline", type=Path, help="Zero-shot test scores for the paired comparison")
    ap.add_argument("--threshold-from", type=Path, help="Val scores used to set the 1 FP/h threshold")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    s = with_splits(args.scores)
    if args.mode == "val":
        res = val_metrics(s)
    else:
        t = s[s.study_split == "test"]
        res = {"scores": str(args.scores), **window_metrics(t)}
        neg = t[t["class"] == "Normal"]
        if args.threshold_from:
            thr = threshold_1fph(args.threshold_from)
            res.update({"threshold_1fph_on_val": thr, "fp_per_hour_normal_test": fp_per_hour(neg, thr),
                        "sensitivity_at_thr": float((t[t.label == 1].p_yes >= thr).mean())})
        if args.baseline:
            b = with_splits(args.baseline)
            b = b[b.study_split == "test"][["video_id", "start_sec", "p_yes"]].rename(columns={"p_yes": "p_base"})
            m = t.merge(b, on=["video_id", "start_sec"], validate="one_to_one")
            assert len(m) == len(t), "baseline and scores cover different windows"
            boots = bootstrap(m, ["p_yes", "p_base"], args.boot, args.seed)
            delta = boots["p_yes"] - boots["p_base"]
            res.update({"baseline": str(args.baseline), "baseline_window_auroc": float(roc_auc_score(m.label, m.p_base)),
                        "window_auroc_ci": ci(boots["p_yes"]), "baseline_window_auroc_ci": ci(boots["p_base"]),
                        "delta_auroc": float(roc_auc_score(m.label, m.p_yes) - roc_auc_score(m.label, m.p_base)),
                        "delta_auroc_ci": ci(delta), "bootstrap_resamples": int(len(delta))})
    print(json.dumps(res, indent=2))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
