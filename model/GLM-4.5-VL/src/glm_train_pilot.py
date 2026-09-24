"""G3 training pilot for GLM-4.5V: one small QLoRA run (see model/GLM-4.5-VL/plans/glm-4.5v-arm.md).

Checks mechanics only: peak memory, seconds per step, that the loss moves, and that the saved
adapter reloads to identical scores. Labels are PLACEHOLDERS, not study labels:
  - "yes": random windows from UCF train-split Shoplifting videos (whole-video label; most such
    windows contain no theft because training videos have no time stamps yet)
  - "no":  random windows from MERL train subjects (1-20), normal shopping
Only training-split videos are used, and none of these windows may be used for evaluation.

  model/GLM-4.5-VL/env/glm/run.sh glm-g3 python -u model/GLM-4.5-VL/src/glm_train_pilot.py --out model/GLM-4.5-VL/runs/glm45v/g3-pilot
"""

import argparse
import csv
import json
import platform
import random
import time
from pathlib import Path

import numpy as np
import peft
import torch
from peft import LoraConfig, PeftModel, get_peft_model

import glm_common as g

# Attention and shared experts in every language layer plus the dense MLP of layer 0.
# Routed experts (mlp.experts.N.*), the router and the vision encoder stay frozen.
LORA_TARGETS = (
    r"model\.language_model\.layers\.\d+\."
    r"(self_attn\.(q|k|v|o)_proj|mlp\.shared_experts\.(gate|up|down)_proj|mlp\.(gate|up|down)_proj)"
)


def make_windows(n_train: int, n_check: int, seed: int):
    """Video-disjoint train and check windows from training-split videos only."""
    rng = random.Random(seed)
    shop = [r for r in g.video_index("ucf", {"train"}) if r["class"] == "Shoplifting"]
    merl = g.video_index("merl", {"train"})
    rng.shuffle(shop)
    rng.shuffle(merl)
    k = n_check // 2
    check_videos = [(r, "yes") for r in shop[:k]] + [(r, "no") for r in merl[:k]]
    pos_pool, neg_pool = shop[k:], merl[k:]

    def sample(pool, label, n):
        out = []
        for _ in range(n):
            r = rng.choice(pool)
            out.append({"video_id": r["video_id"], "dataset": r["dataset"], "path": r["path"],
                        "start": g.random_start(rng, float(r["duration_sec"])), "label": label})
        return out

    train = sample(pos_pool, "yes", n_train // 2) + sample(neg_pool, "no", n_train - n_train // 2)
    rng.shuffle(train)
    check = [{"video_id": r["video_id"], "dataset": r["dataset"], "path": r["path"],
              "start": g.random_start(rng, float(r["duration_sec"])), "label": lab}
             for r, lab in check_videos]
    return train, check


def score_all(model, processor, windows, yes, no) -> list[float]:
    model.eval()
    return [g.score(model, processor, w["frames"], yes, no)[0] for w in windows]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--train-windows", type=int, default=50)
    ap.add_argument("--check-windows", type=int, default=10)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(args.seed)

    train, check = make_windows(args.train_windows, args.check_windows, args.seed)
    for w in train + check:
        w["frames"] = g.read_window(w["path"], w["start"])
    with open(args.out / "windows.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["set", "dataset", "video_id", "start_sec", "placeholder_label"])
        for name, ws in (("train", train), ("check", check)):
            for w in ws:
                wr.writerow([name, w["dataset"], w["video_id"], w["start"], w["label"]])

    t0 = time.time()
    processor = g.load_processor()
    model, source = g.load_model()
    load_sec = time.time() - t0
    yes, no = g.answer_token_ids(processor.tokenizer)
    target_id = {"yes": processor.tokenizer.encode("yes", add_special_tokens=False)[0],
                 "no": processor.tokenizer.encode("no", add_special_tokens=False)[0]}

    base_scores = score_all(model, processor, check, yes, no)

    # Keep inference numerics identical to scoring: no fp32 upcast of the bf16 modules.
    for p in model.parameters():
        p.requires_grad_(False)
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, bias="none", target_modules=LORA_TARGETS,
    ))
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    optim = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
    torch.cuda.reset_peak_memory_stats()

    log, step, micro = [], 0, 0
    model.train()
    for epoch in range(args.epochs):
        for w in train:
            t = time.time()
            inputs = g.model_inputs(model, processor, w["frames"])
            logits = model(**inputs, logits_to_keep=1).logits[0, -1].float()
            loss = torch.nn.functional.cross_entropy(logits[None], torch.tensor([target_id[w["label"]]], device=logits.device))
            (loss / args.grad_accum).backward()
            micro += 1
            if micro % args.grad_accum == 0:
                optim.step()
                optim.zero_grad(set_to_none=True)
                step += 1
            log.append({"epoch": epoch, "micro": micro, "opt_step": step, "dataset": w["dataset"],
                        "label": w["label"], "loss": round(loss.item(), 4), "sec": round(time.time() - t, 2)})
            print(json.dumps(log[-1]), flush=True)
    if micro % args.grad_accum:
        optim.step()
        optim.zero_grad(set_to_none=True)
        step += 1
    train_peak = torch.cuda.max_memory_allocated() / 2**30

    trained_scores = score_all(model, processor, check, yes, no)
    model.save_pretrained(args.out / "adapter")
    base = model.unload()  # strip LoRA layers, then reload the adapter from disk
    reloaded = PeftModel.from_pretrained(base, args.out / "adapter")
    reloaded_scores = score_all(reloaded, processor, check, yes, no)

    with open(args.out / "train_log.csv", "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=log[0].keys())
        wr.writeheader()
        wr.writerows(log)
    with open(args.out / "check_scores.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["dataset", "video_id", "start_sec", "placeholder_label", "p_yes_base", "p_yes_trained", "p_yes_reloaded"])
        for w, b, tr, rl in zip(check, base_scores, trained_scores, reloaded_scores):
            wr.writerow([w["dataset"], w["video_id"], w["start"], w["label"], b, tr, rl])

    def mean_loss(ep):
        return round(float(np.mean([r["loss"] for r in log if r["epoch"] == ep])), 4)

    def median_sec(ds):
        return float(np.median([r["sec"] for r in log if r["dataset"] == ds]))

    summary = {
        "model_source": source,
        "precision": g.PRECISION + " + LoRA bf16",
        "peft": peft.__version__,
        "lora": {"rank": args.rank, "alpha": 2 * args.rank, "dropout": 0.05, "targets": LORA_TARGETS},
        "trainable_params": trainable,
        "train_windows": len(train), "check_windows": len(check),
        "epochs": args.epochs, "grad_accum": args.grad_accum, "lr": args.lr, "optimizer_steps": step,
        "load_sec": round(load_sec, 1),
        "mean_loss_by_epoch": [mean_loss(e) for e in range(args.epochs)],
        "median_sec_per_train_window": {"ucf": median_sec("ucf"), "merl": median_sec("merl")},
        "peak_gpu_mem_gib_training": round(train_peak, 1),
        "adapter_reload_max_abs_diff": max(abs(a - b) for a, b in zip(trained_scores, reloaded_scores)),
        "labels": "PLACEHOLDER (whole-video UCF labels vs MERL); mechanics check only, not evaluative",
        "torch": torch.__version__,
        "host": platform.node(),
    }
    (args.out / "env.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
