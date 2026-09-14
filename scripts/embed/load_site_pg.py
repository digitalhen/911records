#!/usr/bin/env python3
"""load_site_pg.py — load data/site/site.sqlite into the central Postgres, for the app's two HA
hosts. site.sqlite (build_site_db.py) stays the local intermediate / dev source of truth for the
schema; this script is a pure copy of it into Postgres, plus one extra table Postgres alone holds:

  page_text(doc, page, text, source, PRIMARY KEY(doc,page))

built straight from data/text/**/<bates>.pages.jsonl (source='pdftotext') and, for a page whose
site.sqlite `pages.ocr_status='empty'`, overridden by data/text/**/<bates>.ocr.jsonl when that
file has a line for the page (source='ours') — see docs/briefs/A1-render-boxes-ocr.md. The app
reads page text from Postgres so both hosts see the same thing; site.sqlite has no text column.

Build-then-swap, like build_site_db.py, but at the schema level: every table is created and
COPY-loaded into a fresh `site_new` schema, indexed there, and only then swapped in — in ONE
transaction: `site` -> `site_old`, `site_new` -> `site`, grant SELECT on the new `site` to
sept11_ro (ALTER DEFAULT PRIVILEGES only covers `public`, so this grant is redone on every swap),
drop `site_old`. A reader never sees a half-loaded schema.

Connection: database `sept11`, host/port/user default to the central Homebrew Postgres
(127.0.0.1:5433, user sept11, the schema owner) — credentials come from ~/.pgpass via libpq;
**no password is ever read, held or written by this script.** Override with the standard
PGHOST / PGPORT / PGUSER / PGDATABASE env vars.

COPY (psycopg3's Copy, one row at a time via write_row — text-protocol, adapted the same way a
parameterised query would be) is the fast path for the big tables; loading currently takes well
under a minute for the corpus mirrored so far and is expected to take a few minutes at the full
24k-document / 172k-page scale, per the brief.

Usage: .venv/bin/python scripts/embed/load_site_pg.py [--site data/site/site.sqlite]
Requires: pip install "psycopg[binary]" into .venv (already done in this repo's .venv).
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parents[2]
TEXT_DIR = REPO / "data" / "text"
SITE_SQLITE = REPO / "data" / "site" / "site.sqlite"
RO_ROLE = "sept11_ro"

PG_CONN = dict(
    host=os.environ.get("PGHOST", "127.0.0.1"),
    port=os.environ.get("PGPORT", "5433"),
    user=os.environ.get("PGUSER", "sept11"),
    dbname=os.environ.get("PGDATABASE", "sept11"),
)

# (sqlite table -> [(column, pg_type), ...]); order matches build_site_db.py's SCHEMA exactly.
# `cross` is quoted everywhere (it's a reserved word in Postgres, ordinary in SQLite).
TABLES: dict[str, list[tuple[str, str]]] = {
    "documents": [
        ("doc", "TEXT"), ("bates_end", "TEXT"), ("agency", "TEXT"), ("source", "TEXT"),
        ("volume", "TEXT"), ("box", "TEXT"), ("folder", "TEXT"), ("page_count", "INTEGER"),
        ("pdf_size", "BIGINT"), ("status", "TEXT"), ("first_seen", "DATE"), ("removed_at", "DATE"),
        ("reappeared_at", "DATE"), ("changed_at", "DATE"), ("changed_fields", "JSONB"),
        ("held_locally", "BOOLEAN"), ("pages_ok", "INTEGER"), ("pages_empty", "INTEGER"),
        ("pages_ocr", "INTEGER"), ("topic", "INTEGER"), ("n_related_cross", "INTEGER"),
        ("official_url", "TEXT"),
    ],
    "pages": [
        ("doc", "TEXT"), ("page", "INTEGER"), ("bates", "TEXT"), ("chars", "INTEGER"),
        ("ocr_status", "TEXT"), ("ocr_source", "TEXT"), ("image_ready", "BOOLEAN"),
    ],
    "snapshots": [
        ("date", "DATE"), ("documents", "INTEGER"), ("pages", "INTEGER"), ("bytes", "BIGINT"),
        ("added", "INTEGER"), ("removed", "INTEGER"), ("changed", "INTEGER"), ("sha256", "TEXT"),
    ],
    "changes": [("date", "DATE"), ("doc", "TEXT"), ("kind", "TEXT"), ("fields", "JSONB")],
    "entities": [
        ("id", "TEXT"), ("type", "TEXT"), ("slug", "TEXT"), ("label", "TEXT"), ("n_docs", "INTEGER"),
        ("n_pages", "INTEGER"), ("first_date", "DATE"), ("last_date", "DATE"), ("variants", "JSONB"),
        ("bbl", "TEXT"), ("bin", "TEXT"), ("method", "TEXT"),
    ],
    "entity_pages": [
        ("entity_id", "TEXT"), ("doc", "TEXT"), ("page", "INTEGER"), ("role", "TEXT"),
        ("confidence", "DOUBLE PRECISION"), ("raw", "TEXT"),
    ],
    "signatories": [
        ("id", "TEXT"), ("slug", "TEXT"), ("name", "TEXT"), ("title", "TEXT"), ("org", "TEXT"),
        ("n_docs", "INTEGER"), ("first_date", "DATE"), ("last_date", "DATE"),
    ],
    "signatory_pages": [
        ("id", "TEXT"), ("doc", "TEXT"), ("page", "INTEGER"), ("action", "TEXT"),
        ("confidence", "DOUBLE PRECISION"),
    ],
    "related": [
        ("doc", "TEXT"), ("rank", "INTEGER"), ("other", "TEXT"), ("score", "DOUBLE PRECISION"),
        ("cross", "BOOLEAN"),
    ],
    "near_dupes": [("doc", "TEXT"), ("other", "TEXT"), ("score", "DOUBLE PRECISION")],
    "topics": [
        ("id", "INTEGER"), ("parent", "INTEGER"), ("label", "TEXT"), ("size_docs", "INTEGER"),
        ("size_pages", "INTEGER"), ("terms", "JSONB"), ("boxes", "JSONB"), ("agencies", "JSONB"),
    ],
    "doc_topics": [("doc", "TEXT"), ("topic", "INTEGER"), ("prob", "DOUBLE PRECISION")],
    "places": [
        ("id", "TEXT"), ("kind", "TEXT"), ("key", "TEXT"), ("label", "TEXT"), ("n_docs", "INTEGER"),
        ("n_pages", "INTEGER"), ("n_test_pages", "INTEGER"), ("first_date", "DATE"),
        ("last_date", "DATE"), ("lat", "DOUBLE PRECISION"), ("lon", "DOUBLE PRECISION"),
    ],
    "place_pages": [
        ("place_id", "TEXT"), ("doc", "TEXT"), ("page", "INTEGER"), ("has_test", "BOOLEAN"),
        ("contaminants", "JSONB"), ("units", "JSONB"), ("dates", "JSONB"), ("labs", "JSONB"),
        ("confidence", "DOUBLE PRECISION"),
    ],
    "building_facts": [
        ("bbl", "TEXT"), ("bin", "TEXT"), ("year_built", "INTEGER"), ("num_floors", "DOUBLE PRECISION"),
        ("units_res", "INTEGER"), ("units_total", "INTEGER"), ("bldg_area", "BIGINT"),
        ("bldg_class", "TEXT"), ("num_bldgs", "INTEGER"), ("source", "TEXT"),
    ],
    "meta": [("key", "TEXT"), ("value", "TEXT")],
}
BOOL_COLUMNS = {"held_locally", "image_ready", "cross", "has_test"}
PRIMARY_KEYS = {
    "documents": ["doc"], "pages": ["doc", "page"], "snapshots": ["date"], "entities": ["id"],
    "signatories": ["id"], "topics": ["id"], "places": ["id"], "meta": ["key"],
    "page_text": ["doc", "page"], "building_facts": ["bbl"],
}
PAGE_TEXT_COLUMNS = [("doc", "TEXT"), ("page", "INTEGER"), ("text", "TEXT"), ("source", "TEXT")]

INDEX_STATEMENTS = [
    'CREATE INDEX documents_status ON site_new.documents(status)',
    'CREATE INDEX documents_volume ON site_new.documents(volume)',
    'CREATE INDEX documents_agency ON site_new.documents(agency)',
    'CREATE INDEX documents_topic ON site_new.documents(topic)',
    'CREATE INDEX pages_doc ON site_new.pages(doc)',
    'CREATE INDEX pages_bates ON site_new.pages(bates)',
    'CREATE INDEX changes_date ON site_new.changes(date)',
    'CREATE INDEX changes_doc ON site_new.changes(doc)',
    'CREATE UNIQUE INDEX entities_type_slug_unique ON site_new.entities(type, slug)',
    'CREATE INDEX entity_pages_entity ON site_new.entity_pages(entity_id)',
    'CREATE INDEX entity_pages_doc ON site_new.entity_pages(doc)',
    'CREATE UNIQUE INDEX signatories_slug_unique ON site_new.signatories(slug)',
    'CREATE INDEX signatory_pages_id ON site_new.signatory_pages(id)',
    'CREATE INDEX signatory_pages_doc ON site_new.signatory_pages(doc)',
    'CREATE INDEX related_doc ON site_new.related(doc)',
    'CREATE INDEX related_other ON site_new.related(other)',
    'CREATE INDEX near_dupes_doc ON site_new.near_dupes(doc)',
    'CREATE INDEX near_dupes_other ON site_new.near_dupes(other)',
    'CREATE INDEX doc_topics_doc ON site_new.doc_topics(doc)',
    'CREATE INDEX doc_topics_topic ON site_new.doc_topics(topic)',
    'CREATE INDEX places_kind_key ON site_new.places(kind, key)',
    'CREATE INDEX place_pages_place ON site_new.place_pages(place_id)',
    'CREATE INDEX place_pages_doc ON site_new.place_pages(doc)',
    'CREATE INDEX page_text_doc ON site_new.page_text(doc)',
    'CREATE INDEX building_facts_bin ON site_new.building_facts(bin)',
    'CREATE INDEX entities_bbl ON site_new.entities(bbl)',
]


def col_ident(name: str) -> str:
    return f'"{name}"' if name in ("cross",) else name


def create_table_sql(table: str, columns: list[tuple[str, str]]) -> str:
    cols_sql = ", ".join(f"{col_ident(c)} {t}" for c, t in columns)
    pk = PRIMARY_KEYS.get(table)
    pk_sql = f", PRIMARY KEY({', '.join(col_ident(c) for c in pk)})" if pk else ""
    return f"CREATE TABLE site_new.{table} ({cols_sql}{pk_sql})"


def load_table(pg_cur, sqlite_con: sqlite3.Connection, table: str, columns: list[tuple[str, str]]) -> int:
    names = [c for c, _ in columns]
    bool_idx = {i for i, (c, _) in enumerate(columns) if c in BOOL_COLUMNS}
    sel = ", ".join(names)
    cols_sql = ", ".join(col_ident(c) for c in names)
    n = 0
    with pg_cur.copy(f"COPY site_new.{table} ({cols_sql}) FROM STDIN") as copy:
        for row in sqlite_con.execute(f"SELECT {sel} FROM {table}"):
            row = tuple(
                (None if v is None else bool(v)) if i in bool_idx else v for i, v in enumerate(row)
            )
            copy.write_row(row)
            n += 1
    return n


def page_text_rows(ocr_status: dict[tuple[str, int], str]):
    """(doc, page, text, source) — pdftotext by default, tesseract OCR ('ours') when the page's
    status is 'empty' and a matching data/text/**/<bates>.ocr.jsonl line exists (A1's ocr_pages.py;
    may not exist yet for any document — nothing here breaks if it never has a match)."""
    for f in sorted(TEXT_DIR.rglob("*.pages.jsonl")):
        doc = f.name[: -len(".pages.jsonl")]
        ocr_path = f.with_name(f"{doc}.ocr.jsonl")
        ocr_map: dict[int, str] = {}
        if ocr_path.exists():
            for line in ocr_path.open():
                if not line.strip():
                    continue
                r = json.loads(line)
                ocr_map[int(r["page"])] = r.get("text") or ""
        for line in f.open():
            if not line.strip():
                continue
            row = json.loads(line)
            page = int(row["page"])
            text = row.get("text") or ""
            source = "pdftotext"
            if ocr_status.get((doc, page)) == "empty" and page in ocr_map:
                text, source = ocr_map[page], "ours"
            yield (doc, page, text, source)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default=str(SITE_SQLITE))
    args = ap.parse_args()
    site_path = Path(args.site)
    if not site_path.exists():
        print(f"error: {site_path} does not exist — run build_site_db.py first", file=sys.stderr)
        return 1

    t0 = time.time()
    sconn = sqlite3.connect(f"file:{site_path}?mode=ro", uri=True)
    ocr_status = {(d, p): s for d, p, s in sconn.execute("SELECT doc, page, ocr_status FROM pages")}

    conn = psycopg.connect(**PG_CONN, autocommit=True)
    cur = conn.cursor()

    cur.execute("DROP SCHEMA IF EXISTS site_new CASCADE; CREATE SCHEMA site_new;")
    for table, columns in TABLES.items():
        cur.execute(create_table_sql(table, columns))
    cur.execute(create_table_sql("page_text", PAGE_TEXT_COLUMNS))

    counts: dict[str, int] = {}
    for table, columns in TABLES.items():
        counts[table] = load_table(cur, sconn, table, columns)

    n = 0
    with cur.copy('COPY site_new.page_text (doc, page, text, source) FROM STDIN') as copy:
        for row in page_text_rows(ocr_status):
            copy.write_row(row)
            n += 1
    counts["page_text"] = n
    sconn.close()

    for stmt in INDEX_STATEMENTS:
        cur.execute(stmt)

    # ---- build-then-swap, at the schema level, in one transaction ----
    with conn.transaction():
        had_site = cur.execute(
            "SELECT 1 FROM pg_namespace WHERE nspname = 'site'").fetchone() is not None
        if had_site:
            cur.execute("ALTER SCHEMA site RENAME TO site_old")
        cur.execute("ALTER SCHEMA site_new RENAME TO site")
        cur.execute("GRANT USAGE ON SCHEMA site TO " + RO_ROLE)
        cur.execute("GRANT SELECT ON ALL TABLES IN SCHEMA site TO " + RO_ROLE)
        if had_site:
            cur.execute("DROP SCHEMA site_old CASCADE")

    conn.close()
    summary = {"pg": {k: v for k, v in PG_CONN.items()}, "seconds": round(time.time() - t0, 2),
               "counts": counts}
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
