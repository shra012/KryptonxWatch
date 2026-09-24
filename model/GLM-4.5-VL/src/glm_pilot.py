"""G2 inference pilot for GLM-4.5V (see model/GLM-4.5-VL/plans/glm-4.5v-arm.md).

Scores a few 8 s windows with the model in 4-bit NF4, thinking disabled, and reports P("yes")
for the answer token, seconds per window, peak memory and determinism.
Uses only non-test videos (UCF train split, MERL validation subjects); labels are irrelevant here.

Run inside the kryptonx/glm:dev container:
  docker run --rm --runtime=nvidia --gpus all --ipc=host \
    -v /srv/kryptonx-data:/srv/kryptonx-data -v "$PWD":/workspace -w /workspace kryptonx/glm:dev \
    python model/GLM-4.5-VL/src/glm_pilot.py --windows 20 --out model/GLM-4.5-VL/runs/glm45v/g2-pilot-box
"""

import argparse
import csv
import json
import platform
import random
import time
from pathlib import Path

import numpy as np
import torch

import glm_common as g


def pilot_windows(n: int, seed: int) -> list[tuple[str, Path, float]]:
    """Non-test windows: UCF train-split videos and MERL validation subjects (21-26)."""
    pool = g.video_index("ucf", {"train"}) + g.video_index("merl", {"val"})
    rng = random.Random(seed)
    chosen = rng.sample(pool, n)
    return [(r["video_id"], r["path"], g.random_start(rng, float(r["duration_sec"]))) for r in chosen]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--windows", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--answer-prefix", default=g.ANSWER_PREFIX,
                    help='Text appended after the assistant turn opener before scoring ("" to disable)')
    ap.add_argument("--no-cache", action="store_true", help="Quantize the bf16 checkpoint instead of loading the NF4 cache")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    processor = g.load_processor()
    model, source = g.load_model(prefer_cache=not args.no_cache)
    model.eval()
    load_sec = time.time() - t0
    yes, no = g.answer_token_ids(processor.tokenizer)
    torch.cuda.reset_peak_memory_stats()

    rows = []
    for vid, path, start in pilot_windows(args.windows, args.seed):
        frames = g.read_window(path, start)
        t = time.time()
        p1, top, mass = g.score(model, processor, frames, yes, no, args.answer_prefix)
        sec = time.time() - t
        p2, _, _ = g.score(model, processor, frames, yes, no, args.answer_prefix)
        rows.append({"video_id": vid, "start_sec": start, "p_yes": p1, "p_yes_repeat": p2,
                     "deterministic": p1 == p2, "top_token": top, "yes_no_mass": round(mass, 4),
                     "sec": round(sec, 2)})
        print(json.dumps(rows[-1]), flush=True)

    with open(args.out / "scores.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    summary = {
        "model_source": source,
        "precision": g.PRECISION,
        "windows": len(rows),
        "load_sec": round(load_sec, 1),
        "median_sec_per_window": float(np.median([r["sec"] for r in rows])),
        "peak_gpu_mem_gib": round(torch.cuda.max_memory_allocated() / 2**30, 1),
        "all_deterministic": all(r["deterministic"] for r in rows),
        "answer_prefix": args.answer_prefix,
        "min_yes_no_mass": min(r["yes_no_mass"] for r in rows),
        "top_tokens": sorted({r["top_token"] for r in rows}),
        "torch": torch.__version__,
        "host": platform.node(),
    }
    (args.out / "env.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
