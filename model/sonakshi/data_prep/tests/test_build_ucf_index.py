"""Offline tests for build_ucf_index.py.

Each test builds a tiny fake raw/ folder (empty .mp4 files, split lists and an
annotation zip) and replaces ffprobe with a stub, so no real video is needed.

Run:  python -m unittest discover -s model/sonakshi/data_prep/tests -v
"""

import csv
import io
import os
import stat
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_ucf_index as b  # noqa: E402

DEFAULT_INFO = {"codec": "h264", "width": 320, "height": 240, "r_fps": 30.0, "avg_fps": 30.0,
                "n_frames": 3000, "duration": 100.0}

BASE_ANN = {
    "Shoplifting001_x264.mp4": "Shoplifting  1550  2000  -1  -1",
    "Shoplifting007_x264.mp4": "Shoplifting  550  760  2630  2920",
    "Stealing019_x264.mp4": "Stealing  300  600  -1  -1",
    "Normal_Videos_003_x264.mp4": "Normal  -1  -1  -1  -1",
    "Robbery050_x264.mp4": "Robbery  10  20  -1  -1",           # other class: ignored
}
BASE_TRAIN = ["Shoplifting/Shoplifting003_x264.mp4", "Stealing/Stealing001_x264.mp4",
              "Robbery/Robbery001_x264.mp4", "Training_Normal_Videos_Anomaly/Normal_Videos_001_x264.mp4"]
BASE_TEST = ["Shoplifting/Shoplifting001_x264.mp4", "Shoplifting/Shoplifting007_x264.mp4",
             "Stealing/Stealing019_x264.mp4", "Testing_Normal_Videos_Anomaly/Normal_Videos_003_x264.mp4",
             "Robbery/Robbery050_x264.mp4"]
# Videos we actually downloaded (no Robbery, no Training_Normal).
BASE_DISK = ["Shoplifting/Shoplifting003_x264.mp4", "Stealing/Stealing001_x264.mp4",
             "Shoplifting/Shoplifting001_x264.mp4", "Shoplifting/Shoplifting007_x264.mp4",
             "Stealing/Stealing019_x264.mp4", "Testing_Normal_Videos_Anomaly/Normal_Videos_003_x264.mp4"]


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        self.raw = self.dest / "raw"
        self.infos = {}          # rel path -> overrides for the fake ffprobe

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, ann=None, train=None, test=None, disk=None, ann_lines=None):
        ann = BASE_ANN if ann is None else ann
        vids = self.raw / "UCF_Crimes" / "Videos"
        for rel in (BASE_DISK if disk is None else disk):
            (vids / rel).parent.mkdir(parents=True, exist_ok=True)
            (vids / rel).write_bytes(b"\0" * 10)
        splits = self.raw / "UCF_Crimes" / "Anomaly_Detection_splits"
        splits.mkdir(parents=True, exist_ok=True)
        (splits / "Anomaly_Train.txt").write_text("\n".join(BASE_TRAIN if train is None else train) + "\n")
        (splits / "Anomaly_Test.txt").write_text("\n".join(BASE_TEST if test is None else test) + "\n")
        lines = ann_lines if ann_lines is not None else [f"{k}  {v}  " for k, v in ann.items()]
        with zipfile.ZipFile(self.raw / b.ANNOTATION_ZIP, "w") as z:
            z.writestr(b.ANNOTATION_MEMBER, "\n".join(lines) + "\n")

    def fake_probe(self, path):
        rel = f"{path.parent.name}/{path.name}"
        return {**DEFAULT_INFO, **self.infos.get(rel, {})}

    def build(self):
        return b.build(self.raw, probe_fn=self.fake_probe)

    def assertDataError(self, fragment):
        with self.assertRaises(b.DataError) as cm:
            self.build()
        self.assertIn(fragment, str(cm.exception))

    # --- happy path --------------------------------------------------------

    def test_happy_path(self):
        self.make()
        videos, events, warnings = self.build()
        self.assertEqual(warnings, [])
        by_id = {v["video_id"]: v for v in videos}
        self.assertEqual(set(by_id), {"Shoplifting001", "Shoplifting003", "Shoplifting007",
                                      "Stealing001", "Stealing019", "Normal_Videos_003"})
        self.assertEqual(by_id["Shoplifting003"]["split"], "train")
        self.assertEqual(by_id["Shoplifting001"]["split"], "test")
        self.assertEqual(by_id["Normal_Videos_003"]["class"], "Normal")
        self.assertEqual(by_id["Shoplifting007"]["n_events"], 2)
        e = [x for x in events if x["video_id"] == "Shoplifting001"][0]
        self.assertEqual((e["start_frame"], e["end_frame"]), (1550, 2000))
        self.assertEqual((e["start_sec"], e["end_sec"], e["duration_sec"]), (51.667, 66.667, 15.0))
        self.assertEqual([x["event_idx"] for x in events if x["video_id"] == "Shoplifting007"], [1, 2])
        self.assertFalse(any(x["video_id"].startswith("Robbery") for x in events))

    def test_ntsc_fps_conversion(self):
        self.make()
        self.infos["Shoplifting/Shoplifting001_x264.mp4"] = {"r_fps": b.parse_fps("30000/1001"),
                                                             "avg_fps": b.parse_fps("30000/1001")}
        _, events, _ = self.build()
        e = [x for x in events if x["video_id"] == "Shoplifting001"][0]
        self.assertEqual(e["start_sec"], round(1550 * 1001 / 30000, 3))   # 51.718, not 51.667

    def test_missing_nb_frames_falls_back_to_duration(self):
        self.make()
        self.infos["Shoplifting/Shoplifting001_x264.mp4"] = {"n_frames": None, "duration": 80.0}
        videos, _, _ = self.build()
        self.assertEqual({v["video_id"]: v for v in videos}["Shoplifting001"]["n_frames"], 2400)

    def test_parse_fps(self):
        self.assertEqual(b.parse_fps("30/1"), 30.0)
        self.assertAlmostEqual(b.parse_fps("30000/1001"), 29.97, places=2)
        for bad in ["0/0", "0/1", "-30/1", "abc", "", None]:
            with self.subTest(bad=bad):
                self.assertIsNone(b.parse_fps(bad))

    def test_variable_frame_rate_is_a_warning(self):
        self.make()
        self.infos["Stealing/Stealing001_x264.mp4"] = {"avg_fps": 24.0}
        _, _, warnings = self.build()
        self.assertTrue(any("variable frame rate" in w for w in warnings))

    # --- split problems ----------------------------------------------------

    def test_video_in_both_splits(self):
        self.make(train=BASE_TRAIN + ["Shoplifting/Shoplifting001_x264.mp4"])
        self.assertDataError("both train and test")

    def test_listed_video_missing_on_disk(self):
        self.make(disk=[d for d in BASE_DISK if "Stealing001" not in d])
        self.assertDataError("missing on disk")

    def test_video_on_disk_not_in_any_split(self):
        self.make(disk=BASE_DISK + ["Shoplifting/Shoplifting099_x264.mp4"])
        self.assertDataError("not in any split")

    def test_duplicate_split_line(self):
        self.make(train=BASE_TRAIN + [BASE_TRAIN[0]])
        self.assertDataError("duplicate entry")

    def test_blank_lines_and_trailing_spaces_ok(self):
        self.make(train=BASE_TRAIN + ["", "   "])
        split = self.raw / "UCF_Crimes" / "Anomaly_Detection_splits" / "Anomaly_Test.txt"
        split.write_text("\n".join(x + "  " for x in BASE_TEST) + "\n\n")
        videos, _, _ = self.build()
        self.assertEqual(len(videos), 6)

    # --- annotation format problems ---------------------------------------

    def test_bad_annotation_lines(self):
        cases = {
            "only one of start/end": "Shoplifting  1550  -1  -1  -1",
            "event 2 set but event 1 is empty": "Shoplifting  -1  -1  100  200",
            "invalid range": "Shoplifting  2000  1550  -1  -1",
            "starts before event 1 ends": "Shoplifting  100  500  400  600",
            "non-integer": "Shoplifting  1550.5  2000  -1  -1",
        }
        for fragment, line in cases.items():
            with self.subTest(fragment):
                self.tearDown()      # fresh folder per case
                self.setUp()
                self.make(ann={**BASE_ANN, "Shoplifting001_x264.mp4": line})
                self.assertDataError(fragment)

    def test_wrong_field_count(self):
        self.make(ann_lines=["Shoplifting001_x264.mp4  Shoplifting  1550  2000  -1"])
        self.assertDataError("expected 6 fields")

    def test_duplicate_annotation(self):
        lines = [f"{k}  {v}" for k, v in BASE_ANN.items()] + ["Shoplifting001_x264.mp4  Shoplifting  1  2  -1  -1"]
        self.make(ann_lines=lines)
        self.assertDataError("duplicate video")

    # --- annotation vs video consistency -----------------------------------

    def test_test_video_without_annotation(self):
        self.make(ann={k: v for k, v in BASE_ANN.items() if not k.startswith("Stealing019")})
        self.assertDataError("has no temporal annotation")

    def test_anomaly_test_video_without_events(self):
        self.make(ann={**BASE_ANN, "Stealing019_x264.mp4": "Stealing  -1  -1  -1  -1"})
        self.assertDataError("anomaly test video has no events")

    def test_normal_video_with_events(self):
        self.make(ann={**BASE_ANN, "Normal_Videos_003_x264.mp4": "Normal  10  20  -1  -1"})
        self.assertDataError("normal video has events")

    def test_class_mismatch(self):
        self.make(ann={**BASE_ANN, "Stealing019_x264.mp4": "Shoplifting  300  600  -1  -1"})
        self.assertDataError("annotation class")

    def test_train_video_in_annotations(self):
        self.make(ann={**BASE_ANN, "Shoplifting003_x264.mp4": "Shoplifting  1  2  -1  -1"})
        self.assertDataError("train video appears in the test annotations")

    def test_annotation_for_video_not_on_disk(self):
        self.make(ann={**BASE_ANN, "Shoplifting050_x264.mp4": "Shoplifting  1  2  -1  -1"})
        self.assertDataError("no such video on disk")

    def test_event_slightly_past_end_is_warning(self):
        self.make()
        self.infos["Shoplifting/Shoplifting001_x264.mp4"] = {"n_frames": 1990}
        _, _, warnings = self.build()
        self.assertTrue(any("past the last frame" in w for w in warnings))

    def test_event_far_past_end_is_error(self):
        self.make()
        self.infos["Shoplifting/Shoplifting001_x264.mp4"] = {"n_frames": 1900}
        self.assertDataError("video has only 1900 frames")

    def test_event_starting_after_end_is_error(self):
        self.make()
        self.infos["Shoplifting/Shoplifting001_x264.mp4"] = {"n_frames": 1500}
        self.assertDataError("event starts at frame 1550")

    def test_bad_fps_and_duration(self):
        self.make()
        self.infos["Stealing/Stealing001_x264.mp4"] = {"r_fps": None}
        self.assertDataError("unusable frame rate")
        self.infos["Stealing/Stealing001_x264.mp4"] = {"duration": float("nan")}
        self.assertDataError("invalid duration")

    # --- main(): writing ---------------------------------------------------

    def run_main(self):
        with mock.patch.object(b, "probe", self.fake_probe), \
             mock.patch.object(b.build, "__defaults__", (self.fake_probe,)):
            err, out = io.StringIO(), io.StringIO()
            with mock.patch("sys.stderr", err), mock.patch("sys.stdout", out):
                code = b.main(["--dest", str(self.dest)])
        return code, out.getvalue(), err.getvalue()

    def test_main_writes_readable_csvs(self):
        self.make()
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        idx = self.dest / "index"
        with open(idx / "videos.csv") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), 6)
        self.assertEqual(list(rows[0].keys()), b.VIDEO_COLUMNS)
        with open(idx / "events.csv") as f:
            self.assertEqual(len(list(csv.DictReader(f))), 4)
        for name in ("videos.csv", "events.csv"):
            mode = stat.S_IMODE(os.stat(idx / name).st_mode)
            self.assertTrue(mode & stat.S_IROTH, f"{name} not world-readable: {oct(mode)}")
        self.assertEqual(list(idx.glob("*.tmp")), [])

    def test_main_on_error_leaves_old_index_untouched(self):
        self.make()
        self.assertEqual(self.run_main()[0], 0)
        before = (self.dest / "index" / "videos.csv").read_bytes()
        self.make(train=BASE_TRAIN + ["Shoplifting/Shoplifting001_x264.mp4"])   # now broken
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("Nothing was written", err)
        self.assertEqual((self.dest / "index" / "videos.csv").read_bytes(), before)

    def test_main_missing_raw_folder(self):
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("ERROR", err)
        self.assertFalse((self.dest / "index").exists())


if __name__ == "__main__":
    unittest.main()
