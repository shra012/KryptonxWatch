"""G2 inference pilot for GLM-4.5V (see model/.plans/glm-4.5v-arm.md).

Scores a few 8 s windows with the model loaded in 4-bit NF4, thinking disabled, and reports
P("yes") from the first answer token, seconds per window, peak memory and determinism.
Uses only non-test videos (UCF train split, MERL validation subjects); labels are irrelevant here.

Run inside the kryptonx/glm:dev container:
  docker run --rm --runtime=nvidia --gpus all --ipc=host \
    -v /srv/kryptonx-data:/srv/kryptonx-data -v "$PWD":/workspace kryptonx/glm:dev \
    python model/src/glm_pilot.py --windows 20 --out model/runs/glm45v/g2-pilot
"""

import argparse
import csv
import json
import platform
import random
import time
from pathlib import Path

import av
import numpy as np
import torch
from transformers import AutoProcessor, BitsAndBytesConfig, Glm4vMoeForConditionalGeneration

MODEL_DIR = "/srv/kryptonx-data/models/glm-4.5v/ed47433b37111465ec527affaaddceff371bca04"
UCF = Path("/srv/kryptonx-data/ucf-crime")
MERL = Path("/srv/kryptonx-data/merl-shopping")
WINDOW_SEC, FPS = 8.0, 2.0

# Draft prompt for the pilot only; the study prompt is chosen and frozen on validation in Experiment 2.
PROMPT = (
    "This is an 8-second clip from a store security camera. "
    "Is someone shoplifting in this clip, meaning concealing or taking merchandise with evident "
    "intent to leave without paying? Answer with exactly one word: yes or no."
)


def read_window(path: Path, start: float) -> np.ndarray:
    """Decode frames at FPS for WINDOW_SEC seconds starting at `start`; returns (T, H, W, 3) uint8."""
    wanted = [start + i / FPS for i in range(int(WINDOW_SEC * FPS))]
    frames, k = [], 0
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        container.seek(int(max(start - 1, 0) / stream.time_base), stream=stream)
        for frame in container.decode(stream):
            t = float(frame.pts * stream.time_base)
            while k < len(wanted) and t >= wanted[k]:
                frames.append(frame.to_ndarray(format="rgb24"))
                k += 1
            if k == len(wanted):
                break
    if len(frames) != len(wanted):
        raise ValueError(f"{path.name}@{start}s: got {len(frames)} of {len(wanted)} frames")
    return np.stack(frames)


def pilot_windows(n: int, seed: int) -> list[tuple[str, Path, float]]:
    """Non-test windows: UCF train-split videos and MERL validation subjects (21-26)."""
    pool = []
    with open(UCF / "index/videos.csv") as f:
        for r in csv.DictReader(f):
            if r["split"] == "train":
                pool.append((r["video_id"], UCF / "raw" / r["rel_path"], float(r["duration_sec"])))
    with open(MERL / "index/videos.csv") as f:
        for r in csv.DictReader(f):
            if r["split"] == "val":
                pool.append((r["video_id"], MERL / "raw" / r["rel_path"], float(r["duration_sec"])))
    rng = random.Random(seed)
    chosen = rng.sample(pool, n)
    return [(vid, path, round(rng.uniform(0, max(dur - WINDOW_SEC - 1, 0)), 1)) for vid, path, dur in chosen]


def answer_token_ids(tokenizer) -> tuple[list[int], list[int]]:
    def ids(words):
        out = set()
        for w in words:
            toks = tokenizer.encode(w, add_special_tokens=False)
            if len(toks) == 1:
                out.add(toks[0])
        return sorted(out)

    yes, no = ids(["yes", "Yes", " yes", " Yes"]), ids(["no", "No", " no", " No"])
    if not yes or not no:
        raise RuntimeError("yes/no are not single tokens for this tokenizer")
    return yes, no


@torch.inference_mode()
def score(model, processor, frames: np.ndarray, yes: list[int], no: list[int]) -> tuple[float, str]:
    messages = [{"role": "user", "content": [{"type": "video"}, {"type": "text", "text": PROMPT}]}]
    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
    )
    metadata = {"fps": FPS, "total_num_frames": len(frames), "frames_indices": list(range(len(frames)))}
    inputs = processor(
        text=[text], videos=[frames], video_metadata=[metadata], do_sample_frames=False, return_tensors="pt"
    ).to(model.device)
    logits = model(**inputs).logits[0, -1].float()
    logp = torch.log_softmax(logits, dim=-1)
    p_yes = torch.logsumexp(logp[yes], 0)
    p_no = torch.logsumexp(logp[no], 0)
    top = processor.tokenizer.decode([int(logits.argmax())])
    return float(torch.sigmoid(p_yes - p_no)), top


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--windows", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    # transformers 4.57.5 (pinned) defaults to the slow processor saved with the checkpoint;
    # passing use_fast=False explicitly breaks Glm4vProcessor, so rely on the pinned default.
    processor = AutoProcessor.from_pretrained(MODEL_DIR)
    model = Glm4vMoeForConditionalGeneration.from_pretrained(
        MODEL_DIR,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
            llm_int8_skip_modules=["visual", "lm_head"],
        ),
        dtype=torch.bfloat16,
        device_map={"": 0},
    ).eval()
    load_sec = time.time() - t0
    yes, no = answer_token_ids(processor.tokenizer)
    torch.cuda.reset_peak_memory_stats()

    rows = []
    for vid, path, start in pilot_windows(args.windows, args.seed):
        frames = read_window(path, start)
        t = time.time()
        p1, top = score(model, processor, frames, yes, no)
        sec = time.time() - t
        p2, _ = score(model, processor, frames, yes, no)
        rows.append({"video_id": vid, "start_sec": start, "p_yes": p1, "p_yes_repeat": p2,
                     "deterministic": p1 == p2, "top_token": top, "sec": round(sec, 2)})
        print(json.dumps(rows[-1]), flush=True)

    with open(args.out / "scores.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    summary = {
        "model_dir": MODEL_DIR,
        "precision": "nf4 (bitsandbytes, double quant), visual + lm_head bf16",
        "windows": len(rows),
        "load_sec": round(load_sec, 1),
        "median_sec_per_window": float(np.median([r["sec"] for r in rows])),
        "peak_gpu_mem_gib": round(torch.cuda.max_memory_allocated() / 2**30, 1),
        "all_deterministic": all(r["deterministic"] for r in rows),
        "top_tokens": sorted({r["top_token"] for r in rows}),
        "torch": torch.__version__,
        "host": platform.node(),
    }
    (args.out / "env.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
