"""Offline tests for download_ucf_subset.py (stdlib only, no internet needed).

A local HTTP server serves a small zip built in memory and can misbehave on
purpose: corrupt bytes, drop connections, return 500s, or refuse ranges.

Run:  python -m unittest discover -s model/sonakshi/data_prep/tests -v
"""

import io
import os
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import download_ucf_subset as d  # noqa: E402


def build_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("UCF_Crimes/", "")
        z.writestr("UCF_Crimes/Videos/Shoplifting/", "")
        z.writestr("UCF_Crimes/Videos/Shoplifting/Shoplifting001_x264.mp4", os.urandom(3_000_000))
        z.writestr("UCF_Crimes/Videos/Shoplifting/Shoplifting002_x264.mp4", b"")          # empty file
        z.writestr("UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4", b"x" * 12_345_678)  # > BLOCK_SIZE
        z.writestr("UCF_Crimes/Videos/Stealing_extra/Nope.mp4", b"must not be selected")
        z.writestr("UCF_Crimes/Videos/Robbery/Robbery001_x264.mp4", b"not ours")
        z.writestr("UCF_Crimes/Anomaly_Detection_splits/Anomaly_Test.txt", "Shoplifting/Shoplifting001_x264.mp4\n")
        z.writestr("UCF_Crimes/Videos/Testing_Normal_Videos_Anomaly/Normal_Videos_003_x264.mp4",
                   os.urandom(10_000))
    return buf.getvalue()


def build_annotation_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Temporal_Anomaly_Annotation_For_Testing_Videos/Txt_formate/Temporal_Anomaly_Annotation.txt",
                   "Shoplifting001_x264.mp4  Shoplifting  1550  2000  -1  -1\n")
    return buf.getvalue()


class FakeServer:
    """Behaviour flags are changed by tests between runs."""

    def __init__(self, files):
        self.files = files
        self.corrupt = False        # flip a byte in every range response past the first 64 KB
        self.fail_next = 0          # return HTTP 500 for the next N requests
        self.drop_next = 0          # send headers then close early for the next N range requests
        self.no_ranges = False      # behave like a server without range support
        self.range_requests = 0
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _body(self):
                return server.files.get(self.path)

            def do_HEAD(self):
                body = self._body()
                if body is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                if not server.no_ranges:
                    self.send_header("Accept-Ranges", "bytes")
                self.end_headers()

            def do_GET(self):
                body = self._body()
                if body is None:
                    self.send_error(404)
                    return
                if server.fail_next > 0:
                    server.fail_next -= 1
                    self.send_error(500)
                    return
                rng = self.headers.get("Range")
                if rng and not server.no_ranges:
                    server.range_requests += 1
                    start, end = (int(x) for x in rng.removeprefix("bytes=").split("-"))
                    chunk = bytearray(body[start:end + 1])
                    if server.corrupt and start > 65536 and chunk:
                        chunk[len(chunk) // 2] ^= 0xFF
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
                    self.send_header("Content-Length", str(len(chunk)))
                    self.end_headers()
                    if server.drop_next > 0:
                        server.drop_next -= 1
                        self.wfile.write(bytes(chunk[: len(chunk) // 2]))
                        self.wfile.flush()
                        self.close_connection = True
                        return
                    self.wfile.write(bytes(chunk))
                else:
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class DownloaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.zip_bytes = build_zip()
        cls.ann_bytes = build_annotation_zip()
        cls.srv = FakeServer({"/UCF_Crimes.zip": cls.zip_bytes,
                              "/Temporal_Anomaly_Annotation_For_Testing_Videos.zip": cls.ann_bytes})
        cls.expected = {i.filename: i for i in zipfile.ZipFile(io.BytesIO(cls.zip_bytes)).infolist()}
        # No real waiting during retries.
        cls._sleep = mock.patch.object(d.time, "sleep", lambda s: None)
        cls._sleep.start()
        # Small blocks so the ~15 MB test zip spans many range requests.
        cls._block = mock.patch.object(d, "BLOCK_SIZE", 1024 * 1024)
        cls._block.start()

    @classmethod
    def tearDownClass(cls):
        cls._block.stop()
        cls._sleep.stop()
        cls.srv.close()

    def setUp(self):
        self.srv.corrupt = False
        self.srv.fail_next = self.srv.drop_next = 0
        self.srv.no_ranges = False
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *extra):
        with mock.patch.object(d, "make_ssl_context", lambda: None):
            return d.main(["--dest", str(self.dest),
                           "--url", self.srv.base + "/UCF_Crimes.zip",
                           "--annotation-url", self.srv.base + "/Temporal_Anomaly_Annotation_For_Testing_Videos.zip",
                           *extra])

    def raw(self, name):
        return self.dest / "raw" / name

    # --- selection ---------------------------------------------------------

    def test_selection_exact_prefixes(self):
        names = {i.filename for i in d.select_members(self.expected.values())}
        self.assertEqual(names, {
            "UCF_Crimes/Videos/Shoplifting/Shoplifting001_x264.mp4",
            "UCF_Crimes/Videos/Shoplifting/Shoplifting002_x264.mp4",
            "UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4",
            "UCF_Crimes/Anomaly_Detection_splits/Anomaly_Test.txt",
            "UCF_Crimes/Videos/Testing_Normal_Videos_Anomaly/Normal_Videos_003_x264.mp4",
        })  # no dirs, no Robbery, no "Stealing_extra"

    def test_empty_selection_is_an_error(self):
        with mock.patch.object(d, "SELECTED_PREFIXES", ("NoSuchFolder/",)), \
             mock.patch.object(d, "select_members", lambda infos: []):
            self.assertEqual(self.run_main(), 1)

    # --- path safety -------------------------------------------------------

    def test_zip_slip_rejected(self):
        for bad in ["../evil.mp4", "UCF_Crimes/../../evil", "/etc/passwd", "C:/x", "a\\..\\b", "a/\x00b", ""]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                d.safe_member_path(self.dest, bad)

    def test_safe_path_ok(self):
        p = d.safe_member_path(self.dest, "UCF_Crimes/Videos/Shoplifting/a.mp4")
        self.assertEqual(p, (self.dest / "UCF_Crimes/Videos/Shoplifting/a.mp4").resolve())

    # --- happy path, resume, repair ---------------------------------------

    def test_full_download_bytes_match(self):
        self.assertEqual(self.run_main(), 0)
        src = zipfile.ZipFile(io.BytesIO(self.zip_bytes))
        for info in d.select_members(self.expected.values()):
            with self.subTest(f=info.filename):
                self.assertEqual(self.raw(info.filename).read_bytes(), src.read(info))
        self.assertFalse(self.raw("UCF_Crimes/Videos/Robbery").exists())
        self.assertTrue(zipfile.ZipFile(self.raw("Temporal_Anomaly_Annotation_For_Testing_Videos.zip")).testzip() is None)
        self.assertEqual(list(self.dest.rglob("*.part")), [])

    def test_rerun_skips_without_refetching(self):
        self.assertEqual(self.run_main(), 0)
        before = self.srv.range_requests
        self.assertEqual(self.run_main("--dry-run"), 0)
        toc_requests = self.srv.range_requests - before       # cost of reading the table of contents
        before = self.srv.range_requests
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            self.assertEqual(self.run_main(), 0)
        self.assertEqual(out.getvalue().count("skip (ok)"), 6)   # 5 members + annotation zip
        # Only the table-of-contents read should hit the network again; no video bytes.
        self.assertEqual(self.srv.range_requests - before, toc_requests)

    def test_truncated_file_is_redownloaded(self):
        self.assertEqual(self.run_main(), 0)
        f = self.raw("UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4")
        with open(f, "r+b") as fh:
            fh.truncate(1000)
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(f.stat().st_size, self.expected["UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4"].file_size)

    def test_same_size_but_corrupted_file_is_redownloaded(self):
        self.assertEqual(self.run_main(), 0)
        f = self.raw("UCF_Crimes/Videos/Shoplifting/Shoplifting001_x264.mp4")
        data = bytearray(f.read_bytes())
        data[100] ^= 0xFF
        f.write_bytes(bytes(data))
        self.assertEqual(self.run_main(), 0)
        info = self.expected["UCF_Crimes/Videos/Shoplifting/Shoplifting001_x264.mp4"]
        self.assertEqual(d.file_crc32(f), info.CRC)

    def test_leftover_part_file_is_replaced(self):
        target = self.raw("UCF_Crimes/Videos/Shoplifting/Shoplifting001_x264.mp4")
        target.parent.mkdir(parents=True)
        Path(str(target) + ".part").write_bytes(b"junk from a killed run")
        self.assertEqual(self.run_main(), 0)
        self.assertFalse(Path(str(target) + ".part").exists())
        self.assertEqual(d.file_crc32(target), self.expected[
            "UCF_Crimes/Videos/Shoplifting/Shoplifting001_x264.mp4"].CRC)

    def test_limit_and_dry_run(self):
        self.assertEqual(self.run_main("--dry-run"), 0)
        self.assertFalse((self.dest / "raw").exists())            # dry run writes nothing
        self.assertEqual(self.run_main("--limit", "1"), 0)
        vids = [p for p in self.dest.rglob("*") if p.is_file() and p.suffix in (".mp4", ".txt")]
        self.assertEqual(len(vids), 1)
        with self.assertRaises(SystemExit):
            self.run_main("--limit", "0")

    # --- network misbehaviour ---------------------------------------------

    def test_corrupted_bytes_are_caught_and_not_kept(self):
        self.srv.corrupt = True
        err = io.StringIO()
        with mock.patch("sys.stderr", err):
            self.assertEqual(self.run_main(), 1)
        self.assertIn("FAILED", err.getvalue())
        big = self.raw("UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4")
        self.assertFalse(big.exists())                             # bad file never lands
        self.assertEqual(list(self.dest.rglob("*.part")), [])
        self.srv.corrupt = False
        self.assertEqual(self.run_main(), 0)                       # re-run repairs it

    def test_transient_500s_are_retried(self):
        self.srv.fail_next = 3
        with mock.patch("sys.stderr", io.StringIO()):
            self.assertEqual(self.run_main(), 0)

    def test_dropped_connection_is_retried(self):
        self.assertEqual(self.run_main("--dry-run"), 0)  # warm-up, nothing written
        self.srv.drop_next = 2
        with mock.patch("sys.stderr", io.StringIO()):
            self.assertEqual(self.run_main(), 0)
        self.assertEqual(d.file_crc32(self.raw("UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4")),
                         self.expected["UCF_Crimes/Videos/Stealing/Stealing001_x264.mp4"].CRC)

    def test_server_without_ranges_is_refused(self):
        self.srv.no_ranges = True
        with self.assertRaises(IOError):
            self.run_main()

    def test_404_is_not_retried(self):
        with mock.patch.object(d, "make_ssl_context", lambda: None):
            with self.assertRaises(d.urllib.error.HTTPError):
                d.main(["--dest", str(self.dest), "--url", self.srv.base + "/missing.zip"])

    # --- range file --------------------------------------------------------

    def test_range_file_reads_match_local(self):
        f = d.HttpRangeFile(self.srv.base + "/UCF_Crimes.zip", None)
        b = self.zip_bytes
        self.assertEqual(f.size, len(b))
        for off, n in [(0, 4), (len(b) - 22, 22), (d.BLOCK_SIZE - 3, 10), (5, d.BLOCK_SIZE * 2), (len(b) - 5, 100)]:
            with self.subTest(off=off, n=n):
                f.seek(off)
                self.assertEqual(f.read(n), b[off:off + n])
        f.seek(0, 2)
        self.assertEqual(f.read(10), b"")
        with self.assertRaises(ValueError):
            f.seek(-1)


class TlsTests(unittest.TestCase):
    def test_missing_cert_file_errors(self):
        with self.assertRaises(FileNotFoundError):
            d.make_ssl_context(Path("/nonexistent/cert.pem"))

    def test_partial_chain_disabled(self):
        ctx = d.make_ssl_context()
        self.assertEqual(ctx.verify_mode, d.ssl.CERT_REQUIRED)
        self.assertTrue(ctx.check_hostname)
        self.assertFalse(ctx.verify_flags & getattr(d.ssl, "VERIFY_X509_PARTIAL_CHAIN", 0))


if __name__ == "__main__":
    unittest.main()
