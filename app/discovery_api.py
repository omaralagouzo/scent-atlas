"""Admin API for new-release discovery (review queue, edits, approve / publish, research runs) and the public image route.

Mounted on the admin router (its sign-in, CSRF and host rules). Published candidates join the catalogue the next time
the app starts (discovery.merged_catalog); with RENDER_DEPLOY_HOOK_URL set, publishing starts that restart itself.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

import discovery as dz
import discovery_engine as de
import images
import palette
from userdb import discovery_images, discovery_items, discovery_runs

SORTS = {
    "confidence": (discovery_items.c.overall.desc(), discovery_items.c.id.desc()),
    "newest": (discovery_items.c.id.desc(),),
    "release": (discovery_items.c.release_date.desc(), discovery_items.c.id.desc()),
    "brand": (discovery_items.c.brand, discovery_items.c.name),
}


class Notes(BaseModel):
    top: list[str] = Field(default_factory=list, max_length=25)
    middle: list[str] = Field(default_factory=list, max_length=25)
    base: list[str] = Field(default_factory=list, max_length=25)
    general: list[str] = Field(default_factory=list, max_length=25)


class ItemPatch(BaseModel):
    """Owner edits. A field the owner sets counts as verified (confidence 1)."""
    brand: str | None = Field(default=None, max_length=120)
    name: str | None = Field(default=None, max_length=160)
    concentration: str | None = Field(default=None, max_length=40)
    gender: str | None = Field(default=None, max_length=10)
    release_date: str | None = Field(default=None, max_length=10)
    release_status: str | None = Field(default=None, max_length=10)
    perfumers: list[str] | None = Field(default=None, max_length=8)
    notes: Notes | None = None
    family: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=600)
    image_url: str | None = Field(default=None, max_length=1000)
    official_url: str | None = Field(default=None, max_length=1000)
    comment: str | None = Field(default=None, max_length=500)


class ApproveBody(BaseModel):
    force: bool = False          # approve even though data is missing / it looks like a duplicate


class RejectBody(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class DuplicateBody(BaseModel):
    perfume_id: int


class BulkBody(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    action: str = Field(pattern="^(approve|reject|restore)$")
    reason: str | None = Field(default=None, max_length=300)


class RunBody(BaseModel):
    kind: str = Field(pattern="^(discover|complete|full)$")
    segments: list[str] | None = None
    model: str = Field(default="sonnet", pattern="^(sonnet|haiku)$")
    complete_model: str = Field(default="haiku", pattern="^(sonnet|haiku)$")
    budget_usd: float = Field(default=de.DEFAULT_BUDGET_USD, gt=0, le=200)
    max_items: int = Field(default=60, ge=1, le=500)
    since: str = Field(default="2026-07-01", pattern=r"^\d{4}-\d{2}-\d{2}$")


def _j(s, default):
    try:
        return json.loads(s) if s else default
    except ValueError:
        return default


def admin_image_url(iid: int, fetched_at: int | None) -> str | None:
    return f"/api/admin/discovery/images/{iid}.webp?v={fetched_at}" if fetched_at else None


def make_admin_routes(router: APIRouter, ctx, require_admin, log, ip_of):
    store, cat = ctx.store, ctx.cat
    engine = getattr(ctx, "discovery_engine", None) or de.Engine(store, cat)
    ctx.discovery_engine = engine
    auth = [Depends(require_admin)]

    def images_of(ids: list[int]) -> dict[int, int]:
        if not ids:
            return {}
        with store.eng.connect() as c:
            return {r.item_id: r.fetched_at for r in c.execute(
                sa.select(discovery_images.c.item_id, discovery_images.c.fetched_at)
                .where(discovery_images.c.item_id.in_(ids)))}

    def dup_out(pid: int | None):
        if pid is None:
            return None
        i = cat.idx_of(pid)
        if i is None:
            return {"id": pid}
        s = cat.summary(i)
        return {k: s.get(k) for k in ("id", "name", "brand", "year", "gender", "image")}

    def out(r: dict, img: int | None, full: bool = False) -> dict:
        notes = _j(r["notes"], {})
        d = {"id": r["id"], "state": r["state"], "brand": r["brand"], "name": r["name"],
             "concentration": r["concentration"], "gender": r["gender"], "release_date": r["release_date"],
             "release_status": r["release_status"], "perfumers": _j(r["perfumers"], []), "notes": notes,
             "note_count": dz.n_notes(notes), "family": r["family"], "description": r["description"],
             "image": admin_image_url(r["id"], img), "image_url": r["image_url"], "official_url": r["official_url"],
             "sources": _j(r["sources"], []), "confidence": _j(r["confidence"], {}), "overall": r["overall"],
             "missing": _j(r["missing"], []), "duplicate_of": dup_out(r["duplicate_of"]), "perfume_id": r["perfume_id"],
             "review_note": r["review_note"], "comment": r["comment"], "origin": r["origin"], "attempts": r["attempts"],
             "created_at": r["created_at"], "updated_at": r["updated_at"], "reviewed_at": r["reviewed_at"],
             "published_at": r["published_at"]}
        if r["state"] == "published":
            d["live"] = r["perfume_id"] is not None and cat.idx_of(r["perfume_id"]) is not None
        return d

    def get(iid: int) -> dict:
        with store.eng.connect() as c:
            r = c.execute(sa.select(discovery_items).where(discovery_items.c.id == iid)).mappings().first()
        if not r:
            raise HTTPException(404, "Candidate not found.")
        return dict(r)

    def put(iid: int, **vals):
        vals["updated_at"] = int(time.time())
        with store.eng.begin() as c:
            c.execute(discovery_items.update().where(discovery_items.c.id == iid).values(**vals))

    def one_out(iid: int) -> dict:
        return out(get(iid), images_of([iid]).get(iid), full=True)

    def counts() -> dict:
        with store.eng.connect() as c:
            got = dict(c.execute(sa.select(discovery_items.c.state, sa.func.count())
                                 .group_by(discovery_items.c.state)).all())
        return {s: int(got.get(s, 0)) for s in dz.STATES}

    # ------------------------------------------------------------ queue
    @router.get("/discovery/items", dependencies=auth)
    def list_items(response: Response, state: str = Query("complete", max_length=12), q: str = Query("", max_length=100),
                   sort: str = Query("confidence", max_length=12), limit: int = Query(200, ge=1, le=1000),
                   offset: int = Query(0, ge=0)):
        response.headers["Cache-Control"] = "no-store"
        if state != "all" and state not in dz.STATES:
            raise HTTPException(422, "Unknown state.")
        sel = sa.select(discovery_items)
        if state != "all":
            sel = sel.where(discovery_items.c.state == state)
        for tok in dz.norm(q).split()[:6]:
            sel = sel.where(discovery_items.c.key.like(f"%{tok}%"))
        with store.eng.connect() as c:
            total = int(c.execute(sa.select(sa.func.count()).select_from(sel.subquery())).scalar() or 0)
            rows = [dict(r) for r in c.execute(sel.order_by(*SORTS.get(sort, SORTS["confidence"]))
                                               .limit(limit).offset(offset)).mappings()]
        imgs = images_of([r["id"] for r in rows])
        return {"items": [out(r, imgs.get(r["id"])) for r in rows], "total": total, "counts": counts()}

    @router.get("/discovery/items/{iid}", dependencies=auth)
    def item(iid: int, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return one_out(iid)

    @router.patch("/discovery/items/{iid}", dependencies=auth)
    def edit(iid: int, body: ItemPatch, request: Request):
        r = get(iid)
        if r["state"] == "published":
            raise HTTPException(409, "Unpublish it first to edit.")
        given = body.model_dump(exclude_unset=True)
        raw = {"brand": r["brand"], "name": r["name"], "concentration": r["concentration"], "gender": r["gender"],
               "release_date": r["release_date"], "status": r["release_status"], "perfumers": _j(r["perfumers"], []),
               "notes": _j(r["notes"], {}), "family": r["family"], "description": r["description"],
               "image_url": r["image_url"], "official_url": r["official_url"], "comment": r["comment"]}
        for k, v in given.items():
            raw["status" if k == "release_status" else k] = v
        it = dz.clean_item(raw)
        if not it:
            raise HTTPException(422, "Brand and name are required.")
        if "gender" in given and given["gender"] and not it["gender"]:
            raise HTTPException(422, "Gender is women, men or unisex.")
        if "release_date" in given and given["release_date"] and not it["release_date"]:
            raise HTTPException(422, "Release date is YYYY, YYYY-MM or YYYY-MM-DD.")
        if "image_url" in given and given["image_url"] and not it["image_url"]:
            raise HTTPException(422, "Image URL must start with http:// or https://.")
        key = dz.item_key(it["brand"], it["name"], it["concentration"])
        if key != r["key"]:
            with store.eng.connect() as c:
                if c.execute(sa.select(discovery_items.c.id).where(discovery_items.c.key == key)).first():
                    raise HTTPException(409, "Another candidate already has this brand, name and concentration.")
        conf = _j(r["confidence"], {})
        field_conf = {"brand": "identity", "name": "identity", "concentration": "concentration", "gender": "gender",
                      "release_date": "release_date", "perfumers": "perfumers", "notes": "notes", "image_url": "image"}
        for k in given:
            if k in field_conf and k != "image_url":
                conf[field_conf[k]] = 1.0
        vals = dict(key=key, brand=it["brand"], name=it["name"], concentration=it["concentration"], gender=it["gender"],
                    release_date=it["release_date"], release_status=it["release_status"],
                    perfumers=json.dumps(it["perfumers"]), notes=json.dumps(it["notes"]), family=it["family"],
                    description=it["description"], image_url=it["image_url"], official_url=it["official_url"],
                    comment=it["comment"], confidence=json.dumps(conf))
        put(iid, **vals)
        if "image_url" in given and it["image_url"] != r["image_url"]:
            with store.eng.begin() as c:
                c.execute(discovery_images.delete().where(discovery_images.c.item_id == iid))
            if it["image_url"] and dz.fetch_image(store, iid):
                conf["image"] = 1.0
                put(iid, confidence=json.dumps(conf))
        dz.recompute(store, iid)
        log.info("admin edited discovery item %s from %s", iid, ip_of(request))
        return one_out(iid)

    # ------------------------------------------------------------ decisions
    def approve_one(iid: int, force: bool) -> dict:
        r = get(iid)
        if r["state"] in ("approved", "published"):
            return r
        if r["state"] == "rejected":
            raise HTTPException(409, "Restore it before approving.")
        if not force and r["state"] != "complete":
            raise HTTPException(409, "It is still missing data (or looks like a duplicate). Approve anyway with force.")
        put(iid, state="approved", perfume_id=r["perfume_id"] or dz.ID_BASE + iid, reviewed_at=int(time.time()),
            review_note=None)
        return r

    def reject_one(iid: int, reason: str | None):
        r = get(iid)
        if r["state"] == "published":
            raise HTTPException(409, "Unpublish it first.")
        put(iid, state="rejected", review_note=reason, reviewed_at=int(time.time()))

    def restore_one(iid: int):
        r = get(iid)
        if r["state"] == "published":
            raise HTTPException(409, "Unpublish it first.")
        put(iid, state="duplicate" if r["duplicate_of"] else "incomplete", review_note=None)
        dz.recompute(store, iid)

    @router.post("/discovery/items/{iid}/approve", dependencies=auth)
    def approve(iid: int, body: ApproveBody, request: Request):
        approve_one(iid, body.force)
        log.info("admin approved discovery item %s from %s", iid, ip_of(request))
        return one_out(iid)

    @router.post("/discovery/items/{iid}/reject", dependencies=auth)
    def reject(iid: int, body: RejectBody, request: Request):
        reject_one(iid, body.reason)
        log.info("admin rejected discovery item %s from %s", iid, ip_of(request))
        return one_out(iid)

    @router.post("/discovery/items/{iid}/restore", dependencies=auth)
    def restore(iid: int):
        restore_one(iid)
        return one_out(iid)

    @router.post("/discovery/items/{iid}/not-duplicate", dependencies=auth)
    def not_duplicate(iid: int):
        r = get(iid)
        if r["state"] == "published":
            raise HTTPException(409, "Already published.")
        put(iid, duplicate_of=None, state="incomplete" if r["state"] == "duplicate" else r["state"])
        dz.recompute(store, iid)
        return one_out(iid)

    @router.post("/discovery/items/{iid}/duplicate", dependencies=auth)
    def mark_duplicate(iid: int, body: DuplicateBody):
        r = get(iid)
        if r["state"] == "published":
            raise HTTPException(409, "Unpublish it first.")
        if cat.idx_of(body.perfume_id) is None:
            raise HTTPException(422, "Unknown catalogue perfume.")
        put(iid, duplicate_of=body.perfume_id, state="duplicate")
        return one_out(iid)

    @router.post("/discovery/items/{iid}/refetch-image", dependencies=auth)
    def refetch(iid: int):
        r = get(iid)
        if not r["image_url"]:
            raise HTTPException(422, "It has no image URL.")
        if not dz.fetch_image(store, iid):
            raise HTTPException(502, "Could not download a usable image from that URL.")
        return one_out(iid)

    @router.post("/discovery/bulk", dependencies=auth)
    def bulk(body: BulkBody, request: Request):
        done, failed = [], []
        for iid in dict.fromkeys(body.ids):
            try:
                if body.action == "approve":
                    approve_one(iid, False)
                elif body.action == "reject":
                    reject_one(iid, body.reason)
                else:
                    restore_one(iid)
                done.append(iid)
            except HTTPException as e:
                failed.append({"id": iid, "error": e.detail})
        log.info("admin bulk %s on %s discovery items from %s", body.action, len(done), ip_of(request))
        return {"done": done, "failed": failed, "counts": counts()}

    # ------------------------------------------------------------ publishing
    def pending_restart() -> int:
        return sum(1 for r in dz.published_rows(store) if cat.idx_of(r["perfume_id"] or 0) is None)

    def deploy_hook() -> str | None:
        return os.environ.get("RENDER_DEPLOY_HOOK_URL") or None

    @router.post("/discovery/publish", dependencies=auth)
    def publish(request: Request):
        now = int(time.time())
        with store.eng.begin() as c:
            n = c.execute(discovery_items.update().where(discovery_items.c.state == "approved")
                          .values(state="published", published_at=now, updated_at=now)).rowcount
        restarted = False
        hook = deploy_hook()
        if n and hook and hook.startswith("https://"):
            try:
                urllib.request.urlopen(urllib.request.Request(hook, method="POST"), timeout=10).read()  # noqa: S310
                restarted = True
            except Exception as e:   # noqa: BLE001
                log.warning("deploy hook failed: %s", e)
        log.info("admin published %s discovery items from %s", n, ip_of(request))
        return {"published": n, "restarting": restarted, "pending_restart": pending_restart(), "counts": counts()}

    @router.post("/discovery/items/{iid}/unpublish", dependencies=auth)
    def unpublish(iid: int, request: Request):
        r = get(iid)
        if r["state"] != "published":
            raise HTTPException(409, "It is not published.")
        put(iid, state="approved", published_at=None)
        log.info("admin unpublished discovery item %s from %s", iid, ip_of(request))
        return one_out(iid)

    # ------------------------------------------------------------ runs
    def run_out(r: dict, full: bool = False) -> dict:
        d = {"id": r["id"], "kind": r["kind"], "status": r["status"], "model": r["model"], "params": _j(r["params"], {}),
             "stats": _j(r["stats"], {}), "error": r["error"], "created_at": r["created_at"],
             "started_at": r["started_at"], "finished_at": r["finished_at"]}
        if full:
            d["log"] = (r["log"] or "").splitlines()[-200:]
        return d

    @router.get("/discovery/config", dependencies=auth)
    def config(response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"engine_ready": engine.ready(), "running": engine.running(), "deploy_hook": bool(deploy_hook()),
                "pending_restart": pending_restart(), "counts": counts(),
                "segments": [{"key": s["key"], "title": s["title"]} for s in de.SEGMENTS],
                "models": {"sonnet": de.MODELS["sonnet"], "haiku": de.MODELS["haiku"]},
                "default_budget_usd": de.DEFAULT_BUDGET_USD}

    @router.get("/discovery/runs", dependencies=auth)
    def runs(response: Response, limit: int = Query(30, ge=1, le=200)):
        response.headers["Cache-Control"] = "no-store"
        with store.eng.connect() as c:
            rows = [dict(r) for r in c.execute(sa.select(discovery_runs).order_by(discovery_runs.c.id.desc())
                                               .limit(limit)).mappings()]
        return {"runs": [run_out(r) for r in rows], "running": engine.running()}

    @router.get("/discovery/runs/{rid}", dependencies=auth)
    def run(rid: int, response: Response):
        response.headers["Cache-Control"] = "no-store"
        with store.eng.connect() as c:
            r = c.execute(sa.select(discovery_runs).where(discovery_runs.c.id == rid)).mappings().first()
        if not r:
            raise HTTPException(404, "Run not found.")
        return run_out(dict(r), full=True)

    @router.post("/discovery/runs", dependencies=auth)
    def start(body: RunBody, request: Request):
        if not engine.ready():
            raise HTTPException(409, "Set ANTHROPIC_API_KEY on the server to run research from here.")
        try:
            rid = engine.start(body.kind, segments=body.segments, model=body.model, complete_model=body.complete_model,
                               budget_usd=body.budget_usd, max_items=body.max_items, since=body.since)
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e))
        log.info("admin started discovery run %s (%s) from %s", rid, body.kind, ip_of(request))
        return run(rid, Response())

    @router.post("/discovery/runs/{rid}/cancel", dependencies=auth)
    def cancel(rid: int, request: Request):
        if not engine.cancel(rid):
            raise HTTPException(409, "That run is not going.")
        log.info("admin cancelled discovery run %s from %s", rid, ip_of(request))
        return {"ok": True}

    # ------------------------------------------------------------ admin image preview
    @router.get("/discovery/images/{iid}.webp", dependencies=auth)
    def admin_image(iid: int):
        with store.eng.connect() as c:
            r = c.execute(sa.select(discovery_images.c.data, discovery_images.c.mime)
                          .where(discovery_images.c.item_id == iid)).first()
        if not r:
            raise HTTPException(404, "No image.")
        return Response(r.data, media_type=r.mime or "image/webp", headers={"Cache-Control": "private, max-age=86400"})


def add_public_routes(app, store, cat):
    """/img/discovery/{id}.webp: the stored image of a published candidate (a drawn bottle when it has none)."""

    @app.get("/img/discovery/{iid}.webp")
    def discovery_image(iid: int):
        with store.eng.connect() as c:
            r = c.execute(sa.select(discovery_items.c.state, discovery_items.c.brand, discovery_items.c.name,
                                    discovery_images.c.data, discovery_images.c.mime)
                          .select_from(discovery_items.outerjoin(discovery_images,
                                                                 discovery_images.c.item_id == discovery_items.c.id))
                          .where(discovery_items.c.id == iid)).first()
        if not r or r.state != "published":
            raise HTTPException(404, "Not found.")
        if r.data:
            return Response(r.data, media_type=r.mime or "image/webp", headers={"Cache-Control": "public, max-age=86400"})
        svg = images.bottle_svg(r.brand, r.name, palette.DEFAULT_ACCENT, str(dz.ID_BASE + iid))
        return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})
