"""Per-source adapters: raw files -> list of records in one common shape.

Record = dict(src, fid, url, name, brand, year, gender, country, rating, rating_count,
              perfumers[list], accords[list of (name, strength 0..1 or None)],
              notes{'top','middle','base','general': [display names, ordered]}, image_url, slug_names(bool))

All files here are untrusted DATA: we only parse them with pandas / json / ast.literal_eval.
"""
import glob
import json
import re
from pathlib import Path

import pandas as pd

from norm import (canon_url, clean_text, fid_from_url, norm_gender, split_list, strip_gender_tail,
                  to_float, to_int, valid_year)

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

# source priority (lower = preferred when fields conflict / tie)
PRIORITY = {
    "decant_kaggle": 1,
    "gh_astyxxx": 2,
    "wilsonanthony_fra": 3,
    "sabitahmad_fra": 4,
    "olga_fra": 5,
    "gh_rdemarqui": 6,
    "imerghichi_notes": 7,
}


def new_rec(src, **kw):
    r = dict(src=src, fid=None, url=None, name="", brand="", year=None, gender=None, country=None,
             rating=None, rating_count=None, perfumers=[], accords=[], accords_synthetic=False,
             notes={"top": [], "middle": [], "base": [], "general": []}, image_url=None, slug_names=False)
    r.update(kw)
    return r


def _weighted_list(v, with_strength=False):
    """'Name:weight|Name:weight' -> [(name, weight)]"""
    out = []
    if not isinstance(v, str) or not v.strip():
        return out
    for part in v.split("|"):
        part = part.strip()
        if not part:
            continue
        name, _, w = part.rpartition(":")
        if not name or not re.fullmatch(r"\d+(\.\d+)?", w.strip()):
            name, w = part, None
        name = clean_text(name)
        if name:
            out.append((name, to_float(w)))
    return out


def _accords_from_weighted(v):
    return [(n, (w / 100.0 if w is not None else None)) for n, w in _weighted_list(v)]


def _rating(avg, count):
    avg, count = to_float(avg), to_int(count)
    if avg is None or not count or avg <= 0:
        return None, count if count else None
    return round(avg, 4), count


SYNTHETIC = "synthetic"  # marker object type for name-only accord lists


def _linear_strengths(names):
    """Sources that only list accord names (ordered strongest first): synthesise a monotone strength."""
    n = len(names)
    return [(a, round(max(0.2, 1.0 - 0.1 * i), 2)) for i, a in enumerate(names)] if n else []


# ------------------------------------------------------------------ decant (the big one)

def load_decant():
    f = RAW / "decant_kaggle" / "perfumes.csv"
    cols = ["id", "name", "brand", "year", "gender", "url", "rating_avg", "vote_count", "accords",
            "notes_top", "notes_middle", "notes_base", "notes_flat", "perfumers"]
    df = pd.read_csv(f, usecols=cols, dtype=str, keep_default_na=False)
    recs = []
    for r in df.itertuples(index=False):
        rating, cnt = _rating(r.rating_avg, r.vote_count)
        rec = new_rec(
            "decant_kaggle", fid=to_int(r.id), url=canon_url(r.url), name=clean_text(r.name),
            brand=clean_text(r.brand), year=valid_year(r.year), gender=norm_gender(r.gender),
            rating=rating, rating_count=cnt,
            perfumers=[p for p in (clean_text(x) for x in r.perfumers.split("|")) if p],
            accords=_accords_from_weighted(r.accords),
        )
        rec["notes"] = {
            "top": [n for n, _ in _weighted_list(r.notes_top)],
            "middle": [n for n, _ in _weighted_list(r.notes_middle)],
            "base": [n for n, _ in _weighted_list(r.notes_base)],
            "general": [n for n, _ in _weighted_list(r.notes_flat)],
        }
        recs.append(rec)
    return recs


# ------------------------------------------------------------------ aStyxxx github (same shape as decant)

def load_astyxxx():
    df = pd.read_csv(RAW / "gh_astyxxx" / "perfumes_actual.csv", dtype=str, keep_default_na=False)
    recs = []
    for r in df.itertuples(index=False):
        url = canon_url(r.url)
        fid = fid_from_url(r.url) or to_int(r.id)
        rating, cnt = _rating(r.rating_avg, r.vote_count)
        rec = new_rec(
            "gh_astyxxx", fid=fid, url=url, name=clean_text(r.name), brand=clean_text(r.brand),
            year=valid_year(r.year), gender=norm_gender(r.gender), rating=rating, rating_count=cnt,
            perfumers=[p for p in (clean_text(x) for x in re.split(r"[|;]", r.perfumers)) if p],
            accords=_accords_from_weighted(r.accords),
        )
        rec["notes"] = {
            "top": [n for n, _ in _weighted_list(r.notes_top)],
            "middle": [n for n, _ in _weighted_list(r.notes_middle)],
            "base": [n for n, _ in _weighted_list(r.notes_base)],
            "general": [n for n, _ in _weighted_list(r.notes_flat)],
        }
        recs.append(rec)
    return recs


# ------------------------------------------------------------------ sabitahmad (brand/name/year/gender/url only)

def load_sabitahmad():
    df = pd.read_excel(RAW / "sabitahmad_fra" / "fragrantica_all.xlsx", dtype=str)
    recs = []
    for r in df.itertuples(index=False):
        url = canon_url(r.perfume_url)
        recs.append(new_rec("sabitahmad_fra", fid=fid_from_url(r.perfume_url), url=url,
                            name=clean_text(r.name), brand=clean_text(r.brand),
                            year=valid_year(r.year), gender=norm_gender(r.gender)))
    return recs


# ------------------------------------------------------------------ wilsonanthony (reviews-exploded; 1st row per perfume has the data)

def load_wilson():
    recs = {}
    cols = ["id", "perfume_name", "url", "dizajner", "rating", "rating_count", "godina", "naslov",
            "notes.top", "notes.middle", "notes.base"]
    for f in sorted(glob.glob(str(RAW / "wilsonanthony_fra" / "*.xlsx"))):
        df = pd.read_excel(f, usecols=cols, dtype=str)
        df = df[df["perfume_name"].notna() & df["url"].notna()]
        for r in df.itertuples(index=False):
            fid = fid_from_url(r.url) or to_int(r.id)
            if fid in recs:
                continue
            rating, cnt = _rating(r.rating, r.rating_count)
            title = clean_text(r.perfume_name)
            gender = norm_gender(re.search(r"\bfor\s+(women and men|men and women|women|men)\s*$", title, re.I).group(1)
                                 if re.search(r"\bfor\s+(women and men|men and women|women|men)\s*$", title, re.I) else None)
            rec = new_rec("wilsonanthony_fra", fid=fid, url=canon_url(r.url),
                          name=clean_text(r.naslov) or strip_gender_tail(title), brand=clean_text(r.dizajner),
                          year=valid_year(r.godina), gender=gender, rating=rating, rating_count=cnt)
            rec["notes"] = {"top": split_list(r._8), "middle": split_list(r._9), "base": split_list(r._10),
                            "general": []}
            recs[fid] = rec
    return list(recs.values())


# ------------------------------------------------------------------ olga fra_perfumes.csv (70k; notes only inside description text)

_DESC_NOTES = re.compile(r"\b(top|middle|base) notes are ([^;.]+)", re.I)
_DESC_FLAT = re.compile(r"\b(?:fragrance|perfume) features ([^.]+)\.", re.I)


def _split_and(s):
    s = re.sub(r"\s+and\s+(?=[^,]+$)", ", ", s.strip())
    return [clean_text(x) for x in s.split(",") if clean_text(x)]


def load_olga70k():
    df = pd.read_csv(RAW / "olga_fra" / "fra_perfumes.csv", dtype=str, keep_default_na=False)
    recs = []
    for d in df.to_dict("records"):
        url = canon_url(d["url"])
        fid = fid_from_url(d["url"])
        m = re.search(r"/perfume/([^/]+)/(.+)-(\d+)\.html", d["url"] or "")
        brand = m.group(1).replace("-", " ") if m else ""
        name = m.group(2).replace("-", " ") if m else ""
        rating, cnt = _rating(d["Rating Value"], d["Rating Count"])
        notes = {"top": [], "middle": [], "base": [], "general": []}
        desc = d["Description"] or ""
        for lay, txt in _DESC_NOTES.findall(desc):
            notes[lay.lower()] = _split_and(txt)
        if not any(notes.values()):
            m2 = _DESC_FLAT.search(desc)
            if m2:
                notes["general"] = _split_and(m2.group(1))
        rec = new_rec("olga_fra", fid=fid, url=url, name=name, brand=brand, gender=norm_gender(d["Gender"]),
                      rating=rating, rating_count=cnt, perfumers=split_list(d["Perfumers"]),
                      accords=_linear_strengths(split_list(d["Main Accords"])), slug_names=True, accords_synthetic=True)
        rec["notes"] = notes
        recs.append(rec)
    return recs


# ------------------------------------------------------------------ olga fra_cleaned.csv (24k; country, notes by layer)

def load_olga24k():
    df = pd.read_csv(RAW / "olga_fra" / "fra_cleaned.csv", sep=";", encoding="cp1252", encoding_errors="replace",
                     dtype=str, keep_default_na=False)
    recs = []
    for r in df.to_dict("records"):
        accords = [clean_text(r.get(f"mainaccord{i}")) for i in range(1, 6)]
        accords = [a for a in accords if a]
        pf = [p for p in (clean_text(r.get("Perfumer1")), clean_text(r.get("Perfumer2"))) if p.lower() != "unknown"]
        rating, cnt = _rating(r["Rating Value"], r["Rating Count"])
        rec = new_rec("olga_fra", fid=fid_from_url(r["url"]), url=canon_url(r["url"]),
                      name=clean_text(r["Perfume"]).replace("-", " "), brand=clean_text(r["Brand"]).replace("-", " "),
                      year=valid_year(r["Year"]), gender=norm_gender(r["Gender"]), country=(clean_text(r["Country"]) if clean_text(r["Country"]).lower() != "unknown" else None),
                      rating=rating, rating_count=cnt, perfumers=[p for p in pf if p],
                      accords=_linear_strengths(accords), slug_names=True, accords_synthetic=True)
        rec["notes"] = {"top": split_list(r["Top"]), "middle": split_list(r["Middle"]),
                        "base": split_list(r["Base"]), "general": []}
        recs.append(rec)
    return recs


# ------------------------------------------------------------------ rdemarqui (xlsx; general notes; fragrantica id in image name)

def load_rdemarqui():
    df = pd.read_excel(RAW / "gh_rdemarqui" / "perfume_database.xlsx", dtype=str)
    recs = []
    for r in df.to_dict("records"):
        m = re.search(r"o\.(\d+)\.jpg", r.get("image") or "")
        fid = int(m.group(1)) if m else None
        rec = new_rec("gh_rdemarqui", fid=fid, name=clean_text(r["perfume"]), brand=clean_text(r["brand"]),
                      year=valid_year(r.get("launch_year")),
                      accords=_linear_strengths(split_list(r.get("main_accords"))), accords_synthetic=True)
        rec["notes"]["general"] = split_list(r.get("notes"))
        recs.append(rec)
    return recs


# ------------------------------------------------------------------ imerghichi (no ids; flat notes, concatenated pyramid with repeats)

def load_imerghichi():
    df = pd.read_csv(RAW / "imerghichi_notes" / "perfume data.csv", dtype=str, keep_default_na=False)
    ncols = [c for c in df.columns if c.startswith("note")]
    recs = []
    for r in df.to_dict("records"):
        brand = clean_text(r["brand"]).replace("-", " ")
        title = clean_text(r["title"])
        gender = norm_gender(r.get("gender"))
        m = re.search(r"\bfor\s+(women and men|men and women|women|men)\s*$", title, re.I)
        if m:
            gender = norm_gender(m.group(1))
        name = strip_gender_tail(title)
        rec = new_rec("imerghichi_notes", name=name, brand=brand, gender=gender, slug_names=False)
        seen, notes = set(), []
        for c in ncols:
            n = clean_text(r[c])
            if n and n.lower() not in seen:
                seen.add(n.lower())
                notes.append(n)
        rec["notes"]["general"] = notes
        rec["enrich_only"] = True  # no ids, mangled brands, flat notes: only used to fill gaps of known perfumes
        recs.append(rec)
    return recs


LOADERS = [
    ("decant_kaggle", load_decant),
    ("gh_astyxxx", load_astyxxx),
    ("wilsonanthony_fra", load_wilson),
    ("sabitahmad_fra", load_sabitahmad),
    ("olga_fra:fra_perfumes.csv", load_olga70k),
    ("olga_fra:fra_cleaned.csv", load_olga24k),
    ("gh_rdemarqui", load_rdemarqui),
    ("imerghichi_notes", load_imerghichi),
]
