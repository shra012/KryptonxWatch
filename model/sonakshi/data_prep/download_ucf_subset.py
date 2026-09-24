"""Download only the parts of UCF-Crime needed for shoplifting detection.

The official UCF_Crimes.zip is one 103 GB file. The server supports HTTP range
requests, so this script reads the zip's table of contents over the network and
extracts only the members we need (~10 GB):

    Videos/Shoplifting/                     50 videos
    Videos/Stealing/                       100 videos
    Videos/Testing_Normal_Videos_Anomaly/  150 videos (for false alarm rate)
    Anomaly_Detection_splits/*.txt         train/test lists
    Action_Regnition_splits/*.txt          (spelling is UCF's)

It also downloads the separate temporal annotation zip (test-set event times).

Output keeps the original paths:
    <dest>/raw/UCF_Crimes/...
    <dest>/raw/Temporal_Anomaly_Annotation_For_Testing_Videos.zip

Safety:
- TLS verification stays ON. crcv.ucf.edu omits its intermediate certificate;
  we ship that public cert in certs/ and only accept it if it chains to a root
  the OS already trusts (partial-chain trust is switched off).
- Every file is checked against the CRC32 and size stored in the zip. Files are
  written to *.part and renamed only after they pass.
- Re-running skips files that already exist and pass the CRC check, so an
  interrupted download can simply be restarted.

Usage:
    python download_ucf_subset.py --dry-run
    python download_ucf_subset.py --limit 2          # small test
    python download_ucf_subset.py                    # everything selected
"""

import argparse
import http.client
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from pathlib import Path, PurePosixPath

ZIP_URL = "https://www.crcv.ucf.edu/data1/chenchen/UCF_Crimes.zip"
ANNOTATION_URL = ("https://www.crcv.ucf.edu/projects/real-world/"
                  "Temporal_Anomaly_Annotation_For_Testing_Videos.zip")
DEFAULT_DEST = "/srv/kryptonx-data/ucf-crime"
INTERMEDIATE_CERT = Path(__file__).resolve().parent / "certs" / "InCommonRSAOVSSLCA3.pem"

# Zip member prefixes to extract. Trailing "/" matters: "Videos/Stealing/" must not
# match a hypothetical "Videos/Stealing_extra/".
SELECTED_PREFIXES = (
    "UCF_Crimes/Videos/Shoplifting/",
    "UCF_Crimes/Videos/Stealing/",
    "UCF_Crimes/Videos/Testing_Normal_Videos_Anomaly/",
    "UCF_Crimes/Anomaly_Detection_splits/",
    "UCF_Crimes/Action_Regnition_splits/",
)

BLOCK_SIZE = 32 * 1024 * 1024  # bytes per HTTP range request; each request is a new TLS connection
COPY_CHUNK = 1024 * 1024
MAX_RETRIES = 5


def make_ssl_context(cert_path=INTERMEDIATE_CERT):
    """System trust store + UCF's missing intermediate, which must chain to a system root."""
    if not Path(cert_path).is_file():
        raise FileNotFoundError(f"intermediate certificate not found: {cert_path}")
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(cafile=str(cert_path))
    # Python 3.13+ enables partial-chain by default, which would make the intermediate
    # a trust anchor on its own. Turn it off so it is only trusted via a real root.
    ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0)
    return ctx


def _urlopen_with_retry(req, ctx, timeout, what):
    """urlopen with exponential backoff on network errors. HTTP 4xx is not retried."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return urllib.request.urlopen(req, context=ctx, timeout=timeout)
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:
                raise
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            # A certificate failure will not fix itself; don't retry it.
            if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
                raise
            err = e
        if attempt < MAX_RETRIES:
            wait = 2 ** attempt
            print(f"  network error on {what} ({err}); retry {attempt}/{MAX_RETRIES - 1} in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise err


class HttpRangeFile:
    """Read-only, seekable file object backed by HTTP range requests, with a block cache."""

    def __init__(self, url, ctx):
        self.url, self.ctx, self.pos = url, ctx, 0
        self._buf, self._buf_start = b"", 0
        req = urllib.request.Request(url, method="HEAD")
        with _urlopen_with_retry(req, ctx, 60, "HEAD") as r:
            if r.headers.get("Accept-Ranges", "").lower() != "bytes":
                raise IOError("server does not advertise byte-range support")
            self.size = int(r.headers["Content-Length"])

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        if whence == 0:
            new = offset
        elif whence == 1:
            new = self.pos + offset
        elif whence == 2:
            new = self.size + offset
        else:
            raise ValueError(f"invalid whence {whence}")
        if new < 0:
            raise ValueError("negative seek position")
        self.pos = new
        return self.pos

    def _fetch(self, start, length):
        end = min(start + length, self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
        for attempt in range(1, MAX_RETRIES + 1):
            with _urlopen_with_retry(req, self.ctx, 120, f"bytes {start}-{end}") as r:
                if r.status != 206:
                    raise IOError(f"expected HTTP 206 for range request, got {r.status}")
                try:
                    data = r.read()
                # IncompleteRead (connection dropped mid-body) is an HTTPException, not OSError.
                except (TimeoutError, ConnectionError, OSError, http.client.HTTPException) as e:
                    data, err = None, e
            if data is not None and len(data) == end - start + 1:
                return data
            if attempt < MAX_RETRIES:
                print(f"  short/failed read at {start} ({'got ' + str(len(data)) if data is not None else err});"
                      f" retry {attempt}/{MAX_RETRIES - 1}", file=sys.stderr)
                time.sleep(2 ** attempt)
        raise IOError(f"could not read bytes {start}-{end} after {MAX_RETRIES} attempts")

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        n = min(n, self.size - self.pos)
        out = bytearray()
        while n > 0:
            off = self.pos - self._buf_start
            if not (0 <= off < len(self._buf)):
                # Big reads (e.g. the central directory) are fetched in one go.
                self._buf = self._fetch(self.pos, max(n, BLOCK_SIZE))
                self._buf_start, off = self.pos, 0
            piece = self._buf[off:off + n]
            out += piece
            self.pos += len(piece)
            n -= len(piece)
        return bytes(out)


def safe_member_path(dest_root, name):
    """Map a zip member name to a path under dest_root, rejecting zip-slip tricks."""
    p = PurePosixPath(name)
    if (p.is_absolute() or not p.parts or ".." in p.parts or "\\" in name
            or ":" in p.parts[0] or "\x00" in name):
        raise ValueError(f"unsafe path in zip: {name!r}")
    target = (Path(dest_root) / Path(*p.parts)).resolve()
    root = Path(dest_root).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"zip member escapes destination: {name!r}")
    return target


def select_members(infolist, prefixes=SELECTED_PREFIXES):
    return [i for i in infolist
            if not i.is_dir() and any(i.filename.startswith(p) for p in prefixes)]


def file_crc32(path):
    crc = 0
    with open(path, "rb") as f:
        while chunk := f.read(COPY_CHUNK):
            crc = zlib.crc32(chunk, crc)
    return crc


def is_already_done(info, target):
    return (target.is_file() and target.stat().st_size == info.file_size
            and file_crc32(target) == info.CRC)


def extract_member(zf, info, target):
    """Stream one member to target.part, verify size + CRC, then rename into place."""
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    crc, written = 0, 0
    try:
        # zipfile also checks the CRC and raises BadZipFile on mismatch at EOF.
        with zf.open(info) as src, open(part, "wb") as dst:
            while chunk := src.read(COPY_CHUNK):
                dst.write(chunk)
                crc = zlib.crc32(chunk, crc)
                written += len(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        if written != info.file_size or crc != info.CRC:
            raise IOError(f"verification failed for {info.filename}: "
                          f"size {written}/{info.file_size}, crc {crc:08x}/{info.CRC:08x}")
        os.replace(part, target)
    except BaseException:
        part.unlink(missing_ok=True)
        raise


def download_annotations(dest_raw, ctx, url=ANNOTATION_URL):
    """Download the small temporal-annotation zip whole and check it."""
    target = Path(dest_raw) / Path(PurePosixPath(url).name)
    if target.is_file() and zipfile.is_zipfile(target):
        with zipfile.ZipFile(target) as z:
            if z.testzip() is None:
                print(f"skip (ok)  {target.name}")
                return target
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    try:
        with _urlopen_with_retry(urllib.request.Request(url), ctx, 120, target.name) as r, \
                open(part, "wb") as f:
            expected = r.headers.get("Content-Length")
            while chunk := r.read(COPY_CHUNK):
                f.write(chunk)
        if expected is not None and part.stat().st_size != int(expected):
            raise IOError(f"{target.name}: got {part.stat().st_size} bytes, expected {expected}")
        with zipfile.ZipFile(part) as z:
            bad = z.testzip()
            if bad is not None:
                raise IOError(f"{target.name}: corrupt member {bad}")
        os.replace(part, target)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    print(f"done       {target.name}")
    return target


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=DEFAULT_DEST, help=f"dataset folder (default {DEFAULT_DEST})")
    ap.add_argument("--dry-run", action="store_true", help="list what would be downloaded, write nothing")
    ap.add_argument("--limit", type=int, help="only process the first N selected files (for testing)")
    ap.add_argument("--url", default=ZIP_URL, help=argparse.SUPPRESS)
    ap.add_argument("--annotation-url", default=ANNOTATION_URL, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.limit is not None and args.limit < 1:
        ap.error("--limit must be at least 1")

    dest_raw = Path(args.dest) / "raw"
    ctx = make_ssl_context()

    print(f"reading table of contents: {args.url}")
    zf = zipfile.ZipFile(HttpRangeFile(args.url, ctx))
    members = select_members(zf.infolist())
    if not members:
        print("ERROR: no members matched the selection; zip layout may have changed", file=sys.stderr)
        return 1
    for info in members:
        safe_member_path(dest_raw, info.filename)   # fail fast before downloading anything
    if args.limit:
        members = members[:args.limit]

    total = sum(i.file_size for i in members)
    print(f"selected {len(members)} files, {total / 1e9:.2f} GB -> {dest_raw}")
    if args.dry_run:
        for prefix in SELECTED_PREFIXES:
            group = [i for i in members if i.filename.startswith(prefix)]
            print(f"  {len(group):4d} files  {sum(i.file_size for i in group) / 1e9:6.2f} GB  {prefix}")
        return 0

    dest_raw.mkdir(parents=True, exist_ok=True)
    download_annotations(dest_raw, ctx, args.annotation_url)

    fetched_bytes, started, failures = 0, time.time(), []
    for n, info in enumerate(members, 1):
        target = safe_member_path(dest_raw, info.filename)
        label = f"[{n}/{len(members)}] {info.filename.removeprefix('UCF_Crimes/')}"
        if is_already_done(info, target):
            print(f"skip (ok)  {label}")
            continue
        t0 = time.time()
        try:
            extract_member(zf, info, target)
        except (IOError, OSError, zipfile.BadZipFile) as e:
            print(f"FAILED     {label}: {e}", file=sys.stderr)
            failures.append(info.filename)
            continue
        fetched_bytes += info.compress_size
        rate = info.compress_size / max(time.time() - t0, 1e-6) / 1e6
        print(f"done       {label}  ({info.file_size / 1e6:.1f} MB, {rate:.1f} MB/s)")

    if failures:
        print(f"\n{len(failures)} file(s) failed; re-run the same command to retry them:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    print(f"\nall {len(members)} files present and verified in {dest_raw} "
          f"({fetched_bytes / 1e9:.2f} GB fetched in {time.time() - started:.0f}s)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrupted; partial file removed. Re-run the same command to continue.", file=sys.stderr)
        sys.exit(130)
