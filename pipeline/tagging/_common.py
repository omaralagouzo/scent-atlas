"""Shared helpers for the tagging pipeline (data loading, name normalisation, famous-name index)."""
import json
import re
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "master.db"
RAW = ROOT / "data" / "raw" / "decant_kaggle" / "perfumes.jsonl"
HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
OUT = HERE / "out"

FAMOUS_BRAND_VOTES = 20_000   # brand total rating_count to count as a "famous brand"
FAMOUS_PERFUME_VOTES = 3_000  # perfume rating_count to count as a "famous perfume" (name-match index)
MIN_NAME_LEN = 5              # ignore generic names shorter than this
GENERIC_BRANDS_N = 12         # a normalised name used by >= this many distinct brands is generic

# very generic single words that should never count as a "famous perfume name"
GENERIC_WORDS = set("""
oud rose musk noir amber vanilla sport intense classic original night black white gold silver blue red
pour homme femme woman women men man sexy love life happy fresh summer winter spring light dark absolute
essence royal prive private reserve collection signature elixir extreme edition parfum perfume cologne
eau aqua water fire earth wind sunset sunrise paradise passion desire dream dreams magic secret secrets
legend hero heroes king queen prince princess lady ladies gentleman gentlemen boss number limited
""".split())


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def load_perfumes():
    """-> list of dict(id,name,brand,year,country,rating_count,gender), id-indexed dict"""
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        "select id,name,brand,year,gender,country,coalesce(rating_count,0) rating_count from perfumes")]
    con.close()
    return rows


def load_raw(want_desc=True):
    """Yield (id, description, reminds_me_of list). Plain json only (untrusted data)."""
    with open(RAW, encoding="utf8") as f:
        for line in f:
            d = json.loads(line)
            sim = d.get("similar") or {}
            yield d["id"], (d.get("description") if want_desc else None), (sim.get("reminds_me_of") or [])


def build_famous_names(perfumes, brand_votes):
    """norm(name) -> {'brands': {brand: votes}, 'owner': brand, 'votes': n} for names of perfumes from famous
    brands with enough votes, that are not generic (short / stop word / used by many brands) and
    where the famous brand owns >= 50% of that name's votes."""
    by_name = defaultdict(lambda: defaultdict(int))
    for p in perfumes:
        n = norm(p["name"])
        if n:
            by_name[n][p["brand"]] += p["rating_count"]
    fam = {}
    for p in perfumes:
        if p["rating_count"] < FAMOUS_PERFUME_VOTES or brand_votes.get(p["brand"], 0) < FAMOUS_BRAND_VOTES:
            continue
        n = norm(p["name"])
        if len(n) < MIN_NAME_LEN or n in GENERIC_WORDS or n in fam:
            continue
        if all(w in GENERIC_WORDS or len(w) < 3 for w in n.split()):
            continue
        brands = by_name[n]
        if len(brands) >= GENERIC_BRANDS_N:
            continue
        tot = sum(brands.values())
        owner = max(brands, key=brands.get)
        if brands[owner] < 0.5 * tot or brand_votes.get(owner, 0) < FAMOUS_BRAND_VOTES:
            continue
        fam[n] = {"owner": owner, "votes": brands[owner]}
    return fam


def name_matches(name, own_brand, fam, max_n=6):
    """famous perfume names (of OTHER brands) contained as whole-word n-grams in `name`.
    Returns list of (famous_name, owner_brand, votes), longest first."""
    toks = norm(name).split()
    seen, out = set(), []
    own = f" {norm(own_brand)} "
    for n in range(min(max_n, len(toks)), 0, -1):
        for i in range(len(toks) - n + 1):
            g = " ".join(toks[i:i + n])
            f = fam.get(g)
            if f and f["owner"] != own_brand and g not in seen and f" {g} " not in own:
                seen.add(g)
                out.append((g, f["owner"], f["votes"]))
    return out
