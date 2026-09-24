"""Qwen3.8-27B loading, prompting and P("yes") scoring shared by scoring and training."""

from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

from windows import FPS

MODEL_DIR = "/data/models/qwen3.8-27b/1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0"
REVISION = "1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0"

# Draft prompt from the G2 pilot. Experiment 2 selects and freezes the study prompt on validation.
PROMPT = (
    "This is an 8-second clip from a store security camera. "
    "Is someone shoplifting in this clip, meaning concealing or taking merchandise with evident "
    "intent to leave without paying? Answer with exactly one word: yes or no."
)

# LoRA targets: every projection of the language model (full-attention, linear-attention and MLP).
# The vision encoder and merger stay frozen.
LORA_TARGETS = (
    r"model\.language_model\.layers\.\d+\.("
    r"self_attn\.(q|k|v|o)_proj|linear_attn\.(in_proj_qkv|in_proj_z|out_proj)|mlp\.(gate|up|down)_proj)"
)


def load(adapter: Path | None = None, trainable: bool = False):
    processor = AutoProcessor.from_pretrained(MODEL_DIR)
    processor.tokenizer.padding_side = "left"
    model = AutoModelForImageTextToText.from_pretrained(MODEL_DIR, dtype=torch.bfloat16, device_map={"": 0})
    if adapter is not None:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, str(adapter), is_trainable=trainable)
    return processor, model


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


def build_inputs(processor, batch: list[np.ndarray]):
    messages = [{"role": "user", "content": [{"type": "video"}, {"type": "text", "text": PROMPT}]}]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    metadata = [{"fps": FPS, "total_num_frames": len(f), "frames_indices": list(range(len(f)))} for f in batch]
    return processor(text=[text] * len(batch), videos=batch, video_metadata=metadata, do_sample_frames=False,
                     padding=True, return_tensors="pt")


def yes_no_logits(model, inputs, yes: list[int], no: list[int]) -> tuple[torch.Tensor, torch.Tensor]:
    """log P(yes-set) and log P(no-set) of the first answer token, one value per batch item."""
    logits = model(**inputs).logits[:, -1].float()
    logp = torch.log_softmax(logits, dim=-1)
    return torch.logsumexp(logp[:, yes], -1), torch.logsumexp(logp[:, no], -1)


@torch.inference_mode()
def score_batch(model, processor, batch: list[np.ndarray], yes: list[int], no: list[int]) -> list[float]:
    inputs = build_inputs(processor, batch).to(model.device)
    lp_yes, lp_no = yes_no_logits(model, inputs, yes, no)
    return torch.sigmoid(lp_yes - lp_no).tolist()
