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
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
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

    for kind in kinds:
        files = files_for(kind, removed)
        groups = shards(files, limit)
        total = sum(p.stat().st_size for p in files)
        print(f"{kind}: {len(files)} files, {total / (1 << 30):.1f} GiB -> {len(groups)} shard(s)", flush=True)
        if args.dry_run:
            continue
        for i, group in enumerate(groups):
            name = f"{kind}-{i:03d}.tar"
            dest = args.out / name
            prev = manifest["shards"].get(name)
            if prev and dest.exists() and dest.stat().st_size == prev["bytes"] and prev["files"] == len(group):
                print(f"  {name}: already packed", flush=True)
                continue
            with tempfile.NamedTemporaryFile("w", delete=False, suffix=".lst") as lst:
                lst.write("\n".join(str(p.relative_to(REPO)) for p in group) + "\n")
            tmp = dest.with_suffix(".tar.partial")
            try:
                subprocess.run(["tar", "-cf", str(tmp), "-C", str(REPO), "-T", lst.name], check=True)
            finally:
                os.unlink(lst.name)
            tmp.rename(dest)
            manifest["shards"][name] = {"kind": kind, "files": len(group), "bytes": dest.stat().st_size,
                                        "sha256": sha256(dest)}
            manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
            print(f"  {name}: {len(group)} files, {dest.stat().st_size / (1 << 30):.2f} GiB", flush=True)

    if not args.dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
        print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
