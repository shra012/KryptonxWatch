"""Score 8 s windows of a video for suspected shoplifting via a zrt (vLLM) OpenAI-compatible endpoint.

Reproduces the adapter's training-time protocol (shra012/qwen3.8-27b-ucf-shoplifting-lora,
code/qwen_model.py): 16 frames at 2 fps, native resolution, fixed prompt, thinking off, and
score = P(yes) / (P(yes) + P(no)) over the first answer token. Frames are cut losslessly with
ffmpeg into a 16-frame clip and sent as a data URL, with vLLM frame sampling disabled.

Serve first (the LoRA serving runbook, model/.plans/qwen-lora-zrt.md, is in git history before commit d79bacd), then e.g.:
  python3 model/src/qwen_zrt_score.py --video clip.mp4 --model shoplifting-s1
  python3 model/src/qwen_zrt_score.py --video clip.mp4 --model Qwen/Qwen3.8-27B --start 12
"""

import argparse
import base64
import json
import math
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests

WINDOW_SEC, FPS, STRIDE_SEC = 8.0, 2, 4.0
PROMPT = (
    "This is an 8-second clip from a store security camera. "
    "Is someone shoplifting in this clip, meaning concealing or taking merchandise with evident "
    "intent to leave without paying? Answer with exactly one word: yes or no."
)
YES, NO = {"yes", "Yes", " yes", " Yes"}, {"no", "No", " no", " No"}


def duration(video: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def clip_b64(video: Path, start: float) -> str:
    """Exactly 16 frames at 2 fps from [start, start+8), lossless H.264, as base64."""
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", str(video), "-t", f"{WINDOW_SEC}",
             "-vf", f"fps={FPS}", "-frames:v", str(int(WINDOW_SEC * FPS)), "-an",
             "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", tmp.name],
            check=True,
        )
        return base64.b64encode(Path(tmp.name).read_bytes()).decode()


def score_window(endpoint: str, model: str, video: Path, start: float) -> dict:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + clip_b64(video, start)}},
            {"type": "text", "text": PROMPT},
        ]}],
        "max_tokens": 1,
        "temperature": 0,
        "logprobs": True,
        "top_logprobs": 20,
        "chat_template_kwargs": {"enable_thinking": False},
        "mm_processor_kwargs": {"fps": FPS, "do_sample_frames": False},
    }
    t = time.time()
    r = requests.post(f"{endpoint}/chat/completions", json=payload, timeout=300)
    if not r.ok:
        raise RuntimeError(f"{r.status_code}: {r.text[:500]}")
    top = r.json()["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
    p_yes = sum(math.exp(t_["logprob"]) for t_ in top if t_["token"] in YES)
    p_no = sum(math.exp(t_["logprob"]) for t_ in top if t_["token"] in NO)
    mass = p_yes + p_no
    return {"start_sec": start, "end_sec": start + WINDOW_SEC,
            "p_yes": p_yes / mass if mass > 0 else float("nan"), "yes_no_mass": round(mass, 4),
            "top_token": top[0]["token"], "sec": round(time.time() - t, 2)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--model", default="shoplifting-s1",
                    help="LoRA name registered with vLLM (shoplifting-s1/-s2/-s3) or the base model name for zero-shot")
    ap.add_argument("--endpoint", default="http://127.0.0.1:8080/v1")
    ap.add_argument("--start", type=float, help="Score one window starting here; default scans the whole video")
    ap.add_argument("--out", type=Path, help="Write results as JSON")
    args = ap.parse_args()

    if args.start is not None:
        starts = [args.start]
    else:
        dur = duration(args.video)
        n = max(int((dur - WINDOW_SEC) // STRIDE_SEC) + 1, 0)
        starts = [round(i * STRIDE_SEC, 3) for i in range(n)]
    rows = []
    for s in starts:
        rows.append(score_window(args.endpoint, args.model, args.video, s))
        print(json.dumps(rows[-1]), flush=True)
    if args.out:
        args.out.write_text(json.dumps({"video": str(args.video), "model": args.model, "windows": rows}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
