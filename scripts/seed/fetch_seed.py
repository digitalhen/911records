#!/usr/bin/env python3
"""fetch_seed.py — download a seed (pack_seed.py) from Google Drive, S3 or any HTTPS URL.

  python3 scripts/seed/fetch_seed.py <source> [--out ./911records-seed] [--kinds core,text,pages,pdf]
  python3 scripts/seed/fetch_seed.py <source> --extract [--kinds ...]      # straight into data/

<source> is one of
  https://drive.google.com/drive/folders/<id>   a Drive folder shared as "Anyone with the link"
                                                (no Google account needed)
  s3://bucket/prefix                            an S3 copy (credentials from the usual AWS chain:
                                                instance/task role, AWS_* env, ~/.aws; needs boto3)
  https://host/path                             any web server or CDN holding the seed files
                                                (<url>/SEED-MANIFEST.json, <url>/<shard>)

Without --extract: downloads SEED-MANIFEST.json and every shard of the chosen kinds that is
missing or incomplete in --out, resuming partial downloads, and checks each shard's sha256.
Re-run later to pick up a seed update. Then run scripts/seed/unpack_seed.sh <out>.

With --extract: for each shard not yet in data/.seed-unpacked (name and sha256, the same record
unpack_seed.sh keeps), downloads it to data/.seed-download/, verifies it, extracts it into the
repo and deletes the tar, so the extra disk needed is one shard (~4.5 GB), not the whole seed.
Prints `extracted <name>` per shard, so callers can tell whether anything changed.

Drive limits anonymous downloads of popular large files. If it serves a quota or "virus scan"
page instead of a file, this exits non-zero; wait and re-run, or copy the seed to S3 once and use
that (docs/SELF-HOSTING.md).
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import BinaryIO

UA = {"User-Agent": "911records-seed-fetch/1"}
KINDS = ("core", "text", "pages", "pdf")
REPO = Path(__file__).resolve().parents[2]


class FetchError(Exception):
    pass


class Source:
    """Opens seed files by name, optionally from a byte offset."""

    def open(self, name: str, offset: int = 0) -> tuple[BinaryIO, bool]:
        """-> (stream, resumed): resumed is False if the server ignored the offset."""
        raise NotImplementedError


class HttpSource(Source):
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def url(self, name: str) -> str:
        return f"{self.base}/{urllib.parse.quote(name)}"

    def open(self, name, offset=0):
        headers = dict(UA, **({"Range": f"bytes={offset}-"} if offset else {}))
        resp = urllib.request.urlopen(urllib.request.Request(self.url(name), headers=headers), timeout=120)
        if "text/html" in resp.headers.get("Content-Type", ""):
            raise FetchError(f"{name}: the server returned a web page instead of the file (for Drive: "
                             "download quota or virus-scan page; wait and re-run, or use an S3 copy)")
        return resp, offset > 0 and resp.status == 206


class DriveSource(HttpSource):
    def __init__(self, folder: str):
        m = re.search(r"/folders/([\w-]+)", folder) or re.search(r"[?&]id=([\w-]+)", folder)
        fid = m.group(1) if m else folder
        req = urllib.request.Request(f"https://drive.google.com/embeddedfolderview?id={fid}", headers=UA)
        page = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        pairs = re.findall(r'href="https://drive\.google\.com/file/d/([\w-]+)/view[^"]*".*?'
                           r'class="flip-entry-title">([^<]+)<', page, re.S)
        if not pairs:
            raise FetchError("could not list the Drive folder: is it shared as 'Anyone with the link'?")
        self.ids = {html.unescape(name).strip(): file_id for file_id, name in pairs}

    def url(self, name):
        if name not in self.ids:
            raise FetchError(f"{name} is not in the Drive folder (upload still in progress?)")
        return f"https://drive.usercontent.google.com/download?id={self.ids[name]}&export=download&confirm=t"


class S3Source(Source):
    def __init__(self, uri: str):
        import boto3  # only needed for s3:// sources
        u = urllib.parse.urlparse(uri)
        self.bucket, self.prefix = u.netloc, u.path.strip("/")
        self.s3 = boto3.client("s3")

    def open(self, name, offset=0):
        key = f"{self.prefix}/{name}" if self.prefix else name
        kw = {"Range": f"bytes={offset}-"} if offset else {}
        return self.s3.get_object(Bucket=self.bucket, Key=key, **kw)["Body"], offset > 0


def make_source(arg: str) -> Source:
    if arg.startswith("s3://"):
        return S3Source(arg)
    if "drive.google.com" in arg or re.fullmatch(r"[\w-]{25,}", arg):
        return DriveSource(arg)
    if arg.startswith(("http://", "https://")):
        return HttpSource(arg)
    raise FetchError(f"unrecognised seed source {arg!r}: use a Drive folder link, s3://... or https://...")


def download(src: Source, name: str, dest: Path, size: int | None = None) -> None:
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if size is not None and have > size:
        have = 0
    stream, resumed = src.open(name, have)
    if have and not resumed:
        have = 0
    t0, done, last = time.time(), have, 0.0
    with open(part, "ab" if have else "wb") as f:
        while chunk := stream.read(8 << 20):
            f.write(chunk)
            done += len(chunk)
            if size and time.time() - last > 10:
                last = time.time()
                rate = (done - have) / max(last - t0, 1e-6) / (1 << 20)
                print(f"  {name}: {done / (1 << 30):.2f}/{size / (1 << 30):.2f} GiB  {rate:.0f} MiB/s", flush=True)
    if size is not None and part.stat().st_size != size:
        raise FetchError(f"{name}: got {part.stat().st_size} bytes, expected {size}; re-run to resume")
    part.replace(dest)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


def extract(tar: Path, repo: Path) -> None:
    # Shards packed on macOS may carry AppleDouble ._* entries and xattr headers: skip / ignore them.
    opts = ["--exclude=._*"]
    if "GNU" in subprocess.run(["tar", "--version"], capture_output=True, text=True).stdout:
        opts.append("--warning=no-unknown-keyword")
    subprocess.run(["tar", "-xf", str(tar), *opts, "-C", str(repo)], check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="Drive folder link, s3://bucket/prefix or https:// base URL")
    ap.add_argument("--out", type=Path, default=Path("911records-seed"))
    ap.add_argument("--kinds", default=",".join(KINDS))
    ap.add_argument("--extract", action="store_true", help="extract each shard into the repo, then delete it")
    ap.add_argument("--repo", type=Path, default=REPO, help="checkout to extract into (with --extract)")
    args = ap.parse_args()
    kinds = {k.strip() for k in args.kinds.split(",") if k.strip()}
    if bad := kinds - set(KINDS):
        ap.error(f"unknown kind(s) {sorted(bad)}; choose from {KINDS}")

    try:
        src = make_source(args.source)
        work = args.repo / "data" / ".seed-download" if args.extract else args.out
        work.mkdir(parents=True, exist_ok=True)
        download(src, "SEED-MANIFEST.json", work / "SEED-MANIFEST.json")
        shards = {n: s for n, s in json.loads((work / "SEED-MANIFEST.json").read_text())["shards"].items()
                  if s["kind"] in kinds}
        unpacked_log = args.repo / "data" / ".seed-unpacked"
        unpacked = set(unpacked_log.read_text().splitlines()) if args.extract and unpacked_log.exists() else set()
        todo = {n: s for n, s in shards.items() if f"{n} {s['sha256']}" not in unpacked}
        need = sum(s["bytes"] for s in todo.values())
        print(f"{len(shards)} shard(s) for {','.join(sorted(kinds))}; {len(todo)} to fetch, "
              f"{need / (1 << 30):.1f} GiB", flush=True)

        # In name order: update shards (<kind>-u<timestamp>-NNN) come after base shards and win.
        for name, s in sorted(todo.items()):
            dest, ok = work / name, work / f".{name}.ok"
            if not (dest.exists() and dest.stat().st_size == s["bytes"] and ok.exists()
                    and ok.read_text() == s["sha256"]):
                if not (dest.exists() and dest.stat().st_size == s["bytes"]):
                    download(src, name, dest, s["bytes"])
                if sha256(dest) != s["sha256"]:
                    dest.unlink()
                    raise FetchError(f"{name}: checksum mismatch, deleted; re-run to download it again")
                ok.write_text(s["sha256"])
            if args.extract:
                extract(dest, args.repo)
                with open(unpacked_log, "a") as f:
                    f.write(f"{name} {s['sha256']}\n")
                dest.unlink()
                ok.unlink()
                print(f"extracted {name}", flush=True)
            else:
                print(f"  {name}: ok", flush=True)
    except FetchError as e:
        print(f"fetch_seed: {e}", file=sys.stderr)
        return 2
    if not args.extract:
        print(f"done. Next: scripts/seed/unpack_seed.sh {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
