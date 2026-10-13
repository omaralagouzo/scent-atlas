"""'Notes I gravitate to': a weighted note profile computed from a user's favourites, collection and ratings."""
from __future__ import annotations

import palette

STATUS_W = {"owned": 1.0, "tried": 0.5, "wishlist": 0.5}
LAYER_W = {0: 0.8, 1: 1.0, 2: 1.0, 3: 0.9}   # top notes fade first, so count slightly less
MAX_PERFUMES = 500
LAYER_KEYS = ("top", "middle", "base", "any")


def perfume_weights(fav_ids: list[int], statuses: list[dict]) -> dict[int, float]:
    """perfume id -> weight (>0). Disliked perfumes (low rating, no other signal) drop out."""
    sig: dict[int, dict] = {}
    for pid in fav_ids:
        sig.setdefault(pid, {})["fav"] = True
    for r in statuses:
        s = sig.setdefault(int(r["perfume_id"]), {})
        s["status"], s["rating"] = r.get("status"), r.get("rating")
    out = {}
    for pid, s in sig.items():
        w = 1.0 + (1.5 if s.get("fav") else 0.0) + STATUS_W.get(s.get("status"), 0.0)
        if s.get("rating"):
            w += 0.75 * (int(s["rating"]) - 3)
        if w > 0:
            out[pid] = min(w, 6.0)
    return out


def build_profile(cat, fav_ids: list[int], statuses: list[dict], top_n: int = 14) -> dict:
    weights = perfume_weights(fav_ids, statuses)
    counts = {"favorites": len(fav_ids), "owned": 0, "tried": 0, "wishlist": 0, "rated": 0}
    for r in statuses:
        if r.get("status") in counts:
            counts[r["status"]] += 1
        if r.get("rating"):
            counts["rated"] += 1
    score: dict[int, float] = {}
    occurs: dict[int, int] = {}
    layer_hist: dict[int, list[float]] = {}
    used = 0
    for pid, w in sorted(weights.items(), key=lambda kv: -kv[1])[:MAX_PERFUMES]:
        i = cat.idx_of(pid)
        if i is None:
            continue
        used += 1
        a, b = int(cat.pn_indptr[i]), int(cat.pn_indptr[i + 1])
        seen = set()
        for k in range(a, b):
            j, L = int(cat.pn_note[k]), int(cat.pn_layer[k])
            score[j] = score.get(j, 0.0) + w * LAYER_W[L]
            lh = layer_hist.setdefault(j, [0.0, 0.0, 0.0, 0.0])
            lh[L] += w
            if j not in seen:
                seen.add(j)
                occurs[j] = occurs.get(j, 0) + 1
    # rare notes say more about taste than musk/vanilla that are everywhere: weight by idf
    ranked = sorted(((s * float(cat.idf[j]), j) for j, s in score.items()), reverse=True)[:top_n]
    top = ranked[0][0] if ranked else 1.0
    notes = [cat.note_obj(j, score=round(s, 3), share=round(s / top, 3), perfumes=occurs[j]) for s, j in ranked]

    fam: dict[str, float] = {}
    for s, j in ranked:
        fam[cat.note_family[j]] = fam.get(cat.note_family[j], 0.0) + s
    ftot = sum(fam.values()) or 1.0
    families = [{"name": f, "color": palette.family_color(f), "share": round(v / ftot, 3)}
                for f, v in sorted(fam.items(), key=lambda kv: -kv[1])][:6]

    # a ready-to-run pyramid: each leading note goes to the layer where the user's perfumes most often place it
    tiers: dict[str, list[str]] = {k: [] for k in LAYER_KEYS}
    for s, j in ranked[:10]:
        lh = layer_hist[j]
        L = max(range(4), key=lambda x: lh[x])
        key = "any" if L == 3 else LAYER_KEYS[L]
        if len(tiers[key]) < 4:
            tiers[key].append(cat.note_slug[j])
    params = {k: ",".join(v) for k, v in tiers.items() if v}
    return {"based_on": {**counts, "used": used}, "notes": notes, "families": families,
            "pyramid": tiers, "pyramid_params": params}
