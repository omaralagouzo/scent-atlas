"""Build the slim, deployable catalog:  data/deploy/catalog.db  and  data/deploy/catalog.db.gz

    python pipeline/make_deploy_db.py [--src data/master.db] [--out data/deploy] [--max-mb 50]

Only what the web app reads is kept:
  * perfumes: no `sources`; `image_url` only when it is NOT the standard Fragrantica pattern
    (the app derives https://fimgs.net/mdimg/perfume/375x500.<fragrantica_id>.jpg itself).
    `perfumers` (JSON array) IS kept: the catalog builds its in-memory perfumer index (filter + facet on the
    Combine / note / pyramid pages) from it at load; `country` and `accords` feed the other facets.
  * notes: `image_local` is dropped (no image files ship), `image_remote` is the hotlink URL
    (Fragrantica t.<id>.jpg thumbnail, or a Wikimedia thumbnail), `image_credit` the licence line for
    the few Wikipedia/Commons images
  * brand_tags / perfume_dupes / perfume_dupe_status (written by pipeline/tagging/merge_tags.py) are copied as they are when
    the source has them; the catalog turns them into bitmasks + link arrays at load and reads notes / sources lazily
  * perfume_notes: WITHOUT ROWID table (no second copy of the key in an auto-index), no extra indexes
The gzip is written deterministically (mtime=0) so an unchanged catalog gives a byte-identical file in git.
"""
from __future__ import annotations

import argparse
import gzip
import os
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))
import remote_images  # noqa: E402

SCHEMA = """
CREATE TABLE perfumes (
  id INTEGER PRIMARY KEY, fragrantica_id INTEGER, name TEXT NOT NULL, brand TEXT NOT NULL, year INTEGER,
  gender TEXT, country TEXT, rating REAL, rating_count INTEGER, url TEXT, image_url TEXT,
  perfumers TEXT, accords TEXT
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, family TEXT,
  perfume_count INTEGER NOT NULL DEFAULT 0, image_local TEXT, image_remote TEXT, image_credit TEXT
);
CREATE TABLE perfume_notes (
  perfume_id INTEGER NOT NULL, note_id INTEGER NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('top','middle','base','general')),
  position INTEGER,
  PRIMARY KEY (perfume_id, note_id, layer)
) WITHOUT ROWID;
"""


TAG_SCHEMA = """
CREATE TABLE brand_tags (
  brand TEXT PRIMARY KEY, tags TEXT NOT NULL, dupe_style TEXT, origin_country TEXT, parent_company TEXT,
  confidence TEXT, inferred INTEGER NOT NULL DEFAULT 0, notes TEXT, sources TEXT
);
CREATE TABLE perfume_dupes (
  perfume_id INTEGER NOT NULL, target_id INTEGER NOT NULL, confidence TEXT NOT NULL, basis TEXT NOT NULL,
  sources TEXT, rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (perfume_id, target_id)
) WITHOUT ROWID;
CREATE INDEX idx_perfume_dupes_target ON perfume_dupes(target_id);
CREATE TABLE perfume_dupe_status (perfume_id INTEGER PRIMARY KEY, is_original INTEGER NOT NULL, notes TEXT);
"""


def build(src: Path, out_dir: Path, max_mb: float = 50.0) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    db, gz = out_dir / "catalog.db", out_dir / "catalog.db.gz"
    for p in (db, gz):
        if p.exists():
            p.unlink()
    con = sqlite3.connect(db)
    con.execute("PRAGMA journal_mode=OFF")
    con.execute("PRAGMA synchronous=OFF")
    con.executescript(SCHEMA)
    con.execute("ATTACH DATABASE ? AS src", (str(src),))

    con.execute(
        "INSERT INTO perfumes SELECT id, fragrantica_id, name, brand, year, gender, country, rating, rating_count,"
        " url, CASE WHEN image_url = 'https://fimgs.net/mdimg/perfume/375x500.' || fragrantica_id || '.jpg'"
        " THEN NULL ELSE image_url END, perfumers, accords FROM src.perfumes ORDER BY id"
    )
    rows = con.execute("SELECT id, slug, name, family, perfume_count, image_source FROM src.notes ORDER BY id").fetchall()
    con.executemany(
        "INSERT INTO notes(id, slug, name, family, perfume_count, image_local, image_remote, image_credit)"
        " VALUES (?,?,?,?,?,NULL,?,?)",
        [(i, slug, name, fam, cnt, remote_images.note_remote_url(srcurl), remote_images.note_credit(srcurl))
         for i, slug, name, fam, cnt, srcurl in rows],
    )
    con.execute(
        "INSERT INTO perfume_notes SELECT perfume_id, note_id, layer, position FROM src.perfume_notes"
        " ORDER BY perfume_id, note_id, layer"
    )
    have = {r[0] for r in con.execute("SELECT name FROM src.sqlite_master WHERE type='table'")}
    has_tags = {"brand_tags", "perfume_dupes", "perfume_dupe_status"} <= have
    if has_tags:
        con.executescript(TAG_SCHEMA)
        con.execute("INSERT INTO brand_tags SELECT brand, tags, dupe_style, origin_country, parent_company, confidence,"
                    " inferred, notes, sources FROM src.brand_tags ORDER BY brand")
        con.execute("INSERT INTO perfume_dupes SELECT perfume_id, target_id, confidence, basis, sources, rank"
                    " FROM src.perfume_dupes WHERE perfume_id IN (SELECT id FROM perfumes) AND target_id IN (SELECT id FROM perfumes)"
                    " ORDER BY perfume_id, rank")
        con.execute("INSERT INTO perfume_dupe_status SELECT perfume_id, is_original, notes FROM src.perfume_dupe_status"
                    " WHERE perfume_id IN (SELECT id FROM perfumes) ORDER BY perfume_id")
    con.commit()
    con.execute("DETACH DATABASE src")
    con.execute("PRAGMA journal_mode=DELETE")
    con.execute("VACUUM")
    con.execute("ANALYZE")
    tables = ["perfumes", "notes", "perfume_notes"] + (["brand_tags", "perfume_dupes", "perfume_dupe_status"] if has_tags else [])
    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    no_remote = con.execute("SELECT COUNT(*) FROM notes WHERE image_remote IS NULL").fetchone()[0]
    con.close()

    with open(db, "rb") as f_in, open(gz, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as f_out:
            shutil.copyfileobj(f_in, f_out, 1 << 20)
    info = {"db_mb": db.stat().st_size / 1e6, "gz_mb": gz.stat().st_size / 1e6, "counts": counts, "notes_without_remote_image": no_remote}
    if info["gz_mb"] >= max_mb:
        raise SystemExit(f"catalog.db.gz is {info['gz_mb']:.1f} MB (limit {max_mb} MB)")
    return info


def verify(out_dir: Path, src: Path):
    """Load the artifact through the real Catalog and compare headline numbers with the source."""
    from catalog import Catalog

    c = Catalog(out_dir / "catalog.db", "remote")
    s = sqlite3.connect(src)
    n_p = s.execute("SELECT COUNT(*) FROM perfumes").fetchone()[0]
    n_pn = s.execute("SELECT COUNT(*) FROM perfume_notes").fetchone()[0]
    n_pf = s.execute("SELECT COUNT(*) FROM perfumes WHERE perfumers IS NOT NULL AND perfumers NOT IN ('', '[]')").fetchone()[0]
    n_bt = s.execute("SELECT COUNT(*) FROM brand_tags").fetchone()[0] if s.execute(
        "SELECT 1 FROM sqlite_master WHERE name='brand_tags'").fetchone() else 0
    n_dl = s.execute("SELECT COUNT(*) FROM perfume_dupes").fetchone()[0] if n_bt or s.execute(
        "SELECT 1 FROM sqlite_master WHERE name='perfume_dupes'").fetchone() else 0
    s.close()
    assert c.n_perf == n_p and len(c.pn_note) == n_pn, (c.n_perf, n_p, len(c.pn_note), n_pn)
    assert (len(c.perfumer_names) > 0) == (n_pf > 0), "perfumer index is empty although the source has perfumers"
    assert int(c.p_has_perfumer.sum()) <= n_pf
    if n_bt:
        assert c.tags_loaded and int((c.p_btags != 0).sum()) > 0, "brand tags were not carried into the deploy DB"
        assert len(c.dl_target) == n_dl, (len(c.dl_target), n_dl)
    sample = c.summary(0)
    assert sample["image"].startswith("https://fimgs.net/mdimg/perfume/375x500."), sample["image"]
    return c.n_perf, c.n_notes, len(c.pn_note)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(ROOT / "data" / "master.db"))
    ap.add_argument("--out", default=str(ROOT / "data" / "deploy"))
    ap.add_argument("--max-mb", type=float, default=50.0)
    a = ap.parse_args()
    info = build(Path(a.src), Path(a.out), a.max_mb)
    print(f"catalog.db     {info['db_mb']:.1f} MB   {info['counts']}")
    print(f"catalog.db.gz  {info['gz_mb']:.1f} MB   (limit {a.max_mb:.0f} MB)")
    print(f"notes without a remote image url: {info['notes_without_remote_image']}")
    print("verified load: perfumes=%d notes=%d note_rows=%d" % verify(Path(a.out), Path(a.src)))


if __name__ == "__main__":
    main()
