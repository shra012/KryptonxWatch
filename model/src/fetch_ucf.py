"""Fetch selected files from the official UCF-Crime zip without downloading all of it.

The archive is ~103 GB. This reads its central directory over HTTP range requests
and extracts only the requested members, verifying each file's CRC-32 from the zip.

The UCF server does not send its intermediate certificate, so TLS verification uses
the system CA bundle plus model/certs/incommon-rsa-ov-ssl-ca-3.pem (verification stays on).

Examples:
  python3 model/src/fetch_ucf.py --classes Robbery --list
  python3 model/src/fetch_ucf.py --classes Shoplifting --out /data/ucf-crime/raw
"""

import argparse
import io
import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import certifi
import requests

URL = "https://www.crcv.ucf.edu/data1/chenchen/UCF_Crimes.zip"
INTERMEDIATE = Path(__file__).resolve().parent.parent / "certs" / "incommon-rsa-ov-ssl-ca-3.pem"
CHUNK = 8 * 1024 * 1024


class HttpRangeFile(io.RawIOBase):
    """Seekable read-only file backed by HTTP range requests."""

    def __init__(self, url: str, session: requests.Session, retries: int = 5):
        self.url, self.session, self.retries, self.pos = url, session, retries, 0
        r = self._get(0, 0)
        self.size = int(r.headers["Content-Range"].rsplit("/", 1)[1])

    def _get(self, start: int, end: int) -> requests.Response:
        for attempt in range(self.retries):
            try:
                r = self.session.get(self.url, headers={"Range": f"bytes={start}-{end}"}, timeout=120)
                if r.status_code != 206:
                    raise IOError(f"expected 206 Partial Content, got {r.status_code}")
                if len(r.content) != end - start + 1:
                    raise IOError(f"short read: {len(r.content)} of {end - start + 1} bytes")
                return r
            except (requests.RequestException, IOError) as e:
                if attempt == self.retries - 1:
                    raise
                wait = 2 ** attempt
                print(f"retry {attempt + 1}/{self.retries} in {wait}s: {e}", file=sys.stderr)
                time.sleep(wait)
        raise AssertionError("unreachable")

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = max(0, base + offset)
        return self.pos

    def readinto(self, buffer) -> int:
        if self.pos >= self.size or len(buffer) == 0:
            return 0
        end = min(self.pos + len(buffer), self.size) - 1
        data = self._get(self.pos, end).content
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)


def ca_bundle() -> str:
    """System/certifi roots plus the intermediate the UCF server omits."""
    bundle = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
    bundle.write(Path(certifi.where()).read_text())
    bundle.write("\n" + INTERMEDIATE.read_text())
    bundle.close()
    return bundle.name


def select(members: list[zipfile.ZipInfo], classes: list[str]) -> list[zipfile.ZipInfo]:
    wanted = tuple(f"/Videos/{c}/" for c in classes)
    return [m for m in members if not m.is_dir() and any(w in "/" + m.filename for w in wanted)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--classes", nargs="+", required=True,
                    help="Video folders to fetch, e.g. Robbery Training_Normal_Videos_Anomaly")
    ap.add_argument("--out", type=Path, help="Destination root (member paths are kept, e.g. UCF_Crimes/Videos/...)")
    ap.add_argument("--list", action="store_true", help="Only list matching files and total size")
    args = ap.parse_args()
    if not args.list and not args.out:
        ap.error("--out is required unless --list is given")

    session = requests.Session()
    session.verify = ca_bundle()
    remote = io.BufferedReader(HttpRangeFile(URL, session), buffer_size=1024 * 1024)
    print(f"reading table of contents: {URL}")
    zf = zipfile.ZipFile(remote)
    chosen = select(zf.infolist(), args.classes)
    total = sum(m.file_size for m in chosen)
    print(f"selected {len(chosen)} files, {total / 1e9:.2f} GB for classes {', '.join(args.classes)}")
    if not chosen:
        print("no matching files; check the class folder names", file=sys.stderr)
        return 1
    if args.list:
        for m in chosen:
            print(f"{m.file_size / 1e6:9.1f} MB  {m.filename}")
        return 0

    started, fetched = time.time(), 0
    for i, m in enumerate(chosen, 1):
        target = args.out / m.filename
        if target.exists() and target.stat().st_size == m.file_size:
            print(f"skip (ok)  [{i}/{len(chosen)}] {m.filename}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".part")
        t0 = time.time()
        # zipfile raises BadZipFile on CRC mismatch when the member is fully read.
        with zf.open(m) as src, open(partial, "wb") as dst:
            shutil.copyfileobj(src, dst, CHUNK)
        os.replace(partial, target)
        fetched += m.file_size
        rate = m.file_size / 1e6 / max(time.time() - t0, 1e-6)
        print(f"done       [{i}/{len(chosen)}] {m.filename}  ({m.file_size / 1e6:.1f} MB, {rate:.1f} MB/s)", flush=True)

    missing = [m.filename for m in chosen if (args.out / m.filename).stat().st_size != m.file_size]
    if missing:
        print(f"{len(missing)} files have the wrong size: {missing[:5]}", file=sys.stderr)
        return 1
    print(f"\nall {len(chosen)} files present and verified in {args.out} "
          f"({fetched / 1e9:.2f} GB fetched in {time.time() - started:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
