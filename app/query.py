"""Advanced note queries (AND of OR-clauses with layers), result filters, facets and sorting.

A query is
    clauses : list of Clause, ANDed together. A clause is a set of notes ORed together + a layer
              (top | middle | base | any). A note can be expanded to every note whose name contains the
              note's name as a whole word ("tea" -> Green Tea, White Tea, Tea Leaf ... but "amber" does not
              match "Ambergris"). Perfumes that only list a flat "general" note list have no pyramid; with
              `gen` on (the default of the advanced mode) they match a layered clause in any layer.
    exclude : notes that may not appear anywhere (optionally variant-expanded)
    filters : Filters (name text, year range, brands, perfumers, accords, gender, country, rating, votes,
              extra must-have / must-not notes)

Everything is numpy boolean algebra over the catalog's inverted indexes: one int16 counter array per clause
(union inside a clause, intersection across clauses), one boolean mask per active filter. Facet counts for a
filter group are bincounts over "base query AND every other filter" (so a multi-select still shows the
alternatives you could switch to). The legacy GET /api/search parameters (include/exclude/mode/layer) are mapped
onto the same machinery, so there is one code path.

The state of a query is a flat dict of strings (the URL hash params, the saved-search state):
    include exclude mode            simple mode (comma list of  slug[@layer]; mode all|any)
    adv=1  q  x  gen                advanced mode:  q = "top:tea*,mint~middle:rose,lily~base:amber*"  x = "oud*,vetiver"
                                    (`*` after a slug = also every note containing that word, `~` separates clauses)
    must not                        extra note refinements (comma list, `*` = variants)
    name year_min year_max year_unknown brands perfumers accords acc_any acc_main gender countries
    rating_min votes_min brand      filters (`brands` / `perfumers` / `accords` / `countries`: ~ separated names)
    sort
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Mapping

import numpy as np

LAYER_CODE = {"top": 0, "middle": 1, "mid": 1, "heart": 1, "base": 2}
LAYER_NAME = {None: "any", 0: "top", 1: "middle", 2: "base"}
GENDER_CODE = {"women": 1, "men": 2, "unisex": 3}
SORT_KEYS = ("popularity", "rating", "year", "year_asc", "name", "brand", "matches", "dupes")
MAX_CLAUSES = 12
MAX_CLAUSE_NOTES = 60
MAX_MEMBERS = 600          # expanded notes per clause
MAX_LIST = 60              # entries of a multi-select filter
HIST_LO = 1900             # year histogram starts here (older years are counted in "before")


class QueryError(ValueError):
    """Bad query parameter (the server maps it to HTTP 400)."""


def _norm(s):
    from catalog import norm
    return norm(s)


# --------------------------------------------------------------------------------------- list codec
def enc_list(items) -> str:
    """'~'-joined list; a literal '~' or '\\' inside an item is backslash-escaped."""
    return "~".join(str(x).replace("\\", "\\\\").replace("~", "\\~") for x in items)


def dec_list(s: str | None) -> list[str]:
    out, cur, esc = [], [], False
    for ch in s or "":
        if esc:
            cur.append(ch)
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == "~":
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur).strip())
    return [x for x in out if x]


def _csv(s) -> list[str]:
    return [t.strip() for t in str(s or "").split(",") if t.strip()]


def _int(p, key, lo=None, hi=None):
    v = str(p.get(key) if p.get(key) is not None else "").strip()
    if v == "":
        return None
    try:
        n = int(float(v))
    except ValueError:
        raise QueryError(f"{key} must be a number")
    if lo is not None:
        n = max(lo, n)
    if hi is not None:
        n = min(hi, n)
    return n


def _float(p, key, lo=None, hi=None):
    v = str(p.get(key) if p.get(key) is not None else "").strip()
    if v == "":
        return None
    try:
        n = float(v)
    except ValueError:
        raise QueryError(f"{key} must be a number")
    if not math.isfinite(n):
        raise QueryError(f"{key} must be a number")
    if lo is not None:
        n = max(lo, n)
    if hi is not None:
        n = min(hi, n)
    return n


def _flag(p, key, default=False):
    v = p.get(key)
    if v is None or str(v).strip() == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------------------- notes / clauses
@dataclass
class NoteRef:
    j: int
    variants: bool = False


@dataclass
class Clause:
    layer: int | None                      # None = any layer (display; members carry their own layer)
    notes: list[NoteRef]
    members: list[tuple[int, int | None]]  # expanded + deduplicated (note idx, layer code | None)
    gen: bool = False                      # flat-list perfumes match in any layer
    dead: bool = False                     # contained only unknown notes -> matches nothing


def note_variants(cat, j: int) -> list[int]:
    """Notes whose normalised name contains note j's normalised name as a whole word (j itself first)."""
    cache = cat.__dict__.setdefault("_variant_cache", {})
    got = cache.get(j)
    if got is not None:
        return got
    phrase = cat.note_norm[j]
    out = [j]
    if phrase:
        pad = f" {phrase} "
        pads = cat.__dict__.get("_note_pad")
        if pads is None:
            pads = cat._note_pad = [f" {nm} " for nm in cat.note_norm]
        out += [k for k, hay in enumerate(pads) if k != j and pad in hay]
    if len(cache) > 4000:
        cache.clear()
    cache[j] = out
    return out


def _resolve_slug(cat, tok: str):
    """'tea*' -> (note idx, variants) or None for an unknown slug."""
    tok = tok.strip()
    variants = tok.endswith("*")
    slug = tok.rstrip("*").strip()
    j = cat.note_index.get(slug)
    if j is None:
        from catalog import slugify
        j = cat.note_index.get(slugify(slug))
    return (j, variants) if j is not None else None


def _make_clause(cat, layer, toks: list[str], gen: bool, unknown: list[str]) -> Clause | None:
    notes, members, seen = [], [], set()
    for tok in toks[:MAX_CLAUSE_NOTES]:
        r = _resolve_slug(cat, tok)
        if r is None:
            if tok.strip():
                unknown.append(tok.strip().rstrip("*"))
            continue
        j, var = r
        if any(n.j == j for n in notes):
            continue
        notes.append(NoteRef(j, var))
        for k in (note_variants(cat, j) if var else [j]):
            if k not in seen and len(members) < MAX_MEMBERS:
                seen.add(k)
                members.append((k, layer))
    if not notes:
        return Clause(layer, [], [], gen, dead=True) if toks else None
    return Clause(layer, notes, members, gen)


def parse_adv_q(cat, q: str, gen: bool, unknown: list[str]) -> list[Clause]:
    """'top:tea*,mint~middle:rose,lily~base:amber*' -> clauses. Layer defaults to any."""
    out = []
    for seg in (q or "").split("~")[:MAX_CLAUSES]:
        seg = seg.strip()
        if not seg:
            continue
        head, sep, rest = seg.partition(":")
        if sep:
            lname = head.strip().lower()
            if lname in ("any", "all", ""):
                layer = None
            elif lname in LAYER_CODE:
                layer = LAYER_CODE[lname]
            else:
                raise QueryError(f"bad layer {head!r}")
        else:
            layer, rest = None, seg
        c = _make_clause(cat, layer, _csv(rest), gen, unknown)
        if c is not None:
            out.append(c)
    return out


def parse_note_list(cat, s: str, unknown: list[str] | None = None) -> list[NoteRef]:
    out = []
    for tok in _csv(s)[:MAX_CLAUSE_NOTES]:
        r = _resolve_slug(cat, tok)
        if r is None:
            if unknown is not None:
                unknown.append(tok.rstrip("*"))
            continue
        if not any(n.j == r[0] for n in out):
            out.append(NoteRef(*r))
    return out


def expand_notes(cat, refs: list[NoteRef]) -> list[int]:
    seen, out = set(), []
    for r in refs:
        for k in (note_variants(cat, r.j) if r.variants else [r.j]):
            if k not in seen and len(out) < MAX_MEMBERS:
                seen.add(k)
                out.append(k)
    return out


# --------------------------------------------------------------------------------------- spec / filters
@dataclass
class Filters:
    name: str = ""
    year_min: int | None = None
    year_max: int | None = None
    year_unknown: bool = False
    brands: list[int] = field(default_factory=list)
    brand_text: str = ""                    # legacy ?brand= (case-insensitive equal-or-contains)
    perfumers: list[int] = field(default_factory=list)
    accords: list[int] = field(default_factory=list)
    acc_any: bool = False                   # match ANY of the accords (default: all of them)
    acc_main: bool = False                  # only count the perfume's top-3 accords
    genders: list[int] = field(default_factory=list)
    countries: list[int] = field(default_factory=list)
    rating_min: float | None = None
    votes_min: int | None = None
    btags: list[int] = field(default_factory=list)       # brand-tag bits to include (OR)
    btags_not: list[int] = field(default_factory=list)   # brand-tag bits to exclude
    has_dupes: bool = False                              # originals with at least one known dupe
    is_dupe: bool = False                                # perfumes linked as a dupe of something


@dataclass
class Spec:
    clauses: list[Clause] = field(default_factory=list)
    exclude: list[NoteRef] = field(default_factory=list)
    exclude_layers: list[tuple[int, int | None]] = field(default_factory=list)   # legacy: exclude note@layer
    must: list[NoteRef] = field(default_factory=list)     # extra refinements: each AND'ed, any layer
    must_not: list[NoteRef] = field(default_factory=list)
    adv: bool = False
    gen: bool = False
    unknown: list[str] = field(default_factory=list)
    legacy_mode: str = "all"
    flt: Filters = field(default_factory=Filters)
    flt_unknown: list[str] = field(default_factory=list)


def _lookup_names(names, index: dict, lower_index: dict, unknown: list[str]) -> list[int]:
    out = []
    for nm in names[:MAX_LIST]:
        k = index.get(nm)
        if k is None:
            k = lower_index.get(nm.lower())
        if k is None:
            unknown.append(nm)
        elif k not in out:
            out.append(k)
    return out


def _brand_lookup(cat):
    d = cat.__dict__
    if "_brand_by_name" not in d:
        d["_brand_by_name"] = {b: k for k, b in enumerate(cat.brand_list)}
        low = {}
        for k, b in enumerate(cat.brand_list):
            low.setdefault(b.lower(), []).append(k)
        d["_brand_by_lower"] = low
    return d["_brand_by_name"], d["_brand_by_lower"]


def _tag_bits(s, unknown: list[str]) -> list[int]:
    """'dupe~middle_eastern' (or comma separated) -> brand-tag bit values, in canonical order, unknown names reported."""
    from catalog import BTAG_BITS
    out: list[int] = []
    for tok in re.split(r"[~,]", str(s or "")):
        tok = tok.strip().lower().replace(" ", "_").replace("-", "_")
        if not tok:
            continue
        b = BTAG_BITS.get(tok)
        if b is None:
            unknown.append(tok)
        elif b not in out:
            out.append(b)
    return sorted(out)


def parse_filters(cat, p: Mapping) -> tuple[Filters, list[str]]:
    f = Filters()
    unknown: list[str] = []
    f.name = " ".join(str(p.get("name") or "").split())[:80]
    f.year_min = _int(p, "year_min", 0, 3000)
    f.year_max = _int(p, "year_max", 0, 3000)
    f.year_unknown = _flag(p, "year_unknown")
    by_name, by_lower = _brand_lookup(cat)
    for nm in dec_list(p.get("brands"))[:MAX_LIST]:
        ks = [by_name[nm]] if nm in by_name else by_lower.get(nm.lower(), [])
        if not ks:
            unknown.append(nm)
        f.brands += [k for k in ks if k not in f.brands]
    f.brand_text = str(p.get("brand") or "").strip()[:80]
    pf_low = cat.__dict__.get("_pf_lower")
    if pf_low is None:
        pf_low = cat._pf_lower = {nm.lower(): k for k, nm in enumerate(cat.perfumer_names)}
    pf_by_name = cat.__dict__.get("_pf_by_name")
    if pf_by_name is None:
        pf_by_name = cat._pf_by_name = {nm: k for k, nm in enumerate(cat.perfumer_names)}
    f.perfumers = _lookup_names(dec_list(p.get("perfumers")), pf_by_name, pf_low, unknown)
    acc_idx = {nm: k for k, nm in enumerate(cat.acc_col_names)}
    f.accords = _lookup_names([a.lower() for a in dec_list(p.get("accords"))], acc_idx, acc_idx, unknown)
    f.acc_any = _flag(p, "acc_any")
    f.acc_main = _flag(p, "acc_main")
    for g in _csv(p.get("gender")):
        c = GENDER_CODE.get(g.lower())
        if c and c not in f.genders:
            f.genders.append(c)
        elif not c:
            unknown.append(g)
    ctry = {nm: k for k, nm in enumerate(cat.country_list) if nm}
    ctry_low = {nm.lower(): k for nm, k in ctry.items()}
    f.countries = _lookup_names(dec_list(p.get("countries")), ctry, ctry_low, unknown)
    f.rating_min = _float(p, "rating_min", 0.0, 5.0)
    f.votes_min = _int(p, "votes_min", 0, 10**9)
    f.btags = _tag_bits(p.get("btags"), unknown)
    f.btags_not = [b for b in _tag_bits(p.get("btags_not"), unknown)]
    f.has_dupes = _flag(p, "has_dupes")
    f.is_dupe = _flag(p, "is_dupe")
    return f, unknown


def parse_spec(cat, p: Mapping, default_layer: int | None = None) -> Spec:
    """Query-string / state dict -> Spec (advanced when `q` or `adv` is present, else the legacy simple form)."""
    s = Spec()
    s.flt, s.flt_unknown = parse_filters(cat, p)
    s.must = parse_note_list(cat, p.get("must") or "", s.flt_unknown)
    s.must_not = parse_note_list(cat, p.get("not") or "", s.flt_unknown)
    q = str(p.get("q") or "")[:4000]
    if q.strip() or _flag(p, "adv"):
        s.adv = True
        s.gen = _flag(p, "gen", True)
        s.clauses = parse_adv_q(cat, q, s.gen, s.unknown)
        s.exclude = parse_note_list(cat, p.get("x") or "", s.unknown)
        s.exclude_layers = [(j, None) for j in expand_notes(cat, s.exclude)]
        return s
    # ---- legacy / simple mode: include/exclude with optional @layer, mode all|any
    mode = str(p.get("mode") or "all")
    if mode not in ("all", "any"):
        raise QueryError("mode must be all|any")
    s.legacy_mode = mode
    s.gen = _flag(p, "gen", False)

    def lst(key):
        out = []
        for part in _csv(p.get(key)):
            slug, _, layer = part.partition("@")
            layer = layer.strip().lower()
            if layer in ("", "any", "all"):
                code = None
            elif layer in LAYER_CODE:
                code = LAYER_CODE[layer]
            elif layer == "general":
                code = 3
            else:
                raise QueryError(f"bad layer {layer!r}")
            out.append((slug.strip(), code))
        return out

    inc = []
    for slug, layer in lst("include"):
        r = _resolve_slug(cat, slug)
        if r is None:
            s.unknown.append(slug)
        else:
            inc.append((r[0], layer if layer is not None else default_layer))
    if mode == "any":
        if inc:
            s.clauses = [Clause(None, [NoteRef(j) for j, _ in inc], list(dict.fromkeys(inc)), s.gen)]
    else:
        for j, L in inc:
            s.clauses.append(Clause(L, [NoteRef(j)], [(j, L)], s.gen))
        if s.unknown:
            s.clauses.append(Clause(None, [], [], dead=True))
    for slug, layer in lst("exclude"):
        r = _resolve_slug(cat, slug)
        if r is not None:
            s.exclude.append(NoteRef(r[0]))
            s.exclude_layers.append((r[0], layer))
    return s


# --------------------------------------------------------------------------------------- evaluation
def _rows(cat, j: int, L: int | None, gen: bool) -> np.ndarray:
    if L is None:
        return cat.any_rows(j)
    rows = cat.layer_rows(L, j)
    if gen and L != 3:
        g = cat.layer_rows(3, j)
        g = g[cat.p_flat[g]]
        if g.size:
            rows = np.concatenate([rows, g])
    return rows


def clause_counts(cat, c: Clause) -> np.ndarray:
    """int16 [n]: how many of the clause's notes each perfume has (in the clause's layer)."""
    cnt = np.zeros(cat.n_perf, dtype=np.int16)
    for j, L in c.members:
        cnt[_rows(cat, j, L, c.gen)] += 1
    return cnt


def presence(cat, members) -> np.ndarray:
    m = np.zeros(cat.n_perf, dtype=bool)
    for j, L in members:
        m[_rows(cat, j, L, False)] = True
    return m


def contains_mask(cat, token: str) -> np.ndarray:
    """bool [n]: perfumes whose 'brand name' search text contains `token` (vectorised substring scan)."""
    n = cat.n_perf
    a = np.frombuffer(token.encode("ascii", "ignore"), dtype=np.uint8)
    k = a.size
    out = np.zeros(n, dtype=bool)
    buf = cat._search_u8
    if k == 0:
        out[:] = True
        return out
    if buf.size < k:
        return out
    pos = np.flatnonzero(buf[: buf.size - k + 1] == a[0])
    for t in range(1, k):
        if pos.size == 0:
            return out
        pos = pos[buf[pos + t] == a[t]]
    if pos.size:
        out[np.searchsorted(cat._s_off, pos, side="right") - 1] = True
    return out


def _brand_text_ids(cat, text: str) -> list[int]:
    b = _norm(text)
    if not b:
        return []
    ids = [k for k, bn in enumerate(cat.brand_norm) if b == bn]
    return ids or [k for k, bn in enumerate(cat.brand_norm) if b in bn]


def filter_masks(cat, f: Filters, only: set | None = None) -> dict[str, np.ndarray]:
    """One boolean mask per ACTIVE filter group (keys: name year brand perfumer accord gender country rating votes)."""
    n = cat.n_perf
    out: dict[str, np.ndarray] = {}

    def want(k):
        return only is None or k in only

    if f.name and want("name"):
        m = np.ones(n, dtype=bool)
        for tok in _norm(f.name).split()[:6]:
            m &= contains_mask(cat, tok)
        out["name"] = m
    if (f.year_min or f.year_max or False) and want("year"):
        py = cat.p_year
        m = py > 0
        if f.year_min:
            m &= py >= f.year_min
        if f.year_max:
            m &= py <= f.year_max
        if f.year_unknown:
            m |= py == 0
        out["year"] = m
    if (f.brands or f.brand_text) and want("brand"):
        m = np.ones(n, dtype=bool)
        if f.brands:
            tbl = np.zeros(len(cat.brand_list), dtype=bool)
            tbl[f.brands] = True
            m &= tbl[cat.p_brand_idx]
        if f.brand_text:
            ids = _brand_text_ids(cat, f.brand_text)
            tbl = np.zeros(len(cat.brand_list), dtype=bool)
            tbl[ids] = True
            m &= tbl[cat.p_brand_idx]
        out["brand"] = m
    if f.perfumers and want("perfumer"):
        tbl = np.zeros(len(cat.perfumer_names), dtype=bool)
        tbl[f.perfumers] = True
        m = np.zeros(n, dtype=bool)
        m[cat.pf_row[tbl[cat.pf_ids]]] = True
        out["perfumer"] = m
    if f.accords and want("accord"):
        sel = cat.acc_rank < 3 if f.acc_main else None
        m = None
        for c in f.accords:
            hit = cat.acc_colid == c
            if sel is not None:
                hit &= sel
            mc = np.zeros(n, dtype=bool)
            mc[cat.acc_row[hit]] = True
            m = mc if m is None else ((m | mc) if f.acc_any else (m & mc))
        out["accord"] = m
    if f.genders and want("gender"):
        tbl = np.zeros(4, dtype=bool)
        tbl[f.genders] = True
        out["gender"] = tbl[cat.p_gender]
    if f.countries and want("country"):
        tbl = np.zeros(len(cat.country_list), dtype=bool)
        tbl[f.countries] = True
        out["country"] = tbl[cat.p_country]
    if f.rating_min and want("rating"):
        out["rating"] = cat.p_rating >= f.rating_min
    if f.votes_min and want("votes"):
        out["votes"] = cat.p_votes >= f.votes_min
    if (f.btags or f.btags_not) and want("btags"):
        m = np.ones(n, dtype=bool)
        if f.btags:
            m &= (cat.p_btags & np.uint8(sum(f.btags))) != 0
        if f.btags_not:
            m &= (cat.p_btags & np.uint8(sum(f.btags_not))) == 0
        out["btags"] = m
    if f.has_dupes and want("has_dupes"):
        out["has_dupes"] = cat.p_ndupes > 0
    if f.is_dupe and want("is_dupe"):
        out["is_dupe"] = cat.p_nlinks > 0
    return out


def _and_all(n, masks):
    out = None
    for m in masks:
        out = m.copy() if out is None else np.logical_and(out, m, out=out)
    return out if out is not None else np.ones(n, dtype=bool)


@dataclass
class Evaluation:
    spec: Spec
    base: np.ndarray                 # the note query only (clauses AND must AND NOT excluded)
    counts: np.ndarray | None        # int32 [n]: matched query notes (sum over clauses), None without clauses
    fm: dict                         # active filter masks
    mask: np.ndarray                 # base AND every filter

    def without(self, *groups) -> np.ndarray:
        """base AND all active filters except the given groups."""
        rest = [m for k, m in self.fm.items() if k not in groups]
        if not rest:
            return self.base
        return _and_all(len(self.base), [self.base, *rest])


def evaluate(cat, spec: Spec) -> Evaluation:
    n = cat.n_perf
    base = np.ones(n, dtype=bool)
    counts = None
    for c in spec.clauses:
        if c.dead or not c.members:
            base[:] = False
            continue
        cnt = clause_counts(cat, c)
        base &= cnt > 0
        counts = cnt.astype(np.int32) if counts is None else counts + cnt
    for ref in spec.must:
        m = presence(cat, [(k, None) for k in (note_variants(cat, ref.j) if ref.variants else [ref.j])])
        base &= m
    if spec.exclude_layers:
        base &= ~presence(cat, spec.exclude_layers)
    if spec.must_not:
        base &= ~presence(cat, [(k, None) for k in expand_notes(cat, spec.must_not)])
    fm = filter_masks(cat, spec.flt)
    mask = _and_all(n, [base, *fm.values()]) if fm else base
    return Evaluation(spec, base, counts, fm, mask)


# --------------------------------------------------------------------------------------- sorting / paging
def sort_order(cat, cand: np.ndarray, counts, sort: str, k: int) -> np.ndarray:
    """Indices into `cand` of the first k results in sort order (unique composite keys -> stable paging)."""
    n = cat.n_perf
    c = cand.astype(np.int64)
    if sort == "rating":
        prim = -np.rint(cat.p_wrating[cand].astype(np.float64) * 1e5).astype(np.int64)
    elif sort == "year":
        y = cat.p_year[cand].astype(np.int64)
        prim = np.where(y > 0, -y, 1)
    elif sort == "year_asc":
        y = cat.p_year[cand].astype(np.int64)
        prim = np.where(y > 0, y, 9999)
    elif sort == "name":
        prim = cat.p_name_rank[cand].astype(np.int64)
    elif sort == "brand":
        prim = cat.p_brand_idx[cand].astype(np.int64) * (n + 1) + cat.p_name_rank[cand]
    elif sort == "dupes":
        prim = -(cat.p_ndupes[cand].astype(np.int64) * (int(cat.p_votes.max()) + 1) + cat.p_votes[cand])
    elif sort == "matches" and counts is not None:
        prim = -(counts[cand].astype(np.int64) * (int(cat.p_votes.max()) + 1) + cat.p_votes[cand])
    else:
        prim = -cat.p_votes[cand].astype(np.int64)
    key = prim * (n + 1) + c
    size = key.size
    if k < size // 3 and k > 0:
        part = np.argpartition(key, k - 1)[:k]
        return part[np.argsort(key[part])]
    return np.argsort(key)


def matched_slugs(cat, spec: Spec, i: int, limit=8) -> list[str]:
    """Slugs of the query notes perfume i satisfies (clause members present in the clause's layer)."""
    a, b = int(cat.pn_indptr[i]), int(cat.pn_indptr[i + 1])
    notes, lays = cat.pn_note[a:b].tolist(), cat.pn_layer[a:b].tolist()
    pairs, anyl = set(zip(notes, lays)), set(notes)
    flat = bool(cat.p_flat[i])
    out = []
    for c in spec.clauses:
        for j, L in c.members:
            ok = (j in anyl) if L is None else ((j, L) in pairs or (c.gen and flat and (j, 3) in pairs))
            if ok and cat.note_slug[j] not in out:
                out.append(cat.note_slug[j])
                if len(out) >= limit:
                    return out
    return out


# --------------------------------------------------------------------------------------- facets
def _top(counts: np.ndarray, selected, limit: int, offset: int, cand_idx: np.ndarray | None = None):
    """Order values by count desc. Returns (index array, total with count>0). Selected values are always kept."""
    if cand_idx is None:
        idx = np.flatnonzero(counts > 0)
    else:
        idx = cand_idx[counts[cand_idx] > 0]
    total = int(idx.size)
    sel = [k for k in selected if k < counts.size]
    if idx.size > (offset + limit) * 4:
        kk = min(idx.size, (offset + limit) * 2 + 50)
        part = np.argpartition(-counts[idx], kk - 1)[:kk]
        idx = idx[part]
    order = idx[np.lexsort((idx, -counts[idx]))]
    return order, total, sel


def _page(order, sel, counts, offset, limit):
    selset = set(sel)
    if offset == 0:
        head = [k for k in sel]
        rest = [int(k) for k in order if int(k) not in selset]
        return (head + rest)[: max(limit, len(head))]
    rest = [int(k) for k in order if int(k) not in selset]
    return rest[offset: offset + limit]


def facet_years(cat, m: np.ndarray, flt: Filters) -> dict:
    py = cat.p_year[m]
    known = py[py > 0]
    hi = cat.__dict__.get("_year_hi")
    if hi is None:
        hi = cat._year_hi = max(HIST_LO, int(cat.p_year.max()) if cat.n_perf else HIST_LO)
    known = known.astype(np.int64)
    cnt = np.bincount(known[known >= HIST_LO] - HIST_LO, minlength=hi - HIST_LO + 1)
    return {"lo": HIST_LO, "hi": hi, "counts": cnt.tolist(), "before": int((known < HIST_LO).sum()),
            "unknown": int((py == 0).sum()),
            "min": int(known.min()) if known.size else None, "max": int(known.max()) if known.size else None}


def facet_list(cat, name: str, ev: Evaluation, limit=12, offset=0, fq: str = "") -> dict:
    """One multi-select facet. name: brand | perfumer | accord | gender | country | note."""
    f = ev.spec.flt
    limit = max(1, min(int(limit), 200))
    fqn = _norm(fq)[:60]
    if name == "brand":
        m = ev.without("brand")
        counts = np.bincount(cat.p_brand_idx[m], minlength=len(cat.brand_list))
        cand = None
        if fqn:
            cand = np.array([k for k, bn in enumerate(cat.brand_norm) if fqn in bn], dtype=np.int64)
            if not cand.size:
                return {"items": [], "total": 0}
        order, total, sel = _top(counts, f.brands, limit, offset, cand)
        if fqn:
            sel = [k for k in sel if fqn in cat.brand_norm[k]]
        items = [{"name": cat.brand_list[k], "count": int(counts[k]), "selected": k in f.brands}
                 for k in _page(order, sel, counts, offset, limit)]
        return {"items": items, "total": total}
    if name == "perfumer":
        m = ev.without("perfumer")
        counts = np.bincount(cat.pf_ids[m[cat.pf_row]], minlength=len(cat.perfumer_names))
        cand = None
        if fqn:
            pn = cat.__dict__.get("_pf_norm")
            if pn is None:
                pn = cat._pf_norm = [_norm(x) or x.lower() for x in cat.perfumer_names]
            cand = np.array([k for k, x in enumerate(pn) if fqn in x], dtype=np.int64)
            if not cand.size:
                return {"items": [], "total": 0}
        order, total, sel = _top(counts, f.perfumers, limit, offset, cand)
        if fqn:
            sel = [k for k in sel if fqn in (_norm(cat.perfumer_names[k]) or "")]
        items = [{"name": cat.perfumer_names[k], "count": int(counts[k]), "selected": k in f.perfumers}
                 for k in _page(order, sel, counts, offset, limit)]
        with_pf = int((m & cat.p_has_perfumer).sum())
        return {"items": items, "total": total, "coverage": {"with": with_pf, "all": int(m.sum())}}
    if name == "accord":
        m = ev.mask if (f.accords and not f.acc_any) else ev.without("accord")
        sel_rows = m[cat.acc_row]
        if f.acc_main:
            sel_rows &= cat.acc_rank < 3
        counts = np.bincount(cat.acc_colid[sel_rows], minlength=len(cat.acc_col_names))
        from palette import accord_color
        cand = None
        if fqn:
            cand = np.array([k for k, a in enumerate(cat.acc_col_names) if fqn in a], dtype=np.int64)
            if not cand.size:
                return {"items": [], "total": 0}
        order, total, sel = _top(counts, f.accords, limit, offset, cand)
        items = [{"name": cat.acc_col_names[k], "count": int(counts[k]), "selected": k in f.accords,
                  "color": accord_color(cat.acc_col_names[k])} for k in _page(order, sel, counts, offset, limit)]
        return {"items": items, "total": total}
    if name == "gender":
        m = ev.without("gender")
        counts = np.bincount(cat.p_gender[m], minlength=4)
        items = [{"name": nm, "count": int(counts[c]), "selected": c in f.genders}
                 for nm, c in (("women", 1), ("men", 2), ("unisex", 3))]
        return {"items": items, "total": 3, "unknown": int(counts[0])}
    if name == "country":
        m = ev.without("country")
        counts = np.bincount(cat.p_country[m], minlength=len(cat.country_list))
        unknown = int(counts[0])
        counts[0] = 0
        cand = None
        if fqn:
            cand = np.array([k for k, c in enumerate(cat.country_list) if c and fqn in _norm(c)], dtype=np.int64)
            if not cand.size:
                return {"items": [], "total": 0, "unknown": unknown}
        order, total, sel = _top(counts, f.countries, limit, offset, cand)
        items = [{"name": cat.country_list[k], "count": int(counts[k]), "selected": k in f.countries}
                 for k in _page(order, sel, counts, offset, limit)]
        return {"items": items, "total": total, "unknown": unknown}
    if name == "brand_tags":
        return facet_brand_tags(cat, ev)
    if name == "note":  # notes inside the current result set (for the must-have / must-not pickers)
        counts = cat.counts_for(ev.mask)
        skip = {j for c in ev.spec.clauses for j, _ in c.members} | {r.j for r in ev.spec.must}
        counts = counts.copy()
        for j in skip:
            counts[j] = 0
        cand = None
        if fqn:
            cand = np.array([k for k, nm in enumerate(cat.note_norm) if fqn in nm], dtype=np.int64)
            if not cand.size:
                return {"items": [], "total": 0}
        order, total, _ = _top(counts, [], limit, offset, cand)
        items = [cat.note_obj(int(k), count=int(counts[k])) for k in order[offset: offset + limit]]
        return {"items": items, "total": total}
    raise QueryError(f"unknown facet {name!r}")


def facet_brand_tags(cat, ev: Evaluation) -> dict:
    """The brand-tag chips with counts over base AND every other filter (own group left out)."""
    from catalog import BTAG_BITS, BTAG_LABELS
    f = ev.spec.flt
    m = ev.without("btags")
    hist = np.bincount(cat.p_btags[m], minlength=256)
    keys = np.arange(256)
    items = []
    for name, bit in BTAG_BITS.items():
        items.append({"name": name, "label": BTAG_LABELS[name], "count": int(hist[(keys & bit) != 0].sum()),
                      "selected": "exclude" if bit in f.btags_not else ("include" if bit in f.btags else None)})
    return {"items": items, "total": len(items), "available": bool(cat.tags_loaded)}


def facet_dupe_flags(cat, ev: Evaluation) -> dict:
    return {"has_dupes": {"count": int((ev.without("has_dupes") & (cat.p_ndupes > 0)).sum()), "selected": ev.spec.flt.has_dupes},
            "is_dupe": {"count": int((ev.without("is_dupe") & (cat.p_nlinks > 0)).sum()), "selected": ev.spec.flt.is_dupe},
            "available": bool(len(cat.dl_target))}


def all_facets(cat, ev: Evaluation, limit=10) -> dict:
    return {
        "brand_tags": facet_brand_tags(cat, ev),
        "dupe_flags": facet_dupe_flags(cat, ev),
        "years": facet_years(cat, ev.without("year"), ev.spec.flt),
        "brands": facet_list(cat, "brand", ev, limit),
        "perfumers": facet_list(cat, "perfumer", ev, limit),
        "accords": facet_list(cat, "accord", ev, max(limit, 24)),
        "genders": facet_list(cat, "gender", ev),
        "countries": facet_list(cat, "country", ev, limit),
    }


# --------------------------------------------------------------------------------------- echo / sentences
LAYER_WORDS = {None: "Any layer", 0: "Top", 1: "Heart", 2: "Base"}


def _ref_out(cat, r: NoteRef) -> dict:
    return {"slug": cat.note_slug[r.j], "name": cat.note_name[r.j], "variants": r.variants,
            "expands": len(note_variants(cat, r.j)) if r.variants else 1}


def _join_or(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " or " + names[-1]


def _ref_names(cat, refs: list[NoteRef]) -> list[str]:
    return [cat.note_name[r.j].lower() + ("-ish" if r.variants else "") for r in refs]


def sentence(cat, spec: Spec) -> str:
    if not spec.clauses and not spec.exclude and not spec.must and not spec.must_not:
        return "Showing the whole catalogue."
    bits = []
    if spec.adv:
        for c in spec.clauses:
            if not c.notes:
                continue
            bits.append(f"{LAYER_WORDS[c.layer]} has {_join_or(_ref_names(cat, c.notes))}")
    elif spec.clauses:
        if spec.legacy_mode == "any":
            names = [cat.note_name[j] for j, _ in spec.clauses[0].members]
            bits.append("Has " + _join_or([n.lower() for n in names]))
        else:
            names = []
            for c in spec.clauses:
                if c.members:
                    j, L = c.members[0]
                    names.append(cat.note_name[j] + (f" ({LAYER_WORDS[L].lower()})" if L in (0, 1, 2) else ""))
            bits.append(" + ".join(names))
    if spec.must:
        bits.append("also has " + " and ".join(_ref_names(cat, spec.must)))
    out_refs = spec.exclude + spec.must_not
    if out_refs:
        bits.append("without " + _join_or(_ref_names(cat, out_refs)))
    return " · ".join(bits)


def echo(cat, spec: Spec) -> dict:
    return {
        "adv": spec.adv, "gen": spec.gen, "mode": spec.legacy_mode,
        "clauses": [{"layer": LAYER_NAME.get(c.layer, "any"), "notes": [_ref_out(cat, r) for r in c.notes]}
                    for c in spec.clauses if not c.dead],
        "exclude": [_ref_out(cat, r) for r in spec.exclude],
        "must": [_ref_out(cat, r) for r in spec.must],
        "must_not": [_ref_out(cat, r) for r in spec.must_not],
        "sentence": sentence(cat, spec),
        "unknown": spec.unknown + spec.flt_unknown,
    }


# --------------------------------------------------------------------------------------- run
def run(cat, spec: Spec, sort="popularity", page=1, per_page=48, facet_limit=30, want_facets=True,
        filter_facets=False, ff_limit=10) -> dict:
    if sort not in SORT_KEYS:
        raise QueryError(f"sort must be one of {SORT_KEYS}")
    ev = evaluate(cat, spec)
    cand = np.flatnonzero(ev.mask)
    total = int(cand.size)
    pages = max(1, math.ceil(total / per_page))
    k = min(total, page * per_page)
    order = sort_order(cat, cand, ev.counts, sort, k) if total else np.zeros(0, np.int64)
    sel = cand[order[(page - 1) * per_page: page * per_page]]
    show_matched = sum(len(c.members) for c in spec.clauses) > 1
    results = []
    for i in sel.tolist():
        d = cat.summary(i)
        if show_matched:
            d["matched"] = matched_slugs(cat, spec, i)
            d["matched_names"] = [cat.note_name[cat.note_index[s]] for s in d["matched"]]
        results.append(d)
    out = {"total": total, "page": page, "per_page": per_page, "pages": pages, "results": results,
           "unknown": spec.unknown + spec.flt_unknown, "mode": spec.legacy_mode, "sort": sort, "query": echo(cat, spec)}
    if want_facets:
        skip = {j for c in spec.clauses for j, _ in c.members} | {j for j, _ in spec.exclude_layers}
        skip |= {r.j for r in spec.must} | {r.j for r in spec.must_not}
        out["facets"] = cat.facets(ev.mask, skip, facet_limit)
    if filter_facets:
        out["filter_facets"] = all_facets(cat, ev, ff_limit)
    return out


# --------------------------------------------------------------------------------------- canonical state
FILTER_KEYS = ("name", "year_min", "year_max", "year_unknown", "brands", "brand", "perfumers", "accords", "acc_any",
               "acc_main", "gender", "countries", "rating_min", "votes_min", "must", "not", "btags", "btags_not",
               "has_dupes", "is_dupe")


def _ser_clause(cat, c: Clause) -> str:
    toks = [cat.note_slug[r.j] + ("*" if r.variants else "") for r in c.notes]
    return f"{LAYER_NAME[c.layer]}:{','.join(toks)}"


def _ser_notes(cat, refs: list[NoteRef]) -> str:
    return ",".join(cat.note_slug[r.j] + ("*" if r.variants else "") for r in refs)


def _clean_params(state) -> dict[str, str]:
    if not isinstance(state, Mapping):
        return {}
    return {k: ("" if v is None else str(v).strip()[:1500]) for k, v in state.items() if isinstance(k, str)}


def _prepare(p: dict[str, str]) -> dict[str, str]:
    """Drop what the strict request parser would reject (bad numbers, layers, mode) so a state degrades gracefully."""
    p = dict(p)
    for k in ("year_min", "year_max", "rating_min", "votes_min"):
        try:
            if p.get(k):
                float(p[k])
        except ValueError:
            p.pop(k)
    if p.get("mode") not in (None, "", "all", "any"):
        p.pop("mode")
    if p.get("q"):
        segs = [s for s in p["q"].split("~") if ":" not in s or s.partition(":")[0].strip().lower() in ("any", "all", "", *LAYER_CODE)]
        p["q"] = "~".join(segs)
    for k in ("include", "exclude"):
        if p.get(k):
            ok = []
            for part in p[k].split(","):
                lay = part.partition("@")[2].strip().lower()
                ok.append(part if lay in ("", "any", "all", "general", *LAYER_CODE) else part.partition("@")[0])
            p[k] = ",".join(ok)
    return p


def canonical_filters(cat, p: Mapping[str, str]) -> dict[str, str]:
    """Filter part of a state (shared by combine and pyramid saved searches), validated against the catalog."""
    out: dict[str, str] = {}
    p = _prepare(dict(p))
    f, _ = parse_filters(cat, p)
    m = _ser_notes(cat, parse_note_list(cat, p.get("must") or ""))
    if m:
        out["must"] = m
    n = _ser_notes(cat, parse_note_list(cat, p.get("not") or ""))
    if n:
        out["not"] = n
    if f.name:
        out["name"] = f.name
    if f.year_min:
        out["year_min"] = str(f.year_min)
    if f.year_max:
        out["year_max"] = str(f.year_max)
    if f.year_unknown and (f.year_min or f.year_max):
        out["year_unknown"] = "1"
    brands = list(f.brands)
    if f.brand_text:
        exact = [k for k, bn in enumerate(cat.brand_norm) if bn == _norm(f.brand_text)]
        if exact:
            brands += [k for k in exact if k not in brands]
        else:
            out["brand"] = f.brand_text
    if brands:
        out["brands"] = enc_list(cat.brand_list[k] for k in brands)
    if f.perfumers:
        out["perfumers"] = enc_list(cat.perfumer_names[k] for k in f.perfumers)
    if f.accords:
        out["accords"] = enc_list(cat.acc_col_names[k] for k in f.accords)
        if f.acc_any:
            out["acc_any"] = "1"
        if f.acc_main:
            out["acc_main"] = "1"
    if f.genders:
        out["gender"] = ",".join(nm for nm, c in (("women", 1), ("men", 2), ("unisex", 3)) if c in f.genders)
    if f.countries:
        out["countries"] = enc_list(cat.country_list[k] for k in f.countries)
    if f.rating_min:
        out["rating_min"] = f"{f.rating_min:g}"
    if f.votes_min:
        out["votes_min"] = str(f.votes_min)
    from catalog import BTAG_BITS
    names = {b: nm for nm, b in BTAG_BITS.items()}
    if f.btags:
        out["btags"] = enc_list(names[b] for b in f.btags)
    if f.btags_not:
        out["btags_not"] = enc_list(names[b] for b in f.btags_not)
    if f.has_dupes:
        out["has_dupes"] = "1"
    if f.is_dupe:
        out["is_dupe"] = "1"
    return out


def canonical_state(cat, state: Mapping) -> dict[str, str]:
    """Validate + normalise a saved / history combine state into the current flat-string shape.

    Old saved searches (include / exclude / mode / sort / gender / brand / year_min / year_max) keep working
    unchanged; a free-text `brand` that names a brand exactly becomes the multi-select `brands`.
    """
    p = _prepare(_clean_params(state))
    out: dict[str, str] = {}
    spec = parse_spec(cat, p)
    if spec.adv:
        out["adv"] = "1"
        q = "~".join(_ser_clause(cat, c) for c in spec.clauses if c.notes)
        if q:
            out["q"] = q
        x = _ser_notes(cat, spec.exclude)
        if x:
            out["x"] = x
        if not spec.gen:
            out["gen"] = "0"
    else:
        for key in ("include", "exclude"):
            res = []
            for part in _csv(p.get(key))[:60]:
                slug, _, layer = part.partition("@")
                if slug not in cat.note_index:
                    continue
                layer = layer.strip().lower()
                res.append(f"{slug}@{layer}" if layer in ("top", "middle", "base") else slug)
            if res:
                out[key] = ",".join(res)
        if p.get("mode") == "any":
            out["mode"] = "any"
    out.update(canonical_filters(cat, p))
    if p.get("sort") in SORT_KEYS and p.get("sort") != "popularity":
        out["sort"] = p["sort"]
    return out


def evaluate_base(cat, base: np.ndarray, flt: Filters) -> Evaluation:
    """Evaluation over an externally computed candidate set (pyramid / smells-like) plus filters."""
    fm = filter_masks(cat, flt)
    mask = _and_all(len(base), [base, *fm.values()]) if fm else base
    return Evaluation(Spec(flt=flt), base, None, fm, mask)


def filters_mask(cat, flt: Filters):
    fm = filter_masks(cat, flt)
    return _and_all(cat.n_perf, fm.values()) if fm else None


def state_has_query(cat, state: Mapping) -> bool:
    return bool(state.get("include") or state.get("q"))


def state_summary(cat, state: Mapping) -> str:
    try:
        spec = parse_spec(cat, {k: v for k, v in state.items() if isinstance(k, str)})
    except QueryError:
        return ""
    s = sentence(cat, spec)
    return "" if s.startswith("Showing the whole") else s


def state_note_slugs(cat, state: Mapping, limit=6) -> list[str]:
    try:
        spec = parse_spec(cat, {k: v for k, v in state.items() if isinstance(k, str)})
    except QueryError:
        return []
    out = []
    for c in spec.clauses:
        for r in c.notes:
            if cat.note_slug[r.j] not in out:
                out.append(cat.note_slug[r.j])
    return out[:limit]
