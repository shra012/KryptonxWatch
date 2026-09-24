"""Offline tests for build_merl_index.py (needs numpy + scipy: use the zgx conda env).

Each test builds a tiny fake raw/ folder with empty .mp4 files and real .mat
label files written by scipy, and replaces ffprobe with a stub.

Run:  ~/miniforge3/envs/zgx/bin/python -m unittest discover -s model/sonakshi/data_prep/tests -v
"""

import csv
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    import numpy as np
    import scipy.io
except ImportError:  # base python without scipy: skip instead of erroring
    raise unittest.SkipTest("numpy/scipy not installed; run with the zgx conda env")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_merl_index as m  # noqa: E402

DEFAULT_INFO = {"codec": "h264", "width": 920, "height": 680, "r_fps": 30.0, "avg_fps": 30.0,
                "n_frames": 3000, "duration": 100.0}
GOOD = [[(10, 20), (100, 130)], [(21, 30)], [], [(200, 400)], [(500, 560)]]


def tlabs(actions):
    cell = np.empty((len(actions), 1), dtype=object)
    for i, rows in enumerate(actions):
        cell[i, 0] = np.array(rows, dtype=np.uint16).reshape(-1, 2) if rows else np.zeros((0, 0))
    return cell


class MerlIndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        self.raw = self.dest / "raw"
        self.infos = {}

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, vid, actions=GOOD, video=True, label=True, var="tlabs", raw_label=None):
        vdir, ldir = self.raw / m.VIDEO_DIR, self.raw / m.LABEL_DIR
        vdir.mkdir(parents=True, exist_ok=True)
        ldir.mkdir(parents=True, exist_ok=True)
        if video:
            (vdir / f"{vid}_crop.mp4").write_bytes(b"\0" * 10)
        if label:
            path = ldir / f"{vid}_label.mat"
            if raw_label is not None:
                path.write_bytes(raw_label)
            else:
                scipy.io.savemat(path, {var: tlabs(actions) if var == "tlabs" else actions})

    def fake_probe(self, path):
        return {**DEFAULT_INFO, **self.infos.get(path.name.removesuffix("_crop.mp4"), {})}

    def build(self):
        return m.build(self.raw, probe_fn=self.fake_probe)

    def assertDataError(self, fragment):
        with self.assertRaises(m.DataError) as cm:
            self.build()
        self.assertIn(fragment, str(cm.exception))

    # --- happy path --------------------------------------------------------

    def test_happy_path_and_seconds(self):
        for vid in ["1_1", "20_3", "21_1", "26_2", "27_1", "41_2"]:
            self.add(vid)
        videos, actions, warnings = self.build()
        self.assertEqual([v["video_id"] for v in videos], ["1_1", "20_3", "21_1", "26_2", "27_1", "41_2"])
        self.assertEqual([v["split"] for v in videos], ["train", "train", "val", "val", "test", "test"])
        v = videos[0]
        self.assertEqual((v["subject"], v["session"], v["n_actions"], v["n_hand_in_shelf"]), (1, 1, 5, 0))
        a = [x for x in actions if x["video_id"] == "1_1" and x["action"] == "reach_to_shelf"][0]
        # 1-based inclusive frames 10..20 at 30 fps -> 0.3 s .. 0.667 s, 11 frames long
        self.assertEqual((a["start_frame"], a["end_frame"]), (10, 20))
        self.assertEqual((a["start_sec"], a["end_sec"], a["duration_sec"]), (0.3, 0.667, 0.367))
        self.assertTrue(any("split sizes" in w for w in warnings))   # 2/2/2, not 60/18/28

    def test_numeric_sort_not_text_sort(self):
        for vid in ["10_1", "2_1", "1_2", "1_1"]:
            self.add(vid)
        self.assertEqual([v["video_id"] for v in self.build()[0]], ["1_1", "1_2", "2_1", "10_1"])

    def test_empty_actions_are_fine_but_all_empty_warns(self):
        self.add("1_1", actions=[[], [], [], [], []])
        videos, actions, warnings = self.build()
        self.assertEqual((videos[0]["n_actions"], len(actions)), (0, 0))
        self.assertTrue(any("no labelled actions" in w for w in warnings))

    def test_touching_instances_warn(self):
        self.add("1_1", actions=[[(10, 20), (20, 30)], [], [], [], []])
        self.assertTrue(any("overlap" in w for w in self.build()[2]))

    def test_unsorted_instances_are_sorted(self):
        self.add("1_1", actions=[[(100, 130), (10, 20)], [], [], [], []])
        starts = [a["start_frame"] for a in self.build()[1]]
        self.assertEqual(starts, [10, 100])

    # --- pairing / naming --------------------------------------------------

    def test_video_without_label(self):
        self.add("1_1")
        self.add("1_2", label=False)
        self.assertDataError("without labels")

    def test_label_without_video(self):
        self.add("1_1")
        self.add("1_2", video=False)
        self.assertDataError("without a video")

    def test_bad_filename(self):
        self.add("1_1")
        (self.raw / m.VIDEO_DIR / "copy of 1_1_crop.mp4").write_bytes(b"")
        self.assertDataError("unexpected video filename")

    def test_subject_out_of_range(self):
        self.add("42_1")
        self.assertDataError("outside the documented range")

    def test_not_unzipped(self):
        self.assertDataError("unzip the dataset first")

    # --- label contents ----------------------------------------------------

    def test_missing_tlabs_variable(self):
        self.add("1_1", var="labels", actions=np.zeros((2, 2)))
        self.assertDataError("no 'tlabs' variable")

    def test_corrupt_mat_file(self):
        self.add("1_1", raw_label=b"this is not a mat file")
        self.assertDataError("cannot read .mat file")

    def test_wrong_number_of_actions(self):
        self.add("1_1", actions=GOOD[:4])
        self.assertDataError("cell array of 5")

    def test_bad_ranges(self):
        cases = {"invalid range 20..10": [(20, 10)], "invalid range 0..5": [(0, 5)]}
        for fragment, rows in cases.items():
            with self.subTest(fragment):
                self.tearDown()
                self.setUp()
                self.add("1_1", actions=[rows, [], [], [], []])
                self.assertDataError(fragment)

    def test_non_integer_frames(self):
        vdir, ldir = self.raw / m.VIDEO_DIR, self.raw / m.LABEL_DIR
        vdir.mkdir(parents=True)
        ldir.mkdir(parents=True)
        (vdir / "1_1_crop.mp4").write_bytes(b"")
        cell = tlabs(GOOD)
        cell[0, 0] = np.array([[10.5, 20.0]])
        scipy.io.savemat(ldir / "1_1_label.mat", {"tlabs": cell})
        self.assertDataError("non-integer")

    def test_wrong_column_count(self):
        vdir, ldir = self.raw / m.VIDEO_DIR, self.raw / m.LABEL_DIR
        vdir.mkdir(parents=True)
        ldir.mkdir(parents=True)
        (vdir / "1_1_crop.mp4").write_bytes(b"")
        cell = tlabs(GOOD)
        cell[1, 0] = np.array([[10, 20, 30]], dtype=np.uint16)
        scipy.io.savemat(ldir / "1_1_label.mat", {"tlabs": cell})
        self.assertDataError("should be K x 2")

    def test_labels_past_video_end(self):
        self.add("1_1", actions=[[(10, 3010)], [], [], [], []])
        self.assertTrue(any("past the last frame" in w for w in self.build()[2]))
        self.infos["1_1"] = {"n_frames": 2900}
        self.assertDataError("video has only 2900 frames")
        self.infos["1_1"] = {"n_frames": 5}
        self.assertDataError("starts at frame 10")

    def test_bad_fps(self):
        self.add("1_1")
        self.infos["1_1"] = {"r_fps": None}
        self.assertDataError("unusable frame rate")

    # --- main() ------------------------------------------------------------

    def run_main(self):
        with mock.patch.object(m.build, "__defaults__", (self.fake_probe,)):
            err, out = io.StringIO(), io.StringIO()
            with mock.patch("sys.stderr", err), mock.patch("sys.stdout", out):
                return m.main(["--dest", str(self.dest)]), out.getvalue(), err.getvalue()

    def test_main_writes_and_refuses_on_error(self):
        self.add("1_1")
        self.add("27_1")
        self.assertEqual(self.run_main()[0], 0)
        with open(self.dest / "index" / "actions.csv") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), 10)
        self.assertEqual(list(rows[0].keys()), m.ACTION_COLUMNS)
        before = (self.dest / "index" / "videos.csv").read_bytes()
        self.add("27_2", label=False)                     # break it
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("Nothing was written", err)
        self.assertEqual((self.dest / "index" / "videos.csv").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
