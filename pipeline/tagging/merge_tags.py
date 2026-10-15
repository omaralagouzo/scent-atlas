"""Merge the web-research tagging files into master.db.

    python pipeline/tagging/merge_tags.py [--db data/master.db] [--out pipeline/tagging/out] [--report PATH]

Reads every  out/*.jsonl  (brand files: `{"brand": ...}` rows, perfume files: `{"perfume_id": ...}` rows; the kind is
decided per row, not per file name), validates / repairs them against master.db and (re)creates three tables
(idempotent: drop + recreate, safe to run after every new agent output file):

  brand_tags(brand TEXT PRIMARY KEY, tags TEXT JSON, dupe_style, origin_country, parent_company, confidence,
             inferred INTEGER, notes, sources TEXT JSON)
  perfume_dupes(perfume_id, target_id, confidence, basis, sources JSON, rank INTEGER, PRIMARY KEY(perfume_id, target_id))
  perfume_dupe_status(perfume_id PRIMARY KEY, is_original INTEGER, notes)

Brand rules
  * `brand` must exist in master.db exactly. A case / accent / whitespace variant that maps to ONE brand is repaired,
    anything else is dropped.
  * tags are limited to niche / designer / dupe / middle_eastern (derived tags in the input are ignored);
    dupe replaces niche + designer; niche + designer together keeps the first listed.
  * derived tags are added: middle_eastern_original = middle_eastern and not dupe, middle_eastern_dupe = middle_eastern and dupe.
  * duplicates: last writer wins (files in natural name order, `*longtail*` first so every real row overrides it,
    later lines within a file override earlier ones); an `"inferred": true` row never replaces a researched row.

Perfume rules
  * `perfume_id` must exist; each `target_id` must exist (a wrong id whose name/brand do not fit the stated
    target_name / target_brand is replaced by the unique exact name+brand match, otherwise dropped; a null id is resolved
    by exact name + brand, otherwise dropped because the table needs a target id).
  * a perfume can not be a dupe of itself or of a perfume of the same brand; a target from a brand tagged `dupe` is only kept
    with confidence `high`; two-way links (A of B and B of A) keep the better-evidenced / more-voted direction.
  * confidence / basis outside the allowed values are repaired (low / name); at most 6 originals per perfume.
  * duplicates: last writer wins per perfume. `is_original` and `dupe_of` that contradict each other resolve to the links.
  * `rank` orders the originals of one perfume: confidence, then basis (web > brand_stated > community > name), then votes.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_DB = ROOT / "data" / "master.db"
DEFAULT_OUT = HERE / "out"
DEFAULT_REPORT = HERE / "work" / "merge_report.json"

BASE_TAGS = ("niche", "designer", "dupe", "middle_eastern")
DERIVED_TAGS = ("middle_eastern_original", "middle_eastern_dupe")
ALL_TAGS = BASE_TAGS + DERIVED_TAGS
DUPE_STYLES = ("open", "unstated", "partial")
CONFIDENCE = ("high", "medium", "low")
CONF_RANK = {"high": 2, "medium": 1, "low": 0}
BASIS = ("web", "community", "name", "brand_stated")
BASIS_RANK = {"web": 3, "brand_stated": 2, "community": 1, "name": 0}
MAX_ORIGINALS = 6
MAX_SOURCES = 8

SCHEMA = """
DROP TABLE IF EXISTS brand_tags;
DROP TABLE IF EXISTS perfume_dupes;
DROP TABLE IF EXISTS perfume_dupe_status;
CREATE TABLE brand_tags (
  brand TEXT PRIMARY KEY, tags TEXT NOT NULL, dupe_style TEXT, origin_country TEXT, parent_company TEXT,
  confidence TEXT, inferred INTEGER NOT NULL DEFAULT 0, notes TEXT, sources TEXT
);
CREATE TABLE perfume_dupes (
  perfume_id INTEGER NOT NULL, target_id INTEGER NOT NULL, confidence TEXT NOT NULL, basis TEXT NOT NULL,
  sources TEXT, rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (perfume_id, target_id)
);
CREATE INDEX idx_perfume_dupes_target ON perfume_dupes(target_id);
CREATE TABLE perfume_dupe_status (perfume_id INTEGER PRIMARY KEY, is_original INTEGER NOT NULL, notes TEXT);
"""


# ----------------------------------------------------------------------------------------- helpers
def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def natural_key(p: Path):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name.lower())]


def derive_tags(tags) -> list[str]:
    """Base tags (any order) -> canonical list including the two derived middle_eastern_* tags."""
    s = set(tags)
    out = [t for t in BASE_TAGS if t in s]
    if "middle_eastern" in s:
        out.append("middle_eastern_dupe" if "dupe" in s else "middle_eastern_original")
    return out


def _str(v, limit) -> str | None:
    if v is None:
        return None
    v = " ".join(str(v).split())
    return v[:limit] if v else None


def _sources(v) -> list[str]:
    out = []
    if isinstance(v, str):
        v = [v]
    for u in v if isinstance(v, (list, tuple)) else []:
        u = str(u).strip()
        if re.match(r"^https?://\S+$", u) and len(u) <= 400 and u not in out:
            out.append(u)
    return out[:MAX_SOURCES]


def read_rows(out_dir: Path):
    """Yield (file name, line no, row) for every well-formed JSON object; files in natural order, longtail first."""
    files = sorted(Path(out_dir).glob("*.jsonl"), key=natural_key)
    files.sort(key=lambda p: 0 if "longtail" in p.name.lower() else 1)   # stable: longtail first, the rest natural
    bad = 0
    for f in files:
        with open(f, encoding="utf8", errors="replace") as fh:
            for n, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    bad += 1
                    continue
                if isinstance(row, dict):
                    yield f.name, n, row
                else:
                    bad += 1
    yield None, 0, {"__bad_lines__": bad}


# ----------------------------------------------------------------------------------------- brands
def clean_brand_row(row: dict, brand_name: str):
    tags_in = row.get("tags")
    tags_in = tags_in if isinstance(tags_in, list) else []
    seen = []
    for t in tags_in:
        t = str(t).strip().lower().replace(" ", "_").replace("-", "_")
        if t in BASE_TAGS and t not in seen:
            seen.append(t)
    repaired = []
    if "dupe" in seen and ("niche" in seen or "designer" in seen):
        seen = [t for t in seen if t not in ("niche", "designer")]
        repaired.append("dupe_replaces_niche_designer")
    if "niche" in seen and "designer" in seen:
        keep = "niche" if seen.index("niche") < seen.index("designer") else "designer"
        seen = [t for t in seen if t not in ("niche", "designer") or t == keep]
        repaired.append("niche_and_designer")
    style = row.get("dupe_style")
    style = style if (style in DUPE_STYLES and "dupe" in seen) else None
    conf = row.get("confidence")
    conf = conf if conf in CONFIDENCE else "low"
    return {
        "brand": brand_name,
        "tags": derive_tags(seen),
        "dupe_style": style,
        "origin_country": _str(row.get("origin_country"), 80),
        "parent_company": _str(row.get("parent_company"), 120),
        "confidence": conf,
        "inferred": 1 if row.get("inferred") else 0,
        "notes": _str(row.get("notes"), 400),
        "sources": _sources(row.get("sources")),
    }, repaired


def merge_brands(rows, brands: list[str], stats: Counter) -> dict[str, dict]:
    exact = set(brands)
    by_key: dict[str, list[str]] = defaultdict(list)
    for b in brands:
        by_key[norm(b)].append(b)
    out: dict[str, dict] = {}
    for fname, ln, row in rows:
        b = row.get("brand")
        if not isinstance(b, str) or not b.strip():
            stats["brand_row_without_brand"] += 1
            continue
        name = b if b in exact else None
        if name is None:
            cands = [x for x in brands if x.strip() == b.strip()] or by_key.get(norm(b), [])
            if len(cands) == 1:
                name = cands[0]
                stats["brand_name_repaired"] += 1
            else:
                stats["brand_unknown_dropped" if not cands else "brand_ambiguous_dropped"] += 1
                continue
        rec, rep = clean_brand_row(row, name)
        for r in rep:
            stats["brand_repair_" + r] += 1
        old = out.get(name)
        if old is not None:
            stats["brand_duplicates"] += 1
            if rec["inferred"] and not old["inferred"]:
                stats["brand_inferred_kept_out"] += 1
                continue
        out[name] = rec
        stats["brand_rows_used"] += 1
    return out


# ----------------------------------------------------------------------------------------- perfume links
class Index:
    """id -> (name, brand, votes) plus (brand, name) lookups for repairing / resolving target ids."""

    def __init__(self, con: sqlite3.Connection):
        self.info: dict[int, tuple] = {}
        self.by_bn: dict[tuple, list[int]] = defaultdict(list)
        for pid, name, brand, votes in con.execute("SELECT id, name, brand, COALESCE(rating_count,0) FROM perfumes"):
            self.info[pid] = (name, brand, votes)
            self.by_bn[(norm(brand), norm(name))].append(pid)
        self.names_by_brand: dict[str, list[tuple]] = defaultdict(list)
        for pid, (name, brand, votes) in self.info.items():
            self.names_by_brand[norm(brand)].append((norm(name), pid))

    def exact(self, brand: str, name: str):
        ids = self.by_bn.get((norm(brand), norm(name)), [])
        if len(ids) == 1:
            return ids[0]
        return max(ids, key=lambda i: self.info[i][2]) if ids else None

    def fits(self, pid: int, name: str, brand: str) -> bool:
        """Does perfume `pid` plausibly match the stated target name / brand?"""
        n, b, _ = self.info[pid]
        nb, nn = norm(brand), norm(name)
        if nb:
            db = norm(b)
            if not (nb in db or db in nb):
                return False
        if nn:
            dn = norm(n)
            if nn in dn or dn in nn:
                return True
            a, c = set(nn.split()), set(dn.split())
            return bool(a and c) and len(a & c) / len(a | c) >= 0.5
        return True


def merge_perfumes(rows, idx: Index, brand_tags: dict[str, dict], stats: Counter):
    latest: dict[int, dict] = {}
    for fname, ln, row in rows:
        pid = row.get("perfume_id")
        if isinstance(pid, bool) or not isinstance(pid, int) or pid not in idx.info:
            stats["perfume_unknown_dropped"] += 1
            continue
        if pid in latest:
            stats["perfume_duplicates"] += 1
        latest[pid] = row

    links: dict[int, dict[int, dict]] = {}
    status: dict[int, dict] = {}
    for pid, row in latest.items():
        brand = idx.info[pid][1]
        mine: dict[int, dict] = {}
        raw = row.get("dupe_of")
        for t in raw if isinstance(raw, list) else []:
            if not isinstance(t, dict):
                stats["link_malformed"] += 1
                continue
            tid, tname, tbrand = t.get("target_id"), _str(t.get("target_name"), 160) or "", _str(t.get("target_brand"), 120) or ""
            if isinstance(tid, bool) or not isinstance(tid, int):
                tid = None
            if tid is not None and tid not in idx.info:
                stats["link_target_id_unknown"] += 1
                tid = None
                if not (tname and tbrand):
                    continue
            if tid is not None and (tname or tbrand) and not idx.fits(tid, tname, tbrand):
                alt = idx.exact(tbrand, tname) if (tname and tbrand) else None
                if alt is None:
                    stats["link_target_mismatch_dropped"] += 1
                    continue
                stats["link_target_repaired"] += 1
                tid = alt
            if tid is None:
                tid = idx.exact(tbrand, tname) if (tname and tbrand) else None
                if tid is None:
                    stats["link_target_unresolved_dropped"] += 1
                    continue
                stats["link_target_resolved_by_name"] += 1
            if tid == pid:
                stats["link_self_dropped"] += 1
                continue
            tb = idx.info[tid][1]
            if tb == brand:
                stats["link_same_brand_dropped"] += 1
                continue
            conf = t.get("confidence") if t.get("confidence") in CONFIDENCE else "low"
            if "dupe" in brand_tags.get(tb, {}).get("tags", ()) and conf != "high":
                stats["link_target_is_dupe_house_dropped"] += 1
                continue
            basis = t.get("basis") if t.get("basis") in BASIS else "name"
            rec = {"target_id": tid, "confidence": conf, "basis": basis, "sources": _sources(t.get("sources"))}
            old = mine.get(tid)
            if old is None or (CONF_RANK[conf], BASIS_RANK[basis]) >= (CONF_RANK[old["confidence"]], BASIS_RANK[old["basis"]]):
                if old is not None:
                    stats["link_duplicate_targets"] += 1
                    rec["sources"] = list(dict.fromkeys(rec["sources"] + old["sources"]))[:MAX_SOURCES]
                mine[tid] = rec
        links[pid] = mine
        status[pid] = {"is_original": bool(row.get("is_original")), "notes": _str(row.get("notes"), 400)}

    # two-way links: keep the stronger direction (then the one whose target has more votes)
    for pid, mine in links.items():
        for tid in list(mine):
            back = links.get(tid, {}).get(pid)
            if back is None or tid not in mine:
                continue
            a, b = mine[tid], back
            ka = (CONF_RANK[a["confidence"]], BASIS_RANK[a["basis"]])
            kb = (CONF_RANK[b["confidence"]], BASIS_RANK[b["basis"]])
            stats["link_two_way_resolved"] += 1
            keep_a = ka > kb or (ka == kb and idx.info[tid][2] >= idx.info[pid][2])   # tie: the popular one is the original
            if keep_a:
                del links[tid][pid]
            else:
                del mine[tid]

    # cap + rank + final status
    out_links = []
    for pid, mine in links.items():
        ordered = sorted(mine.values(), key=lambda r: (-CONF_RANK[r["confidence"]], -BASIS_RANK[r["basis"]],
                                                       -idx.info[r["target_id"]][2], r["target_id"]))
        if len(ordered) > MAX_ORIGINALS:
            stats["link_over_cap_dropped"] += len(ordered) - MAX_ORIGINALS
            ordered = ordered[:MAX_ORIGINALS]
        for k, r in enumerate(ordered):
            out_links.append({"perfume_id": pid, "rank": k, **r})
        if ordered and status[pid]["is_original"]:
            stats["status_original_contradicted_by_links"] += 1
        status[pid]["is_original"] = bool(status[pid]["is_original"]) and not ordered
        status[pid]["linked"] = len(ordered)
    return out_links, status


# ----------------------------------------------------------------------------------------- write + stats
def write_tables(con: sqlite3.Connection, brand_tags, out_links, status):
    con.executescript(SCHEMA)
    con.executemany(
        "INSERT INTO brand_tags(brand, tags, dupe_style, origin_country, parent_company, confidence, inferred, notes, sources)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        [(b["brand"], json.dumps(b["tags"]), b["dupe_style"], b["origin_country"], b["parent_company"], b["confidence"],
          b["inferred"], b["notes"], json.dumps(b["sources"])) for b in sorted(brand_tags.values(), key=lambda x: x["brand"])])
    con.executemany(
        "INSERT INTO perfume_dupes(perfume_id, target_id, confidence, basis, sources, rank) VALUES (?,?,?,?,?,?)",
        [(r["perfume_id"], r["target_id"], r["confidence"], r["basis"], json.dumps(r["sources"]), r["rank"])
         for r in sorted(out_links, key=lambda r: (r["perfume_id"], r["rank"]))])
    con.executemany(
        "INSERT INTO perfume_dupe_status(perfume_id, is_original, notes) VALUES (?,?,?)",
        [(pid, 1 if s["is_original"] else 0, s["notes"]) for pid, s in sorted(status.items())])
    con.commit()


def coverage(con: sqlite3.Connection, stats: Counter) -> dict:
    cov: dict = {}
    n_brands, n_perf, votes = con.execute(
        "SELECT COUNT(DISTINCT brand), COUNT(*), COALESCE(SUM(rating_count),0) FROM perfumes").fetchone()
    cov["brands_total"], cov["perfumes_total"] = n_brands, n_perf
    rows = con.execute("SELECT t.brand, t.tags, t.inferred, t.confidence, COUNT(p.id), COALESCE(SUM(p.rating_count),0)"
                       " FROM brand_tags t JOIN perfumes p ON p.brand = t.brand GROUP BY t.brand").fetchall()
    cov["brands_covered"] = len(rows)
    cov["brands_researched"] = sum(1 for r in rows if not r[2])
    cov["brands_inferred"] = sum(1 for r in rows if r[2])
    cov["perfumes_in_covered_brands"] = sum(r[4] for r in rows)
    cov["votes_share_covered"] = round(sum(r[5] for r in rows) / votes, 4) if votes else 0
    by_tag = {t: {"brands": 0, "perfumes": 0} for t in ALL_TAGS}
    untagged = 0
    for brand, tags, inferred, conf, cnt, v in rows:
        ts = json.loads(tags)
        if not ts:
            untagged += 1
        for t in ts:
            by_tag[t]["brands"] += 1
            by_tag[t]["perfumes"] += cnt
    cov["by_tag"] = by_tag
    cov["brands_covered_but_untagged"] = untagged
    cov["conf"] = dict(Counter(r[3] for r in rows))
    cov["dupe_links"] = con.execute("SELECT COUNT(*) FROM perfume_dupes").fetchone()[0]
    cov["perfumes_with_links"] = con.execute("SELECT COUNT(DISTINCT perfume_id) FROM perfume_dupes").fetchone()[0]
    cov["originals_with_dupes"] = con.execute("SELECT COUNT(DISTINCT target_id) FROM perfume_dupes").fetchone()[0]
    cov["perfumes_researched"] = con.execute("SELECT COUNT(*) FROM perfume_dupe_status").fetchone()[0]
    cov["researched_originals"] = con.execute("SELECT COUNT(*) FROM perfume_dupe_status WHERE is_original=1").fetchone()[0]
    cov["links_by_confidence"] = dict(con.execute("SELECT confidence, COUNT(*) FROM perfume_dupes GROUP BY 1"))
    cov["links_by_basis"] = dict(con.execute("SELECT basis, COUNT(*) FROM perfume_dupes GROUP BY 1"))
    return cov


def merge(db: Path, out_dir: Path, report: Path | None = None, quiet: bool = False) -> dict:
    db = Path(db)
    if not db.exists():
        raise SystemExit(f"database not found: {db}")
    con = sqlite3.connect(db)
    stats: Counter = Counter()
    brands = [r[0] for r in con.execute("SELECT DISTINCT brand FROM perfumes")]
    brand_rows, perf_rows = [], []
    for fname, ln, row in read_rows(Path(out_dir)):
        if fname is None:
            stats["bad_json_lines"] += row["__bad_lines__"]
            continue
        stats["rows_read"] += 1
        if "perfume_id" in row:
            perf_rows.append((fname, ln, row))
        elif "brand" in row:
            brand_rows.append((fname, ln, row))
        else:
            stats["row_of_unknown_kind"] += 1
    btags = merge_brands(brand_rows, brands, stats)
    idx = Index(con)
    out_links, status = merge_perfumes(perf_rows, idx, btags, stats)
    write_tables(con, btags, out_links, status)
    cov = coverage(con, stats)
    con.close()
    result = {"coverage": cov, "stats": dict(sorted(stats.items()))}
    if report:
        Path(report).parent.mkdir(parents=True, exist_ok=True)
        Path(report).write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf8")
    if not quiet:
        print_report(result)
    return result


def print_report(result: dict):
    c, s = result["coverage"], result["stats"]
    print(f"brands: {c['brands_covered']:,} of {c['brands_total']:,} tagged "
          f"({c['brands_researched']:,} researched, {c['brands_inferred']:,} inferred, {c['brands_covered_but_untagged']:,} with no tag)")
    print(f"perfumes in tagged brands: {c['perfumes_in_covered_brands']:,} of {c['perfumes_total']:,}; "
          f"{c['votes_share_covered'] * 100:.1f}% of all votes")
    for t, v in c["by_tag"].items():
        print(f"  {t:<24} {v['brands']:>6,} brands  {v['perfumes']:>8,} perfumes")
    print(f"dupe links: {c['dupe_links']:,} on {c['perfumes_with_links']:,} perfumes -> {c['originals_with_dupes']:,} originals; "
          f"confidence {c['links_by_confidence']}  basis {c['links_by_basis']}")
    print(f"perfumes researched for dupes: {c['perfumes_researched']:,} (original: {c['researched_originals']:,})")
    if s:
        print("merge counters: " + ", ".join(f"{k}={v}" for k, v in s.items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--report", default=str(DEFAULT_REPORT))
    a = ap.parse_args()
    merge(Path(a.db), Path(a.out), Path(a.report))


if __name__ == "__main__":
    sys.exit(main())
