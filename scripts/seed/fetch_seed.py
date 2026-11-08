#!/usr/bin/env python3
"""fetch_seed.py — download a seed (pack_seed.py) from a public Google Drive folder, no account needed.

  python3 scripts/seed/fetch_seed.py <drive folder link or id> [--out ./911records-seed]
                                     [--kinds core,text,pages,pdf]

Works with a folder shared as "Anyone with the link". Reads the folder listing, downloads
SEED-MANIFEST.json, then every shard of the chosen kinds that is missing or incomplete locally,
resuming partial downloads, and checks each shard's sha256 against the manifest. Re-run it later
to pick up a seed update: shards you already have are skipped, changed ones (core) re-downloaded.
Then run scripts/seed/unpack_seed.sh <out> and scripts/seed/load_seed.sh.

Standard library only. If Drive refuses with a quota or "can't scan for viruses" page (it limits
anonymous downloads of popular large files), wait and re-run, or use rclone with your own Google
account (docs/SELF-HOSTING.md).
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "911records-seed-fetch/1"}
KINDS = ("core", "text", "pages", "pdf")


def folder_id(arg: str) -> str:
    m = re.search(r"/folders/([\w-]+)", arg) or re.search(r"[?&]id=([\w-]+)", arg)
    return m.group(1) if m else arg.strip()


def listing(fid: str) -> dict[str, str]:
    """file name -> Drive file id, from the public embedded folder view."""
    req = urllib.request.Request(f"https://drive.google.com/embeddedfolderview?id={fid}", headers=UA)
    page = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    pairs = re.findall(r'href="https://drive\.google\.com/file/d/([\w-]+)/view[^"]*".*?'
                       r'class="flip-entry-title">([^<]+)<', page, re.S)
    if not pairs:
        sys.exit("could not list the folder: is it shared as 'Anyone with the link'?")
    return {html.unescape(name).strip(): file_id for file_id, name in pairs}


def download(file_id: str, dest: Path, size: int | None = None) -> None:
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if size is not None and have > size:
        part.unlink()
        have = 0
    url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
    headers = dict(UA, **({"Range": f"bytes={have}-"} if have else {}))
    resp = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120)
    if "text/html" in resp.headers.get("Content-Type", ""):
        sys.exit(f"{dest.name}: Drive returned a web page instead of the file (download quota or "
                 "virus-scan page); wait a while and re-run, or use rclone (docs/SELF-HOSTING.md)")
    if have and resp.status != 206:  # server ignored the range: start over
        have = 0
    t0, done = time.time(), have
    with open(part, "ab" if have else "wb") as f:
        while chunk := resp.read(8 << 20):
            f.write(chunk)
            done += len(chunk)
            if size:
                rate = (done - have) / max(time.time() - t0, 1e-6) / (1 << 20)
                print(f"\r  {dest.name}: {done / (1 << 30):.2f}/{size / (1 << 30):.2f} GiB  {rate:.0f} MiB/s",
                      end="", flush=True)
    if size:
        print()
    if size is not None and part.stat().st_size != size:
        sys.exit(f"{dest.name}: got {part.stat().st_size} bytes, expected {size}; re-run to resume")
    part.replace(dest)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", help="Google Drive folder link or id")
    ap.add_argument("--out", type=Path, default=Path("911records-seed"))
    ap.add_argument("--kinds", default=",".join(KINDS))
    args = ap.parse_args()
    kinds = {k.strip() for k in args.kinds.split(",") if k.strip()}
    if bad := kinds - set(KINDS):
        ap.error(f"unknown kind(s) {sorted(bad)}; choose from {KINDS}")
    args.out.mkdir(parents=True, exist_ok=True)

    files = listing(folder_id(args.folder))
    if "SEED-MANIFEST.json" not in files:
        sys.exit("no SEED-MANIFEST.json in that folder")
    download(files["SEED-MANIFEST.json"], args.out / "SEED-MANIFEST.json")
    shards = {n: s for n, s in json.loads((args.out / "SEED-MANIFEST.json").read_text())["shards"].items()
              if s["kind"] in kinds}
    total = sum(s["bytes"] for s in shards.values())
    print(f"{len(shards)} shard(s), {total / (1 << 30):.1f} GiB for kinds {','.join(sorted(kinds))}")

    # A ".ok" marker per shard records the sha256 already verified, so re-runs skip re-hashing.
    for name, s in sorted(shards.items()):
        dest, ok = args.out / name, args.out / f".{name}.ok"
        if dest.exists() and dest.stat().st_size == s["bytes"] and ok.exists() and ok.read_text() == s["sha256"]:
            print(f"  {name}: have it")
            continue
        if name not in files:
            sys.exit(f"{name} is in the manifest but not in the folder (upload still in progress?)")
        if not (dest.exists() and dest.stat().st_size == s["bytes"]):
            download(files[name], dest, s["bytes"])
        got = sha256(dest)
        if got != s["sha256"]:
            dest.unlink()
            sys.exit(f"{name}: checksum mismatch, deleted; re-run to download it again")
        ok.write_text(got)
        print(f"  {name}: ok")
    print(f"done. Next: scripts/seed/unpack_seed.sh {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
