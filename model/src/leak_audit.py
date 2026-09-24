"""Near-duplicate audit across UCF videos (Experiment 1, step 4).

Hashes one frame per second of every indexed video with a 64-bit perceptual hash (pHash) and finds
video pairs that share near-identical frames (Hamming distance <= --max-dist). Flat frames (black,
blank, fades) are skipped because they match everything. A pair is reported when at least
--min-matches of the smaller video's frames have a near-identical frame in the other video.

  python model/src/leak_audit.py --out model/study/v1/leak_audit.csv
"""

import argparse
import csv
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import av
import imagehash
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from windows import load_videos  # noqa: E402


def hashes(path: Path) -> np.ndarray:
    out, k = [], 0
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        for frame in container.decode(stream):
            if float(frame.pts * stream.time_base) < k:
                continue
            k += 1
            img = frame.to_ndarray(format="rgb24").mean(-1).astype(np.uint8)
            if img.std() < 12:
                continue
            h = imagehash.phash(Image.fromarray(img)).hash.flatten()
            out.append(np.packbits(h).view(">u8")[0])
    return np.array(out, dtype=np.uint64)


def popcount(x: np.ndarray) -> np.ndarray:
    return np.unpackbits(x.view(np.uint8).reshape(*x.shape, 8), axis=-1).sum(-1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-dist", type=int, default=6)
    ap.add_argument("--min-matches", type=float, default=0.2)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    videos = load_videos()
    with ProcessPoolExecutor(16) as pool:
        hs = list(pool.map(hashes, [v.path for v in videos], chunksize=1))
    print(f"hashed {sum(len(h) for h in hs)} frames from {len(videos)} videos", flush=True)

    rows = []
    for i in range(len(videos)):
        if not len(hs[i]):
            continue
        for j in range(i + 1, len(videos)):
            if not len(hs[j]):
                continue
            a, b = (hs[i], hs[j]) if len(hs[i]) <= len(hs[j]) else (hs[j], hs[i])
            close = np.zeros(len(a), dtype=bool)
            for s in range(0, len(b), 2048):
                d = popcount(a[:, None] ^ b[None, s:s + 2048])
                close |= (d <= args.max_dist).any(1)
            frac = close.mean()
            if frac >= args.min_matches:
                vi, vj = videos[i], videos[j]
                rows.append({"video_a": vi.video_id, "split_a": vi.split, "class_a": vi.cls,
                             "video_b": vj.video_id, "split_b": vj.split, "class_b": vj.cls,
                             "matched_frac_of_shorter": round(float(frac), 3),
                             "cross_split": vi.split != vj.split})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    fields = ["video_a", "split_a", "class_a", "video_b", "split_b", "class_b", "matched_frac_of_shorter", "cross_split"]
    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} near-duplicate pairs, {sum(r['cross_split'] for r in rows)} across train/test -> {args.out}")
    for r in sorted(rows, key=lambda r: -r["matched_frac_of_shorter"])[:40]:
        print(r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
