"""Build the OpenRouter bake-off test set under data/bakeoff/ (git-ignored).

Three parts:
  hawkwatch/  the 12 UCF-Crime clips HawkWatch demoed (clip label = file name)
  timed/      6 UCF-Crime test videos with official start/end times, first 64 s kept
  normal/     18 UCF-Crime test videos with no anomaly, first 64 s kept

Writes data/bakeoff/manifest.json, which the benchmark reads.

  python3 model/openrouter-bakeoff/fetch_data.py --hawkwatch /path/to/Treehacks2025/public/videos

--version v2 builds a second, fresh test set under data/bakeoff-v2/ with none of the v1 videos:
  timed/   every other annotated UCF test video of the 5 classes, 64 s cut around the first event
  normal/  30 more UCF test normal videos (2-15 MB), first 64 s

--version full builds data/bakeoff-full/ with every UCF test video the app can name, cut the same way as v2:
  timed/   all annotated test videos of Shoplifting, Stealing, Robbery, Fighting, Vandalism, Burglary, Shooting,
           Assault and Abuse (82), 64 s from 16 s before the first event
  normal/  all 150 UCF test normal videos, first 64 s
Raw videos already fetched for v1/v2 are reused.
"""

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "model/Qwen3.8-27B-INT4/src"))
from fetch_ucf import URL, HttpRangeFile, ca_bundle  # noqa: E402

import requests  # noqa: E402

ANNOTATION_URL = "https://raw.githubusercontent.com/WaqasSultani/AnomalyDetectionCVPR2018/master/Temporal_Anomaly_Annotation.txt"
KEEP_SECONDS = 64
TIMED = ["Shoplifting017_x264", "Shoplifting031_x264", "Robbery106_x264", "Fighting018_x264", "Stealing062_x264", "Vandalism007_x264"]
NORMAL = ["Normal_Videos_881_x264", "Normal_Videos_345_x264", "Normal_Videos_889_x264", "Normal_Videos_745_x264",
          "Normal_Videos_878_x264", "Normal_Videos_888_x264", "Normal_Videos_885_x264", "Normal_Videos_063_x264",
          "Normal_Videos_010_x264", "Normal_Videos_025_x264", "Normal_Videos_872_x264", "Normal_Videos_867_x264",
          "Normal_Videos_870_x264", "Normal_Videos_939_x264", "Normal_Videos_907_x264", "Normal_Videos_910_x264",
          "Normal_Videos_904_x264", "Normal_Videos_100_x264"]
FULL_CLASSES = {"Shoplifting", "Stealing", "Robbery", "Fighting", "Vandalism", "Burglary", "Shooting", "Assault", "Abuse"}
HAWKWATCH_CLASS = {"Shoplifting": "Shoplifting", "Stealing": "Stealing", "Robbery": "Robbery", "Fighting": "Fighting", "Vandalism": "Vandalism"}


def probe(path: Path) -> tuple[float, float]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=avg_frame_rate:format=duration", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True)
    info = json.loads(out.stdout)
    num, den = (int(x) for x in info["streams"][0]["avg_frame_rate"].split("/"))
    return float(info["format"]["duration"]), num / den


def trim(src: Path, dst: Path) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", str(KEEP_SECONDS), "-an",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", str(dst)], check=True)


def cut(src: Path, dst: Path, start: float) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-i", str(src), "-t", str(KEEP_SECONDS), "-an",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", str(dst)], check=True)


def build_v2(out: Path, full: bool = False) -> int:
    """Fresh test set: annotated UCF test videos and normals not used in v1 (full=True: every in-scope test video)."""
    for sub in ("timed", "normal", "raw"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    ann = {}
    for line in urllib.request.urlopen(ANNOTATION_URL).read().decode().splitlines():
        if line.strip():
            p = line.split()
            ann[p[0].removesuffix(".mp4")] = (p[1], [int(x) for x in p[2:6]])
    session = requests.Session()
    session.verify = ca_bundle()
    archive = zipfile.ZipFile(HttpRangeFile(URL, session))
    members = {Path(i.filename).stem: i for i in archive.infolist() if i.filename.endswith(".mp4")}
    if full:
        crimes = sorted(n for n, (c, _) in ann.items() if c in FULL_CLASSES and n in members)
        normals = sorted(n for n, (c, _) in ann.items() if c == "Normal" and n in members)
    else:
        crimes = sorted(n for n, (c, _) in ann.items() if c in HAWKWATCH_CLASS and n not in TIMED and n in members)
        normals = sorted((members[n].file_size, n) for n, (c, _) in ann.items()
                         if c == "Normal" and n not in NORMAL and n in members and 2e6 <= members[n].file_size <= 15e6)
        normals = [n for _, n in normals[::max(1, len(normals) // 30)]][:30]
    items = []
    for name, part in [(n, "timed") for n in crimes] + [(n, "normal") for n in normals]:
        raw = out / "raw" / f"{name}.mp4"
        cached = [p for p in (ROOT / "data/bakeoff/raw" / raw.name, ROOT / "data/bakeoff-v2/raw" / raw.name) if p.exists()]
        if not raw.exists() and cached:
            shutil.copy(cached[0], raw)
        if not raw.exists():
            print(f"fetching {name} ({members[name].file_size / 1e6:.1f} MB)", file=sys.stderr)
            with archive.open(members[name]) as src, open(raw, "wb") as dst:
                shutil.copyfileobj(src, dst)
        full, fps = probe(raw)
        cls, frames = ann[name]
        # Start 16 s before the first event so each clip has normal context, the event, and what follows.
        start = 0.0 if part == "normal" else max(0.0, min(frames[0] / fps - 16, full - KEEP_SECONDS))
        dst = out / part / f"{name}.mp4"
        cut(raw, dst, start)
        duration, _ = probe(dst)
        events = []
        for a, b in ((frames[0], frames[1]), (frames[2], frames[3])):
            if a >= 0:
                s0, e0 = a / fps - start, b / fps - start
                if e0 > 0 and s0 < duration:
                    events.append([round(max(0, s0), 2), round(min(e0, duration), 2)])
        items.append({"id": name, "set": part, "path": f"{part}/{name}.mp4", "label": "Normal" if part == "normal" else cls,
                      "duration": round(duration, 2), "events": events, "cutStart": round(start, 2)})
    (out / "manifest.json").write_text(json.dumps({"keepSeconds": KEEP_SECONDS, "items": items}, indent=1))
    print(f"{len(items)} videos ({len(crimes)} crime, {len(normals)} normal) -> {out / 'manifest.json'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", choices=["v1", "v2", "full"], default="v1")
    ap.add_argument("--hawkwatch", type=Path, help="Treehacks2025/public/videos (v1 only)")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    if args.version == "v2":
        return build_v2(args.out or ROOT / "data/bakeoff-v2")
    if args.version == "full":
        return build_v2(args.out or ROOT / "data/bakeoff-full", full=True)
    if not args.hawkwatch:
        ap.error("--hawkwatch is required for v1")
    args.out = args.out or ROOT / "data/bakeoff"
    out: Path = args.out
    for sub in ("hawkwatch", "timed", "normal", "raw"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    ann = {}
    for line in urllib.request.urlopen(ANNOTATION_URL).read().decode().splitlines():
        if line.strip():
            p = line.split()
            ann[p[0].removesuffix(".mp4")] = (p[1], [int(x) for x in p[2:6]])

    session = requests.Session()
    session.verify = ca_bundle()
    archive = zipfile.ZipFile(HttpRangeFile(URL, session))
    members = {Path(i.filename).stem: i for i in archive.infolist() if i.filename.endswith(".mp4")}

    items = []
    for clip in sorted(args.hawkwatch.glob("*.mp4")):
        cls = HAWKWATCH_CLASS[clip.stem.rstrip("0123456789")]
        shutil.copy(clip, out / "hawkwatch" / clip.name)
        duration, _ = probe(clip)
        items.append({"id": f"hw-{clip.stem}", "set": "hawkwatch", "path": f"hawkwatch/{clip.name}",
                      "label": cls, "duration": round(duration, 2), "events": None})

    for name, part in [(n, "timed") for n in TIMED] + [(n, "normal") for n in NORMAL]:
        raw = out / "raw" / f"{name}.mp4"
        if not raw.exists():
            print(f"fetching {name}", file=sys.stderr)
            with archive.open(members[name]) as src, open(raw, "wb") as dst:
                shutil.copyfileobj(src, dst)
        dst = out / part / f"{name}.mp4"
        trim(raw, dst)
        duration, _ = probe(dst)
        _, fps = probe(raw)
        cls, frames = ann[name]
        events = []
        for start, end in ((frames[0], frames[1]), (frames[2], frames[3])):
            if start >= 0 and start / fps < duration:
                events.append([round(start / fps, 2), round(min(end / fps, duration), 2)])
        items.append({"id": name, "set": part, "path": f"{part}/{name}.mp4",
                      "label": "Normal" if part == "normal" else cls, "duration": round(duration, 2),
                      "events": events})

    (out / "manifest.json").write_text(json.dumps({"keepSeconds": KEEP_SECONDS, "items": items}, indent=1))
    print(f"{len(items)} videos -> {out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
