"""Marketplace: members sell bottles to each other, message the seller, and post "wanted" requests.

* A listing names a catalogue perfume (live at once) or a custom one (waits for the owner's review on the admin).
* Each listing has the size, how much is left, a price, optional box / tester flags, up to MAX_PHOTOS photos and a
  pickup point. Strangers only ever see the pickup area and a position rounded to ~1 km; the exact point stays with
  the seller.
* No reservations (they invite hoarding and bots): buyers message the seller instead.
* A "wanted" request (perfume, optional max price, minimum ml, area and radius) is matched against every listing that
  goes live; matching members get a notification.
* Everything here needs an account, like profiles: sellers and buyers are real members, never anonymous.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

import auth
import avatar
import geo
from social_api import name_fields, top_summaries

CURRENCIES = ["AED", "SAR", "QAR", "KWD", "BHD", "OMR", "EGP", "JOD", "USD", "EUR", "GBP"]
SIZES = [5, 10, 15, 20, 30, 35, 40, 50, 60, 75, 80, 90, 100, 110, 120, 125, 150, 200, 250]
MAX_PHOTOS = 4
MAX_OPEN_LISTINGS = 30            # active + pending per member
LISTINGS_PER_HOUR = 10
MESSAGES_PER_MINUTE = 20
MAX_WANTED = 20
MESSAGE_MAX = 2000
STATUSES = ("pending", "active", "rejected", "sold", "withdrawn")


class Pickup(BaseModel):
    lat: float
    lng: float
    formatted: str | None = Field(default=None, max_length=300)
    area: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    country: str | None = Field(default=None, max_length=2)


class ListingBody(BaseModel):
    perfume_id: int | None = None
    custom_name: str | None = Field(default=None, max_length=120)
    custom_brand: str | None = Field(default=None, max_length=120)
    ml_total: int = Field(ge=1, le=1000)
    ml_left: int = Field(ge=1, le=1000)
    price: float = Field(gt=0, le=1_000_000)
    currency: str = Field(max_length=3)
    box: bool = False
    tester: bool = False
    description: str | None = Field(default=None, max_length=1000)
    pickup: Pickup


class ListingPatch(BaseModel):
    ml_left: int | None = Field(default=None, ge=1, le=1000)
    price: float | None = Field(default=None, gt=0, le=1_000_000)
    currency: str | None = Field(default=None, max_length=3)
    box: bool | None = None
    tester: bool | None = None
    description: str | None = Field(default=None, max_length=1000)
    pickup: Pickup | None = None
    custom_name: str | None = Field(default=None, max_length=120)
    custom_brand: str | None = Field(default=None, max_length=120)
    status: str | None = Field(default=None, max_length=10)       # sold | withdrawn | active (relist)


class PhotoBody(BaseModel):
    data: str = Field(max_length=300_000)


class MessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX + 200)


class WantedBody(BaseModel):
    perfume_id: int
    max_price: float | None = Field(default=None, gt=0, le=1_000_000)
    currency: str | None = Field(default=None, max_length=3)
    min_ml: int | None = Field(default=None, ge=1, le=1000)
    lat: float | None = None
    lng: float | None = None
    radius_km: int | None = Field(default=None, ge=1, le=20000)
    area: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=300)


class AddressBody(BaseModel):
    recipient: str | None = Field(default=None, max_length=80)
    phone: str = Field(min_length=6, max_length=32)
    formatted: str = Field(min_length=3, max_length=300)
    building: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=40)
    floor: str | None = Field(default=None, max_length=20)
    street: str | None = Field(default=None, max_length=160)
    area: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    region: str | None = Field(default=None, max_length=80)
    country: str | None = Field(default=None, max_length=2)
    postal_code: str | None = Field(default=None, max_length=20)
    instructions: str | None = Field(default=None, max_length=300)
    lat: float
    lng: float
    place_id: str | None = Field(default=None, max_length=300)


def tidy(s: str | None) -> str | None:
    s = " ".join((s or "").split())
    return s or None


def tidy_text(s: str | None) -> str | None:
    s = "\n".join(line.rstrip() for line in (s or "").strip().splitlines()).strip()
    return s or None


def money(minor: int) -> float:
    return round(minor / 100, 2)


def photo_url(pid: int) -> str:
    return f"/api/market/photos/{pid}.webp"


def listing_title(cat, row: dict) -> tuple[str, str, dict | None]:
    if row["perfume_id"] is not None:
        i = cat.idx_of(row["perfume_id"])
        if i is not None:
            s = cat.summary(i)
            return s["name"], s["brand"], s
    return row["custom_name"] or "Unnamed", row["custom_brand"] or "", None


def wanted_matches(w: dict, r: dict) -> bool:
    """Does listing r satisfy wanted request w (same perfume, price, minimum ml, within the radius)?"""
    if w["perfume_id"] != r["perfume_id"] or r["status"] != "active":
        return False
    if w["max_price_minor"] is not None and (w["currency"] != r["currency"] or r["price_minor"] > w["max_price_minor"]):
        return False
    if w["min_ml"] is not None and r["ml_left"] < w["min_ml"]:
        return False
    if w["radius_km"] and w["lat"] is not None and w["lng"] is not None:
        if geo.haversine_km(w["lat"], w["lng"], r["lat"], r["lng"]) > w["radius_km"]:
            return False
    return True


def notify_matches(store, row: dict):
    """A listing just went live: tell everyone whose wanted request it satisfies."""
    if row["status"] != "active" or row["perfume_id"] is None:
        return
    for w in store.wanted_where(perfume_id=row["perfume_id"]):
        if w["user_id"] != row["seller_id"] and wanted_matches(w, row):
            store.notify(w["user_id"], "wanted_match", row["seller_id"], str(row["id"]))


def listing_brief(store, cat, lid: int) -> dict | None:
    """Small summary for notifications: id, title, brand, image, status."""
    row = store.get_listing(lid)
    if not row:
        return None
    name, brand, s = listing_title(cat, row)
    photos = store.photo_ids([lid]).get(lid, [])
    return {"id": lid, "title": name, "brand": brand, "status": row["status"],
            "image": photo_url(photos[0]) if photos else (s or {}).get("image")}


def make_router(ctx, current_user, require_user) -> APIRouter:
    store, cat, settings = ctx.store, ctx.cat, ctx.settings
    router = APIRouter()
    create_limit = auth.RateLimiter(LISTINGS_PER_HOUR, 3600.0)
    message_limit = auth.RateLimiter(MESSAGES_PER_MINUTE, 60.0)

    def is_admin(request: Request) -> bool:
        sessions = getattr(ctx, "admin_sessions", None)
        if not sessions:
            return False
        return any(sessions.valid(request.cookies.get(n)) for n in ("__Host-sa_admin", "sa_admin"))

    # ---- output ------------------------------------------------------------------------------
    def people(uids, viewer) -> dict[int, dict]:
        ppl = store.people_by_id(list(set(uids)))
        friends = set(store.friend_ids(viewer["id"])) | {viewer["id"]} if viewer else set()
        tops = top_summaries(store, cat, [u for u in ppl if u in friends])
        return {u: {"username": p["username"], **name_fields(p), "top": tops.get(u)} for u, p in ppl.items()}

    def out(rows: list[dict], viewer: dict | None, near: tuple[float, float] | None = None, full: bool = False) -> list[dict]:
        photos = store.photo_ids([r["id"] for r in rows])
        sellers = people([r["seller_id"] for r in rows], viewer)
        res = []
        for r in rows:
            name, brand, s = listing_title(cat, r)
            mine = bool(viewer and r["seller_id"] == viewer["id"])
            ph = [photo_url(p) for p in photos.get(r["id"], [])]
            d = {
                "id": r["id"], "status": r["status"], "title": name, "brand": brand,
                "perfume": {k: s.get(k) for k in ("id", "name", "brand", "year", "gender", "image", "accords", "rating")} if s else None,
                "custom": r["perfume_id"] is None,
                "image": ph[0] if ph else (s or {}).get("image"), "photos": ph,
                "ml_total": r["ml_total"], "ml_left": r["ml_left"],
                "price": money(r["price_minor"]), "currency": r["currency"],
                "price_per_ml": round(r["price_minor"] / 100 / max(1, r["ml_left"]), 2),
                "box": bool(r["box"]), "tester": bool(r["tester"]), "description": r["description"],
                "area": r["area"], "city": r["city"], "country": r["country"],
                "approx": geo.approx(r["lat"], r["lng"]),
                "seller": sellers.get(r["seller_id"]), "mine": mine,
                "created_at": r["created_at"], "updated_at": r["updated_at"],
            }
            if near:
                d["distance_km"] = round(geo.haversine_km(near[0], near[1], r["lat"], r["lng"]), 1)
            if mine:   # only the seller sees the exact pickup point and review notes
                d["pickup"] = {"lat": r["lat"], "lng": r["lng"], "formatted": r["formatted"], "area": r["area"],
                               "city": r["city"], "country": r["country"]}
                d["review_note"] = r["review_note"]
            res.append(d)
        return res

    def own(lid: int, user: dict) -> dict:
        row = store.get_listing(lid)
        if not row or row["seller_id"] != user["id"]:
            raise HTTPException(404, "Listing not found.")
        return row

    def visible(lid: int, user: dict) -> dict:
        row = store.get_listing(lid)
        if not row or (row["status"] != "active" and row["seller_id"] != user["id"] and row["status"] != "sold"):
            raise HTTPException(404, "Listing not found.")
        return row

    def check_currency(c: str | None) -> str:
        c = (c or "").upper()
        if c not in CURRENCIES:
            raise HTTPException(422, "Choose a currency from the list.")
        return c

    def check_pickup(p: Pickup) -> dict:
        if not geo.valid_point(p.lat, p.lng):
            raise HTTPException(422, "Pin the pickup location on the map.")
        return {"lat": p.lat, "lng": p.lng, "formatted": tidy(p.formatted), "area": tidy(p.area) or tidy(p.city),
                "city": tidy(p.city), "country": (p.country or "").upper()[:2] or None}

    def match_and_notify(row: dict):
        notify_matches(store, row)

    # ---- config + location ---------------------------------------------------------------------
    @router.get("/market/config")
    def config(response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"currencies": CURRENCIES, "sizes": SIZES, "max_photos": MAX_PHOTOS,
                "google_maps_key": settings.google_maps_key, "address_search": "google" if settings.google_maps_key else "osm"}

    @router.get("/geo/search")
    def geo_search(q: str = Query(min_length=2, max_length=120), lat: float | None = None, lng: float | None = None,
                   user=Depends(require_user)):
        try:
            return {"results": geo.search(q.strip(), lat, lng)}
        except Exception:
            raise HTTPException(502, "Address search is not available right now.")

    @router.get("/geo/reverse")
    def geo_reverse(lat: float, lng: float, user=Depends(require_user)):
        if not geo.valid_point(lat, lng):
            raise HTTPException(422, "Invalid position.")
        try:
            return {"result": geo.reverse(lat, lng)}
        except Exception:
            raise HTTPException(502, "Address search is not available right now.")

    # ---- my delivery address (private) ---------------------------------------------------------
    @router.get("/me/address")
    def my_address(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        a = store.get_address(user["id"])
        return {"address": {k: a[k] for k in (*store.ADDRESS_FIELDS, "updated_at")} if a else None}

    @router.put("/me/address")
    def put_address(body: AddressBody, user=Depends(require_user)):
        if not geo.valid_point(body.lat, body.lng):
            raise HTTPException(422, "Pin your address on the map.")
        phone = "".join(ch for ch in body.phone if ch.isdigit() or ch == "+")
        if len(phone.lstrip("+")) < 6:
            raise HTTPException(422, "Enter a phone number a courier can call.")
        fields = {k: tidy(getattr(body, k)) if isinstance(getattr(body, k), str) else getattr(body, k)
                  for k in store.ADDRESS_FIELDS}
        fields.update(phone=phone, country=(body.country or "").upper()[:2] or None,
                      recipient=tidy(body.recipient) or None)
        a = store.put_address(user["id"], fields)
        store.unnotify(user["id"], "address_reminder")
        return {"address": {k: a[k] for k in (*store.ADDRESS_FIELDS, "updated_at")}}

    @router.delete("/me/address")
    def delete_address(user=Depends(require_user)):
        store.delete_address(user["id"])
        return {"address": None}

    # ---- browsing ------------------------------------------------------------------------------
    @router.get("/market/listings")
    def browse(response: Response, q: str = Query("", max_length=120), perfume_id: int | None = None,
               seller: str | None = Query(None, max_length=40), brand: str | None = Query(None, max_length=120),
               accords: str = Query("", max_length=400), gender: str | None = Query(None, max_length=10),
               currency: str | None = Query(None, max_length=3), price_min: float | None = None, price_max: float | None = None,
               ml_min: int | None = None, box: bool | None = None, tester: bool | None = None,
               lat: float | None = None, lng: float | None = None, radius_km: float | None = Query(None, gt=0, le=20000),
               sort: str = Query("newest", max_length=12), offset: int = Query(0, ge=0, le=10_000),
               limit: int = Query(24, ge=1, le=60), user=Depends(require_user)):
        """Active listings with filters, 'near me' and facets (accords, brands, currencies) for the filter panel."""
        response.headers["Cache-Control"] = "no-store"
        seller_id = None
        if seller:
            u = store.user_by_username(seller)
            if not u:
                raise HTTPException(404, "No one goes by that name.")
            seller_id = u["id"]
        rows = store.listings_where("active", seller_id=seller_id, perfume_ids=[perfume_id] if perfume_id else None)
        near = (lat, lng) if lat is not None and lng is not None and geo.valid_point(lat, lng) else None
        ql = " ".join(q.lower().split())

        enriched = []
        for r in rows:
            name, br, s = listing_title(cat, r)
            if ql and ql not in f"{name} {br}".lower():
                continue
            if near and radius_km and geo.haversine_km(near[0], near[1], r["lat"], r["lng"]) > radius_km:
                continue
            enriched.append((r, name, br, s))
        # facets come from the search + area results, before the panel's own filters narrow them down
        acc_count, brand_count, cur_count = {}, {}, {}
        for r, name, br, s in enriched:
            for a in (s or {}).get("accords", [])[:5]:
                acc_count[a["name"]] = acc_count.get(a["name"], 0) + 1
            brand_count[br] = brand_count.get(br, 0) + 1
            cur_count[r["currency"]] = cur_count.get(r["currency"], 0) + 1

        want_acc = [a for a in accords.split("~") if a]
        cur = currency.upper() if currency else None
        keep = []
        for r, name, br, s in enriched:
            acc = {a["name"] for a in (s or {}).get("accords", [])[:5]}
            if want_acc and not all(a in acc for a in want_acc):
                continue
            if brand and br.lower() != brand.lower():
                continue
            if gender and (s or {}).get("gender") != gender:
                continue
            if cur and r["currency"] != cur:
                continue
            if price_min is not None and r["price_minor"] < price_min * 100:
                continue
            if price_max is not None and r["price_minor"] > price_max * 100:
                continue
            if ml_min is not None and r["ml_left"] < ml_min:
                continue
            if box is not None and bool(r["box"]) != box:
                continue
            if tester is not None and bool(r["tester"]) != tester:
                continue
            keep.append(r)
        key = {"price": lambda r: (r["price_minor"], -r["created_at"]),
               "price_ml": lambda r: (r["price_minor"] / max(1, r["ml_left"]), -r["created_at"]),
               "distance": (lambda r: geo.haversine_km(near[0], near[1], r["lat"], r["lng"])) if near else (lambda r: -r["created_at"]),
               }.get(sort, lambda r: (-r["created_at"], -r["id"]))
        keep.sort(key=key)
        page = keep[offset:offset + limit]
        res = {"listings": out(page, user, near), "total": len(keep),
               "next_offset": offset + len(page) if offset + len(page) < len(keep) else None,
               "facets": {"accords": sorted(({"name": k, "count": v} for k, v in acc_count.items()), key=lambda x: -x["count"])[:30],
                          "brands": sorted(({"name": k, "count": v} for k, v in brand_count.items()), key=lambda x: -x["count"])[:40],
                          "currencies": sorted(({"name": k, "count": v} for k, v in cur_count.items()), key=lambda x: -x["count"])}}
        if perfume_id:
            res["wanted"] = len(store.wanted_where(perfume_id=perfume_id))
        return res

    @router.get("/market/summary")
    def summary(response: Response, perfume_id: int):
        """For a perfume page (no account needed): how many are for sale, the lowest prices, and how many want one."""
        rows = store.listings_where("active", perfume_ids=[perfume_id])
        low: dict[str, int] = {}
        for r in rows:
            low[r["currency"]] = min(low.get(r["currency"], r["price_minor"]), r["price_minor"])
        return {"active": len(rows), "from": [{"currency": c, "price": money(p)} for c, p in sorted(low.items())],
                "wanted": len(store.wanted_where(perfume_id=perfume_id))}

    @router.get("/market/listings/{lid}")
    def listing(lid: int, response: Response, lat: float | None = None, lng: float | None = None, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        row = visible(lid, user)
        near = (lat, lng) if lat is not None and lng is not None and geo.valid_point(lat, lng) else None
        d = out([row], user, near)[0]
        conv = store.conversation_for(lid, user["id"], row["seller_id"], create=False) if row["seller_id"] != user["id"] else None
        d["conversation_id"] = conv["id"] if conv else None
        if row["seller_id"] == user["id"]:
            d["conversations"] = sum(1 for c in store.my_conversations(user["id"]) if c["listing_id"] == lid)
        return d

    @router.get("/market/photos/{pid}.webp", include_in_schema=False)
    def photo(pid: int, request: Request, user=Depends(current_user)):
        ph = store.get_photo(pid)
        row = store.get_listing(ph["listing_id"]) if ph else None
        if not ph or not row:
            raise HTTPException(404, "No photo.")
        if row["status"] not in ("active", "sold") and not (user and user["id"] == row["seller_id"]) and not is_admin(request):
            raise HTTPException(404, "No photo.")
        return Response(ph["data"], media_type=ph["mime"], headers={"Cache-Control": "private, max-age=86400"})

    # ---- selling -------------------------------------------------------------------------------
    @router.post("/market/listings", status_code=201)
    def create(body: ListingBody, request: Request, user=Depends(require_user)):
        ok, _ = create_limit.hit(f"u:{user['id']}")
        if not ok:
            raise HTTPException(429, "That's a lot of listings for one hour. Try again a little later.")
        if store.count_listings(user["id"]) >= MAX_OPEN_LISTINGS:
            raise HTTPException(429, f"You can have at most {MAX_OPEN_LISTINGS} open listings. Mark some as sold first.")
        fields = {"ml_total": body.ml_total, "ml_left": body.ml_left, "price_minor": int(round(body.price * 100)),
                  "currency": check_currency(body.currency), "box": body.box, "tester": body.tester,
                  "description": tidy_text(body.description), **check_pickup(body.pickup)}
        if body.ml_left > body.ml_total:
            raise HTTPException(422, "The amount left can't be more than the bottle size.")
        if body.perfume_id is not None:
            if cat.idx_of(body.perfume_id) is None:
                raise HTTPException(422, "Pick the fragrance from the list.")
            fields.update(perfume_id=body.perfume_id, status="active")
        else:
            name, brand = tidy(body.custom_name), tidy(body.custom_brand)
            if not name or len(name) < 2 or not brand:
                raise HTTPException(422, "Give the fragrance's name and brand.")
            fields.update(perfume_id=None, custom_name=name, custom_brand=brand, status="pending")
        row = store.create_listing(user["id"], fields)
        match_and_notify(row)
        return out([row], user)[0]

    @router.patch("/market/listings/{lid}")
    def edit(lid: int, body: ListingPatch, user=Depends(require_user)):
        row = own(lid, user)
        if row["status"] == "pending" and body.status not in (None, "withdrawn"):
            raise HTTPException(409, "This listing is waiting for review.")
        f: dict = {}
        if body.price is not None:
            f["price_minor"] = int(round(body.price * 100))
        if body.currency is not None:
            f["currency"] = check_currency(body.currency)
        if body.ml_left is not None:
            if body.ml_left > row["ml_total"]:
                raise HTTPException(422, "The amount left can't be more than the bottle size.")
            f["ml_left"] = body.ml_left
        for k in ("box", "tester"):
            if getattr(body, k) is not None:
                f[k] = getattr(body, k)
        if body.description is not None:
            f["description"] = tidy_text(body.description)
        if body.pickup is not None:
            f.update(check_pickup(body.pickup))
        if row["perfume_id"] is None and (body.custom_name is not None or body.custom_brand is not None):
            f.update(custom_name=tidy(body.custom_name) or row["custom_name"], custom_brand=tidy(body.custom_brand) or row["custom_brand"])
            if row["status"] in ("rejected", "active"):
                f.update(status="pending", review_note=None)       # a changed custom name is reviewed again
        if row["status"] == "rejected" and "status" not in f and body.status is None and f:
            f.update(status="pending", review_note=None)           # fixed after a rejection: back into the queue
        if body.status is not None:
            s = body.status
            if s not in ("sold", "withdrawn", "active"):
                raise HTTPException(422, "Unknown status.")
            if s == "active":
                if row["status"] not in ("sold", "withdrawn"):
                    raise HTTPException(409, "Only a sold or withdrawn listing can be put back up.")
                if store.count_listings(user["id"]) >= MAX_OPEN_LISTINGS:
                    raise HTTPException(429, f"You can have at most {MAX_OPEN_LISTINGS} open listings.")
                s = "active" if (row["perfume_id"] is not None or row["reviewed_at"]) else "pending"
            f["status"] = s
        new = store.update_listing(lid, f)
        if new["status"] == "active" and row["status"] != "active":
            match_and_notify(new)
        return out([new], user)[0]

    @router.post("/market/listings/{lid}/photos", status_code=201)
    def add_photo(lid: int, body: PhotoBody, user=Depends(require_user)):
        own(lid, user)
        if len(store.photo_ids([lid]).get(lid, [])) >= MAX_PHOTOS:
            raise HTTPException(422, f"Up to {MAX_PHOTOS} photos per listing.")
        try:
            data = avatar.process_photo(avatar.decode_data_url(body.data))
        except avatar.AvatarError as e:
            raise HTTPException(422, str(e))
        pid = store.add_photo(lid, data, "image/webp")
        return {"id": pid, "url": photo_url(pid), "photos": [photo_url(p) for p in store.photo_ids([lid]).get(lid, [])]}

    @router.delete("/market/listings/{lid}/photos/{pid}")
    def delete_photo(lid: int, pid: int, user=Depends(require_user)):
        own(lid, user)
        ph = store.get_photo(pid)
        if not ph or ph["listing_id"] != lid:
            raise HTTPException(404, "No photo.")
        store.delete_photo(pid)
        return {"photos": [photo_url(p) for p in store.photo_ids([lid]).get(lid, [])]}

    @router.get("/market/mine")
    def mine(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        rows = store.listings_where(None, seller_id=user["id"])
        return {"listings": out(rows, user), "wanted": wanted_out(store.wanted_where(user_id=user["id"]), user)}

    # ---- wanted --------------------------------------------------------------------------------
    def wanted_out(rows: list[dict], user: dict) -> list[dict]:
        res = []
        for w in rows:
            i = cat.idx_of(w["perfume_id"])
            s = cat.summary(i) if i is not None else None
            matches = [r for r in store.listings_where("active", perfume_ids=[w["perfume_id"]])
                       if r["seller_id"] != w["user_id"] and wanted_matches(w, r)]
            res.append({"id": w["id"], "status": w["status"], "created_at": w["created_at"],
                        "perfume": {k: s.get(k) for k in ("id", "name", "brand", "image", "accords")} if s else None,
                        "max_price": money(w["max_price_minor"]) if w["max_price_minor"] is not None else None,
                        "currency": w["currency"], "min_ml": w["min_ml"], "radius_km": w["radius_km"], "area": w["area"],
                        "note": w["note"], "matches": len(matches)})
        return res

    @router.post("/market/wanted", status_code=201)
    def create_wanted(body: WantedBody, user=Depends(require_user)):
        if cat.idx_of(body.perfume_id) is None:
            raise HTTPException(422, "Pick the fragrance from the list.")
        if len(store.wanted_where(user_id=user["id"])) >= MAX_WANTED:
            raise HTTPException(429, f"You can have at most {MAX_WANTED} open requests.")
        if body.max_price is not None and not body.currency:
            raise HTTPException(422, "Choose the currency of your price.")
        has_point = body.lat is not None and body.lng is not None
        if has_point and not geo.valid_point(body.lat, body.lng):
            raise HTTPException(422, "Invalid location.")
        w = store.create_wanted(user["id"], {
            "perfume_id": body.perfume_id, "currency": check_currency(body.currency) if body.currency else None,
            "max_price_minor": int(round(body.max_price * 100)) if body.max_price is not None else None,
            "min_ml": body.min_ml, "lat": body.lat if has_point else None, "lng": body.lng if has_point else None,
            "radius_km": body.radius_km if has_point else None, "area": tidy(body.area), "note": tidy(body.note)})
        matches = [r for r in store.listings_where("active", perfume_ids=[w["perfume_id"]])
                   if r["seller_id"] != user["id"] and wanted_matches(w, r)]
        return {"wanted": wanted_out([w], user)[0], "matches": out(matches[:12], user)}

    @router.get("/market/wanted/{wid}/matches")
    def wanted_listing_matches(wid: int, user=Depends(require_user)):
        w = store.get_wanted(wid)
        if not w or w["user_id"] != user["id"]:
            raise HTTPException(404, "Request not found.")
        rows = [r for r in store.listings_where("active", perfume_ids=[w["perfume_id"]])
                if r["seller_id"] != user["id"] and wanted_matches(w, r)]
        return {"listings": out(rows, user, (w["lat"], w["lng"]) if w["lat"] is not None else None)}

    @router.delete("/market/wanted/{wid}")
    def close_wanted(wid: int, user=Depends(require_user)):
        w = store.get_wanted(wid)
        if not w or w["user_id"] != user["id"]:
            raise HTTPException(404, "Request not found.")
        store.close_wanted(wid)
        return {"ok": True}

    # ---- messages ------------------------------------------------------------------------------
    def conv_out(cv: dict, user: dict, ppl: dict, briefs: dict) -> dict:
        other = cv["seller_id"] if cv["buyer_id"] == user["id"] else cv["buyer_id"]
        last = cv.get("last")
        return {"id": cv["id"], "role": "buyer" if cv["buyer_id"] == user["id"] else "seller",
                "listing": briefs.get(cv["listing_id"]), "other": ppl.get(other), "last_at": cv["last_at"],
                "unread": cv.get("unread", 0),
                "last": {"body": last["body"][:140], "mine": last["sender_id"] == user["id"], "created_at": last["created_at"]} if last else None}

    def my_conv(cid: int, user: dict) -> dict:
        cv = store.get_conversation(cid)
        if not cv or user["id"] not in (cv["buyer_id"], cv["seller_id"]):
            raise HTTPException(404, "Conversation not found.")
        return cv

    @router.post("/market/listings/{lid}/conversation")
    def start(lid: int, user=Depends(require_user)):
        row = visible(lid, user)
        if row["seller_id"] == user["id"]:
            raise HTTPException(400, "That's your own listing.")
        if row["status"] != "active":
            raise HTTPException(409, "This bottle is no longer for sale.")
        cv = store.conversation_for(lid, user["id"], row["seller_id"])
        return {"conversation_id": cv["id"]}

    @router.get("/messages")
    def inbox(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        convs = store.my_conversations(user["id"])
        ppl = people([c["seller_id"] if c["buyer_id"] == user["id"] else c["buyer_id"] for c in convs], user)
        briefs = {lid: listing_brief(store, cat, lid) for lid in {c["listing_id"] for c in convs if c["listing_id"]}}
        return {"conversations": [conv_out(c, user, ppl, briefs) for c in convs], "unread": store.unread_messages(user["id"])}

    @router.get("/messages/unread")
    def unread(response: Response, user=Depends(current_user)):
        response.headers["Cache-Control"] = "no-store"
        return {"unread": store.unread_messages(user["id"]) if user else 0}

    @router.get("/messages/{cid}")
    def thread(cid: int, response: Response, after: int = Query(0, ge=0), user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        cv = my_conv(cid, user)
        msgs = store.list_messages(cid, after)
        store.mark_conversation_read(cid, user["id"])
        store.mark_read_ref(user["id"], "message", str(cid))
        other = cv["seller_id"] if cv["buyer_id"] == user["id"] else cv["buyer_id"]
        ppl = people([other], user)
        cv["last"] = None
        d = conv_out(cv, user, ppl, {cv["listing_id"]: listing_brief(store, cat, cv["listing_id"])} if cv["listing_id"] else {})
        d["messages"] = [{"id": m["id"], "body": m["body"], "mine": m["sender_id"] == user["id"], "created_at": m["created_at"]} for m in msgs]
        return d

    @router.post("/messages/{cid}", status_code=201)
    def send(cid: int, body: MessageBody, user=Depends(require_user)):
        cv = my_conv(cid, user)
        text = tidy_text(body.body)
        if not text:
            raise HTTPException(422, "Write a message.")
        if len(text) > MESSAGE_MAX:
            raise HTTPException(422, f"Messages can be at most {MESSAGE_MAX} characters.")
        ok, _ = message_limit.hit(f"u:{user['id']}")
        if not ok:
            raise HTTPException(429, "Slow down a little: too many messages in a minute.")
        m = store.add_message(cid, user["id"], text)
        other = cv["seller_id"] if cv["buyer_id"] == user["id"] else cv["buyer_id"]
        store.notify(other, "message", user["id"], str(cid))
        return {"id": m["id"], "body": m["body"], "mine": True, "created_at": m["created_at"]}

    return router


# ---------------------------------------------------------------------------- owner review (admin)
class Approve(BaseModel):
    perfume_id: int | None = None          # optionally link the custom listing to a catalogue perfume


class Reject(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


def make_admin_routes(router: APIRouter, ctx, require_admin, log, ip_of):
    """Review queue for custom listings + removal of any listing. Mounted on the admin router (its auth and CSRF)."""
    store, cat = ctx.store, ctx.cat

    def row_out(r: dict) -> dict:
        name, brand, s = listing_title(cat, r)
        u = store.get_user(r["seller_id"])
        photos = store.photo_ids([r["id"]]).get(r["id"], [])
        return {"id": r["id"], "status": r["status"], "title": name, "brand": brand, "custom": r["perfume_id"] is None,
                "custom_name": r["custom_name"], "custom_brand": r["custom_brand"], "perfume_id": r["perfume_id"],
                "image": photo_url(photos[0]) if photos else (s or {}).get("image"), "photos": [photo_url(p) for p in photos],
                "ml_total": r["ml_total"], "ml_left": r["ml_left"], "price": money(r["price_minor"]), "currency": r["currency"],
                "box": bool(r["box"]), "tester": bool(r["tester"]), "description": r["description"],
                "area": r["area"], "city": r["city"], "country": r["country"], "review_note": r["review_note"],
                "created_at": r["created_at"], "updated_at": r["updated_at"],
                "seller": {"id": u["id"], "username": u["username"], "email": u["email"], **name_fields(u)} if u else None}

    @router.get("/market/listings", dependencies=[Depends(require_admin)])
    def admin_listings(response: Response, status: str = Query("pending", max_length=10)):
        response.headers["Cache-Control"] = "no-store"
        st = None if status == "all" else status
        if st is not None and st not in STATUSES:
            raise HTTPException(422, "Unknown status.")
        rows = store.listings_where(st, limit=500)
        if st == "pending":
            rows.sort(key=lambda r: r["updated_at"])          # oldest first: a queue
        counts = {s: len(store.listings_where(s, limit=100000)) for s in STATUSES}
        return {"listings": [row_out(r) for r in rows], "counts": counts}

    @router.post("/market/listings/{lid}/approve", dependencies=[Depends(require_admin)])
    def approve(lid: int, body: Approve, request: Request):
        r = store.get_listing(lid)
        if not r:
            raise HTTPException(404, "Listing not found.")
        if r["status"] != "pending":
            raise HTTPException(409, "Only listings waiting for review can be approved.")
        f = {"status": "active", "reviewed_at": int(time.time()), "review_note": None}
        if body.perfume_id is not None:
            if cat.idx_of(body.perfume_id) is None:
                raise HTTPException(422, "Unknown perfume.")
            f.update(perfume_id=body.perfume_id)
        new = store.update_listing(lid, f)
        store.notify(new["seller_id"], "listing_approved", None, str(lid))
        notify_matches(store, new)
        log.info("admin approved listing id=%s from %s", lid, ip_of(request))
        return {"listing": row_out(new)}

    @router.post("/market/listings/{lid}/reject", dependencies=[Depends(require_admin)])
    def reject(lid: int, body: Reject, request: Request):
        r = store.get_listing(lid)
        if not r:
            raise HTTPException(404, "Listing not found.")
        if r["status"] != "pending":
            raise HTTPException(409, "Only listings waiting for review can be rejected.")
        new = store.update_listing(lid, {"status": "rejected", "review_note": " ".join(body.reason.split()), "reviewed_at": int(time.time())})
        store.notify(new["seller_id"], "listing_rejected", None, str(lid))
        log.info("admin rejected listing id=%s from %s", lid, ip_of(request))
        return {"listing": row_out(new)}

    @router.delete("/market/listings/{lid}", dependencies=[Depends(require_admin)])
    def remove(lid: int, request: Request):
        r = store.get_listing(lid)
        if not r:
            raise HTTPException(404, "Listing not found.")
        store.delete_listing(lid)
        store.notify(r["seller_id"], "listing_removed", None, str(lid))
        log.info("admin removed listing id=%s from %s", lid, ip_of(request))
        return {"ok": True}
