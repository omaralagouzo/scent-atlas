"""Similarity model (see SPEC.md).

    w(n)      = log(1 + N / df(n))                      IDF weight
    match     = LAYER_MATCH[query layer][perfume layer] 1.0 same layer ... 0.4 top<->base, 0.5 any/general
    raw(P)    = sum_q  w(q) * max over P's layers of match
    score(P)  = raw(P) / sqrt(W(Q) * W(P))              cosine-like

W(Q) / W(P) are the summed IDF weights of the query items / of the perfume's
(note, layer) items.  A perfume used as its own query therefore scores 1.0.
All tunable constants live in this file.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# --------------------------------------------------------------------------- constants
SAME_LAYER = 1.0
ADJACENT_LAYER = 0.6      # top<->middle, middle<->base
DISTANT_LAYER = 0.4       # top<->base
ANY_OR_GENERAL = 0.5      # either side is 'any' / 'general'
ACCORD_WEIGHT = 0.15      # share of the final score from accord overlap in "smells like"

# layer codes. perfumes: 0 top, 1 middle, 2 base, 3 general.  queries add 3 = any, 4 = general
TOP, MIDDLE, BASE, GENERAL = 0, 1, 2, 3
Q_ANY, Q_GENERAL = 3, 4
LAYER_NAMES = ("top", "middle", "base", "general")
QUERY_LAYER_CODES = {"top": 0, "middle": 1, "heart": 1, "mid": 1, "base": 2, "any": 3, "": 3, None: 3, "general": 4}

# LAYER_MATCH[query_layer_code][perfume_layer_code]
LAYER_MATCH = np.array(
    [
        [SAME_LAYER, ADJACENT_LAYER, DISTANT_LAYER, ANY_OR_GENERAL],   # q top
        [ADJACENT_LAYER, SAME_LAYER, ADJACENT_LAYER, ANY_OR_GENERAL],  # q middle
        [DISTANT_LAYER, ADJACENT_LAYER, SAME_LAYER, ANY_OR_GENERAL],   # q base
        [ANY_OR_GENERAL] * 4,                                          # q any
        [ANY_OR_GENERAL, ANY_OR_GENERAL, ANY_OR_GENERAL, SAME_LAYER],  # q general (perfume-as-query)
    ],
    dtype=np.float32,
)


def compute_idf(n_perfumes: int, df: np.ndarray) -> np.ndarray:
    return np.log1p(n_perfumes / np.maximum(df, 1)).astype(np.float32)


def parse_query_layer(layer) -> int:
    key = layer.lower().strip() if isinstance(layer, str) else layer
    if key not in QUERY_LAYER_CODES:
        raise ValueError(f"bad layer {layer!r}")
    return QUERY_LAYER_CODES[key]


def match_kind(q_layer: int, p_layer: int) -> str:
    """exact | adjacent | distant | loose  (how the note matched, for the UI)."""
    if q_layer == Q_GENERAL and p_layer == GENERAL:
        return "exact"
    if q_layer in (Q_ANY, Q_GENERAL) or p_layer == GENERAL:
        return "loose"
    if q_layer == p_layer:
        return "exact"
    return "adjacent" if abs(q_layer - p_layer) == 1 else "distant"


@dataclass
class QueryResult:
    idx: np.ndarray        # perfume indices, best first (a page: offset..offset+limit)
    score: np.ndarray      # final score for those
    total: int             # number of perfumes with score > 0
    top_score: float
    items: list            # deduped [(note_idx, q_layer)]
    wq: float
    all_score: object = None   # the unmasked dense score array (perfumes with score > 0 form the candidate set)


def dedupe_items(items):
    seen, out = set(), []
    for j, ql in items:
        if (j, ql) not in seen:
            seen.add((j, ql))
            out.append((int(j), int(ql)))
    return out


def raw_scores(cat, items):
    """Dense float32 array [n_perfumes] of cosine-like scores, plus W(Q)."""
    n = cat.n_perf
    raw = np.zeros(n, dtype=np.float32)
    wq = 0.0
    for j, ql in items:
        w = float(cat.idf[j])
        wq += w
        best = np.zeros(n, dtype=np.float32)
        row = LAYER_MATCH[ql]
        for L in range(4):
            idx = cat.layer_rows(L, j)
            if idx.size:
                best[idx] = np.maximum(best[idx], row[L])
        raw += w * best
    if wq <= 0:
        return np.zeros(n, dtype=np.float32), 0.0
    denom = np.sqrt(wq * cat.p_weight)
    score = np.divide(raw, denom, out=np.zeros(n, dtype=np.float32), where=denom > 0)
    return score, wq


def rank(cat, score: np.ndarray, mask=None, offset: int = 0, limit: int = 50) -> QueryResult:
    s = score
    if mask is not None:
        s = np.where(mask, s, 0.0)
    cand = np.flatnonzero(s > 1e-9)
    total = int(cand.size)
    if total == 0:
        return QueryResult(np.zeros(0, np.int64), np.zeros(0, np.float32), 0, 0.0, [], 0.0, score)
    # popularity only breaks (near-)ties
    key = s[cand].astype(np.float64) + 1e-7 * cat.p_pop[cand]
    k = min(total, offset + limit)
    if k < total:
        part = np.argpartition(-key, k - 1)[:k]
    else:
        part = np.arange(total)
    order = part[np.argsort(-key[part], kind="stable")]
    sel = cand[order][offset:offset + limit]
    return QueryResult(sel, s[sel], total, float(s[cand].max()), [], 0.0, score)


def query_items_from_notes(cat, notes):
    """notes: iterable of (slug, layer_str). Returns (items, unknown_slugs)."""
    items, unknown = [], []
    for slug, layer in notes:
        j = cat.note_index.get(slug)
        if j is None:
            unknown.append(slug)
            continue
        items.append((j, parse_query_layer(layer)))
    return dedupe_items(items), unknown


def similar_by_notes(cat, items, mask=None, offset=0, limit=50) -> QueryResult:
    items = dedupe_items(items)
    score, wq = raw_scores(cat, items)
    res = rank(cat, score, mask, offset, limit)
    res.items, res.wq = items, wq
    return res


def accord_cosine(cat, i: int) -> np.ndarray:
    """Cosine similarity of every perfume's accord vector with perfume i."""
    return cat.accord_cosine(i)


def similar_to_perfume(cat, i: int, mask=None, offset=0, limit=50, include_self=False):
    """'Smells like perfume i': its pyramid is the query, plus a small accord bonus."""
    items = cat.perfume_items(i)  # [(note_idx, q_layer)]
    acc = accord_cosine(cat, i)
    if items:
        score, wq = raw_scores(cat, dedupe_items(items))
        has = score > 0
        final = np.where(has, (1 - ACCORD_WEIGHT) * score + ACCORD_WEIGHT * acc, 0.0).astype(np.float32)
    else:  # perfume without notes: accords only
        wq, final = 0.0, acc
    if not include_self:
        final = final.copy()
        final[i] = 0.0
    res = rank(cat, final, mask, offset, limit)
    res.items, res.wq = dedupe_items(items), wq
    return res, acc


def explain(cat, items, wq: float, i: int):
    """Per-query-note explanation for perfume i.

    contribution values sum to the (note-only) score of the perfume.
    """
    wp = float(cat.p_weight[i]) or 1.0
    denom = math.sqrt(wq * wp) if wq > 0 else 1.0
    p_notes = cat.perfume_pairs(i)  # [(note_idx, layer_code)]
    out = []
    for j, ql in items:
        best_m, best_layer = 0.0, None
        for pj, pl in p_notes:
            if pj != j:
                continue
            m = float(LAYER_MATCH[ql][pl])
            if m > best_m or (m == best_m and best_layer is None):
                best_m, best_layer = m, pl
        w = float(cat.idf[j])
        entry = {
            "slug": cat.note_slug[j],
            "name": cat.note_name[j],
            "query_layer": "any" if ql == Q_ANY else LAYER_NAMES[ql] if ql < 4 else "general",
            "weight": round(w, 3),
            "matched": best_layer is not None,
        }
        if best_layer is not None:
            entry.update(
                layer=LAYER_NAMES[best_layer],
                kind=match_kind(ql, best_layer),
                factor=round(best_m, 2),
                contribution=round(w * best_m / denom, 4),
            )
        else:
            entry.update(layer=None, kind="missing", factor=0.0, contribution=0.0)
        out.append(entry)
    out.sort(key=lambda e: -e["contribution"])
    return out
