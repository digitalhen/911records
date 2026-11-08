#!/usr/bin/env python3
"""pack_seed.py — pack this mirror's data into tar shards a new deployment can start from.

A deployment needs four kinds of data (docs/SELF-HOSTING.md):

  core    data/manifest.jsonl, the latest catalog snapshot, data/site/site.sqlite, data/embed/
          (page vectors, summaries, facts, entities), data/geo/, data/removed_from_portal.jsonl.
          Enough to load Postgres and build the OpenSearch index.
  text    data/text/   page text, OCR sidecars and word-box files (the reader's highlights)
  pages   data/pages/  rendered page images (.webp) and pages.json
  pdf     data/pdf/    the original PDFs and their .pdf.json sidecars

Documents the City has REMOVED from its portal (manifest status "removed", probably personal-
information takedowns) ARE packed by default (Henry, 2026-11-08: "include even removed docs"), so
the seed is a complete archive; their Bates numbers are listed in SEED-MANIFEST.json and the
manifest keeps their status, so a deployment still shows them as removed. Pass --exclude-removed
to leave their PDF, text and page images out. Superseded copies (*.superseded-*) are skipped. data/downloads/ (box ZIPs) is not packed: it is rebuilt
from the PDFs.

Shards are plain uncompressed tars (PDFs and WebP do not compress) of at most --shard-gb each,
named <kind>-NNN.tar, with paths relative to the repo root, so `tar -xf` from the repo root
restores them in place. SEED-MANIFEST.json lists every shard's size and sha256.

Nothing here contacts the network. Upload the output directory yourself (e.g. rclone to Google
Drive; see docs/SELF-HOSTING.md).

Usage:
  python3 scripts/seed/pack_seed.py --out /Volumes/Big/911records-seed [--kinds core,text,pages,pdf]
                                    [--shard-gb 4] [--dry-run] [--repo ~/Code/sept11-docs]
Re-running skips shards whose file already exists with the recorded size (resumable), so keep the
same --shard-gb between runs.

Updates (--update): once the full seed exists, later runs with --update add only what changed.
The core shards are repacked in place (same names, new sha256: about 3 GB), and every text, page
or PDF file that is new or changed since it was last packed goes into new update shards named
<kind>-u<UTC timestamp>-NNN.tar, which sort after the base shards, so extracting in name order
leaves the newest copy. The existing base shards are never rewritten, so `rclone copy` uploads
only the new shards, core and the manifest. PACKED-FILES.tsv in --out records what has been
packed (path, size, mtime); it is rebuilt from the shards' tar headers if missing.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
KINDS = ("core", "text", "pages", "pdf")


def removed_bates() -> set[str]:
    out = set()
    with open(DATA / "manifest.jsonl") as f:
        for line in f:
            r = json.loads(line)
            if r.get("status") == "removed":
                out.add(r["bates_start"])
    return out


def is_excluded(rel: Path, removed: set[str]) -> bool:
    """`removed` is empty unless --exclude-removed was passed."""
    name = rel.name
    if ".superseded-" in name or name.startswith("."):
        return True
    # data/{pdf,text}/<agency>/<volume>/<bates>.<ext...>   data/pages/<agency>/<volume>/<bates>/<n>.webp
    parts = rel.parts
    if len(parts) >= 5 and parts[1] in ("pdf", "text", "pages"):
        bates = parts[4] if parts[1] == "pages" and len(parts) >= 6 else name.split(".", 1)[0]
        return bates in removed
    return False


def latest_catalog() -> list[Path]:
    snaps = sorted(p for p in (DATA / "catalog").glob("20??-??-??*.csv"))
    if not snaps:
        return []
    last = snaps[-1]
    summary = last.with_suffix(".summary.json")
    return [last] + ([summary] if summary.exists() else [])


def files_for(kind: str, removed: set[str]) -> list[Path]:
    if kind == "core":
        roots = [DATA / "site", DATA / "embed", DATA / "geo"]
        singles = [DATA / "manifest.jsonl", DATA / "removed_from_portal.jsonl"] + latest_catalog()
        known = DATA / "catalog" / "known_removed_before_mirror.json"
        singles += [known] if known.exists() else []
    else:
        roots, singles = [DATA / kind], []
    out = [p for p in singles if p.is_file()]
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            for fn in sorted(filenames):
                p = Path(dirpath) / fn
                rel = p.relative_to(REPO)
                if not is_excluded(rel, removed) and p.is_file():
                    out.append(p)
    return out


def shards(files: list[Path], limit: int) -> list[list[Path]]:
    groups, cur, size = [], [], 0
    for p in files:
        s = p.stat().st_size
        if cur and size + s > limit:
            groups.append(cur)
            cur, size = [], 0
        cur.append(p)
        size += s
    if cur:
        groups.append(cur)
    return groups


INDEX = "PACKED-FILES.tsv"
_tar_version = subprocess.run(["tar", "--version"], capture_output=True, text=True).stdout
BSD_TAR_OPTS = ["--no-mac-metadata", "--no-xattrs"] if "bsdtar" in _tar_version else []


def stamp(p: Path) -> tuple[int, int]:
    st = p.stat()
    return st.st_size, int(st.st_mtime)


def load_index(out: Path, manifest: dict) -> dict[str, tuple[int, int]]:
    """path -> (size, mtime) of every non-core file already in a shard."""
    idx: dict[str, tuple[int, int]] = {}
    path = out / INDEX
    if path.exists():
        with open(path) as f:
            for line in f:
                rel, size, mtime = line.rstrip("\n").split("\t")
                idx[rel] = (int(size), int(mtime))
        return idx
    names = sorted(n for n, m in manifest["shards"].items() if m["kind"] != "core" and (out / n).exists())
    if names:
        print(f"building {INDEX} from the headers of {len(names)} shard(s)...", flush=True)
    for name in names:
        with tarfile.open(out / name) as tf:
            for m in tf:
                if m.isfile():
                    idx[m.name] = (m.size, int(m.mtime))
    with open(path, "w") as f:
        f.writelines(f"{rel}\t{s}\t{t}\n" for rel, (s, t) in sorted(idx.items()))
    return idx


def record(out: Path, idx: dict, group: list[Path]) -> None:
    with open(out / INDEX, "a") as f:
        for p in group:
            rel = str(p.relative_to(REPO))
            idx[rel] = stamp(p)
            f.write(f"{rel}\t{idx[rel][0]}\t{idx[rel][1]}\n")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    global REPO, DATA
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--kinds", default=",".join(KINDS))
    ap.add_argument("--shard-gb", type=float, default=4.0)
    ap.add_argument("--dry-run", action="store_true", help="print shard counts and sizes only")
    ap.add_argument("--exclude-removed", action="store_true",
                    help="leave out documents the City removed from its portal (default: include them)")
    ap.add_argument("--repo", type=Path, default=REPO, help="checkout whose data/ to pack (default: this one)")
    ap.add_argument("--update", action="store_true",
                    help="add only new/changed files as update shards and repack core (needs a full seed in --out)")
    args = ap.parse_args()
    REPO, DATA = args.repo.resolve(), args.repo.resolve() / "data"
    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    bad = [k for k in kinds if k not in KINDS]
    if bad:
        ap.error(f"unknown kind(s) {bad}; choose from {KINDS}")

    removed_all = removed_bates()
    removed = removed_all if args.exclude_removed else set()
    limit = int(args.shard_gb * (1 << 30))
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "SEED-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"shards": {}}
    manifest.update({
        "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "911records.org mirror of the NYC 9/11 Document Portal",
        "removed_from_portal": sorted(removed_all),
        "removed_documents_included": not args.exclude_removed,
        "extract": "cd <repo root> && tar -xf <shard>   (or scripts/seed/unpack_seed.sh <seed dir>)",
    })

    if args.update and not any(m["kind"] != "core" for m in manifest["shards"].values()):
        ap.error(f"--update needs an existing full seed in {args.out}; run once without --update first")
    index = load_index(args.out, manifest)
    run_stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S")

    def pack(name: str, kind: str, group: list[Path]) -> None:
        dest = args.out / name
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".lst") as lst:
            lst.write("\n".join(str(p.relative_to(REPO)) for p in group) + "\n")
        tmp = dest.with_suffix(".tar.partial")
        try:
            # Keep macOS metadata (AppleDouble ._* entries, xattr headers) out of the shards.
            subprocess.run(["tar", "-cf", str(tmp), *BSD_TAR_OPTS, "-C", str(REPO), "-T", lst.name],
                           check=True, env={**os.environ, "COPYFILE_DISABLE": "1"})
        finally:
            os.unlink(lst.name)
        tmp.rename(dest)
        manifest["shards"][name] = {"kind": kind, "files": len(group), "bytes": dest.stat().st_size,
                                    "sha256": sha256(dest), "packed": run_stamp}
        if kind != "core":
            record(args.out, index, group)
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
        print(f"  {name}: {len(group)} files, {dest.stat().st_size / (1 << 30):.2f} GiB", flush=True)

    for kind in kinds:
        files = files_for(kind, removed)
        if args.update and kind != "core":
            files = [p for p in files if index.get(str(p.relative_to(REPO))) != stamp(p)]
        groups = shards(files, limit)
        total = sum(p.stat().st_size for p in files)
        what = "new/changed files" if args.update and kind != "core" else "files"
        print(f"{kind}: {len(files)} {what}, {total / (1 << 30):.2f} GiB -> {len(groups)} shard(s)", flush=True)
        if args.dry_run:
            continue
        if args.update and kind == "core":
            # Core changes every refresh: repack it under the same names and drop any surplus.
            for name in [n for n, m in manifest["shards"].items() if m["kind"] == "core"][len(groups):]:
                manifest["shards"].pop(name)
                (args.out / name).unlink(missing_ok=True)
                print(f"  {name}: removed (core now has {len(groups)} shard(s))", flush=True)
            for i, group in enumerate(groups):
                pack(f"core-{i:03d}.tar", kind, group)
            continue
        for i, group in enumerate(groups):
            name = f"{kind}-u{run_stamp}-{i:03d}.tar" if args.update else f"{kind}-{i:03d}.tar"
            prev = manifest["shards"].get(name)
            dest = args.out / name
            if prev and dest.exists() and dest.stat().st_size == prev["bytes"] and prev["files"] == len(group):
                print(f"  {name}: already packed", flush=True)
                continue
            pack(name, kind, group)

    if not args.dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
        print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
