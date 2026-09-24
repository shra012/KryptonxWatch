"""Score every 8 s window of the selected UCF videos with Qwen3.8-27B (zero-shot or with a LoRA adapter).

Writes one CSV row per window: video_id, class, split, start_sec, label, p_yes. Videos already in
the output file are skipped, so an interrupted run resumes where it stopped. Video decoding runs in
background threads while the GPU scores.

  python model/Qwen3.8-27B-INT4/src/score_windows.py --splits train --out /data/runs/qwen38/exp2/zeroshot_trainpool.csv
  python model/Qwen3.8-27B-INT4/src/score_windows.py --splits test --adapter /data/runs/qwen38/exp3/seed1/adapter \
      --out /data/runs/qwen38/exp3/seed1/test_scores.csv
"""

import argparse
import csv
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import qwen_model  # noqa: E402
from windows import decode_video, load_events, load_videos, window_frames, window_label, window_starts  # noqa: E402

FIELDS = ["video_id", "class", "split", "start_sec", "label", "p_yes"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--splits", nargs="+", required=True, choices=["train", "test"])
    ap.add_argument("--videos", type=Path, help="Optional file with one video_id per line to restrict scoring")
    ap.add_argument("--adapter", type=Path)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    videos = [v for v in load_videos() if v.split in args.splits]
    if args.videos:
        keep = set(args.videos.read_text().split())
        videos = [v for v in videos if v.video_id in keep]
    events = load_events()
    done = set()
    if args.out.exists():
        with open(args.out) as f:
            done = {r["video_id"] for r in csv.DictReader(f)}
    todo = [v for v in videos if v.video_id not in done]
    print(f"{len(videos)} videos selected, {len(done)} already scored, {len(todo)} to score", flush=True)
    if not todo:
        return 0

    processor, model = qwen_model.load(args.adapter)
    model.eval()
    yes, no = qwen_model.answer_token_ids(processor.tokenizer)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    new_file = not args.out.exists()
    started, n_windows = time.time(), 0
    with open(args.out, "a", newline="") as f, ThreadPoolExecutor(4) as pool:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new_file:
            w.writeheader()
        decoded = [pool.submit(decode_video, v.path) for v in todo]
        for i, (video, fut) in enumerate(zip(todo, decoded), 1):
            frames = fut.result()
            decoded[i - 1] = None  # release the decoded frames once consumed
            starts = window_starts(len(frames))
            scores = []
            for b in range(0, len(starts), args.batch):
                batch = [window_frames(frames, s) for s in starts[b:b + args.batch]]
                scores += qwen_model.score_batch(model, processor, batch, yes, no)
            w.writerows({"video_id": video.video_id, "class": video.cls, "split": video.split,
                         "start_sec": s, "label": window_label(video, s, events), "p_yes": round(p, 6)}
                        for s, p in zip(starts, scores))
            f.flush()
            n_windows += len(starts)
            rate = n_windows / (time.time() - started)
            print(f"[{i}/{len(todo)}] {video.video_id}: {len(starts)} windows, {rate:.1f} windows/s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
