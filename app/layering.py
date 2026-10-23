"""Layering: which two perfumes work worn together, and why.  Research, sources and the reasoning behind every rule and
weight: docs/LAYERING.md.  In short (perfumer guidance from Experimental Perfume Club, D.S. & Durga, Jo Malone, Maison
Margiela, French ELLE / Jean-Claude Ellena and others):

  * one perfume carries the opening (fresh, top-heavy), the other the drydown (deep, base-heavy);
  * simple + complex layers, complex + complex clashes;
  * a shared "bridge" note (best in the base) ties the two into one scent;
  * two heavyweights or sweet-on-sweet turn muddy; aquatic + dense gourmand / amber / oud clash;
  * near-twins are not layering (the same scent, louder); heavier scent goes on first.

Score of a pair (a, b), components in [0, 1]:

    score = 0.20 simplicity + 0.26 affinity + 0.18 popularity + 0.14 structure + 0.12 bridge + 0.10 harmony
          - 0.4 x penalties (two heavyweights, sweet on sweet, two fleeting, two loud animalics, two loud woody-ambers)
          + 0.35 if a brand / perfumer / editor recommends the pair by name

The weights started from the research proposal and were re-fitted against 64 sourced expert pairs versus random
pairs of popular perfumes (docs/LAYERING.md has the numbers): simplicity, related-but-not-identical accords and
popularity carry the signal there. That sample leans on brands' same-line duos, so "affinity" is earned either by
related accords or by a well-matched contrast (fresh over deep with harmonious accords), the other mode the
research describes; otherwise textbook pairs such as a citrus cologne over an amber would fall below the bar.

plus hard exclusions (same scent, near-duplicate, documented clash, complex x complex, heavy+heavy with a complex one,
dupe of each other).  Pairs are recommended only at score >= SHOW; "no recommendation" is a valid answer.
Everything is vectorised over a pool of well-known, well-liked perfumes: one perfume against ~13k takes a few ms.
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path

import numpy as np

from catalog import norm

HERE = Path(__file__).resolve().parent
CURATED_FILE = HERE / "layering_curated.json"

# --------------------------------------------------------------------------- facets (accords pooled for the pair table)
FACETS = [
    ("citrus", "citrus", "citrus, sour"),
    ("fresh", "fresh", "fresh"),
    ("aquatic", "aquatic / ozonic", "aquatic, marine, ozonic, salty, mineral, metallic, sand"),
    ("green", "green", "green, herbal, terpenic, cannabis, mossy"),
    ("aromatic", "aromatic", "aromatic, lavender, camphor, anis, conifer"),
    ("fspice", "fresh spice", "fresh spicy"),
    ("wspice", "warm spice", "warm spicy, soft spicy, cinnamon, spicy"),
    ("floral", "floral", "floral, yellow floral, violet"),
    ("wfloral", "white floral", "white floral, tuberose"),
    ("rose", "rose", "rose"),
    ("powdery", "iris / powdery", "powdery, iris, aldehydic, soapy"),
    ("fruity", "fruity", "fruity, tropical, cherry"),
    ("gourmand", "gourmand", "sweet, caramel, honey, chocolate, cacao, coffee, nutty, almond, gourmand, milky, "
                             "coconut, lactonic, beeswax"),
    ("vanilla", "vanilla", "vanilla"),
    ("amber", "amber", "amber, balsamic, oriental"),
    ("boozy", "boozy", "rum, whiskey, wine, alcohol, champagne, vodka, sake, coca-cola"),
    ("woody", "woody", "woody, earthy, patchouli"),
    ("oud", "oud", "oud"),
    ("smoky", "leather / tobacco / smoke", "leather, smoky, tobacco, asphault, vinyl, rubber, gasoline"),
    ("animalic", "animalic", "animalic"),
    ("musky", "musk", "musky, musk"),
]
FKEYS = [f[0] for f in FACETS]
FI = {k: n for n, k in enumerate(FKEYS)}
FLABEL = {k: lab for k, lab, _a in FACETS}
ACCORD_FACET = {a.strip(): k for k, _l, accs in FACETS for a in accs.split(",")}
NF = len(FACETS)

# per-accord weights (research section 4.2): heaviness 1 / 0.5 / 0, sweetness, "fresh" (opening provider)
_HEAVY1 = set(("amber balsamic vanilla oud leather tobacco animalic smoky caramel chocolate honey rum whiskey coffee "
               "patchouli sweet cinnamon earthy almond cherry coconut cacao nutty beeswax gourmand oriental").split()) | {"warm spicy"}
_HEAVY0 = set(("citrus fresh aquatic marine ozonic green aromatic herbal aldehydic metallic salty mineral lavender camphor "
               "fruity tropical sour anis terpenic soapy").split()) | {"fresh spicy"}
_SWEET = {"sweet": 1, "vanilla": 1, "caramel": 1, "honey": 1, "chocolate": 1, "cacao": 1, "almond": 1, "cherry": 1,
          "coconut": 1, "gourmand": 1, "nutty": 0.8, "fruity": 0.5, "rum": 0.5, "tropical": 0.5, "lactonic": 0.5}
_FRESH = set("citrus aquatic marine ozonic fresh green aromatic herbal aldehydic fruity tropical lavender salty mineral".split()) | {"fresh spicy"}
# notes that make a perfume a skin-scent "enhancer" / linear base (Molecule 01, Not a Perfume, Another 13, Glossier You)
ENHANCER_NOTES = ("iso e super", "ambroxan", "ambrox", "ambroxide", "cetalox", "ambrofix", "cashmeran", "javanol",
                  "ambrettolide", "habanolide", "helvetolide", "galaxolide", "white musk", "clean musk", "skin musk", "ambrette")
LOUD_WOODY_AMBER_NOTES = ("ambroxan", "ambrox", "ambergris", "iso e super", "cetalox")
ENHANCER_NAME = re.compile(r"(^molecule \d|not a perfume|another 13|i don ?t know what|^you$|\bskin\b|\bmusk\b|\bmusc\b)")
# concentration / edition words: "Sauvage" and "Sauvage Elixir" are the same scent for layering purposes
_EDITION = re.compile(r"\b(eau de parfum|eau de toilette|eau de cologne|edp|edt|edc|parfum|extrait( de parfum)?|intense|"
                      r"elixir|le parfum|absolu|absolute|cologne|body mist|hair mist|perfume oil|concentree|"
                      r"(19|20)\d\d)\b")

# --------------------------------------------------------------------------- the pair table (symmetric, -2..+2)
# From the research family matrix (section 2.3) refined with its accord-level overrides (2.4), mapped onto FACETS.
# The text is what users read in "why this works" / "watch out". Unlisted pairs are neutral (0).
PAIRS: dict[tuple[str, str], tuple[float, str]] = {}


def _p(a, b, s, why=""):
    PAIRS[(a, b)] = PAIRS[(b, a)] = (float(s), why)


CLASSIC = "Classic pairing"
# citrus: "the safest base" (French ELLE), lifts heavy ambers (Space NK, Sephora), cologne structure with herbs
_p("citrus", "woody", 2, "Citrus over woods is the most-recommended layer there is: bright opening, dry woody trail.")
_p("citrus", "amber", 2, "Citrus lightens a heavy amber: the classic way to make a rich scent wearable by day.")
_p("citrus", "vanilla", 2, "Citrus over vanilla is uplifting: the zest cuts the sweetness (think tangerine and vanilla).")
_p("citrus", "fresh", 1, "Citrus and airy freshness: crisp, clean, cologne-like.")
_p("citrus", "aquatic", 1, "Citrus with a salty, watery note: a coastal, summery combination.")
_p("citrus", "aromatic", 1, "Citrus and herbs are the backbone of the classic cologne.")
_p("citrus", "fspice", 1, "Citrus and fresh spice (pepper, ginger, cardamom) sharpen each other.")
_p("citrus", "wspice", 1, "Fresh citrus against warm spice: a lively contrast.")
_p("citrus", "floral", 1, "Florals with citrus give a fresh, light, sunny bouquet.")
_p("citrus", "wfloral", 1, "Citrus lifts white flowers and keeps them from feeling heavy.")
_p("citrus", "rose", 1, "Citrus gives rose a fresh, sparkling opening.")
_p("citrus", "powdery", 1, "Citrus brightens soft, powdery iris and aldehydes.")
_p("citrus", "fruity", 1, "Citrus and fruit read as one juicy, fresh accord.")
_p("citrus", "gourmand", 1, "A citrus top keeps a sweet scent from becoming cloying.")
_p("citrus", "boozy", 1, "Citrus peel and boozy notes: a cocktail-like twist.")
_p("citrus", "oud", 1, "Citrus brings air and light to dense oud.")
_p("citrus", "smoky", 1, "Citrus lifts leather and tobacco, like a twist of peel in a smoky room.")
_p("citrus", "musky", 1, "Clean musk under citrus makes the freshness last longer.")
# fresh / ozonic and aquatic: good with clean things, fight the dense ones (Fragrantica / Basenotes consensus)
_p("fresh", "green", 1, "Airy freshness and green notes: crisp and outdoorsy.")
_p("fresh", "aromatic", 1, "Fresh and aromatic: the clean barbershop register.")
_p("fresh", "fspice", 1, "Freshness sharpened with pepper or ginger.")
_p("fresh", "floral", 1, "A fresh, airy floral: like flowers after rain.")
_p("fresh", "woody", 1, "Fresh air over woods: clean and versatile.")
_p("fresh", "musky", 1, "Fresh notes over clean musk: a soft, laundered skin scent.")
_p("fresh", "amber", 1, "A fresh, clean scent over amber keeps it wearable: the fresh-over-deep idea.")
_p("fresh", "gourmand", -1, "Very clean, fresh scents can feel thin against heavy sweetness.")
_p("fresh", "oud", -1, "A clean, fresh scent and dense oud rarely meet in the middle.")
_p("fresh", "animalic", -1, "Clean, fresh notes and animalic ones pull in opposite directions.")
_p("aquatic", "aromatic", 1, "Aquatic and aromatic: the fresh, sporty register.")
_p("aquatic", "fspice", 1, "Sea air with a peppery edge.")
_p("aquatic", "woody", 1, "Sea salt over woods: a classic coastal pairing (the Wood Sage & Sea Salt idea).")
_p("aquatic", "musky", 1, "Clean musk anchors a watery scent so it lasts.")
_p("aquatic", "wspice", -1, "Warm spice against a watery, metallic accord tends to clash.")
_p("aquatic", "gourmand", -2, "Aquatic + dense gourmand is a documented clash: sugar smothers the watery note.")
_p("aquatic", "vanilla", -1, "Watery notes and vanilla usually fight unless the vanilla is very light.")
_p("aquatic", "amber", -2, "Aquatic + heavy amber is the textbook layering pitfall: nothing ties them together.")
_p("aquatic", "boozy", -1, "Watery and boozy notes don't meet in the middle.")
_p("aquatic", "oud", -2, "Aquatic + oud usually fights.")
_p("aquatic", "smoky", -1, "Marine notes over dry leather can smell metallic or like damp cardboard.")
_p("aquatic", "animalic", -1, "Watery and animalic notes clash.")
# green / aromatic
_p("green", "aromatic", 1, "Green and herbal notes: fresh, natural, garden-like.")
_p("green", "floral", 1, "Green notes give florals a fresh, dewy stem.")
_p("green", "wfloral", 1, "Green leaves cut the richness of white flowers.")
_p("green", "rose", 1, "Green notes make rose fresher and more natural.")
_p("green", "fruity", 1, "Fruit with green leaves and herbs (the blackberry and bay structure).")
_p("green", "amber", 1, "Fresh green against deep amber: a fresh-over-deep contrast.")
_p("green", "woody", 1, "Green and woody: the forest-floor pairing.")
_p("green", "musky", 1, "Musk softens and extends green notes.")
_p("green", "gourmand", -1, "Bitter green notes can sour against heavy sweetness.")
_p("aromatic", "vanilla", 2, "Lavender + vanilla is a classic (the fougère-oriental structure behind many favourites).")
_p("aromatic", "gourmand", 1, "Herbal-aromatic notes over sweetness: the lavender-tonka idea.")
_p("aromatic", "amber", 1, "Lavender and herbs over resins and tonka: warm and clean at once.")
_p("aromatic", "fspice", 1, "Aromatic herbs and fresh spices: a crisp classic.")
_p("aromatic", "wspice", 1, "Herbs and warm spice: an aromatic-spicy fougère feel.")
_p("aromatic", "woody", 1, "Aromatic and woody: neighbours on the fragrance wheel.")
_p("aromatic", "musky", 1, "Musk smooths aromatic herbs.")
# spices
_p("fspice", "amber", 2, "Amber and pepper are a classic: the spice keeps the resin from going flat.")
_p("wspice", "amber", 2, "Warm spice and amber are made for each other.")
_p("fspice", "woody", 2, "Spice and woods is a classic pairing: dry, warm, polished.")
_p("wspice", "woody", 2, "Warm spice and woods: a classic, cosy pairing.")
for _s in ("fspice", "wspice"):
    _p(_s, "floral", 1, "Spice gives florals an edge (think pepper and rose).")
    _p(_s, "wfloral", 1, "Spice adds bite to creamy white flowers.")
    _p(_s, "rose", 1, "Spiced rose: a long-standing perfumery favourite.")
    _p(_s, "fruity", 1, "Spice sharpens fruit (the pomegranate and pink-pepper idea).")
    _p(_s, "gourmand", 1, "A spicy gourmand: spice keeps the sweetness interesting.")
    _p(_s, "vanilla", 1, "Spice and vanilla: warm and inviting.")
    _p(_s, "boozy", 1, "Spice and booze: a mulled, festive feel.")
    _p(_s, "oud", 1, "Spice is oud's traditional companion.")
    _p(_s, "smoky", 1, "Spice and leather or tobacco: warm and textured.")
    _p(_s, "musky", 1, "Musk softens spice.")
# florals
for _a in ("floral", "wfloral", "rose"):
    _p(_a, "woody", 2, "Florals over woods is one of the most reliable layers: the flowers lead, the woods hold them up.")
    _p(_a, "musky", 2, "Musk is the classic bridge under florals: it smooths them and makes them last.")
    _p(_a, "fruity", 1, "Fruity-floral is the most common modern structure; they blend naturally.")
    _p(_a, "gourmand", 1, "A touch of sweetness rounds out a floral.")
    _p(_a, "vanilla", 1, "Vanilla under a floral adds depth without overwhelming it.")
    _p(_a, "amber", 1, "Floral-amber neighbours on the fragrance wheel: warm and luminous.")
    _p(_a, "powdery", 1, "Florals and soft powder: elegant and classic.")
_p("floral", "wfloral", 1, "Two florals from different flowers make a richer bouquet.")
_p("floral", "rose", 1, "Rose with other flowers: a fuller bouquet.")
_p("wfloral", "rose", 1, "Rose with jasmine or tuberose: a lush bouquet.")
_p("floral", "floral", 1, "Two florals blend seamlessly (same family is the safe choice).")
_p("rose", "rose", 1, "Two roses amplify each other into a fuller rose.")
_p("rose", "oud", 2, "Rose + oud is the archetypal Middle-Eastern pairing: the rose softens, the oud deepens.")
_p("floral", "oud", 1, "Florals soften oud.")
_p("rose", "smoky", 1, "Rose with leather or smoke: dark and romantic.")
# iris / powdery
_p("powdery", "musky", 2, "Iris and clean musk are the bridge notes perfumers reach for: soft, skin-like, seamless.")
_p("powdery", "smoky", 1, "Iris and leather: a refined, suede-like pairing.")
_p("powdery", "gourmand", 1, "Powder and sweetness: a soft, comforting blend.")
_p("powdery", "vanilla", 1, "Iris and vanilla: soft, creamy and elegant.")
_p("powdery", "amber", 1, "Powdery iris over amber: plush and warm.")
_p("powdery", "woody", 1, "Iris over woods: elegant and dry.")
# fruity
_p("fruity", "woody", 1, "Fruity over woody: juicy top, dry base.")
_p("fruity", "amber", 1, "Fruit over amber: a warm, glowing pairing.")
_p("fruity", "boozy", 1, "Fruit and booze: a cocktail accord.")
# sweet side
_p("gourmand", "gourmand", -1, "Sweet on sweet with nothing to cut it is the most common layering failure.")
_p("gourmand", "woody", 2, "Woods under a sweet scent add depth and stop it being cloying.")
_p("gourmand", "amber", 1, "Sweet and amber: rich and cosy (go light, both are heavy).")
_p("gourmand", "boozy", 1, "Sweet and boozy: dessert-like.")
_p("gourmand", "smoky", 1, "Sweetness against tobacco or smoke: a classic contrast.")
_p("gourmand", "musky", 1, "Musk softens sweetness into a skin scent.")
_p("gourmand", "oud", -1, "Oud with a dense gourmand: both heavy, they overpower each other.")
_p("vanilla", "woody", 2, "Vanilla + woods is a perfumer favourite: creamy sweetness on a dry base.")
_p("vanilla", "boozy", 2, "Rum and vanilla: a classic boozy-gourmand pairing.")
_p("vanilla", "smoky", 2, "Tobacco and vanilla are a classic accord (the idea behind many cult favourites).")
_p("vanilla", "amber", 1, "Vanilla and amber: warm and enveloping (one spray each).")
_p("vanilla", "oud", 1, "A light vanilla tempers oud's smoky, medicinal edge.")
_p("vanilla", "musky", 1, "Vanilla and musk: the soft, skin-scent pairing behind many layering sets.")
# amber, woods, oud, leather, animalic, musk
_p("amber", "amber", -1, "Two heavy ambers crowd each other and turn muddy.")
_p("amber", "woody", 2, "Amber and woods: the woody-amber family exists because they belong together.")
_p("amber", "boozy", 1, "Amber and boozy notes: warm and festive.")
_p("amber", "oud", 1, "Amber and oud: rich and autumnal (keep it to one spray each).")
_p("amber", "smoky", 1, "Amber with leather or tobacco: warm, autumnal.")
_p("amber", "musky", 1, "Musk softens amber.")
_p("boozy", "woody", 1, "Booze over woods: like a barrel-aged spirit.")
_p("boozy", "smoky", 1, "Rum and tobacco: a smoky-bar classic.")
_p("woody", "woody", 1, "Two different woods (cedar with vetiver, say) layer seamlessly.")
_p("woody", "musky", 2, "Musk and woody skin-scent molecules (Iso E Super, ambroxan) layer under almost anything.")
_p("woody", "oud", 1, "Woods are oud's natural partner.")
_p("woody", "smoky", 1, "Woods with leather or smoke: dry and textured.")
_p("oud", "oud", -1, "Two ouds overpower each other.")
_p("oud", "animalic", -1, "Oud's barnyard side and other animalic notes add up to too much.")
_p("oud", "musky", 1, "Musk smooths oud.")
_p("smoky", "musky", 1, "Musk softens leather and smoke.")
_p("smoky", "animalic", -1, "Leather and animalic notes together get too dirty for most.")
_p("animalic", "animalic", -1, "Two strong animalics add up to too much.")
_p("musky", "musky", 1, "Musk with musk: a soft, amplified skin scent.")

# documented clashes that exclude a pair outright when both sides are strong in them (raw accord strength >= t)
CLASH_RULES = [
    ("aquatic", "gourmand", 0.6, "Aquatic + dense gourmand is a documented clash: the sweetness smothers the watery note."),
    ("aquatic", "amber", 0.6, "Aquatic + heavy amber is the textbook layering pitfall."),
    ("aquatic", "oud", 0.6, "Aquatic + oud usually fights."),
]

K = np.zeros((NF, NF), dtype=np.float32)
for (_a, _b), (_s, _w) in PAIRS.items():
    K[FI[_a], FI[_b]] = _s

# --------------------------------------------------------------------------- thresholds / weights (research 5.3)
POOL_MIN_VOTES = 250        # catalog-wide suggestions only come from well-known perfumes ...
POOL_MIN_RATING = 3.6       # ... that people like
W = {"bridge": 0.12, "compat": 0.10, "struct": 0.14, "simple": 0.20, "affinity": 0.26, "pop": 0.18}
PENALTY_SCALE = 0.4         # independent tests (sweet on sweet, two heavies) vs brands' own sweet duos: a soft push
CURATED_BOOST = 0.35
NEAR_DUP_NOTES = 0.62       # IDF note cosine above this = basically the same perfume
NEAR_DUP_ACCORDS = 0.93     # accord cosine above this together with ...
NEAR_DUP_NOTES_WITH_ACC = 0.4   # ... this much note overlap = the same idea twice
SHOW = 0.60                 # minimum score to recommend: the top ~12% of all pairings (see PERCENTILES)
# whitelisted bridges (Experimental Perfume Club, Sand + Fog): count even though they are everywhere
BRIDGE_FLOOR = {"iris": 0.5, "musk": 0.5, "white-musk": 0.5, "vanilla": 0.5, "sandalwood": 0.5, "jasmine": 0.5, "rose": 0.5}
TIER_W = np.array([  # perfume a layer x perfume b layer (top, middle, base, general) -> bridge weight
    [0.4, 0.4, 0.4, 0.4],
    [0.4, 0.6, 0.8, 0.6],
    [0.4, 0.8, 1.0, 0.6],
    [0.4, 0.6, 0.6, 0.6]], dtype=np.float32)
# labels: popular, note-rich perfumes score higher across the board, so the top labels sit above their typical best
VERDICTS = ((0.74, "classic", "Exceptional pairing"), (0.67, "great", "Great match"), (SHOW, "good", "Good match"),
            (0.47, "neutral", "Not much synergy"), (-99, "weak", "Weak match"))
BLOCKED = ("blocked", "Not recommended")
# score -> share of pairings it beats, measured on the full catalog: 48k random pool pairs that pass the hard rules
PERCENTILES = ((0.446, 40), (0.473, 50), (0.546, 75), (0.588, 85), (0.617, 90), (0.64, 93), (0.66, 95), (0.686, 97),
               (0.707, 98), (0.735, 99), (0.759, 99.5))


def verdict(score: float) -> tuple[str, str]:
    for t, key, label in VERDICTS:
        if score >= t:
            return key, label
    return VERDICTS[-1][1], VERDICTS[-1][2]


def percentile(score: float) -> float:
    """Share of pairings (in %) this score beats; 'top X%' = 100 - this."""
    xs, ps = zip(*PERCENTILES)
    return float(np.interp(score, xs, ps, left=max(0.0, ps[0] - 40 * (xs[0] - score) / 0.1), right=99.9))


def top_share(score: float) -> float:
    """'Top 3%' style number: the share of pairings that score at least this well (one decimal under 1%)."""
    t = 100.0 - percentile(score)
    return round(t, 1) if t < 1 else float(round(t))


# --------------------------------------------------------------------------- per-perfume features
class Feats:
    """Everything the pair score needs about a set of perfume indices (vectors in the same order as idx)."""

    def __init__(self, cat, m: "Model", idx):
        idx = np.asarray(idx, dtype=np.int64)
        self.idx = idx
        starts, ends = cat.acc_indptr[idx].astype(np.int64), cat.acc_indptr[idx + 1].astype(np.int64)
        lens = ends - starts
        rows = np.repeat(np.arange(len(idx)), lens)
        ent = np.repeat(starts - np.concatenate([[0], np.cumsum(lens)[:-1]]), lens) + np.arange(int(lens.sum()))
        col = cat.acc_colid[ent].astype(np.int64) if len(ent) else np.zeros(0, np.int64)
        s = cat.acc_pct[ent].astype(np.float32) / 100.0 if len(ent) else np.zeros(0, np.float32)
        n = len(idx)
        fac = m.col_facet[col]
        ok = fac >= 0
        raw = np.zeros((n, NF), dtype=np.float32)
        np.add.at(raw, (rows[ok], fac[ok].astype(np.int64)), s[ok])
        tot = raw.sum(1, keepdims=True)
        self.has_acc = tot[:, 0] > 0
        self.F = np.divide(raw, tot, out=np.zeros_like(raw), where=tot > 0)          # facet distribution (sums to 1)
        self.Fmax = np.minimum(raw, 1.0)                                            # facet strength, strongest accord = 1
        stot = np.bincount(rows, weights=s, minlength=n)
        self.heavy = np.divide(np.bincount(rows, weights=s * m.col_heavy[col], minlength=n), stot,
                               out=np.zeros(n), where=stot > 0).astype(np.float32)
        self.fresh = np.divide(np.bincount(rows, weights=s * m.col_fresh[col], minlength=n), stot,
                               out=np.zeros(n), where=stot > 0).astype(np.float32)
        sweet = np.zeros(n, dtype=np.float32)
        np.maximum.at(sweet, rows, s * m.col_sweet[col])
        self.sweet = sweet
        strong = np.bincount(rows, weights=(s >= 0.4).astype(np.float32), minlength=n)
        nn = m.n_notes[idx]
        self.complex = (nn >= 14) | (strong >= 7)
        names = [norm(cat.name(int(i))) for i in idx]
        self.enhancer = (m.enhancer_note[idx] & (nn <= 6)) | np.array([bool(ENHANCER_NAME.search(x)) for x in names], dtype=bool)
        self.simple = ~self.complex & (((nn > 0) & (nn <= 6)) | (strong <= 3) | self.enhancer)
        self.loud_wa = m.loud_note[idx] & (self.Fmax[:, FI["woody"]] >= 0.7) & (self.Fmax[:, FI["amber"]] >= 0.5)
        self.brand = cat.p_brand_idx[idx].astype(np.int64)
        self.base_name = np.array([same_scent_key(cat, int(i)) for i in idx], dtype=object)

    def row(self, k: int) -> dict:
        return {key: v[k] for key, v in vars(self).items()}

    def slice(self, sl) -> "Feats":
        out = Feats.__new__(Feats)
        for key, v in vars(self).items():
            setattr(out, key, v[sl])
        return out


def same_scent_key(cat, i: int) -> str:
    return re.sub(r"\s+", " ", _EDITION.sub(" ", cat.name_norm(i))).strip()


class Model:
    """Note-level arrays for the whole catalog (~1 MB), the candidate pool's features (~3 MB) and the curated pairs."""

    def __init__(self, cat):
        n = cat.n_perf
        nc = max(cat.n_acc_cols, 1)
        self.col_facet = np.full(nc, -1, dtype=np.int16)
        self.col_heavy = np.full(nc, 0.5, dtype=np.float32)
        self.col_sweet = np.zeros(nc, dtype=np.float32)
        self.col_fresh = np.zeros(nc, dtype=np.float32)
        for c, nm in enumerate(cat.acc_col_names):
            if nm in ACCORD_FACET:
                self.col_facet[c] = FI[ACCORD_FACET[nm]]
            self.col_heavy[c] = 1.0 if nm in _HEAVY1 else 0.0 if nm in _HEAVY0 else 0.5
            self.col_sweet[c] = _SWEET.get(nm, 0.0)
            self.col_fresh[c] = 1.0 if nm in _FRESH else 0.0
        w2 = cat.idf.astype(np.float64) ** 2
        note_of = np.repeat(np.arange(cat.n_notes), np.diff(cat.na_indptr))
        self.note_norm = np.sqrt(np.bincount(cat.na_perf, weights=w2[note_of], minlength=n)).astype(np.float32)
        self.n_notes = np.bincount(cat.na_perf, minlength=n).astype(np.int16)
        self.bridge_w = np.minimum(1.0, cat.idf / 5.0).astype(np.float32)
        for slug, floor in BRIDGE_FLOOR.items():
            j = cat.note_index.get(slug)
            if j is not None:
                self.bridge_w[j] = max(self.bridge_w[j], floor)

        def flag(names):
            out = np.zeros(n, dtype=bool)
            for j, nm in enumerate(cat.note_name):
                if norm(nm) in names:
                    out[cat.any_rows(j)] = True
            return out
        self.enhancer_note = flag(set(ENHANCER_NOTES))
        self.loud_note = flag(set(LOUD_WOODY_AMBER_NOTES))
        cand = np.flatnonzero((cat.p_votes >= POOL_MIN_VOTES) & (cat.p_rating >= POOL_MIN_RATING))
        pf = Feats(cat, self, cand)
        self.pool = pf.slice(pf.has_acc)
        self.curated, self.curated_missing = load_curated(cat)


_lock = threading.Lock()


def model(cat) -> Model:
    """The catalog's layering model, built on first use and kept on the catalog object (so it lives and dies with it)."""
    m = getattr(cat, "_layering_model", None)
    if m is None:
        with _lock:
            m = getattr(cat, "_layering_model", None)
            if m is None:
                m = Model(cat)
                cat._layering_model = m
    return m


def feats_of(cat, idx) -> Feats:
    return Feats(cat, model(cat), np.asarray(idx, dtype=np.int64))


# --------------------------------------------------------------------------- curated (editor / brand / perfumer) pairs
BRAND_ALIASES = {"thierry mugler": "mugler", "shiseido": "serge lutens", "maison margiela": "maison martin margiela"}


def _bkey(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", norm(s))


def _nkey(cat, name: str, brand: str) -> str:
    """Name without edition words, punctuation, a leading brand name or 'Replica' ("Chanel No 5 Parfum" -> "no5")."""
    n = _EDITION.sub(" ", norm(name))
    for pre in {norm(brand), norm(brand).split(" ")[0], "replica"}:
        if pre and n.startswith(pre + " "):
            n = n[len(pre) + 1:]
    return re.sub(r"[^a-z0-9]", "", n)


def _resolve(cat, brand: str, name: str):
    """Catalog index of a perfume named in an article: brand matched loosely ("Kayali" = "Kayali Fragrances",
    "Kilian" = "By Kilian"), name exact after folding (accents, punctuation, edition words). The most-voted wins."""
    bk = _bkey(BRAND_ALIASES.get(norm(brand), brand))
    want = _nkey(cat, name, brand)
    toks = [t for t in norm(name).split() if len(t) > 2 and t not in ("replica", "eau", "the")] or norm(name).split()
    if not toks or not want:
        return None
    best = None
    for i in cat._containing(max(toks, key=len)):
        i = int(i)
        cb = _bkey(cat.brand(i))
        if not (cb == bk or (min(len(cb), len(bk)) >= 4 and (cb in bk or bk in cb))):
            continue
        if _nkey(cat, cat.name(i), cat.brand(i)) == want:
            if best is None or cat.p_votes[i] > cat.p_votes[best]:
                best = i
    return best


def load_curated(cat):
    """{perfume index: [(partner index, note, source_url)]} plus the pairs that did not resolve against this catalog."""
    out: dict[int, list] = {}
    missing = []
    try:
        rows = json.loads(CURATED_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out, missing
    for r in rows:
        a, b = _resolve(cat, r["a_brand"], r["a_name"]), _resolve(cat, r["b_brand"], r["b_name"])
        if a is None or b is None or a == b:
            missing.append(r)
            continue
        out.setdefault(a, []).append((b, r["note"], r["source_url"]))
        out.setdefault(b, []).append((a, r["note"], r["source_url"]))
    return out, missing


def curated_info(cat, i: int, j: int):
    for other, note, url in model(cat).curated.get(i, ()):
        if other == j:
            return {"note": note, "source_url": url, "source": url.split("/")[2].removeprefix("www.")}
    return None


# --------------------------------------------------------------------------- scoring
def note_cosine(cat, m: Model, i: int, cand: np.ndarray) -> np.ndarray:
    """IDF-weighted cosine of perfume i's notes with every perfume in cand (layer-agnostic; near-duplicate test)."""
    dots = np.zeros(cat.n_perf, dtype=np.float32)
    a, b = int(cat.pn_indptr[i]), int(cat.pn_indptr[i + 1])
    for j in set(cat.pn_note[a:b].tolist()):
        dots[cat.any_rows(j)] += float(cat.idf[j]) ** 2
    den = m.note_norm[cand] * m.note_norm[i]
    return np.divide(dots[cand], den, out=np.zeros(len(cand), np.float32), where=den > 0)


def bridge_scores(cat, m: Model, i: int, cand: np.ndarray) -> np.ndarray:
    """Shared notes weighted by rarity (with a floor for the classic bridges) and by tier: a shared base note counts
    most, a shared top note least (it is gone after half an hour). Capped at 1."""
    acc = np.zeros(cat.n_perf, dtype=np.float32)
    best = np.zeros(cat.n_perf, dtype=np.float32)
    a, b = int(cat.pn_indptr[i]), int(cat.pn_indptr[i + 1])
    mine: dict[int, list[int]] = {}
    for k in range(a, b):
        mine.setdefault(int(cat.pn_note[k]), []).append(int(cat.pn_layer[k]))
    for j, layers in mine.items():
        tw = TIER_W[layers].max(0)                    # best weight per candidate layer for this note
        touched = []
        for L in range(4):
            rows = cat.layer_rows(L, j)
            if rows.size:
                best[rows] = np.maximum(best[rows], tw[L])
                touched.append(rows)
        if touched:
            rows = np.unique(np.concatenate(touched))
            acc[rows] += float(m.bridge_w[j]) * best[rows]
            best[rows] = 0.0
    return np.minimum(1.0, acc[cand] / 2.0)


SPARSE_MAX = 600   # below this many candidates (a collection), pair statistics are computed pair by pair


def _note_layers(cat, p: int) -> dict[int, list[int]]:
    d: dict[int, list[int]] = {}
    for k in range(int(cat.pn_indptr[p]), int(cat.pn_indptr[p + 1])):
        d.setdefault(int(cat.pn_note[k]), []).append(int(cat.pn_layer[k]))
    return d


def _accord_vec(cat, p: int) -> dict[int, float]:
    d: dict[int, float] = {}
    for k in range(int(cat.acc_indptr[p]), int(cat.acc_indptr[p + 1])):
        c = int(cat._acc_col[int(cat.acc_name[k])])
        d[c] = d.get(c, 0.0) + float(cat.acc_w[k])
    return d


def pair_stats(cat, m: Model, i: int, cand: np.ndarray):
    """(note cosine, bridge, accord cosine) of perfume i against cand. Dense passes over the catalog for a big pool,
    plain set intersections for a handful of candidates (both give the same numbers)."""
    if len(cand) > SPARSE_MAX:
        return note_cosine(cat, m, i, cand), bridge_scores(cat, m, i, cand), cat.accord_cosine(i)[cand]
    ni, ai = _note_layers(cat, i), _accord_vec(cat, i)
    idf = cat.idf
    cos = np.zeros(len(cand), np.float32)
    bridge = np.zeros(len(cand), np.float32)
    acos = np.zeros(len(cand), np.float32)
    for k, c in enumerate(cand.tolist()):
        nj = _note_layers(cat, c)
        dot = br = 0.0
        for nt in ni.keys() & nj.keys():
            dot += float(idf[nt]) ** 2
            br += float(m.bridge_w[nt]) * max(float(TIER_W[a, b]) for a in ni[nt] for b in nj[nt])
        den = float(m.note_norm[i]) * float(m.note_norm[c])
        cos[k] = dot / den if den > 0 else 0.0
        bridge[k] = min(1.0, br / 2.0)
        aj = _accord_vec(cat, c)
        acos[k] = sum(v * aj[col] for col, v in ai.items() if col in aj)
    return cos, bridge, acos


def score_against(cat, i: int, fi: dict, cf: Feats) -> dict:
    """Vectorised pair score of perfume i (its feature row fi) against every perfume in cf, plus the flags behind the
    hard exclusions. Arrays are in cf order."""
    m = model(cat)
    cand = cf.idx
    compat = np.clip(cf.F @ (K @ fi["F"]) / 2.0, -1, 1)
    cos, bridge, acos = pair_stats(cat, m, i, cand)
    hi, hj = float(fi["heavy"]), cf.heavy
    wc = np.minimum(1.0, np.abs(hj - hi) / 0.45)
    dry_i, dry_j = np.clip((hi - 0.3) / 0.5, 0, 1), np.clip((hj - 0.3) / 0.5, 0, 1)
    open_i, open_j = np.clip(float(fi["fresh"]) * 1.6, 0, 1), np.clip(cf.fresh * 1.6, 0, 1)
    struct = 0.5 * wc + 0.5 * np.maximum(open_i * dry_j, open_j * dry_i)
    ci, si = bool(fi["complex"]), bool(fi["simple"])
    simple = np.where(cf.simple & si, 0.8, np.where((cf.simple & ci) | (cf.complex & si), 1.0,
                      np.where(cf.simple | si, 0.6, np.where(cf.complex | ci, 0.3, 0.5)))).astype(np.float32)
    simple = np.minimum(1.0, simple + 0.2 * (cf.enhancer | bool(fi["enhancer"])))
    # affinity, the two ways layering works (Jo Malone CBE, David Adelon): the same family ("seamless harmony",
    # near-twins get no extra credit) or a well-matched contrast (fresh over deep with accords that get along)
    related = np.minimum(np.clip(acos, 0, 1), 0.8) / 0.8
    contrast = np.clip((struct - 0.5) / 0.4, 0, 1) * np.clip((compat - 0.25) / 0.35, 0, 1)
    affinity = np.maximum(related, contrast)
    pop = cat.p_pop[cand] * np.clip(cat.p_rating[cand] / 5.0, 0, 1)
    score = (W["bridge"] * bridge + W["compat"] * (compat + 1) / 2 + W["struct"] * struct + W["simple"] * simple
             + W["affinity"] * affinity + W["pop"] * pop)
    # penalties
    pen = np.maximum(0, np.minimum(hj, hi) - 0.6) * 1.5                                   # two heavyweights
    pen += np.maximum(0, np.minimum(cf.sweet, fi["sweet"]) - 0.65) * 1.5                 # sweet on sweet
    overload = (cf.sweet >= 0.8) & (fi["sweet"] >= 0.8) & (cf.fresh < 0.3) & (fi["fresh"] < 0.3)
    pen += 0.3 * overload
    pen += np.maximum(0, 0.25 - np.maximum(hj, hi)) * 1.0                                # two fleeting
    ia = FI["animalic"]
    pen += 0.3 * ((cf.Fmax[:, ia] >= 0.6) & (fi["Fmax"][ia] >= 0.6))
    pen += 0.25 * (cf.loud_wa & bool(fi["loud_wa"]))
    score = score - PENALTY_SCALE * pen
    cur = np.zeros(len(cand), dtype=np.float32)
    partners = [p for p, _n, _u in m.curated.get(i, ())]
    if partners:
        cur = np.isin(cand, partners).astype(np.float32)
        score = score + CURATED_BOOST * cur
    # hard exclusions
    same = (cf.brand == int(fi["brand"])) & (cf.base_name == fi["base_name"])
    near_dup = same | (cos >= NEAR_DUP_NOTES) | ((acos >= NEAR_DUP_ACCORDS) & (cos >= NEAR_DUP_NOTES_WITH_ACC))
    mud = (hj >= 0.75) & (hi >= 0.75) & (cf.complex | ci)
    excluded = near_dup | hard_clash(fi, cf) | (cf.complex & ci) | mud
    excluded &= cur == 0           # a pair a brand or perfumer recommends by name is never hidden by our rules
    return {"score": score.astype(np.float32), "compat": compat, "bridge": bridge, "cos": cos, "acos": acos, "related": related, "contrast": contrast, "affinity": affinity,
            "struct": struct, "simple": simple, "pen": pen, "near_dup": near_dup, "excluded": excluded, "curated": cur}


def hard_clash(fi: dict, cf: Feats) -> np.ndarray:
    out = np.zeros(len(cf.idx), dtype=bool)
    for a, b, t, _why in CLASH_RULES:
        ia, ib = FI[a], FI[b]
        out |= ((fi["Fmax"][ia] >= t) & (cf.Fmax[:, ib] >= t)) | ((fi["Fmax"][ib] >= t) & (cf.Fmax[:, ia] >= t))
    return out


def clash_reasons(fi: dict, fj: dict) -> list[str]:
    out = []
    for a, b, t, why in CLASH_RULES:
        ia, ib = FI[a], FI[b]
        if (fi["Fmax"][ia] >= t and fj["Fmax"][ib] >= t) or (fi["Fmax"][ib] >= t and fj["Fmax"][ia] >= t):
            out.append(why)
    return out


# --------------------------------------------------------------------------- recommendations
def candidates(cat, i: int, cf: Feats, exclude=(), min_score: float = SHOW, per_brand: int | None = 2, limit: int = 30,
               offset: int = 0):
    """Best partners of perfume i among cf: (rows into cf, score dict, fi, total). Excluded pairs and dupes of each
    other never qualify. per_brand caps each house (i's own house gets one more: brands design their lines to layer)."""
    fi = feats_of(cat, [i]).row(0)
    r = score_against(cat, i, fi, cf)
    ok = (r["score"] >= min_score) & ~r["excluded"] & (cf.idx != i)
    for x in exclude:
        ok &= cf.idx != x
    rows = np.flatnonzero(ok)
    order = rows[np.argsort(-r["score"][rows], kind="stable")]
    kept, seen = [], {}
    own = int(cat.p_brand_idx[i])
    for k in order:
        j = int(cf.idx[k])
        if cat.link_relation(i, j):
            continue
        b = int(cat.p_brand_idx[j])
        cap = None if not per_brand else per_brand + (1 if b == own else 0)
        if cap is None or seen.get(b, 0) < cap:
            seen[b] = seen.get(b, 0) + 1
            kept.append(k)
    order = np.array(kept, dtype=np.int64)
    return order[offset:offset + limit], r, fi, int(len(order))


# --------------------------------------------------------------------------- explanations
def _join(words) -> str:
    words = [w for w in words if w]
    if not words:
        return ""
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _layer_notes(cat, i: int, layers, limit: int = 3) -> list[str]:
    a, b = int(cat.pn_indptr[i]), int(cat.pn_indptr[i + 1])
    return [cat.note_name[int(cat.pn_note[k])] for k in range(a, b) if int(cat.pn_layer[k]) in layers][:limit]


def _top_accords(cat, i: int, n: int = 2) -> list[str]:
    return [a["name"] for a in cat.accords_out(i, n)]


def shared_notes(cat, i: int, j: int) -> list[tuple[int, int, int]]:
    """[(note, layer in i, layer in j)] shared by both, best bridges (base tier, rare) first."""
    def layers(p):
        d: dict[int, int] = {}
        for k in range(int(cat.pn_indptr[p]), int(cat.pn_indptr[p + 1])):
            nt, L = int(cat.pn_note[k]), int(cat.pn_layer[k])
            d[nt] = max(d.get(nt, -1), L)
        return d
    a, b = layers(i), layers(j)
    m = model(cat)
    both = [(nt, a[nt], b[nt]) for nt in a.keys() & b.keys()]
    both.sort(key=lambda t: -(float(TIER_W[t[1], t[2]]) * float(m.bridge_w[t[0]])))
    return both


def reasons(cat, i: int, j: int, fi: dict, fj: dict, feats: dict) -> tuple[list[dict], list[dict]]:
    """(why it works, watch-outs): short titled sentences, strongest first."""
    pros, cons = [], []
    cur = curated_info(cat, i, j)
    if cur:
        pros.append({"kind": "curated", "title": "Recommended by name", "text": cur["note"], "source": cur["source"],
                     "url": cur["source_url"]})
    # accord harmony: the facet pairs that contribute most
    contrib = np.outer(fi["F"], fj["F"]) * K
    sym = contrib + contrib.T
    np.fill_diagonal(sym, np.diag(contrib))
    seen = set()
    acc_pros = []
    for flat in np.argsort(-np.abs(sym), axis=None)[:16]:
        a, b = divmod(int(flat), NF)
        key = (min(a, b), max(a, b))
        v = float(sym[a, b])
        if key in seen or abs(v) < 0.015:
            continue
        seen.add(key)
        s, why = PAIRS.get((FKEYS[a], FKEYS[b]), (0.0, ""))
        if not why:
            continue
        fa, fb = FLABEL[FKEYS[a]], FLABEL[FKEYS[b]]
        title = (f"{CLASSIC}: {fa} + {fb}" if s >= 2 else f"{fa.capitalize()} + {fb}") if a != b else f"Tonal: {fa}"
        if v > 0:
            acc_pros.append({"kind": "accord", "title": title, "text": why})
        elif v <= -0.04:
            cons.append({"kind": "accord", "title": title, "text": why})
    pros += acc_pros[:2]
    cons = cons[:2]
    sh = shared_notes(cat, i, j)
    if sh and float(feats["bridge"]) >= 0.1:
        names = [cat.note_name[nt] for nt, _a, _b in sh[:3]]
        in_base = sh[0][1] == 2 and sh[0][2] == 2
        pros.append({"kind": "bridge", "title": f"Bridge note{'s' if len(names) > 1 else ''}: {_join(names).lower()}",
                     "text": (f"{names[0]} runs through both drydowns, so the seam disappears as they settle." if in_base else
                              f"{_join(names)} tie{'s' if len(names) == 1 else ''} the two together, so they read as one scent.")})
    hi, hj = float(fi["heavy"]), float(fj["heavy"])
    light, heavy = (i, j) if hi < hj else (j, i)
    fl = fi if light == i else fj
    if abs(hi - hj) >= 0.2 and float(fl["fresh"]) >= 0.25:
        top = _layer_notes(cat, light, (0,)) or _top_accords(cat, light)
        base = _layer_notes(cat, heavy, (2,)) or _top_accords(cat, heavy)
        pros.append({"kind": "structure", "title": "Fresh over deep",
                     "text": f"{cat.name(heavy)}'s {_join(base[:2]).lower()} base anchors {cat.name(light)}'s "
                             f"{_join(top[:2]).lower()} opening: one carries the first hour, the other the trail."})
    elif abs(hi - hj) >= 0.25:
        pros.append({"kind": "structure", "title": "One leads, one supports",
                     "text": f"{cat.name(heavy)} is the richer of the two and gives the base; {cat.name(light)} sits lightly on top."})
    if fi["simple"] or fj["simple"]:
        both = fi["simple"] and fj["simple"]
        simple, other = (i, j) if fi["simple"] else (j, i)
        enh = bool((fi if simple == i else fj)["enhancer"])
        pros.append({"kind": "simple", "title": "Skin-scent enhancer" if enh else "Easy to layer",
                     "text": (f"{cat.name(simple)} is a skin-scent style base: it amplifies {cat.name(other)} rather than competing." if enh else
                              "Both are simple, linear scents: they combine cleanly." if both else
                              f"{cat.name(simple)} is simple and linear, so it won't fight {cat.name(other)}'s structure.")})
    if min(hi, hj) >= 0.6:
        cons.append({"kind": "heavy", "title": "Go light", "text": "Both are rich and long-lasting: one spray of each, or it turns muddy."})
    if min(float(fi["sweet"]), float(fj["sweet"])) >= 0.7:
        cons.append({"kind": "sweet", "title": "Sweet on sweet", "text": "Both are sweet; use sparingly, or add something fresh to cut it."})
    if max(hi, hj) < 0.25:
        cons.append({"kind": "fleeting", "title": "Both are fleeting", "text": "Neither has much base, so it fades fast: reapply, or add a musk underneath."})
    if fi["complex"] and fj["complex"]:
        cons.insert(0, {"kind": "complex", "title": "Two complex compositions",
                        "text": "Both are full, many-note compositions; perfumers warn these usually clash rather than combine."})
    for why in clash_reasons(fi, fj):
        cons.insert(0, {"kind": "clash", "title": "Known clash", "text": why})
    if bool(feats["near_dup"]):
        cons.insert(0, {"kind": "duplicate", "title": "Almost the same scent",
                        "text": "They share most of their character; layering them mostly makes the same perfume louder."})
    return pros, cons


def how_to(cat, i: int, j: int, fi: dict, fj: dict) -> dict:
    """Heavier first on pulse points, lighter on top or on clothing; the heavier one gets more only when it is far
    richer (research 5.4: Maison Margiela, Experimental Perfume Club, Laudamiel)."""
    hi, hj = float(fi["heavy"]), float(fj["heavy"])
    if abs(hi - hj) < 0.1:      # tie: the one with more base notes goes first
        bi, bj = len(_layer_notes(cat, i, (2,), 99)), len(_layer_notes(cat, j, (2,), 99))
        first, second = (i, j) if bi >= bj else (j, i)
    else:
        first, second = (i, j) if hi > hj else (j, i)
    gap = abs(hi - hj)
    ratio = f"2 sprays of {cat.name(first)}, 1 of {cat.name(second)}" if gap >= 0.3 else "1 spray of each, then adjust"
    if min(hi, hj) >= 0.6:
        ratio = "1 spray of each: both are rich"
    return {"first": int(cat.p_id[first]), "second": int(cat.p_id[second]),
            "steps": [f"Apply {cat.name(first)} first on pulse points (wrists, neck) and let it settle for a minute.",
                      f"Then {cat.name(second)} on top, on the same spots, or on clothing for a lighter effect."],
            "ratio": ratio,
            "tip": "Wear it for a few hours before deciding: the drydown is where layering succeeds or fails."}


def pair_features(cat, i: int, j: int):
    f = feats_of(cat, [i, j])
    fi, fj = f.row(0), f.row(1)
    r = score_against(cat, i, fi, f.slice(slice(1, 2)))
    return fi, fj, {k: v[0] for k, v in r.items()}


def pair_report(cat, i: int, j: int) -> dict:
    """Everything the pair page shows for perfumes i and j (catalog indices)."""
    fi, fj, r = pair_features(cat, i, j)
    score = float(r["score"])
    curated = bool(r["curated"])
    blocked = (bool(r["excluded"]) or bool(cat.link_relation(i, j))) and not curated
    key, label = BLOCKED if blocked else verdict(score)
    pros, cons = reasons(cat, i, j, fi, fj, r)
    if cat.link_relation(i, j):
        cons.insert(0, {"kind": "duplicate", "title": "One is a dupe of the other",
                        "text": "They are linked as an original and its alternative, so they smell alike by design."})
    blend = (fi["F"] + fj["F"]) / 2
    return {"score": round(score, 3), "top": None if blocked else top_share(score), "verdict": key, "verdict_label": label,
            "recommended": (score >= SHOW or curated) and not blocked, "curated": curated_info(cat, i, j),
            "pros": pros, "cons": cons, "how_to": how_to(cat, i, j, fi, fj),
            "components": {k: round(float(r[k]), 3) for k in ("bridge", "compat", "struct", "simple", "related", "contrast", "pen")},
            "blend": [{"facet": FKEYS[k], "label": FLABEL[FKEYS[k]], "share": round(float(blend[k]), 3)}
                      for k in np.argsort(-blend) if blend[k] >= 0.03],
            "shared_notes": [{**cat.note_obj(nt), "layers": [int(a), int(b)]} for nt, a, b in shared_notes(cat, i, j)[:10]]}


def brief(cat, i: int, j: int, fi: dict, fj: dict, r: dict, k: int) -> dict:
    """Card data for a recommended pair: verdict + the best reasons. r is a score_against result, k the row in it."""
    feats = {key: v[k] for key, v in r.items()}
    pros, cons = reasons(cat, i, j, fi, fj, feats)
    score = float(feats["score"])
    key, label = verdict(score)
    specific = next((p["text"] for p in pros if p["kind"] in ("structure", "bridge", "curated")), None)
    return {"score": round(score, 3), "top": top_share(score), "verdict": key, "verdict_label": label,
            "curated": curated_info(cat, i, j), "why": [{"title": p["title"], "text": p["text"]} for p in pros[:3]],
            "tags": [p["title"] for p in pros if p["kind"] != "curated"][:3], "specific": specific,
            "caution": cons[0] if cons else None}


def within(cat, idx: list[int], min_score: float = SHOW, limit: int = 60):
    """Every recommendable pair inside a set of perfumes (a collection), best first: [(i, j, brief)]."""
    idx = [int(x) for x in dict.fromkeys(idx)]
    if len(idx) < 2:
        return []
    f = feats_of(cat, idx)
    hits = []
    for a, i in enumerate(idx[:-1]):
        rest = f.slice(slice(a + 1, None))
        r = score_against(cat, i, f.row(a), rest)
        for k in np.flatnonzero((r["score"] >= min_score) & ~r["excluded"]):
            j = int(rest.idx[k])
            if not cat.link_relation(i, j):
                hits.append((float(r["score"][k]), a, i, a + 1 + int(k), j, r, int(k)))
    hits.sort(key=lambda t: -t[0])
    return [(i, j, brief(cat, i, j, f.row(a), f.row(b), r, k)) for _s, a, i, b, j, r, k in hits[:limit]]
