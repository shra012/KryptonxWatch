"""Build the UCF-Crime index (videos.csv, events.csv) from the files present on disk.

Inputs, under --root (default /data/ucf-crime):
  raw/UCF_Crimes/Videos/<Class>/<video>.mp4                     videos fetched with fetch_ucf.py
  raw/UCF_Crimes/Anomaly_Detection_splits/Anomaly_{Train,Test}.txt   official split lists
  annotations/Temporal_Anomaly_Annotation_For_Testing_Videos/Txt_formate/Temporal_Anomaly_Annotation.txt

Only videos present on disk are indexed. Split lists and annotations cover the whole dataset, so a
missing class is simply absent from the index. Each line of the annotation file is
  <video> <class> <start1> <end1> <start2> <end2>
with frame numbers (-1 = no second event). They are converted to seconds with each video's own fps.

Example:
  python model/src/build_index.py --root /data/ucf-crime
"""

import argparse
import csv
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VIDEOS = "raw/UCF_Crimes/Videos"
SPLITS = "raw/UCF_Crimes/Anomaly_Detection_splits"
ANNOTATION = "annotations/Temporal_Anomaly_Annotation_For_Testing_Videos/Txt_formate/Temporal_Anomaly_Annotation.txt"


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
         "-show_entries", "stream=width,height,avg_frame_rate,nb_read_packets:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(out.stdout)
    s, fmt = info["streams"][0], info["format"]
    num, den = (int(x) for x in s["avg_frame_rate"].split("/"))
    return {"width": s["width"], "height": s["height"], "fps": round(num / den, 3),
            "frames": int(s["nb_read_packets"]), "duration_sec": round(float(fmt["duration"]), 3)}


def read_split(path: Path) -> dict[str, str]:
    """rel_path under Videos/ -> split name, from one official list."""
    split = "test" if "Test" in path.name else "train"
    return {line.strip(): split for line in path.read_text().splitlines() if line.strip()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path("/data/ucf-crime"))
    args = ap.parse_args()
    root = args.root

    split_of = {}
    for name in ("Anomaly_Train.txt", "Anomaly_Test.txt"):
        split_of.update(read_split(root / SPLITS / name))

    files = sorted(p for p in (root / VIDEOS).glob("*/*.mp4"))
    with ThreadPoolExecutor(32) as pool:
        meta = list(pool.map(probe, files))

    videos = []
    for path, m in zip(files, meta):
        rel = f"{path.parent.name}/{path.name}"
        if rel not in split_of:
            print(f"not in any official split, skipped: {rel}", file=sys.stderr)
            continue
        label = "Normal" if "Normal" in path.parent.name else path.parent.name
        videos.append({"video_id": path.stem, "class": label, "split": split_of[rel],
                       "rel_path": f"UCF_Crimes/Videos/{rel}", "bytes": path.stat().st_size, **m})
    by_id = {v["video_id"]: v for v in videos}

    events = []
    for line in (root / ANNOTATION).read_text().splitlines():
        parts = line.split()
        if not parts:
            continue
        vid = Path(parts[0]).stem
        if vid not in by_id:
            continue
        frames = [int(x) for x in parts[2:6]]
        for idx, (a, b) in enumerate([(frames[0], frames[1]), (frames[2], frames[3])]):
            if a < 0:
                continue
            fps = by_id[vid]["fps"]
            events.append({"video_id": vid, "class": parts[1], "event_idx": idx,
                           "start_frame": a, "end_frame": b,
                           "start_sec": round(a / fps, 3), "end_sec": round(b / fps, 3)})

    out = root / "index"
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in (("videos.csv", videos), ("events.csv", events)):
        with open(out / name, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=rows[0].keys())
            w.writeheader()
            w.writerows(rows)

    counts = {}
    for v in videos:
        key = (v["class"], v["split"])
        counts[key] = counts.get(key, 0) + 1
    for (cls, split), n in sorted(counts.items()):
        print(f"{cls:12s} {split:5s} {n:4d} videos")
    print(f"{len(events)} annotated events in {len({e['video_id'] for e in events})} test videos -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
