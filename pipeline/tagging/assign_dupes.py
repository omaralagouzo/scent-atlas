"""Assign "dupe of" links to perfumes of dupe brands using community "reminds me of" votes + data evidence.

  python pipeline/tagging/assign_dupes.py [--out-dir pipeline/tagging/out] [--no-longtail] [--limit N]

Inputs  : out/brand_tags_*.jsonl   (brands tagged "dupe"; brand_tags_longtail.jsonl entries carry inferred=true)
          work/reminds.csv, data/master.db (perfumes, notes)
Outputs : out/perfume_dupes_community.jsonl   (README "perfume_dupes" format)
          work/dupe_assign_report.md

Per perfume the candidate targets are the perfumes it is "reminiscent of" (Fragrantica community votes) plus perfumes
whose (famous) name is contained in its own name.  Candidates are ranked primarily by UP votes (down votes are large for
genuine clone relations because popular targets attract both) and combined with: share of the perfume's total up-votes,
lead over the runner-up, note similarity (weighted Jaccard, same model as dupe_candidates.py), target popularity,
year order, gender compatibility, name match, and target-brand type.  See the constants / `score()` below.
Inferred (long-tail) dupe brands never get "high" confidence.
"""
import argparse
import glob
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OUT, WORK, build_famous_names, load_perfumes, norm
from dupe_candidates import build_note_matrix

# ----------------------------------------------------------------------------- tunables
MIN_TARGET_VOTES = 300        # a target must have at least this many ratings ("originals are popular")
OTHER_BRAND_MIN_VOTES = 1500  # targets of brands not tagged niche/designer need more popularity
MAX_CANDS = 8                 # candidates (by up votes) scored per perfume
YEAR_TOL = 1                  # target.year <= perfume.year + YEAR_TOL
W = dict(abs=0.32, share=0.24, lead=0.12, sim=0.12, pop=0.06, name=0.06)
ABS_REF = 800                 # up votes giving full "absolute" credit
SIM_LO, SIM_HI = 0.04, 0.45   # weighted-Jaccard range mapped to 0..1
SECOND_RATIO = 0.55           # 2nd target kept if its score >= ratio*first and up >= 0.5*first up
# tier thresholds (applied on score AND guard rules, see tier())
HIGH_SCORE, MED_SCORE, LOW_SCORE = 0.60, 0.48, 0.36
# is_original: lots of reminds votes, nothing clears the low bar
ORIG_MIN_TOTAL_UP, ORIG_MIN_PVOTES = 150, 300
ORIG_MAX_TOP_SHARE = 0.45     # the best target of any kind must not dominate

GENERIC_NAME_TOKS = {"intense", "parfum", "extrait", "elixir", "edition", "limited", "pour", "homme", "femme", "for",
                     "him", "her", "men", "women", "man", "woman", "eau", "de", "toilette", "cologne", "the", "and"}


def read_brand_tags(out_dir, use_longtail=True):
    tags = {}
    for fn in sorted(glob.glob(str(Path(out_dir) / "brand_tags_*.jsonl"))):
        is_lt = Path(fn).name == "brand_tags_longtail.jsonl"
        if is_lt and not use_longtail:
            continue
        with open(fn, encoding="utf8") as f:
            for line in f:
                line = line.strip()
                if line:
                    d = json.loads(line)
                    if d["brand"] in tags and is_lt:
                        continue
                    tags[d["brand"]] = {"tags": set(d.get("tags") or []), "inferred": bool(d.get("inferred")) or is_lt,
                                        "confidence": d.get("confidence")}
    return tags


def clip01(x):
    return max(0.0, min(1.0, x))


def name_core(name):
    """normalised perfume name with generic suffix tokens removed (for name-match)."""
    toks = [t for t in norm(name).split() if t not in GENERIC_NAME_TOKS]
    return " ".join(toks)


def contains_ngram(hay, needle):
    return f" {needle} " in f" {hay} "


def score(c):
    """c: dict with up, share, lead, sim (None ok), tvotes, name_hit(0/1), gender_ok, pool, ratio_ok. -> 0..1"""
    a = clip01(math.log1p(c["up"]) / math.log1p(ABS_REF))
    sh = clip01(c["share"] / 0.6)
    ld = clip01(c["lead"])
    sm = 0.35 if c["sim"] is None else clip01((c["sim"] - SIM_LO) / (SIM_HI - SIM_LO))
    pp = clip01((math.log10(max(c["tvotes"], 1)) - 2.5) / 2.0)
    s = W["abs"] * a + W["share"] * sh + W["lead"] * ld + W["sim"] * sm + W["pop"] * pp + W["name"] * c["name_hit"]
    if not c["gender_ok"]:
        s *= 0.8
    if c["pool"] != "pool":
        s *= 0.88
    if c["ratio"] < 0.12:
        s *= 0.7
    elif c["ratio"] < 0.25:
        s *= 0.85
    return s


def tier(c, s, inferred):
    """-> 'high'|'medium'|'low'|None.  Guards stop thin evidence from reaching a high tier through share alone."""
    up, sh = c["up"], c["share"]
    t = None
    if s >= HIGH_SCORE and up >= 120 and sh >= 0.25 and c["lead"] >= 0.25 and c["ratio"] >= 0.25:
        t = "high"
    elif s >= HIGH_SCORE and up >= 40 and sh >= 0.5 and c["lead"] >= 0.5 and c["name_hit"]:
        t = "high"
    elif s >= MED_SCORE and (up >= 30 or (up >= 20 and sh >= 0.7)):
        t = "medium"
    elif s >= LOW_SCORE and up >= 12:
        t = "low"
    if c["name_hit"] and up < 12 and t is None:  # name-only evidence is noisy in this data (agrees with the votes ~1/3)
        if c["name_hit"] >= 1.0 and (c["sim"] or 0) >= 0.25:
            t = "low"
    if t == "high" and (c["pool"] != "pool" or not c["gender_ok"]):
        t = "medium"
    if inferred and t == "high":
        t = "medium"
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(OUT))
    ap.add_argument("--no-longtail", action="store_true", help="ignore brand_tags_longtail.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--debug-ids", nargs="*", type=int, default=[])
    ap.add_argument("--dump", help="debug: write all scored candidates to this csv")
    a = ap.parse_args()

    bt = read_brand_tags(a.out_dir, not a.no_longtail)
    dupe_brands = {b for b, d in bt.items() if "dupe" in d["tags"]}
    inferred_brands = {b for b in dupe_brands if bt[b]["inferred"]}
    pool_brands = {b for b, d in bt.items() if d["tags"] & {"niche", "designer"} and "dupe" not in d["tags"]}
    print(f"dupe brands {len(dupe_brands)} (inferred {len(inferred_brands)}); pool brands {len(pool_brands)}")

    perfumes = load_perfumes()
    pdf = pd.DataFrame(perfumes).set_index("id")
    pdf["year"] = pdf["year"].astype("float")
    brand_votes = Counter()
    for p in perfumes:
        brand_votes[p["brand"]] += p["rating_count"]
    fam = build_famous_names(perfumes, brand_votes)

    srcs = pdf[pdf.brand.isin(dupe_brands)]
    if a.limit:
        srcs = srcs.sort_values("rating_count", ascending=False).head(a.limit)
    src_ids = set(srcs.index)
    print(f"perfumes of dupe brands: {len(srcs)}")

    # ---------- reminds for the source perfumes
    R = pd.read_csv(WORK / "reminds.csv", usecols=["perfume_id", "target_id", "up", "down"])
    R = R[R.perfume_id.isin(src_ids) & R.target_id.isin(pdf.index)].copy()
    R = R.merge(pdf[["brand"]].rename(columns={"brand": "sbrand"}), left_on="perfume_id", right_index=True)
    R = R.merge(pdf[["brand", "name", "year", "gender", "rating_count"]].add_prefix("t_"), left_on="target_id",
                right_index=True)
    R = R[R.sbrand != R.t_brand]  # flankers of the same house are not "originals"
    tot_up = R.groupby("perfume_id").up.sum()
    max_up_any = R.groupby("perfume_id").up.max()
    n_rem = R.groupby("perfume_id").size()

    # eligible targets
    sy = srcs["year"]
    R = R.join(srcs[["year", "gender", "rating_count"]].add_prefix("s_"), on="perfume_id")
    elig = ~R.t_brand.isin(dupe_brands)
    elig &= R.t_rating_count >= MIN_TARGET_VOTES
    in_pool = R.t_brand.isin(pool_brands)
    elig &= in_pool | (R.t_rating_count >= OTHER_BRAND_MIN_VOTES)
    elig &= ~(R.t_year.notna() & R.s_year.notna() & (R.t_year > R.s_year + YEAR_TOL))
    R["pool"] = np.where(in_pool, "pool", "other")
    Re = R[elig].sort_values(["perfume_id", "up", "down"], ascending=[True, False, True])
    Re = Re.groupby("perfume_id").head(MAX_CANDS)
    print(f"candidate rows {len(Re)} for {Re.perfume_id.nunique()} perfumes")

    # ---------- name-match candidates (target perfume = most voted perfume with that exact name of the owner brand)
    best_by_namebrand = {}
    for p in perfumes:
        key = (norm(p["name"]), p["brand"])
        cur = best_by_namebrand.get(key)
        if cur is None or p["rating_count"] > cur["rating_count"]:
            best_by_namebrand[key] = p
    from _common import name_matches
    extra = []
    have = set(zip(Re.perfume_id, Re.target_id))
    for pid_, p in srcs.iterrows():
        for g, owner, _v in name_matches(p["name"], p["brand"], fam):
            t = best_by_namebrand.get((g, owner))
            if not t or owner in dupe_brands:
                continue
            if t["year"] and not pd.isna(p["year"]) and t["year"] > p["year"] + YEAR_TOL:
                continue
            if (pid_, t["id"]) in have:
                continue
            extra.append(dict(perfume_id=pid_, target_id=t["id"], up=0, down=0, sbrand=p["brand"], t_brand=t["brand"],
                              t_name=t["name"], t_year=t["year"], t_gender=t["gender"],
                              t_rating_count=t["rating_count"], s_year=p["year"], s_gender=p["gender"],
                              s_rating_count=p["rating_count"], pool="pool" if t["brand"] in pool_brands else "other"))
            have.add((pid_, t["id"]))
    if extra:
        Re = pd.concat([Re, pd.DataFrame(extra)], ignore_index=True)
    print(f"name-only candidates added: {len(extra)}")

    # ---------- note similarity for candidate pairs
    X, w, s = build_note_matrix(perfumes)
    ix = {p["id"]: i for i, p in enumerate(perfumes)}
    Xw = X.multiply(w).tocsr()
    ia = np.array([ix[i] for i in Re.perfume_id])
    ib = np.array([ix[i] for i in Re.target_id])
    sim = np.full(len(Re), np.nan)
    B = 20000
    for k in range(0, len(Re), B):
        A_ = X[ia[k:k + B]]
        B_ = Xw[ib[k:k + B]]
        inter = np.asarray(A_.multiply(B_).sum(axis=1)).ravel()
        union = s[ia[k:k + B]] + s[ib[k:k + B]] - inter
        ok = (s[ia[k:k + B]] > 0) & (s[ib[k:k + B]] > 0)
        sim[k:k + B] = np.where(ok, inter / np.maximum(union, 1e-6), np.nan)
    Re = Re.reset_index(drop=True)
    Re["sim"] = sim

    # ---------- feature assembly + scoring
    Re["name_hit"] = 0.0
    for i, r in Re.iterrows():
        pn = norm(pdf.at[r.perfume_id, "name"])
        tc = name_core(r.t_name)
        f = fam.get(norm(r.t_name)) or fam.get(tc)
        if f and f["owner"] == r.t_brand and len(tc) >= 5 and contains_ngram(pn, tc):
            Re.at[i, "name_hit"] = 1.0 if (len(tc.split()) >= 2 or len(tc) >= 8) else 0.6
    Re["total_up"] = Re.perfume_id.map(tot_up).fillna(0)
    Re["share"] = (Re.up / Re.total_up.clip(lower=1)).clip(upper=1)

    results = {}
    for pid_, g in Re.groupby("perfume_id"):
        g = g.sort_values(["up", "down"], ascending=[False, True])
        cands = []
        ups = list(g.up)
        for rank, (_, r) in enumerate(g.iterrows()):
            others = [u for u in ups if u != r.up or ups.index(u) != rank]
            nxt = max([u for j, u in enumerate(ups) if j != rank] or [0])
            lead = 1.0 if nxt == 0 else clip01(math.log(max(r.up, 1) / max(nxt, 1)) / math.log(4)) if r.up >= nxt else 0.0
            sgender, tgender = r.s_gender, r.t_gender
            gender_ok = not ({sgender, tgender} == {"men", "women"})
            ratio = (r.t_rating_count or 0) / max(r.s_rating_count or 1, 1)
            c = dict(up=int(r.up), down=int(r.down), share=float(r.share), lead=lead,
                     sim=None if pd.isna(r.sim) else float(r.sim), tvotes=int(r.t_rating_count),
                     name_hit=float(r.name_hit), gender_ok=gender_ok, pool=r.pool, ratio=ratio,
                     tid=int(r.target_id), tname=r.t_name, tbrand=r.t_brand, rank=rank + 1)
            c["score"] = score(c)
            cands.append(c)
        results[pid_] = sorted(cands, key=lambda c: -c["score"])

    if a.dump:
        rows = [dict(pid=k, **{kk: vv for kk, vv in c.items()}) for k, v in results.items() for c in v]
        pd.DataFrame(rows).to_csv(a.dump, index=False)

    # ---------- emit
    out_path = Path(a.out_dir) / "perfume_dupes_community.jsonl"
    records = []
    n_conf = Counter()
    for pid_, p in srcs.iterrows():
        inferred = p["brand"] in inferred_brands
        cands = results.get(pid_, [])
        best = None
        for c in cands:
            t = tier(c, c["score"], inferred)
            if t:
                best = (c, t)
                break
        if best is None:
            tu = float(tot_up.get(pid_, 0))
            mx = float(max_up_any.get(pid_, 0))
            top_cand_share = max([c["share"] for c in cands] + [mx / tu if tu else 0])
            if tu >= ORIG_MIN_TOTAL_UP and p["rating_count"] >= ORIG_MIN_PVOTES and top_cand_share <= ORIG_MAX_TOP_SHARE:
                records.append({"perfume_id": int(pid_), "dupe_of": [], "is_original": True,
                                "notes": f"{int(tu)} reminds up-votes spread over {int(n_rem.get(pid_, 0))} perfumes; "
                                         f"best target holds {top_cand_share:.0%}: no clear original"
                                         + ("; inferred long-tail brand" if inferred else "")})
                n_conf["original"] += 1
            continue
        c, t = best
        first_tier = t
        dupe_of = [_entry(c, t, inferred)]
        for c2 in cands:
            if c2 is c or c2["tid"] == c["tid"] or _same_line(c, c2):
                continue
            t2 = tier(c2, c2["score"], inferred)
            if t2 and c2["score"] >= SECOND_RATIO * c["score"] and c2["up"] >= 0.5 * c["up"]:
                dupe_of.append(_entry(c2, t2, inferred))
                break
        note = (f"{c['up']} up / {c['down']} down reminds votes ({c['share']:.0%} of this perfume's up-votes)"
                + (f"; note similarity {c['sim']:.2f}" if c["sim"] is not None else "")
                + ("; name match" if c["name_hit"] else "") + ("; inferred long-tail brand" if inferred else ""))
        records.append({"perfume_id": int(pid_), "dupe_of": dupe_of, "is_original": False, "notes": note})
        n_conf[first_tier] += 1

    with open(out_path, "w", encoding="utf8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(dict(n_conf), "->", out_path)

    # ---------- report
    write_report(a, srcs, records, results, pdf, dupe_brands, inferred_brands, tot_up)
    for i in a.debug_ids:
        print(i, pdf.at[i, "name"], [(c["tname"], c["tbrand"], c["up"], round(c["score"], 3), c["share"], c["lead"],
                                      c["sim"], c["name_hit"]) for c in results.get(i, [])[:4]])


def _same_line(c1, c2):
    """True when two targets are the same perfume line (same core name, or same house sharing a name token)."""
    a, b = name_core(c1["tname"]), name_core(c2["tname"])
    if not a or not b:
        return False
    if a == b:
        return True
    if c1["tbrand"] != c2["tbrand"]:
        return False
    return a in b or b in a or bool(set(a.split()) & set(b.split()))


def _entry(c, t, inferred):
    basis = "name" if (c["name_hit"] and c["up"] < 25) else "community"
    return {"target_id": c["tid"], "target_name": c["tname"], "target_brand": c["tbrand"], "confidence": t,
            "basis": basis, "sources": [],
            "evidence": {"up": c["up"], "down": c["down"], "share": round(c["share"], 3),
                         "sim": None if c["sim"] is None else round(c["sim"], 3), "score": round(c["score"], 3)}}


SANITY = [  # (label, perfume_id, set of acceptable target_ids, note)
]


def write_report(a, srcs, records, results, pdf, dupe_brands, inferred_brands, tot_up):
    lines = ["# Dupe assignment report (community + data evidence)", ""]
    conf = Counter()
    for r in records:
        if r["is_original"]:
            conf["is_original"] += 1
        else:
            conf[r["dupe_of"][0]["confidence"]] += 1
    lines.append(f"Perfumes of dupe brands: {len(srcs)} ({len(dupe_brands)} brands, {len(inferred_brands)} inferred). "
                 f"Records: {len(records)}. Unknown (omitted): {len(srcs) - len(records)}")
    lines.append("")
    lines.append("## Counts by first-target confidence")
    lines += [f"- {k}: {conf.get(k, 0)}" for k in ("high", "medium", "low", "is_original")]
    n2 = sum(1 for r in records if len(r["dupe_of"]) == 2)
    lines.append(f"- records with a 2nd target: {n2}")
    lines.append("")
    # coverage per brand
    sb = srcs.brand.value_counts()
    cover = defaultdict(Counter)
    rec_by = {r["perfume_id"]: r for r in records}
    for pid_ in srcs.index:
        r = rec_by.get(pid_)
        b = srcs.at[pid_, "brand"]
        cover[b]["n"] += 1
        if r:
            cover[b]["orig" if r["is_original"] else r["dupe_of"][0]["confidence"]] += 1
    lines.append("## Coverage per brand (top 40 by perfumes, + inferred count)")
    lines.append("| brand | perfumes | high | medium | low | original | unknown |")
    lines.append("|---|---|---|---|---|---|---|")
    for b in list(sb.index[:40]):
        c = cover[b]
        unk = c["n"] - c["high"] - c["medium"] - c["low"] - c["orig"]
        lines.append(f"| {b}{' (inferred)' if b in inferred_brands else ''} | {c['n']} | {c['high']} | {c['medium']} | "
                     f"{c['low']} | {c['orig']} | {unk} |")
    lines.append("")
    # sanity examples
    lines.append("## Calibration notes")
    lines += [
        f"- score = {W} weights on: log(up votes) (full credit at {ABS_REF} up), share of the perfume's total up-votes "
        "(full at 60%), lead over the runner-up target, weighted-Jaccard note similarity, target popularity, famous-name "
        "match; multipliers for gender clash (x0.8), target not in a niche/designer-tagged brand (x0.88), target far less "
        "popular than the perfume (x0.7 if ratio<0.12, x0.85 if <0.25).",
        f"- hard filters: target brand not dupe/inferred-dupe and != own brand, target year <= perfume year+{YEAR_TOL}, "
        f"target votes >= {MIN_TARGET_VOTES} ({OTHER_BRAND_MIN_VOTES} if its brand is not tagged niche/designer).",
        f"- high: score>={HIGH_SCORE} & up>=120 & share>=25% & lead>=0.25 & target>=25% as popular as the perfume (or name "
        f"match + up>=40 + share>=50%); medium: score>={MED_SCORE} & (up>=30 or up>=20 & share>=70%); low: score>={LOW_SCORE} "
        "& up>=12 (or a strong famous-name match with note similarity>=0.25 and no votes). Inferred long-tail brands: "
        "capped at medium.",
        "- down-votes are deliberately ignored (popular targets attract both); name-match evidence is weak in this data "
        "(only ~1/3 of strong name matches coincide with the top-voted target), so it adds little weight and name-only "
        "candidates never exceed 'low'.",
        f"- is_original: >= {ORIG_MIN_TOTAL_UP} total reminds up-votes, perfume votes >= {ORIG_MIN_PVOTES}, no target clears "
        f"'low' and the best target of any kind holds <= {ORIG_MAX_TOP_SHARE:.0%} of up-votes.", ""]
    lines.append("## Sanity examples")
    lines += sanity_lines(pdf, rec_by, results)
    lines.append("")
    rnd = random.Random(7)
    keys = [r for r in records if not r["is_original"]]
    lines.append("## 40 random samples (stratified: 14 high, 14 medium, 12 low) for human review")
    lines.append("| brand | perfume | -> target | conf | evidence |")
    lines.append("|---|---|---|---|---|")
    for cf, n in (("high", 14), ("medium", 14), ("low", 12)):
        pool_ = [r for r in keys if r["dupe_of"][0]["confidence"] == cf]
        for r in rnd.sample(pool_, min(n, len(pool_))):
            d = r["dupe_of"][0]
            tg = f"{d['target_name']} ({d['target_brand']})"
            if len(r["dupe_of"]) == 2:
                tg += f" + {r['dupe_of'][1]['target_name']} ({r['dupe_of'][1]['target_brand']})"
            lines.append(f"| {pdf.at[r['perfume_id'], 'brand']} | {pdf.at[r['perfume_id'], 'name']} "
                         f"(id {r['perfume_id']}) | {tg} | {cf} | {r['notes']} |")
    (WORK / "dupe_assign_report.md").write_text("\n".join(lines) + "\n", encoding="utf8")


def find_id(pdf, name, brand):
    m = pdf[(pdf.name == name) & (pdf.brand == brand)]
    return int(m.index[0]) if len(m) else None


def sanity_lines(pdf, rec_by, results):
    cases = [
        ("Armaf Club de Nuit Intense Man -> Creed Aventus", 34696, {9828}),
        ("Lattafa Khamrah -> Kilian Angels' Share", 75805, {62615}),
        ("Lattafa Asad -> Dior Sauvage Elixir", 72821, {68415}),
        ("Zara Red Temptation For Her -> MFK Baccarat Rouge 540", 63264, {33519, 46066}),
        ("Afnan 9pm -> JPG Ultra Male", 65414, {30947}),
        ("Al Haramain Amber Oud Gold Edition -> Xerjoff Erba Pura", 51816, {55157}),
        ("Rasasi Hawas for Him -> Invictus Aqua / Invictus", 46890, {34506, 18471}),
        ("Assaf No Comment -> Amouage Decision", 132740, {103892}),
        ("Lattafa Yara -> (check: Kirke? expected none/low)", 76880, set()),
    ]
    extra = [("Al Haramain L'Aventure -> Creed Aventus", find_id(pdf, "L'Aventure", "Al Haramain Perfumes"), {9828}),
             ("Maison Alhambra Salvo Elixir -> Dior Sauvage Elixir", find_id(pdf, "Salvo Elixir", "Maison Alhambra"),
              {68415}),
             ("Armaf Tres Nuit -> Creed Green Irish Tweed", find_id(pdf, "Tres Nuit", "Armaf"),
              {x for x in pdf[(pdf.name == "Green Irish Tweed") & (pdf.brand == "Creed")].index}),
             ("Lattafa Ana Abiyedh Rouge -> MFK Baccarat Rouge 540", find_id(pdf, "Ana Abiyedh Rouge", "Lattafa Perfumes"),
              {33519, 46066}),
             ("French Avenue Liquid Brun -> PDM Althair (plausible, from memory)",
              find_id(pdf, "Liquid Brun", "French Avenue"),
              {x for x in pdf[(pdf.brand == "Parfums de Marly") & pdf.name.str.startswith("Alta")].index})]
    out = ["| case | result | confidence | evidence |", "|---|---|---|---|"]
    hits = tot = 0
    for label, pid_, ok in cases + extra:
        if pid_ is None:
            out.append(f"| {label} | perfume not found | | |")
            continue
        r = rec_by.get(pid_)
        if r is None:
            res, cf, ev = "no entry (unknown)", "", ""
        elif r["is_original"]:
            res, cf, ev = "is_original", "", r["notes"]
        else:
            d = r["dupe_of"]
            res = " + ".join(f"{x['target_name']} ({x['target_brand']}, {x['confidence']})" for x in d)
            cf = d[0]["confidence"]
            ev = r["notes"]
        if ok:
            tot += 1
            hit = r is not None and not r["is_original"] and any(x["target_id"] in ok for x in r["dupe_of"])
            top1 = r is not None and not r["is_original"] and r["dupe_of"][0]["target_id"] in ok
            hits += hit
            res = ("HIT(top1) " if top1 else "HIT(2nd) " if hit else "MISS ") + res
        out.append(f"| {label} | {res} | {cf} | {ev} |")
    out.append("")
    out.append(f"Hits {hits}/{tot} of expected cases (Yara excluded as it has no expected target).")
    return out


if __name__ == "__main__":
    main()
