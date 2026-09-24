"""LoRA fine-tuning of Qwen3.8-27B for the shoplifting yes/no question (Experiment 3).

Training windows come from a CSV with columns video_id, start_sec, target (1 = shoplifting, 0 = not).
The loss is -log P(target answer) on the first answer token, where P(yes) and P(no) sum over the
same token variants used for scoring, so training optimises exactly the score that is evaluated.
Precision is bf16 (no quantisation), vision encoder frozen, gradient checkpointing on.

  python model/src/train_lora.py --windows /data/runs/qwen38/exp3/train_windows.csv \
      --lr 1e-4 --epochs 2 --seed 1 --out /data/runs/qwen38/exp3/lr1e-4_ep2/seed1
"""

import argparse
import csv
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import qwen_model  # noqa: E402
from windows import decode_video, load_videos, window_frames  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--windows", type=Path, required=True)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--accum", type=int, default=2)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--limit", type=int, help="Use only a random N of the windows (pilot)")
    ap.add_argument("--init-adapter", type=Path, help="Continue training this adapter (next MIL round)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    with open(args.windows) as f:
        rows = [(r["video_id"], float(r["start_sec"]), int(r["target"])) for r in csv.DictReader(f)]
    if args.limit:
        rows = random.Random(args.seed).sample(rows, min(args.limit, len(rows)))
    paths = {v.video_id: v.path for v in load_videos()}
    frames = {vid: decode_video(paths[vid]) for vid in sorted({r[0] for r in rows})}
    print(f"{len(rows)} windows ({sum(r[2] for r in rows)} positive) from {len(frames)} videos", flush=True)

    from peft import LoraConfig, PeftModel, get_peft_model

    processor, model = qwen_model.load()
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    model.config.use_cache = False
    if args.init_adapter:
        model = PeftModel.from_pretrained(model, str(args.init_adapter), is_trainable=True)
    else:
        model = get_peft_model(model, LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05,
                                                 target_modules=qwen_model.LORA_TARGETS, task_type="CAUSAL_LM"))
    model.print_trainable_parameters()
    yes, no = qwen_model.answer_token_ids(processor.tokenizer)

    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.0)
    steps_per_epoch = math.ceil(len(rows) / (args.batch * args.accum))
    total = steps_per_epoch * args.epochs
    warmup = max(1, int(0.05 * total))
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min((s + 1) / warmup, 0.5 * (1 + math.cos(math.pi * min(s, total) / total))))

    model.train()
    torch.cuda.reset_peak_memory_stats()
    log, step, started = [], 0, time.time()
    rng = random.Random(args.seed)
    for epoch in range(args.epochs):
        order = rows[:]
        rng.shuffle(order)
        batches = [order[i:i + args.batch] for i in range(0, len(order), args.batch)]
        for b, batch in enumerate(batches):
            clips = []
            for vid, start, _ in batch:
                clip = window_frames(frames[vid], start)
                clips.append(clip[:, :, ::-1].copy() if rng.random() < 0.5 else clip)  # horizontal flip
            inputs = qwen_model.build_inputs(processor, clips).to(model.device)
            lp_yes, lp_no = qwen_model.yes_no_logits(model, inputs, yes, no)
            target = torch.tensor([t for _, _, t in batch], device=lp_yes.device, dtype=torch.bool)
            loss = -torch.where(target, lp_yes, lp_no).mean()
            (loss / args.accum).backward()
            log.append({"epoch": epoch, "batch": b, "loss": float(loss),
                        "p_yes_mean_pos": float(torch.sigmoid(lp_yes - lp_no)[target].mean()) if target.any() else None})
            if (b + 1) % args.accum == 0 or b + 1 == len(batches):
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step()
                sched.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                recent = [x["loss"] for x in log[-args.accum * 10:]]
                print(f"epoch {epoch} step {step}/{total} loss {np.mean(recent):.4f} "
                      f"lr {sched.get_last_lr()[0]:.2e} {(time.time() - started) / step:.1f}s/step", flush=True)

    model.save_pretrained(args.out / "adapter")
    summary = {"windows": len(rows), "positives": sum(r[2] for r in rows), "lr": args.lr, "epochs": args.epochs,
               "rank": args.rank, "batch": args.batch, "accum": args.accum, "seed": args.seed, "steps": step,
               "sec_per_step": round((time.time() - started) / max(step, 1), 2),
               "peak_gpu_mem_gib": round(torch.cuda.max_memory_allocated() / 2**30, 1),
               "first_10pct_loss": float(np.mean([x["loss"] for x in log[:max(1, len(log) // 10)]])),
               "last_10pct_loss": float(np.mean([x["loss"] for x in log[-max(1, len(log) // 10):]])),
               "model": "Qwen/Qwen3.8-27B", "revision": qwen_model.REVISION, "precision": "bf16",
               "lora_targets": qwen_model.LORA_TARGETS, "torch": torch.__version__}
    (args.out / "train_log.json").write_text(json.dumps(log))
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
