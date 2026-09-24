"""Build clean index tables for the downloaded UCF-Crime subset.

Reads (never modifies) the raw download made by download_ucf_subset.py and writes:

    <dest>/index/videos.csv   one row per video: class, split, duration, fps, size ...
    <dest>/index/events.csv   one row per annotated event, in frames AND seconds

UCF's temporal annotations are frame numbers, e.g.
    Shoplifting001_x264.mp4  Shoplifting  1550  2000  -1  -1
= event 1 from frame 1550 to 2000, no second event (-1). Seconds = frame / fps,
using each video's own fps as reported by ffprobe.

The script checks the data and refuses to write anything if it finds an error
(missing file, video in both splits, bad event range, ...). Things that look
odd but are usable (e.g. an event ending a few frames past the last frame) are
reported as warnings and kept.

Usage:
    python build_ucf_index.py            # uses /srv/kryptonx-data/ucf-crime
    python build_ucf_index.py --dest DIR
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

DEFAULT_DEST = "/srv/kryptonx-data/ucf-crime"
CLASSES = ("Shoplifting", "Stealing")
NORMAL_TEST_DIR = "Testing_Normal_Videos_Anomaly"
ANNOTATION_ZIP = "Temporal_Anomaly_Annotation_For_Testing_Videos.zip"
ANNOTATION_MEMBER = "Temporal_Anomaly_Annotation_For_Testing_Videos/Txt_formate/Temporal_Anomaly_Annotation.txt"
# An event may end slightly past the last decoded frame (annotation rounding);
# more than this is treated as an error.
END_FRAME_TOLERANCE = 30

VIDEO_COLUMNS = ["video_id", "class", "split", "rel_path", "size_bytes", "duration_sec", "fps",
                 "n_frames", "width", "height", "codec", "n_events"]
EVENT_COLUMNS = ["video_id", "class", "event_idx", "start_frame", "end_frame",
                 "start_sec", "end_sec", "duration_sec"]


class DataError(Exception):
    pass


def parse_fps(rate):
    """ffprobe rate string ('30/1', '30000/1001') -> float, or None if unusable."""
    try:
        f = Fraction(rate)
    except (ValueError, ZeroDivisionError, TypeError):
        return None
    return float(f) if f > 0 else None


def probe(path):
    """Return basic stream info for one video using ffprobe."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames:format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise DataError(f"ffprobe timed out on {path}") from None
    if out.returncode != 0:
        raise DataError(f"ffprobe failed on {path}: {out.stderr.strip()}")
    try:
        j = json.loads(out.stdout)
    except json.JSONDecodeError:
        raise DataError(f"ffprobe returned unreadable output for {path}") from None
    if not j.get("streams"):
        raise DataError(f"no video stream in {path}")
    s = j["streams"][0]
    return {
        "codec": s.get("codec_name", ""),
        "width": int(s["width"]), "height": int(s["height"]),
        "r_fps": parse_fps(s.get("r_frame_rate")),
        "avg_fps": parse_fps(s.get("avg_frame_rate")),
        "n_frames": int(s["nb_frames"]) if str(s.get("nb_frames", "")).isdigit() else None,
        "duration": float(j.get("format", {}).get("duration", "nan")),
    }


def read_split(path, prefixes):
    """Return {'Folder/Video.mp4', ...} for lines under the given folder prefixes."""
    entries, seen = set(), set()
    for n, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        if line in seen:
            raise DataError(f"{Path(path).name}:{n}: duplicate entry {line}")
        seen.add(line)
        if line.split("/", 1)[0] in prefixes:
            entries.add(line)
    return entries


def read_annotations(raw):
    """Parse the temporal annotation txt from inside its zip -> {filename: (class, [(s, e), ...])}."""
    with zipfile.ZipFile(Path(raw) / ANNOTATION_ZIP) as z:
        text = z.read(ANNOTATION_MEMBER).decode()
    ann = {}
    for n, line in enumerate(text.splitlines(), 1):
        parts = line.split()
        if not parts:
            continue
        if len(parts) != 6:
            raise DataError(f"annotation line {n}: expected 6 fields, got {len(parts)}: {line!r}")
        name, cls = parts[0], parts[1]
        try:
            s1, e1, s2, e2 = (int(x) for x in parts[2:])
        except ValueError:
            raise DataError(f"annotation line {n}: non-integer frame number: {line!r}") from None
        if name in ann:
            raise DataError(f"annotation line {n}: duplicate video {name}")
        events = []
        for idx, (s, e) in enumerate(((s1, e1), (s2, e2)), 1):
            if (s == -1) != (e == -1):
                raise DataError(f"{name}: event {idx} has only one of start/end set ({s}, {e})")
            if s == -1:
                continue
            if idx == 2 and not events:
                raise DataError(f"{name}: event 2 set but event 1 is empty")
            if s < 0 or e < 0 or e <= s:
                raise DataError(f"{name}: event {idx} has invalid range {s}..{e}")
            if events and s < events[-1][1]:
                raise DataError(f"{name}: event {idx} starts before event {idx - 1} ends")
            events.append((s, e))
        ann[name] = (cls, events)
    return ann


def build(raw, probe_fn=probe):
    """Return (videos, events, warnings). Raises DataError on any hard problem."""
    raw = Path(raw)
    vid_root = raw / "UCF_Crimes" / "Videos"
    split_dir = raw / "UCF_Crimes" / "Anomaly_Detection_splits"
    folders = (*CLASSES, NORMAL_TEST_DIR)
    train = read_split(split_dir / "Anomaly_Train.txt", folders)
    test = read_split(split_dir / "Anomaly_Test.txt", folders)
    if both := train & test:
        raise DataError(f"{len(both)} video(s) in both train and test, e.g. {sorted(both)[0]}")
    ann = read_annotations(raw)

    on_disk = {f"{p.parent.name}/{p.name}" for folder in folders
               for p in (vid_root / folder).glob("*.mp4")}
    listed = train | test
    if missing := listed - on_disk:
        raise DataError(f"{len(missing)} listed video(s) missing on disk, e.g. {sorted(missing)[0]}")
    if unlisted := on_disk - listed:
        raise DataError(f"{len(unlisted)} video(s) on disk not in any split, e.g. {sorted(unlisted)[0]}")

    rels = sorted(on_disk)
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as ex:
        infos = dict(zip(rels, ex.map(lambda r: probe_fn(vid_root / r), rels)))

    videos, events, warnings = [], [], []
    for rel in rels:
        folder, fname = rel.split("/")
        cls = "Normal" if folder == NORMAL_TEST_DIR else folder
        split = "test" if rel in test else "train"
        info = infos[rel]
        fps = info["r_fps"]
        if fps is None:
            raise DataError(f"{rel}: unusable frame rate")
        if info["avg_fps"] and abs(info["avg_fps"] - fps) > 0.01 * fps:
            warnings.append(f"{rel}: avg fps {info['avg_fps']:.3f} differs from nominal {fps:.3f} (variable frame rate?)")
        if not info["duration"] > 0:
            raise DataError(f"{rel}: invalid duration {info['duration']}")
        n_frames = info["n_frames"] or round(info["duration"] * fps)

        vid_events = []
        if split == "test":
            if fname not in ann:
                raise DataError(f"{rel}: test video has no temporal annotation")
            a_cls, vid_events = ann[fname]
            if a_cls != cls:
                raise DataError(f"{rel}: annotation class {a_cls!r} != folder class {cls!r}")
            if cls == "Normal" and vid_events:
                raise DataError(f"{rel}: normal video has events")
            if cls != "Normal" and not vid_events:
                raise DataError(f"{rel}: anomaly test video has no events")
            for s, e in vid_events:
                if s >= n_frames:
                    raise DataError(f"{rel}: event starts at frame {s} but video has {n_frames} frames")
                if e > n_frames + END_FRAME_TOLERANCE:
                    raise DataError(f"{rel}: event ends at frame {e}, video has only {n_frames} frames")
                if e > n_frames:
                    warnings.append(f"{rel}: event end {e} is {e - n_frames} frame(s) past the last frame; kept")
        elif fname in ann:
            raise DataError(f"{rel}: train video appears in the test annotations")

        video_id = fname.removesuffix("_x264.mp4").removesuffix(".mp4")
        videos.append({
            "video_id": video_id, "class": cls, "split": split,
            "rel_path": f"UCF_Crimes/Videos/{rel}", "size_bytes": (vid_root / rel).stat().st_size,
            "duration_sec": round(info["duration"], 3), "fps": round(fps, 3), "n_frames": n_frames,
            "width": info["width"], "height": info["height"], "codec": info["codec"],
            "n_events": len(vid_events),
        })
        for idx, (s, e) in enumerate(vid_events, 1):
            events.append({
                "video_id": video_id, "class": cls, "event_idx": idx,
                "start_frame": s, "end_frame": e,
                "start_sec": round(s / fps, 3), "end_sec": round(e / fps, 3),
                "duration_sec": round((e - s) / fps, 3),
            })

    # Every annotated video in our classes must be one we have.
    ours = {r.split("/")[1] for r in rels}
    for name, (a_cls, _) in ann.items():
        if a_cls in (*CLASSES, "Normal") and name not in ours:
            raise DataError(f"annotation for {name} ({a_cls}) but no such video on disk")
    return videos, events, warnings


def write_csv_atomic(path, columns, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=columns)
            w.writeheader()
            w.writerows(rows)
        os.chmod(tmp, 0o664)   # mkstemp creates 0600; keep the shared folder readable
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=DEFAULT_DEST, help=f"dataset folder (default {DEFAULT_DEST})")
    args = ap.parse_args(argv)
    raw, out = Path(args.dest) / "raw", Path(args.dest) / "index"

    try:
        videos, events, warnings = build(raw)
    except (DataError, FileNotFoundError, KeyError, zipfile.BadZipFile) as e:
        print(f"ERROR: {e}\nNothing was written.", file=sys.stderr)
        return 1

    write_csv_atomic(out / "videos.csv", VIDEO_COLUMNS, videos)
    write_csv_atomic(out / "events.csv", EVENT_COLUMNS, events)

    print(f"wrote {out / 'videos.csv'} ({len(videos)} videos) and {out / 'events.csv'} ({len(events)} events)\n")
    print(f"{'class':12s} {'split':6s} {'videos':>6s} {'hours':>6s} {'events':>6s}")
    for cls in (*CLASSES, "Normal"):
        for split in ("train", "test"):
            rows = [v for v in videos if v["class"] == cls and v["split"] == split]
            if rows:
                print(f"{cls:12s} {split:6s} {len(rows):6d} {sum(v['duration_sec'] for v in rows) / 3600:6.2f} "
                      f"{sum(v['n_events'] for v in rows):6d}")
    fps_values = sorted({v["fps"] for v in videos})
    sizes = sorted({f"{v['width']}x{v['height']}" for v in videos})
    print(f"\nfps values: {fps_values}\nresolutions: {sizes}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
