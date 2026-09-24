"""Shared GLM-4.5V helpers: model/processor loading, window decoding and yes/no scoring.

Used by glm_pilot.py (G2), glm_quantize_cache.py and glm_train_pilot.py (G3).
See model/GLM-4.5-VL/plans/glm-4.5v-arm.md.
"""

import csv
import random
from pathlib import Path

import av
import numpy as np
import torch
from transformers import AutoProcessor, BitsAndBytesConfig, Glm4vMoeForConditionalGeneration

REVISION = "ed47433b37111465ec527affaaddceff371bca04"
MODEL_DIR = Path(f"/srv/kryptonx-data/models/glm-4.5v/{REVISION}")
# Pre-quantized NF4 copy of MODEL_DIR written by glm_quantize_cache.py (~60 GB, loads in minutes).
NF4_DIR = Path(f"/srv/kryptonx-data/models/glm-4.5v/nf4-{REVISION[:12]}")
UCF = Path("/srv/kryptonx-data/ucf-crime")
MERL = Path("/srv/kryptonx-data/merl-shopping")
WINDOW_SEC, FPS = 8.0, 2.0

# GLM-4.5V opens every final answer with this token; the yes/no word is the token after it.
ANSWER_PREFIX = "<|begin_of_box|>"

# Draft prompt for pilots only; the study prompt is chosen and frozen on validation in Experiment 2.
PROMPT = (
    "This is an 8-second clip from a store security camera. "
    "Is someone shoplifting in this clip, meaning concealing or taking merchandise with evident "
    "intent to leave without paying? Answer with exactly one word: yes or no."
)

NF4_CONFIG = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
    llm_int8_skip_modules=["visual", "lm_head"],
)
PRECISION = "nf4 (bitsandbytes, double quant), visual + lm_head bf16"


def load_processor():
    # transformers 4.57.5 (pinned) defaults to the slow processor saved with the checkpoint;
    # passing use_fast=False explicitly breaks Glm4vProcessor, so rely on the pinned default.
    return AutoProcessor.from_pretrained(MODEL_DIR)


def load_model(prefer_cache: bool = True):
    """Returns (model, source). Loads the NF4 cache when present, else quantizes the bf16 checkpoint."""
    if prefer_cache and (NF4_DIR / "config.json").exists():
        model = Glm4vMoeForConditionalGeneration.from_pretrained(
            NF4_DIR, dtype=torch.bfloat16, device_map={"": 0}
        )
        return model, f"nf4-cache:{NF4_DIR}"
    model = Glm4vMoeForConditionalGeneration.from_pretrained(
        MODEL_DIR, quantization_config=NF4_CONFIG, dtype=torch.bfloat16, device_map={"": 0}
    )
    return model, f"bf16->nf4:{MODEL_DIR}"


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


def video_index(dataset: str, splits: set[str]) -> list[dict]:
    """Rows of a dataset's index/videos.csv for the given splits, with absolute `path` added."""
    root = {"ucf": UCF, "merl": MERL}[dataset]
    with open(root / "index/videos.csv") as f:
        rows = [r for r in csv.DictReader(f) if r["split"] in splits]
    for r in rows:
        r["path"] = root / "raw" / r["rel_path"]
        r["dataset"] = dataset
    return rows


def random_start(rng: random.Random, duration: float) -> float:
    return round(rng.uniform(0, max(duration - WINDOW_SEC - 1, 0)), 1)


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


def model_inputs(model, processor, frames: np.ndarray, answer_prefix: str = ANSWER_PREFIX):
    """Tokenized prompt for one window, ending right before the answer word."""
    messages = [{"role": "user", "content": [{"type": "video"}, {"type": "text", "text": PROMPT}]}]
    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
    )
    text += answer_prefix
    metadata = {"fps": FPS, "total_num_frames": len(frames), "frames_indices": list(range(len(frames)))}
    return processor(
        text=[text], videos=[frames], video_metadata=[metadata], do_sample_frames=False, return_tensors="pt"
    ).to(model.device)


@torch.inference_mode()
def score(model, processor, frames: np.ndarray, yes: list[int], no: list[int],
          answer_prefix: str = ANSWER_PREFIX) -> tuple[float, str, float]:
    """Returns (P(yes | yes or no), argmax next token, probability mass on yes/no tokens)."""
    logits = model(**model_inputs(model, processor, frames, answer_prefix)).logits[0, -1].float()
    logp = torch.log_softmax(logits, dim=-1)
    p_yes = torch.logsumexp(logp[yes], 0)
    p_no = torch.logsumexp(logp[no], 0)
    top = processor.tokenizer.decode([int(logits.argmax())])
    mass = float(torch.exp(torch.logsumexp(torch.stack([p_yes, p_no]), 0)))
    return float(torch.sigmoid(p_yes - p_no)), top, mass
