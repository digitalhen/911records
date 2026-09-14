#!/usr/bin/env python3
"""export_prospect_gazetteer.py — ONE-TIME operator-run export of Prospect's property roll as a
gazetteer for address canonicalisation (issue #19, Henry's instruction 2026-09-14: "a definitive
list of all possible properties in lower Manhattan").

**This is the ONLY place in this repo that talks to the `prospect` Postgres database.** Nothing
under scripts/ or web/ connects to it at run time — Henry's explicit instruction is that
prospect.nyc must never be built into the live product. Run this by hand whenever the roll gazetteer
needs refreshing; the pipeline (entities.py --canonicalise, build_site_db.py) reads only the CSV
this writes, data/embed/gazetteer-prospect.csv, which travels with the repo's data/ like any other derived
file (gitignored, not committed, but present on disk for the pipeline to read).

Connects read-only as `prospect_ro` to the central Postgres (127.0.0.1:5433 db `prospect`,
credentials from ~/.pgpass via libpq — never read, held or written here) and sets a 30s
statement_timeout, per Henry's instruction, so a slow query aborts rather than holding a connection
against a production database this repo does not own.

Scope: properties whose zip_code is one of the nine lower-Manhattan ZIPs Henry named (10004, 10005,
10006, 10007, 10038, 10013, 10280, 10282, 10048) — a `bbox south of Canal Street` was the stated
alternative but the ZIP list is exact and reproducible where the bbox is fuzzy at the edges, so this
script uses ZIPs only (documented here rather than silently choosing).

One row per BBL (`properties` carries many rows per BBL — condo/co-op units, DOF's TC1/TC2/AVROLL
duplicates of the same lot); the base building-level row is picked by source_file priority (AVROLL >
TC1 > TC2 > acris_units > listing_units — the first two are DOF's own roll, the co-op/listing rows
are synthetic per-unit rows this repo has no use for). BIN comes from `unit_bridge.billing_bbl`
(lowest BIN kept when a BBL spans multiple buildings, e.g. a superblock — the CSV has one bin column,
noted below). Building facts come from `pluto_lots`, joined on bbl.

**Not exported: lot_area, land_use.** Henry/the brief asked for them but Prospect's `pluto_lots`
table (the only PLUTO-derived table in its schema) has no `lotarea` or `landuse` column — checked
`\\d pluto_lots` and grepped information_schema.columns repo-wide for `%lotarea%`/`%landuse%`, zero
hits. Nothing here fabricates them; the columns are simply absent from the CSV and from
`building_facts` downstream. If Prospect ever imports full PLUTO, re-run this and add them.

Usage: .venv/bin/python scripts/embed/export_prospect_gazetteer.py [--out data/embed/gazetteer-prospect.csv]
Requires: .venv already has psycopg[binary] (used by load_site_pg.py).
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import canonical  # normalize_street() — pre-normalise the roll's street_name into the CSV

REPO = Path(__file__).resolve().parents[2]
OUT_PATH = REPO / "data" / "embed" / "gazetteer-prospect.csv"

ZIPS = ["10004", "10005", "10006", "10007", "10038", "10013", "10280", "10282", "10048"]

# Deliberately PROSPECT_PG* rather than the plain PGHOST/PGPORT/PGUSER/PGDATABASE load_site_pg.py
# uses for the sept11 database — same variable names on the same host, on a database this script
# is the only thing here allowed to touch, is exactly the mistake an operator's shell history could
# make (`PGDATABASE=prospect` left set, then a later `load_site_pg.py` run targets the wrong db).
PG_CONN = dict(
    host=os.environ.get("PROSPECT_PGHOST", "127.0.0.1"),
    port=os.environ.get("PROSPECT_PGPORT", "5433"),
    user=os.environ.get("PROSPECT_PGUSER", "prospect_ro"),
    dbname=os.environ.get("PROSPECT_PGDATABASE", "prospect"),
)

QUERY = """
WITH base AS (
  SELECT DISTINCT ON (p.bbl)
    p.bbl, p.housenum_lo, p.street_name, p.zip_code
  FROM properties p
  WHERE p.zip_code = ANY(%(zips)s) AND p.housenum_lo IS NOT NULL AND p.street_name IS NOT NULL
  ORDER BY p.bbl,
    CASE p.source_file
      WHEN 'AVROLL' THEN 0 WHEN 'TC1' THEN 1 WHEN 'TC2' THEN 2
      WHEN 'acris_units' THEN 3 WHEN 'listing_units' THEN 4 ELSE 5
    END
),
bin_pick AS (
  SELECT DISTINCT ON (billing_bbl) billing_bbl AS bbl, bin
  FROM unit_bridge
  WHERE bin IS NOT NULL
  ORDER BY billing_bbl, bin
)
SELECT b.bbl, bp.bin, b.housenum_lo, b.street_name, b.zip_code,
       pl.yearbuilt, pl.numfloors, pl.unitsres, pl.unitstotal, pl.bldgarea, pl.bldgclass, pl.numbldgs
FROM base b
LEFT JOIN bin_pick bp ON bp.bbl = b.bbl
LEFT JOIN pluto_lots pl ON pl.bbl = b.bbl
ORDER BY b.bbl;
"""

CSV_HEADER = [
    "bbl", "bin", "housenum", "street_canonical", "zip",
    "year_built", "num_floors", "units_res", "units_total", "bldg_area", "bldg_class", "num_bldgs",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT_PATH))
    args = ap.parse_args()
    out_path = Path(args.out)

    conn = psycopg.connect(**PG_CONN, autocommit=True)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '30s'")
    cur.execute(QUERY, {"zips": ZIPS})
    rows = cur.fetchall()
    conn.close()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    n_bin = n_pluto = 0
    with out_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(CSV_HEADER)
        for bbl, bin_, housenum, street_name, zip_code, yearbuilt, numfloors, unitsres, unitstotal, bldgarea, bldgclass, numbldgs in rows:
            street_canonical = canonical.normalize_street(street_name)
            if bin_ is not None:
                n_bin += 1
            if yearbuilt is not None:
                n_pluto += 1
            w.writerow([bbl, bin_ or "", housenum, street_canonical, zip_code or "",
                        yearbuilt or "", numfloors or "", unitsres or "", unitstotal or "",
                        bldgarea or "", bldgclass or "", numbldgs or ""])

    print(f"wrote {out_path}: {len(rows)} BBLs, {n_bin} with a BIN, {n_pluto} with pluto_lots building facts, "
          f"zips={ZIPS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
