"""Build data/master.db, data/master_perfumes.csv and data/BUILD_REPORT.md from data/raw/*.

Run:  python -I pipeline/build_master.py
(-I = isolated mode: never imports anything from the current dir / raw data dirs.)
"""
import csv
import json
import os
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # pipeline dir only (-I removes cwd/script dir)

from rapidfuzz import fuzz  # noqa: E402

import adapters  # noqa: E402
import norm  # noqa: E402
from adapters import PRIORITY  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DB_PATH = DATA / "master.db"
FUZZY_MIN = 94  # rapidfuzz token_sort_ratio, only used for conservative tie-breaks inside the same brand
LAYERS = ("top", "middle", "base", "general")

SCHEMA = """
CREATE TABLE perfumes (
  id            INTEGER PRIMARY KEY,
  fragrantica_id INTEGER,
  name          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  year          INTEGER,
  gender        TEXT,
  country       TEXT,
  rating        REAL,
  rating_count  INTEGER,
  url           TEXT,
  image_url     TEXT,
  perfumers     TEXT,
  accords       TEXT,
  sources       TEXT
);

CREATE TABLE notes (
  id            INTEGER PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  family        TEXT,
  perfume_count INTEGER NOT NULL DEFAULT 0,
  image_local   TEXT,
  image_source  TEXT
);

CREATE TABLE perfume_notes (
  perfume_id INTEGER NOT NULL REFERENCES perfumes(id),
  note_id    INTEGER NOT NULL REFERENCES notes(id),
  layer      TEXT NOT NULL CHECK (layer IN ('top','middle','base','general')),
  position   INTEGER,
  PRIMARY KEY (perfume_id, note_id, layer)
);
CREATE INDEX idx_pn_note ON perfume_notes(note_id);
CREATE INDEX idx_perfumes_brand ON perfumes(brand);
"""


def srckey(rec):
    return rec["src"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def prio(rec):
    return PRIORITY[rec["src"]]


def pretty_slug_name(s):
    """Fallback display for lowercase slug-derived names."""
    words = s.split()
    small = {"de", "du", "la", "le", "of", "the", "and", "for", "in", "by", "a", "au", "des", "di", "da"}
    out = []
    for i, w in enumerate(words):
        out.append(w if (i and w in small) else (w[:1].upper() + w[1:]))
    return " ".join(out)


# ---------------------------------------------------------------------------------------------- load

def load_all():
    recs, stats = [], {}
    for key, fn in adapters.LOADERS:
        t = time.time()
        rs = fn()
        for r in rs:
            r["_file"] = key
        stats[key] = dict(rows=len(rs), with_fid=sum(1 for r in rs if r["fid"]),
                          with_pyramid=sum(1 for r in rs if any(r["notes"][l] for l in ("top", "middle", "base"))),
                          with_flat=sum(1 for r in rs if r["notes"]["general"]), seconds=round(time.time() - t, 1))
        log(f"loaded {key}: {len(rs)} rows")
        recs.extend(rs)
    return recs, stats


# ---------------------------------------------------------------------------------------------- grouping

def year_ok(a, b):
    return a is None or b is None or a == b


def gender_ok(a, b):
    return a is None or b is None or a == b


def group_records(recs, stats):
    """Returns list of groups (each a list of records), plus dedup counters."""
    c = Counter()
    by_fid = defaultdict(list)
    idless = []
    for r in recs:
        (by_fid[r["fid"]] if r["fid"] else idless).append(r)
    c["records_in"] = len(recs)
    c["distinct_fragrantica_ids"] = len(by_fid)
    c["records_merged_by_fid"] = sum(len(v) - 1 for v in by_fid.values())

    # --- per fid-group summary used for key lookups
    def summary(group):
        g = sorted(group, key=prio)
        good = [r for r in g if not r["slug_names"]] or g
        base = good[0]
        return dict(fid=g[0]["fid"], brand=base["brand"], name=base["name"],
                    year=next((r["year"] for r in g if r["year"]), None),
                    gender=next((r["gender"] for r in g if r["gender"]), None),
                    best_prio=prio(g[0]), keys={(norm.norm_brand(r["brand"]), norm.norm_name(r["name"])) for r in g})

    summ = {fid: summary(g) for fid, g in by_fid.items()}
    by_key = defaultdict(set)
    by_brand = defaultdict(set)
    for fid, s in summ.items():
        for k in s["keys"]:
            by_key[k].add(fid)
            by_brand[k[0]].add(fid)

    # --- stale/duplicate ids: a fid-group made only of low-priority sources (decant/astyxxx do not know the id)
    # that matches exactly one decant-known perfume by brand+name(+year) is the same perfume under an old id.
    strong = {"decant_kaggle", "gh_astyxxx"}
    merged_into = {}
    for fid, g in list(by_fid.items()):
        if any(r["src"] in strong for r in g):
            continue
        s = summ[fid]
        cands = set()
        for k in s["keys"]:
            cands |= {f for f in by_key[k] if f != fid and any(r["src"] in strong for r in by_fid[f])}
        cands = {f for f in cands if year_ok(s["year"], summ[f]["year"]) and gender_ok(s["gender"], summ[f]["gender"])}
        if len(cands) == 1:
            merged_into[fid] = next(iter(cands))
    for fid, tgt in merged_into.items():
        by_fid[tgt].extend(by_fid.pop(fid))
        c["stale_id_groups_merged_by_key"] += 1
    summ = {fid: summary(g) for fid, g in by_fid.items()}
    by_key = defaultdict(set)
    by_brand = defaultdict(set)
    for fid, s in summ.items():
        for k in s["keys"]:
            by_key[k].add(fid)
            by_brand[k[0]].add(fid)

    # --- records without id
    new_groups = []           # idless-only groups
    idless_index = defaultdict(list)  # (bk, nk) -> list of group lists
    for r in sorted(idless, key=prio):
        bk = norm.norm_brand(r["brand"])
        nk = norm.norm_name(r["name"], r["brand"])
        nk_full = norm.norm_name(r["name"])
        target = None
        cands = {f for f in (by_key.get((bk, nk), set()) | by_key.get((bk, nk_full), set()))}
        cands = {f for f in cands if year_ok(r["year"], summ[f]["year"]) and gender_ok(r["gender"], summ[f]["gender"])}
        how = None
        if len(cands) == 1:
            target, how = next(iter(cands)), "key"
        elif len(cands) > 1:
            c["idless_ambiguous_dropped"] += 1
            r["_dropped"] = True
            continue
        else:
            # conservative fuzzy tie-break inside the same normalised brand
            best, best_score, tie = None, 0, False
            rn = norm.name_tokens_for_fuzzy(r["name"])
            if rn and len(rn) >= 4:
                for f in by_brand.get(bk, ()):
                    s = summ[f]
                    if not (year_ok(r["year"], s["year"]) and gender_ok(r["gender"], s["gender"])):
                        continue
                    sc = fuzz.token_sort_ratio(rn, norm.name_tokens_for_fuzzy(s["name"]))
                    if sc > best_score:
                        best, best_score, tie = f, sc, False
                    elif sc == best_score:
                        tie = True
            if best is not None and best_score >= FUZZY_MIN and not tie:
                target, how = best, "fuzzy"
        if target is not None:
            by_fid[target].append(r)
            c["idless_merged_by_" + how] += 1
            continue
        if r.get("enrich_only"):
            c["idless_unmatched_dropped"] += 1  # never create new perfumes from low-quality enrich-only sources
            continue
        # no fragrantica-id perfume to attach to: group among id-less records
        for g in idless_index.get((bk, nk), []):
            if year_ok(r["year"], g[0]["year"]) and gender_ok(r["gender"], g[0]["gender"]):
                g.append(r)
                c["idless_merged_among_idless"] += 1
                break
        else:
            g = [r]
            idless_index[(bk, nk)].append(g)
            new_groups.append(g)
    c["idless_new_perfumes"] = len(new_groups)
    groups = list(by_fid.values()) + new_groups
    return groups, c


# ---------------------------------------------------------------------------------------------- merging

def pyramid_score(rec):
    n = rec["notes"]
    layers = sum(1 for l in ("top", "middle", "base") if n[l])
    total = sum(len(n[l]) for l in LAYERS)
    return (layers, 1 if total else 0)


def merge_group(g, contrib):
    g = sorted(g, key=prio)
    win = {}  # field -> record

    def first(field):
        for r in g:
            v = r[field]
            if v not in (None, "", [], 0):
                win.setdefault(field, r)
                return v
        return None

    good = [r for r in g if not r["slug_names"] and r["name"] and r["brand"]]
    base = good[0] if good else g[0]
    win["name"] = base
    name, brand = base["name"], base["brand"]
    if base["slug_names"]:
        name, brand = pretty_slug_name(name), pretty_slug_name(brand)
    fid = g[0]["fid"]
    url = first("url")
    year = first("year")
    gender = first("gender")
    country = first("country")

    # rating: max rating_count (with its rating)
    rated = [r for r in g if r["rating"] is not None and r["rating_count"]]
    rating = rating_count = None
    if rated:
        b = max(rated, key=lambda r: (r["rating_count"], -prio(r)))
        rating, rating_count = b["rating"], b["rating_count"]
        win["rating"] = b

    # perfumers: union, ordered by priority; dedupe case/accent-insensitively
    perfumers, seen = [], set()
    for r in g:
        for p in r["perfumers"]:
            k = norm.slugify(p)
            if k and k != "unknown" and k not in seen:
                seen.add(k)
                perfumers.append(p)
                win.setdefault("perfumers", r)

    # accords: with strengths > more accords > priority
    acc = [r for r in g if r["accords"]]
    accords = []
    if acc:
        b = max(acc, key=lambda r: (not r["accords_synthetic"], len(r["accords"]), -prio(r)))
        accords = [(n, s) for n, s in b["accords"]]
        win["accords"] = b

    # notes: most complete pyramid (layers), then source priority
    nr = [r for r in g if any(r["notes"][l] for l in LAYERS)]
    notes = {l: [] for l in LAYERS}
    if nr:
        b = max(nr, key=lambda r: (pyramid_score(r), -prio(r)))
        notes = {l: list(b["notes"][l]) for l in LAYERS}
        if any(notes[l] for l in ("top", "middle", "base")):
            # a pyramid + a stray flat list: keep the pyramid layers only
            notes["general"] = []
        win["notes"] = b

    for f, r in win.items():
        contrib[(r["_file"], id(r))] += 1
    return dict(fid=fid, name=name, brand=brand, year=year, gender=gender, country=country, rating=rating,
                rating_count=rating_count, url=url, perfumers=perfumers, accords=accords, notes=notes,
                image_url=next((r["image_url"] for r in g if r["image_url"]), None),
                sources=sorted({r["src"] for r in g}, key=lambda s: PRIORITY[s]), bkey=norm.norm_brand(brand),
                nrecs=len(g))


# ---------------------------------------------------------------------------------------------- notes

def build_notes(perfumes):
    """Normalise all note names to slugs; returns {slug: display name}."""
    variants = defaultdict(Counter)
    for p in perfumes:
        for l in LAYERS:
            for n in p["notes"][l]:
                variants[norm.note_slug(n)][n] += 1
    info = {}
    for slug, cnt in variants.items():
        if not slug:
            continue
        own = {n: c for n, c in cnt.items() if norm.slugify(n) == slug}  # spellings that are the canonical one
        cnt = own or cnt
        mixed = [(c, n) for n, c in cnt.items() if n != n.lower()]
        pool = mixed or [(c, n) for n, c in cnt.items()]
        info[slug] = max(pool)[1]
    return info


def finalize_note_names(info):
    out = {}
    for slug, disp in info.items():
        d = disp.strip()
        if d == d.lower():  # only lowercase sources -> Title Case (keep small words lower)
            d = " ".join(w if (i and w in ("of", "the", "and", "de", "du", "la", "in", "or")) else w[:1].upper() + w[1:]
                         for i, w in enumerate(d.split(" ")))
        out[slug] = d
    return out


# ---------------------------------------------------------------------------------------------- output

def write_db(perfumes, note_names):
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    con.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    con.executescript(SCHEMA)
    slugs = sorted(note_names)
    note_id = {s: i + 1 for i, s in enumerate(slugs)}
    counts = Counter()
    pn_rows, p_rows = [], []
    for p in perfumes:
        seen = set()
        for l in LAYERS:
            pos = 0
            for n in p["notes"][l]:
                s = norm.note_slug(n)
                if not s or (s, l) in seen:
                    continue
                seen.add((s, l))
                pn_rows.append((p["id"], note_id[s], l, pos))
                pos += 1
        for s in {s for s, _ in seen}:
            counts[s] += 1
        p_rows.append((p["id"], p["fid"], p["name"], p["brand"], p["year"], p["gender"], p["country"], p["rating"],
                       p["rating_count"], p["url"], p["image_url"],
                       json.dumps(p["perfumers"], ensure_ascii=False),
                       json.dumps([{"name": n, "strength": s} for n, s in p["accords"]], ensure_ascii=False),
                       json.dumps(p["sources"])))
    con.executemany("INSERT INTO perfumes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", p_rows)
    con.executemany("INSERT INTO notes VALUES (?,?,?,?,?,NULL,NULL)",
                    [(note_id[s], s, note_names[s], norm.note_family(s), counts[s]) for s in slugs])
    con.executemany("INSERT INTO perfume_notes VALUES (?,?,?,?)", pn_rows)
    con.commit()
    con.execute("VACUUM")
    con.close()
    return len(p_rows), len(slugs), len(pn_rows)


def write_csv(perfumes):
    with open(DATA / "master_perfumes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "fragrantica_id", "name", "brand", "year", "gender", "country", "rating", "rating_count",
                    "url", "image_url", "perfumers", "accords", "top", "middle", "base", "general", "sources"])
        for p in perfumes:
            w.writerow([p["id"], p["fid"] or "", p["name"], p["brand"], p["year"] or "", p["gender"] or "",
                        p["country"] or "", p["rating"] if p["rating"] is not None else "", p["rating_count"] or "",
                        p["url"] or "", p["image_url"] or "", ";".join(p["perfumers"]),
                        ";".join(f"{n}:{s:.2f}" if s is not None else n for n, s in p["accords"]),
                        *[";".join(p["notes"][l]) for l in LAYERS], ";".join(p["sources"])])


# ---------------------------------------------------------------------------------------------- main

def main():
    t0 = time.time()
    recs, src_stats = load_all()
    groups, dd = group_records(recs, src_stats)
    log(f"groups: {len(groups)}  dedup counters: {dict(dd)}")
    contrib = Counter()
    perfumes = [merge_group(g, contrib) for g in groups]
    log("merged groups")

    # brand -> country (country is a brand-level attribute in the sources that carry it)
    bc = defaultdict(Counter)
    for p in perfumes:
        if p["country"]:
            bc[p["bkey"]][p["country"]] += 1
    filled = 0
    for p in perfumes:
        if not p["country"] and bc.get(p["bkey"]):
            p["country"] = bc[p["bkey"]].most_common(1)[0][0]
            filled += 1
    dd["country_filled_from_brand"] = filled

    # stable ids: fragrantica id when known, else 9_000_000+n in sorted key order
    perfumes.sort(key=lambda p: (p["fid"] is None, p["fid"] or 0, p["bkey"], norm.norm_name(p["name"])))
    nxt = 9_000_000
    for p in perfumes:
        if p["fid"]:
            p["id"] = p["fid"]
            if p["fid"]:
                p["image_url"] = f"https://fimgs.net/mdimg/perfume/375x500.{p['fid']}.jpg"
        else:
            p["id"] = nxt
            nxt += 1

    info = finalize_note_names(build_notes(perfumes))
    n_p, n_n, n_pn = write_db(perfumes, info)
    write_csv(perfumes)
    log(f"db written: perfumes={n_p} notes={n_n} perfume_notes={n_pn}")
    import report  # noqa: E402  (sibling module)
    report.write_report(perfumes, recs, src_stats, dd, contrib, info, DB_PATH, DATA / "BUILD_REPORT.md",
                        time.time() - t0)


if __name__ == "__main__":
    main()
