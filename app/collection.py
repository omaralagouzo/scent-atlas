"""My Collection: a scent profile computed from the perfumes a user owns, weighted by their leaderboard rank and rating.

Everything works on the in-memory catalog (no extra I/O): accords come from the CSR accord arrays, notes from the
pyramid arrays, houses from the brand-tag bitmask.
"""
from __future__ import annotations

import math
from collections import Counter

import catalog as cat_mod
import palette

LAYER_W = (0.8, 1.0, 1.0, 0.9)   # top notes fade first, so count slightly less (as in taste.py)

# accord (lower-cased Fragrantica name) -> profile family. Accords not listed fall into "other" and are ignored.
FAMILIES = [
    # key, label, colour, accords (comma separated)
    ("fresh", "Fresh & aquatic", "#4fa8cf", "fresh, aquatic, marine, ozonic, salty, mineral, metallic, sand"),
    ("citrus", "Citrus", "#f2c94c", "citrus, sour"),
    ("green", "Green & aromatic", "#5fa88b", "green, herbal, aromatic, lavender, camphor, conifer, terpenic, anis, cannabis, "
                                            "mossy, fresh spicy"),
    ("floral", "Floral", "#e57fa3", "floral, white floral, rose, yellow floral, tuberose, violet"),
    ("fruity", "Fruity", "#ef7b45", "fruity, tropical, cherry"),
    ("gourmand", "Sweet & gourmand", "#d9467f", "sweet, vanilla, caramel, honey, chocolate, cacao, coffee, nutty, almond, "
                                               "lactonic, coconut, gourmand, milky, beeswax"),
    ("spicy", "Warm spice", "#c4492f", "warm spicy, soft spicy, cinnamon, spicy"),
    ("amber", "Amber & resin", "#c98a3b", "amber, balsamic, oriental, rum, whiskey, wine, alcohol, champagne, vodka, sake"),
    ("woody", "Woody & earthy", "#9a6b3f", "woody, earthy, patchouli, oud"),
    ("smoky", "Leather, smoke & tobacco", "#6b3e26", "leather, smoky, tobacco, animalic"),
    ("musky", "Musky & powdery", "#b59bb3", "musky, musk, powdery, iris, aldehydic, soapy"),
]
FAMILY_OF = {a.strip(): k for k, _l, _c, accs in FAMILIES for a in accs.split(",")}
FAMILY_LABEL = {k: lab for k, lab, _c, _a in FAMILIES}
FAMILY_COLOR = {k: col for k, _l, col, _a in FAMILIES}

# archetype naming: "<adjective of the 2nd family> <noun of the 1st>"
NOUN = {"fresh": "Fresh Spirit", "citrus": "Citrus Chaser", "green": "Green Wanderer", "floral": "Floral Romantic",
        "fruity": "Fruit Lover", "gourmand": "Gourmand", "spicy": "Spice Seeker", "amber": "Amber Soul",
        "woody": "Woods Devotee", "smoky": "Smoke & Leather Connoisseur", "musky": "Skin-Scent Purist"}
ADJ = {"fresh": "Fresh", "citrus": "Zesty", "green": "Aromatic", "floral": "Floral", "fruity": "Fruity",
       "gourmand": "Sweet", "spicy": "Spiced", "amber": "Ambery", "woody": "Woody", "smoky": "Smoky", "musky": "Soft"}
MOOD = {"fresh": "clean and airy", "citrus": "bright and zesty", "green": "green and herbal", "floral": "floral",
        "fruity": "juicy and fruity", "gourmand": "sweet and edible", "spicy": "warm and spicy", "amber": "rich and ambery",
        "woody": "woody", "smoky": "dark and smoky", "musky": "soft and skin-close"}
# a well-rounded wardrobe usually covers these: (key, label, families that count, min share in one perfume, hint)
ESSENTIALS = (
    ("fresh", "Fresh", ("fresh", "citrus", "green"), 0.35, "Nothing fresh yet: a citrus, aquatic or aromatic scent for hot days and the gym."),
    ("woody", "Woody", ("woody",), 0.2, "No woody scent: woods are the most versatile everyday base."),
    ("warm", "Warm & sweet", ("gourmand", "amber", "spicy"), 0.35, "Nothing warm or sweet: cosy ambers and gourmands shine in cold weather."),
    ("floral", "Floral", ("floral",), 0.2, "No florals: a rose, iris or white flower adds range."),
)
TAG_LABEL = {"designer": "Designer", "niche": "Niche", "middle_eastern": "Middle Eastern", "dupe": "Dupe house"}


def perfume_weight(rank: int | None, n_ranked: int, rating: int | None) -> float:
    """Ranked perfumes count more the higher they sit; the top 3 / top 10 get an extra nudge."""
    w = 1.0
    if rank:
        w += 1.5 * (1 - (rank - 1) / max(n_ranked, 1))
        w += 0.75 if rank <= 3 else 0.35 if rank <= 10 else 0.0
    if rating:
        w += 0.4 * (int(rating) - 3)
    return max(w, 0.25)


def accord_vector(cat, i: int) -> dict[str, float]:
    a, b = int(cat.acc_indptr[i]), int(cat.acc_indptr[i + 1])
    out: dict[str, float] = {}
    for k in range(a, b):
        nm = cat.acc_col_names[int(cat._acc_col[int(cat.acc_name[k])])]
        out[nm] = max(out.get(nm, 0.0), int(cat.acc_pct[k]) / 100.0)
    return out


def family_shares(acc: dict[str, float]) -> dict[str, float]:
    fam: dict[str, float] = {}
    for nm, s in acc.items():
        f = FAMILY_OF.get(nm)
        if f:
            fam[f] = fam.get(f, 0.0) + s
    tot = sum(fam.values()) or 1.0
    return {f: v / tot for f, v in fam.items()}


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def build(cat, rows: list[dict]) -> dict:
    """rows: the user's owned perfume_status rows (perfume_id, rating, rank_pos). Unknown ids are skipped."""
    items = [(cat.idx_of(r["perfume_id"]), r) for r in rows]
    items = [(i, r) for i, r in items if i is not None]
    n_ranked = sum(1 for _i, r in items if r.get("rank_pos"))
    out = {"count": len(items), "ranked": n_ranked}
    if not items:
        return out
    acc: dict[str, float] = {}
    acc_n: Counter = Counter()
    fam: dict[str, float] = {}
    cover: dict[str, float] = {}
    note_s: dict[int, float] = {}
    note_n: Counter = Counter()
    tags: Counter = Counter()
    brands: Counter = Counter()
    perfumers: Counter = Counter()
    genders: Counter = Counter()
    years, ratings = [], []
    wsum = 0.0
    for i, r in items:
        w = perfume_weight(r.get("rank_pos"), n_ranked, r.get("rating"))
        wsum += w
        av = accord_vector(cat, i)
        for nm, s in av.items():
            acc[nm] = acc.get(nm, 0.0) + w * s
            if s >= 0.5:
                acc_n[nm] += 1
        fs = family_shares(av)
        for f, s in fs.items():
            fam[f] = fam.get(f, 0.0) + w * s
        for key, _lab, fams, _min, _hint in ESSENTIALS:
            cover[key] = max(cover.get(key, 0.0), sum(fs.get(f, 0.0) for f in fams))
        a, b = int(cat.pn_indptr[i]), int(cat.pn_indptr[i + 1])
        seen = set()
        for k in range(a, b):
            j = int(cat.pn_note[k])
            note_s[j] = note_s.get(j, 0.0) + w * LAYER_W[int(cat.pn_layer[k])]
            if j not in seen:
                seen.add(j)
                note_n[j] += 1
        m = int(cat.p_btags[i])
        for t in ("designer", "niche", "middle_eastern", "dupe"):
            if m & cat_mod.BTAG_BITS[t]:
                tags[t] += 1
        brands[cat.brand(i)] += 1
        for k in range(int(cat.pf_indptr[i]), int(cat.pf_indptr[i + 1])):
            perfumers[cat.perfumer_names[int(cat.pf_ids[k])]] += 1
        genders[cat_mod.GENDER_NAMES[int(cat.p_gender[i])] or "unknown"] += 1
        if cat.p_year[i] > 0:
            years.append(int(cat.p_year[i]))
        if cat.p_rating[i] > 0:
            ratings.append(float(cat.p_rating[i]))

    n = len(items)
    atot = sum(acc.values()) or 1.0
    names = {nm.lower(): nm for nm in cat.acc_names}
    accords = [{"name": names.get(nm, nm), "share": round(v / atot, 4), "color": palette.accord_color(nm),
                "perfumes": int(acc_n.get(nm, 0))}
               for nm, v in sorted(acc.items(), key=lambda kv: -kv[1])[:10]]
    ftot = sum(fam.values()) or 1.0
    families = [{"key": f, "label": FAMILY_LABEL[f], "color": FAMILY_COLOR[f], "share": round(fam.get(f, 0.0) / ftot, 4)}
                for f in sorted(FAMILY_LABEL, key=lambda f: -fam.get(f, 0.0))]

    # favourite notes: how often (weighted) they appear, softly favouring notes that are not everywhere
    ranked_notes = sorted(note_s.items(), key=lambda kv: -(kv[1] * math.sqrt(float(cat.idf[kv[0]]))))
    notes = [cat.note_obj(j, perfumes=int(note_n[j]), share=round(note_n[j] / n, 3)) for j, _s in ranked_notes[:12]]
    # "in most of my perfumes": plain frequency, needs at least 2 perfumes to mean anything
    common = [cat.note_obj(j, perfumes=int(c), share=round(c / n, 3)) for j, c in note_n.most_common(8) if c >= 2]

    top, second = families[0], families[1] if len(families) > 1 else None
    if top["share"] < 0.17:
        title, blurb = "The Explorer", "Your collection spans every family without a clear favourite: a true explorer."
    elif second is None or second["share"] < 0.12 or top["share"] >= 0.45:
        title = f"Devoted {NOUN[top['key']]}"
        blurb = f"Your collection is firmly {MOOD[top['key']]}."
    else:
        title = f"{ADJ[second['key']]} {NOUN[top['key']]}"
        blurb = f"Your collection leans {MOOD[top['key']]}, with a {MOOD[second['key']]} side."
    lead = [a["name"] for a in accords[:2]]
    if lead:
        blurb += f" {_join(lead).capitalize()} {'is' if len(lead) == 1 else 'are'} your strongest accords"
        blurb += f", and {notes[0]['name'].lower()} is your signature note." if notes else "."

    gaps = [{"key": k, "label": lab, "hint": hint} for k, lab, _f, mn, hint in ESSENTIALS if cover.get(k, 0.0) < mn]
    years.sort()
    out.update(
        archetype={"title": title, "blurb": blurb, "families": [top["key"]] + ([second["key"]] if second else [])},
        favorite_accord=accords[0] if accords else None,
        favorite_notes=notes[:3],
        accords=accords, families=families, notes=notes, common_notes=common,
        houses=[{"tag": t, "label": TAG_LABEL[t], "count": int(c), "share": round(c / n, 3)} for t, c in tags.most_common()],
        brands=[{"name": b, "count": int(c)} for b, c in brands.most_common(6) if c >= 2 or len(brands) <= 6][:6],
        perfumers=[{"name": p, "count": int(c)} for p, c in perfumers.most_common(5) if c >= 2],
        genders={g: int(c) for g, c in genders.items()},
        era={"median_year": years[len(years) // 2], "oldest": years[0], "newest": years[-1]} if years else None,
        community_rating=round(sum(ratings) / len(ratings), 2) if ratings else None,
        gaps=gaps if n >= 3 else [],
    )
    return out
