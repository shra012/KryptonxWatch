"""Windows and labels for the shoplifting study (definitions in model/.plans/shoplifting-study.md).

A window is 8 s long with a 4 s stride, sampled at 2 fps (16 frames) at native resolution.
A window is positive if it overlaps an annotated event by at least 50% of its length or at least
2 s, whichever is smaller (so 2 s for 8 s windows). Only the official test videos have event time
stamps; windows of train-split Shoplifting videos get label -1 (unknown), Normal windows get 0.
"""

import csv
from dataclasses import dataclass
from pathlib import Path

import av
import numpy as np

UCF = Path("/data/ucf-crime")
WINDOW_SEC, STRIDE_SEC, FPS = 8.0, 4.0, 2.0
FRAMES_PER_WINDOW = int(WINDOW_SEC * FPS)
MIN_OVERLAP_SEC = min(0.5 * WINDOW_SEC, 2.0)


@dataclass(frozen=True)
class Video:
    video_id: str
    cls: str
    split: str
    path: Path
    duration_sec: float


def load_videos(root: Path = UCF) -> list[Video]:
    with open(root / "index/videos.csv") as f:
        return [Video(r["video_id"], r["class"], r["split"], root / "raw" / r["rel_path"], float(r["duration_sec"]))
                for r in csv.DictReader(f)]


def load_events(root: Path = UCF) -> dict[str, list[tuple[float, float]]]:
    events: dict[str, list[tuple[float, float]]] = {}
    with open(root / "index/events.csv") as f:
        for r in csv.DictReader(f):
            events.setdefault(r["video_id"], []).append((float(r["start_sec"]), float(r["end_sec"])))
    return events


def decode_video(path: Path) -> np.ndarray:
    """All frames of a video resampled to FPS; returns (N, H, W, 3) uint8, frame k at time k / FPS."""
    frames, k = [], 0
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        stream.thread_count = 4
        for frame in container.decode(stream):
            t = float(frame.pts * stream.time_base)
            while t >= k / FPS:
                frames.append(frame.to_ndarray(format="rgb24"))
                k += 1
    return np.stack(frames)


def window_starts(n_frames: int) -> list[float]:
    """Start times of all full windows in a video with n_frames sampled at FPS."""
    last = (n_frames - FRAMES_PER_WINDOW) / FPS
    return [i * STRIDE_SEC for i in range(int(last // STRIDE_SEC) + 1)] if last >= 0 else []


def window_frames(frames: np.ndarray, start: float) -> np.ndarray:
    i = int(round(start * FPS))
    return frames[i:i + FRAMES_PER_WINDOW]


def window_label(video: Video, start: float, events: dict[str, list[tuple[float, float]]]) -> int:
    if video.cls == "Normal":
        return 0
    if video.video_id not in events:
        return -1
    end = start + WINDOW_SEC
    overlap = sum(max(0.0, min(end, b) - max(start, a)) for a, b in events[video.video_id])
    return int(overlap >= MIN_OVERLAP_SEC)
