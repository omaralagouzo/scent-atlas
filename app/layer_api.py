"""Layering API: recommendations for one perfume, the pair page, layering inside a collection, community combos + votes.

Mounted inside user_api's router (same /api prefix, CSRF guard and session handling). The model lives in layering.py.
"""
from __future__ import annotations

import math
import time

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

import layering as L

COMBOS_PER_DAY = 30          # new community combos one account may start in 24 h (votes are unlimited)
CURATED_SHOWCASE = 12


class ComboBody(BaseModel):
    a: int
    b: int


class VoteBody(BaseModel):
    vote: int = Field(ge=-1, le=1)      # +1 thumbs up, -1 thumbs down, 0 take the vote back


def wilson(up: int, down: int, z: float = 1.64) -> float:
    """Lower bound of the 90% Wilson interval for the share of thumbs up: 3 of 3 does not outrank 40 of 45."""
    n = up + down
    if n == 0:
        return 0.0
    p = up / n
    return (p + z * z / (2 * n) - z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)


def traits(cat, i: int) -> dict:
    """How a perfume behaves in a layer, for the hero card: role, weight, simplicity."""
    f = L.feats_of(cat, [i]).row(0)
    h = float(f["heavy"])
    role = ("base", "Best as the base layer") if h >= 0.6 else ("top", "Best as the top layer") if h <= 0.35 else ("either", "Works as base or top")
    style = ("enhancer", "Skin-scent enhancer") if f["enhancer"] else ("simple", "Simple, linear") if f["simple"] else \
        ("complex", "Complex composition") if f["complex"] else ("medium", "Medium complexity")
    return {"role": role[0], "role_label": role[1], "weight": round(h, 2), "style": style[0], "style_label": style[1],
            "sweet": round(float(f["sweet"]), 2), "fresh": round(float(f["fresh"]), 2)}


def make_router(ctx, current_user, require_user) -> APIRouter:
    store, cat = ctx.store, ctx.cat
    router = APIRouter()

    def idx(pid: int) -> int:
        i = cat.idx_of(pid)
        if i is None:
            raise HTTPException(404, "perfume not found")
        return i

    def owned_idx(uid) -> list[int]:
        out = []
        for r in store.list_status(uid, "owned"):
            i = cat.idx_of(r["perfume_id"])
            if i is not None:
                out.append(i)
        return out

    def combo_out(c, me, votes=None, anchor=None):
        ia, ib = cat.idx_of(c["a_id"]), cat.idx_of(c["b_id"])
        if ia is None or ib is None:
            return None
        rep = L.pair_report(cat, ia, ib)
        d = {"id": c["id"], "up": c["up"], "down": c["down"], "rank": round(wilson(c["up"], c["down"]), 4),
             "my_vote": (votes or {}).get(c["id"], 0) if me else 0,
             "by": c.get("by"), "created_at": c["created_at"],
             "a": cat.summary(ia), "b": cat.summary(ib),
             "ours": {"verdict": rep["verdict"], "verdict_label": rep["verdict_label"], "recommended": rep["recommended"]}}
        if anchor is not None:
            d["partner"] = d["b"] if c["a_id"] == anchor else d["a"]
        return d

    def combos_out(rows, user, anchor=None):
        votes = store.user_votes(user["id"], [c["id"] for c in rows]) if user else {}
        out = [d for d in (combo_out(c, user, votes, anchor) for c in rows) if d]
        out.sort(key=lambda d: (-d["rank"], -d["up"], d["id"]))
        return out

    # ---- one perfume: its best partners from the user's shelf, curated picks, community, the whole catalog ------
    @router.get("/layering/{pid}")
    def layering_for(pid: int, response: Response, offset: int = Query(0, ge=0), limit: int = Query(12, ge=1, le=48),
                     user=Depends(current_user)):
        response.headers["Cache-Control"] = "no-store"
        i = idx(pid)
        m = L.model(cat)
        rows, r, fi, total = L.candidates(cat, i, m.pool, limit=limit, offset=offset)
        catalog_items = [{**cat.summary(int(m.pool.idx[k])), "pair": L.brief(cat, i, int(m.pool.idx[k]), fi, m.pool.row(int(k)), r, int(k))}
                         for k in rows]
        out = {"catalog": {"total": total, "offset": offset, "limit": limit, "items": catalog_items}}
        if offset:
            return out
        d = cat.summary(i)
        d["pyramid"] = cat.pyramid_slim(i)
        out["source"] = {**d, "traits": traits(cat, i)}
        out["curated"] = []
        for j, note, url in m.curated.get(i, ()):
            rep = L.pair_report(cat, i, j)
            out["curated"].append({**cat.summary(j), "pair": {"verdict": rep["verdict"], "verdict_label": rep["verdict_label"],
                                   "note": note, "source_url": url, "source": url.split("/")[2].removeprefix("www.")}})
        out["community"] = combos_out(store.combos_for(int(cat.p_id[i])), user, anchor=int(cat.p_id[i]))
        if user:
            mine = [j for j in owned_idx(user["id"]) if j != i]
            out["collection"] = {"owned": len(mine), "items": []}
            if mine:
                cf = L.feats_of(cat, mine)
                rc = L.score_against(cat, i, fi, cf)
                ok = np.flatnonzero((rc["score"] >= L.SHOW) & ~rc["excluded"])
                ok = [k for k in ok[np.argsort(-rc["score"][ok], kind="stable")] if not cat.link_relation(i, mine[k])]
                out["collection"]["items"] = [{**cat.summary(mine[k]), "pair": L.brief(cat, i, mine[k], fi, cf.row(int(k)), rc, int(k))}
                                              for k in ok[:24]]
        return out

    # ---- the pair page ------------------------------------------------------------------------------------------
    @router.get("/layering/{pid}/with/{other}")
    def pair(pid: int, other: int, response: Response, user=Depends(current_user)):
        response.headers["Cache-Control"] = "no-store"
        i, j = idx(pid), idx(other)
        if i == j:
            raise HTTPException(400, "pick two different perfumes")
        rep = L.pair_report(cat, i, j)
        a, b = cat.summary(i), cat.summary(j)
        a["pyramid"], b["pyramid"] = cat.pyramid_slim(i), cat.pyramid_slim(j)
        c = store.find_combo(pid, other)
        community = combo_out(c, user, store.user_votes(user["id"], [c["id"]]) if user else {}) if c else None
        return {"a": {**a, "traits": traits(cat, i)}, "b": {**b, "traits": traits(cat, j)}, "report": rep, "community": community}

    # ---- layering inside the signed-in user's collection -------------------------------------------------------
    @router.get("/me/collection/layering")
    def collection_layering(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        mine = owned_idx(user["id"])
        pairs = L.within(cat, mine, limit=60)
        by: dict[int, int] = {}
        for i, j, _b in pairs:
            for x in (i, j):
                pid = int(cat.p_id[x])
                by[pid] = by.get(pid, 0) + 1
        return {"owned": len(mine), "pairs": [{"a": cat.summary(i), "b": cat.summary(j), "pair": b} for i, j, b in pairs],
                "partners": {str(k): v for k, v in by.items()}}

    # ---- community combos ----------------------------------------------------------------------------------------
    @router.get("/layering")
    def layering_home(response: Response, user=Depends(current_user)):
        """Front page: top community combos and a showcase of brand / perfumer recommended pairs."""
        response.headers["Cache-Control"] = "no-store"
        m = L.model(cat)
        showcase, seen = [], set()
        for i, lst in m.curated.items():
            for j, note, url in lst:
                key = (min(i, j), max(i, j))
                if key in seen:
                    continue
                seen.add(key)
                showcase.append((float(cat.p_votes[i]) + float(cat.p_votes[j]), i, j, note, url))
        showcase.sort(key=lambda t: -t[0])
        return {
            "community": combos_out(store.top_combos(40), user)[:24],
            "curated": [{"a": cat.summary(i), "b": cat.summary(j), "note": note, "source_url": url,
                         "source": url.split("/")[2].removeprefix("www.")} for _v, i, j, note, url in showcase[:CURATED_SHOWCASE]],
            "curated_total": len(showcase),
        }

    @router.post("/layering/combos", status_code=201)
    def create_combo(body: ComboBody, user=Depends(require_user)):
        """Suggest a pair to the community (it starts with your thumbs up). An existing pair just gets your vote."""
        i, j = idx(body.a), idx(body.b)
        if i == j:
            raise HTTPException(422, "Pick two different fragrances.")
        existing = store.find_combo(body.a, body.b)
        if existing:
            store.vote_combo(user["id"], existing["id"], 1)
            c = store.get_combo(existing["id"])
        else:
            if store.combos_created_since(user["id"], int(time.time()) - 86400) >= COMBOS_PER_DAY:
                raise HTTPException(429, f"You can suggest up to {COMBOS_PER_DAY} new combos a day.")
            c, _created = store.create_combo(user["id"], body.a, body.b)
        return combo_out(c, user, store.user_votes(user["id"], [c["id"]]))

    @router.post("/layering/combos/{cid}/vote")
    def vote(cid: int, body: VoteBody, user=Depends(require_user)):
        if not store.get_combo(cid):
            raise HTTPException(404, "combo not found")
        c = store.vote_combo(user["id"], cid, body.vote)
        return combo_out(c, user, store.user_votes(user["id"], [cid]))

    return router
