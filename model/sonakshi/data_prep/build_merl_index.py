"""Build clean index tables for MERL Shopping.

Reads (never modifies) the unzipped dataset in <dest>/raw/ and writes:

    <dest>/index/videos.csv   one row per video: subject, session, split, fps, size, action counts
    <dest>/index/actions.csv  one row per labelled action instance, in frames AND seconds

Labels: <raw>/Labels_MERL_Shopping_Dataset/xx_yy_label.mat holds a MATLAB cell
array `tlabs` of 5 (K x 2) arrays: start/end frame of every instance of each
action. Frames are MATLAB-style: 1-based and inclusive, at the video's own fps
(checked: the last labelled frame is 90-97% of each video's frame count).
So start_sec = (start_frame - 1) / fps and end_sec = end_frame / fps.

Split (from the dataset ReadMe): subjects 1-20 train, 21-26 val, 27-41 test.

Needs scipy (run with the zgx conda env: ~/miniforge3/envs/zgx/bin/python).

Usage:
    python build_merl_index.py            # uses /srv/kryptonx-data/merl-shopping
    python build_merl_index.py --dest DIR
"""

import argparse
import re
import sys
from pathlib import Path

import numpy as np
import scipy.io

from build_ucf_index import DataError, parse_fps, probe, write_csv_atomic

DEFAULT_DEST = "/srv/kryptonx-data/merl-shopping"
VIDEO_DIR = "Videos_MERL_Shopping_Dataset"
LABEL_DIR = "Labels_MERL_Shopping_Dataset"
ACTIONS = ("reach_to_shelf", "retract_from_shelf", "hand_in_shelf", "inspect_product", "inspect_shelf")
EXPECTED_SPLIT_COUNTS = {"train": 60, "val": 18, "test": 28}
END_FRAME_TOLERANCE = 30
NAME_RE = re.compile(r"^(\d{1,2})_(\d)_crop\.mp4$")

VIDEO_COLUMNS = ["video_id", "subject", "session", "split", "rel_path", "size_bytes", "duration_sec",
                 "fps", "n_frames", "width", "height", "codec", "n_actions",
                 *[f"n_{a}" for a in ACTIONS]]
ACTION_COLUMNS = ["video_id", "split", "action_id", "action", "start_frame", "end_frame",
                  "start_sec", "end_sec", "duration_sec"]


def split_for_subject(subject):
    if 1 <= subject <= 20:
        return "train"
    if 21 <= subject <= 26:
        return "val"
    if 27 <= subject <= 41:
        return "test"
    raise DataError(f"subject {subject} outside the documented range 1-41")


def read_labels(path):
    """-> list of 5 lists of (start, end) ints. Raises DataError on anything malformed."""
    try:
        m = scipy.io.loadmat(path)
    except Exception as e:  # scipy raises several unrelated types for bad files
        raise DataError(f"{path.name}: cannot read .mat file ({e})") from None
    if "tlabs" not in m:
        raise DataError(f"{path.name}: no 'tlabs' variable")
    t = m["tlabs"]
    if t.dtype != object or t.size != len(ACTIONS):
        raise DataError(f"{path.name}: tlabs should be a cell array of {len(ACTIONS)}, got {t.dtype} {t.shape}")
    out = []
    for i, cell in enumerate(t.reshape(-1)):
        a = np.asarray(cell)
        if a.size == 0:
            out.append([])
            continue
        if a.ndim != 2 or a.shape[1] != 2:
            raise DataError(f"{path.name}: action {i + 1} should be K x 2, got {a.shape}")
        if not np.issubdtype(a.dtype, np.number) or not np.all(np.isfinite(a)) or not np.all(a == np.round(a)):
            raise DataError(f"{path.name}: action {i + 1} has non-integer frame numbers")
        rows = [(int(s), int(e)) for s, e in a]
        for s, e in rows:
            if s < 1 or e < s:
                raise DataError(f"{path.name}: action {i + 1} has invalid range {s}..{e}")
        out.append(sorted(rows))
    return out


def build(raw, probe_fn=probe):
    """Return (videos, actions, warnings). Raises DataError on any hard problem."""
    raw = Path(raw)
    vdir, ldir = raw / VIDEO_DIR, raw / LABEL_DIR
    if not vdir.is_dir() or not ldir.is_dir():
        raise DataError(f"expected {VIDEO_DIR}/ and {LABEL_DIR}/ in {raw} (unzip the dataset first)")

    vids = {p.name.removesuffix("_crop.mp4"): p for p in vdir.glob("*.mp4")}
    labels = {p.name.removesuffix("_label.mat"): p for p in ldir.glob("*.mat")}
    for p in vids.values():
        if not NAME_RE.match(p.name):
            raise DataError(f"unexpected video filename {p.name}")
    if missing := sorted(vids.keys() - labels.keys()):
        raise DataError(f"{len(missing)} video(s) without labels, e.g. {missing[0]}")
    if extra := sorted(labels.keys() - vids.keys()):
        raise DataError(f"{len(extra)} label file(s) without a video, e.g. {extra[0]}")

    def sort_key(vid):
        subj, sess = vid.split("_")
        return int(subj), int(sess)

    videos, actions, warnings = [], [], []
    for vid in sorted(vids, key=sort_key):
        subject, session = sort_key(vid)
        split = split_for_subject(subject)
        info = probe_fn(vids[vid])
        fps = info["r_fps"]
        if fps is None:
            raise DataError(f"{vid}: unusable frame rate")
        if not info["duration"] > 0:
            raise DataError(f"{vid}: invalid duration {info['duration']}")
        n_frames = info["n_frames"] or round(info["duration"] * fps)
        per_action = read_labels(labels[vid])

        for a_idx, rows in enumerate(per_action):
            for (s, e), (s2, _) in zip(rows, rows[1:]):
                if s2 <= e:
                    warnings.append(f"{vid}: {ACTIONS[a_idx]} instances overlap ({s}..{e} and next starts {s2})")
            for s, e in rows:
                if s > n_frames:
                    raise DataError(f"{vid}: {ACTIONS[a_idx]} starts at frame {s}, video has {n_frames} frames")
                if e > n_frames + END_FRAME_TOLERANCE:
                    raise DataError(f"{vid}: {ACTIONS[a_idx]} ends at frame {e}, video has only {n_frames} frames")
                if e > n_frames:
                    warnings.append(f"{vid}: {ACTIONS[a_idx]} ends {e - n_frames} frame(s) past the last frame; kept")
                actions.append({
                    "video_id": vid, "split": split, "action_id": a_idx + 1, "action": ACTIONS[a_idx],
                    "start_frame": s, "end_frame": e,
                    "start_sec": round((s - 1) / fps, 3), "end_sec": round(e / fps, 3),
                    "duration_sec": round((e - s + 1) / fps, 3),
                })
        if not any(per_action):
            warnings.append(f"{vid}: no labelled actions at all")

        videos.append({
            "video_id": vid, "subject": subject, "session": session, "split": split,
            "rel_path": f"{VIDEO_DIR}/{vids[vid].name}", "size_bytes": vids[vid].stat().st_size,
            "duration_sec": round(info["duration"], 3), "fps": round(fps, 3), "n_frames": n_frames,
            "width": info["width"], "height": info["height"], "codec": info["codec"],
            "n_actions": sum(len(r) for r in per_action),
            **{f"n_{a}": len(r) for a, r in zip(ACTIONS, per_action)},
        })

    counts = {s: sum(v["split"] == s for v in videos) for s in EXPECTED_SPLIT_COUNTS}
    if counts != EXPECTED_SPLIT_COUNTS:
        warnings.append(f"split sizes {counts} differ from the ReadMe's {EXPECTED_SPLIT_COUNTS}")
    return videos, actions, warnings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=DEFAULT_DEST, help=f"dataset folder (default {DEFAULT_DEST})")
    args = ap.parse_args(argv)
    raw, out = Path(args.dest) / "raw", Path(args.dest) / "index"

    try:
        videos, actions, warnings = build(raw)
    except DataError as e:
        print(f"ERROR: {e}\nNothing was written.", file=sys.stderr)
        return 1

    write_csv_atomic(out / "videos.csv", VIDEO_COLUMNS, videos)
    write_csv_atomic(out / "actions.csv", ACTION_COLUMNS, actions)

    print(f"wrote {out / 'videos.csv'} ({len(videos)} videos) and {out / 'actions.csv'} ({len(actions)} actions)\n")
    print(f"{'split':6s} {'videos':>6s} {'hours':>6s} " + " ".join(f"{a[:14]:>14s}" for a in ACTIONS))
    for split in EXPECTED_SPLIT_COUNTS:
        rows = [v for v in videos if v["split"] == split]
        print(f"{split:6s} {len(rows):6d} {sum(v['duration_sec'] for v in rows) / 3600:6.2f} "
              + " ".join(f"{sum(v[f'n_{a}'] for v in rows):14d}" for a in ACTIONS))
    print(f"\nfps values: {sorted({v['fps'] for v in videos})}"
          f"\nresolutions: {sorted({str(v['width']) + 'x' + str(v['height']) for v in videos})}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
