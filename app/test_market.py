"""Marketplace: addresses, listings (catalogue + custom with review), photos, browsing, messages, wanted + matching.
cd app && python -m pytest test_market.py -q"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401
from test_accounts import H, PW, make_app  # noqa: E402
from test_admin import APW, admin_login  # noqa: E402
from test_social import people  # noqa: E402
import geo  # noqa: E402

DUBAI = {"lat": 25.2711, "lng": 55.3075, "area": "Deira", "city": "Dubai", "country": "AE", "formatted": "Building 4, Al Rigga St, Deira"}
MARINA = {"lat": 25.0805, "lng": 55.1403, "area": "Dubai Marina", "city": "Dubai", "country": "AE"}       # ~26 km away
RIYADH = {"lat": 24.7136, "lng": 46.6753, "area": "Olaya", "city": "Riyadh", "country": "SA"}


@pytest.fixture()
def app(tmp_path, tiny_db):
    return make_app(tmp_path, tiny_db, admin_password=APW)


def listing(c, pid=1, price=250, where=DUBAI, **kw):
    body = {"perfume_id": pid, "ml_total": 100, "ml_left": 80, "price": price, "currency": "AED", "pickup": where, **kw}
    return c.post("/api/market/listings", headers=H, json=body)


def jpeg() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (1600, 1200), (180, 120, 60)).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------- address
def test_address_is_private_validated_and_clears_the_reminder(app):
    (alice,) = people(app, "alice")
    assert alice.get("/api/me").json()["user"]["has_address"] is False
    good = {"phone": "+971 50 123 4567", "formatted": "Building 4, Al Rigga St, Deira, Dubai", "unit": "1204", "building": "Rigga Tower",
            "area": "Deira", "city": "Dubai", "country": "ae", "lat": 25.27, "lng": 55.30, "instructions": "Call on arrival"}
    assert alice.put("/api/me/address", headers=H, json={**good, "lat": 0, "lng": 0}).status_code == 422
    assert alice.put("/api/me/address", headers=H, json={**good, "phone": "abc---"}).status_code == 422
    r = alice.put("/api/me/address", headers=H, json=good)
    assert r.status_code == 200 and r.json()["address"]["phone"] == "+971501234567" and r.json()["address"]["country"] == "AE"
    assert alice.get("/api/me/address").json()["address"]["unit"] == "1204"
    assert alice.get("/api/me").json()["user"]["has_address"] is True
    assert "address" not in TestClient(app).get("/api/me").text and alice.get("/api/users/alice").json().get("address") is None
    assert alice.delete("/api/me/address", headers=H).json() == {"address": None}
    assert TestClient(app).get("/api/me/address").status_code == 401


# ---------------------------------------------------------------------------- listings + review
def test_catalogue_listing_goes_live_and_hides_the_exact_pickup(app):
    seller, buyer = people(app, "seller", "buyer")
    assert listing(seller, ml_left=120).status_code == 422                        # more left than the bottle holds
    assert listing(seller, pid=999999).status_code == 422
    assert listing(seller, currency="XYZ").status_code == 422
    assert listing(seller, where={**DUBAI, "lat": 0, "lng": 0}).status_code == 422
    r = listing(seller, box=True, description="  Barely used.  ")
    assert r.status_code == 201
    d = r.json()
    assert d["status"] == "active" and d["price"] == 250 and d["price_per_ml"] == 3.12 and d["box"] is True
    assert d["pickup"]["formatted"].startswith("Building 4") and d["description"] == "Barely used."
    seen = buyer.get(f"/api/market/listings/{d['id']}").json()
    assert "pickup" not in seen and seen["approx"] == {"lat": 25.27, "lng": 55.31} and seen["area"] == "Deira"
    assert seen["seller"]["username"] == "seller" and seen["mine"] is False and "formatted" not in str(seen)
    assert TestClient(app).get("/api/market/listings").status_code == 401        # members only
    assert TestClient(app).get("/api/market/summary", params={"perfume_id": 1}).json()["active"] == 1


def test_custom_listing_waits_for_review(app):
    seller, buyer = people(app, "seller", "buyer")
    r = seller.post("/api/market/listings", headers=H, json={"custom_name": "Oud Royale", "custom_brand": "Deira Atelier",
                                                            "ml_total": 50, "ml_left": 50, "price": 120, "currency": "AED", "pickup": DUBAI})
    lid = r.json()["id"]
    assert r.json()["status"] == "pending" and r.json()["custom"] is True and r.json()["title"] == "Oud Royale"
    assert buyer.get("/api/market/listings").json()["total"] == 0
    assert buyer.get(f"/api/market/listings/{lid}").status_code == 404
    photo = seller.post(f"/api/market/listings/{lid}/photos", headers=H, json={"data": jpeg()}).json()["url"]
    assert seller.get(photo).status_code == 200 and buyer.get(photo).status_code == 404     # pending: seller only

    a = TestClient(app)
    assert a.get("/api/admin/market/listings").status_code == 401
    admin_login(a)
    q = a.get("/api/admin/market/listings").json()
    assert [x["id"] for x in q["listings"]] == [lid] and q["counts"]["pending"] == 1
    assert q["listings"][0]["seller"]["email"] == "seller@example.com" and a.get(photo).status_code == 200
    assert a.post(f"/api/admin/market/listings/{lid}/reject", headers=H, json={"reason": "No"}).status_code == 422
    r = a.post(f"/api/admin/market/listings/{lid}/reject", headers=H, json={"reason": "Please add a photo of the label."})
    assert r.json()["listing"]["status"] == "rejected"
    mine = seller.get("/api/market/mine").json()["listings"][0]
    assert mine["status"] == "rejected" and mine["review_note"].startswith("Please add")
    assert [n["kind"] for n in seller.get("/api/notifications").json()["items"]][0] == "listing_rejected"
    # fixing it sends it back into the queue; approving can link it to a catalogue perfume
    assert seller.patch(f"/api/market/listings/{lid}", headers=H, json={"description": "Label photo added"}).json()["status"] == "pending"
    r = a.post(f"/api/admin/market/listings/{lid}/approve", headers=H, json={"perfume_id": 2})
    assert r.json()["listing"]["status"] == "active" and r.json()["listing"]["perfume_id"] == 2
    assert buyer.get(f"/api/market/listings/{lid}").json()["perfume"]["id"] == 2
    n = seller.get("/api/notifications").json()["items"][0]
    assert n["kind"] == "listing_approved" and n["listing"]["id"] == lid
    assert a.delete(f"/api/admin/market/listings/{lid}", headers=H).json() == {"ok": True}
    assert buyer.get(f"/api/market/listings/{lid}").status_code == 404


def test_seller_statuses_and_limits(app):
    (seller, other) = people(app, "seller", "other")
    lid = listing(seller).json()["id"]
    assert other.patch(f"/api/market/listings/{lid}", headers=H, json={"status": "sold"}).status_code == 404
    assert seller.patch(f"/api/market/listings/{lid}", headers=H, json={"price": 200, "ml_left": 60}).json()["price_per_ml"] == 3.33
    assert seller.patch(f"/api/market/listings/{lid}", headers=H, json={"status": "sold"}).json()["status"] == "sold"
    assert other.get("/api/market/listings").json()["total"] == 0
    assert seller.patch(f"/api/market/listings/{lid}", headers=H, json={"status": "active"}).json()["status"] == "active"
    for k in range(4):
        assert seller.post(f"/api/market/listings/{lid}/photos", headers=H, json={"data": jpeg()}).status_code == 201
    assert seller.post(f"/api/market/listings/{lid}/photos", headers=H, json={"data": jpeg()}).status_code == 422
    urls = other.get(f"/api/market/listings/{lid}").json()["photos"]
    img = other.get(urls[0])
    with Image.open(io.BytesIO(img.content)) as im:
        assert im.format == "WEBP" and max(im.size) == 1280


# ---------------------------------------------------------------------------- browsing
def test_browse_filters_near_me_sort_and_facets(app):
    s1, s2, buyer = people(app, "sellerone", "sellertwo", "buyer")
    listing(s1, pid=1, price=300, where=DUBAI)
    listing(s1, pid=2, price=150, where=MARINA, box=True)
    listing(s2, pid=3, price=90, where=RIYADH, currency="SAR")
    b = lambda **p: buyer.get("/api/market/listings", params=p).json()   # noqa: E731
    assert b()["total"] == 3
    assert [x["price"] for x in b(sort="price")["listings"]] == [90, 150, 300]
    near = b(lat=25.27, lng=55.30, radius_km=10)
    assert near["total"] == 1 and near["listings"][0]["area"] == "Deira" and near["listings"][0]["distance_km"] < 2
    assert b(lat=25.27, lng=55.30, radius_km=50)["total"] == 2
    assert [x["area"] for x in b(lat=25.27, lng=55.30, sort="distance")["listings"]] == ["Deira", "Dubai Marina", "Olaya"]
    assert b(currency="SAR")["total"] == 1 and b(box=True)["total"] == 1 and b(price_max=200)["total"] == 2
    facets = b()["facets"]
    assert {c["name"] for c in facets["currencies"]} == {"AED", "SAR"} and facets["brands"]
    acc = facets["accords"][0]["name"]
    assert 0 < b(accords=acc)["total"] <= 3
    name = b(sort="price")["listings"][0]["title"]
    assert b(q=name[:4].lower())["total"] >= 1
    assert b(seller="sellertwo")["total"] == 1 and buyer.get("/api/market/listings", params={"seller": "ghost"}).status_code == 404
    assert b(perfume_id=1)["wanted"] == 0


# ---------------------------------------------------------------------------- messages
def test_messages_between_buyer_and_seller(app):
    seller, buyer, nosy = people(app, "seller", "buyer", "nosy")
    lid = listing(seller).json()["id"]
    assert seller.post(f"/api/market/listings/{lid}/conversation", headers=H, json={}).status_code == 400
    cid = buyer.post(f"/api/market/listings/{lid}/conversation", headers=H, json={}).json()["conversation_id"]
    assert buyer.post(f"/api/market/listings/{lid}/conversation", headers=H, json={}).json()["conversation_id"] == cid
    assert buyer.post(f"/api/messages/{cid}", headers=H, json={"body": "   "}).status_code == 422
    assert buyer.post(f"/api/messages/{cid}", headers=H, json={"body": "Hi! Is it still available?"}).status_code == 201
    assert seller.get("/api/messages/unread").json() == {"unread": 1}
    n = seller.get("/api/notifications").json()["items"][0]
    assert n["kind"] == "message" and n["actor"]["username"] == "buyer" and n["listing"]["id"] == lid
    inbox = seller.get("/api/messages").json()
    assert inbox["unread"] == 1 and inbox["conversations"][0]["other"]["username"] == "buyer" and inbox["conversations"][0]["role"] == "seller"
    t = seller.get(f"/api/messages/{cid}").json()
    assert [m["body"] for m in t["messages"]] == ["Hi! Is it still available?"] and t["messages"][0]["mine"] is False
    assert seller.get("/api/messages/unread").json() == {"unread": 0}
    reply = seller.post(f"/api/messages/{cid}", headers=H, json={"body": "Yes, pickup in Deira."}).json()
    assert buyer.get(f"/api/messages/{cid}", params={"after": reply["id"] - 1}).json()["messages"][0]["body"].startswith("Yes")
    assert nosy.get(f"/api/messages/{cid}").status_code == 404
    assert nosy.post(f"/api/messages/{cid}", headers=H, json={"body": "hey"}).status_code == 404
    assert buyer.get(f"/api/market/listings/{lid}").json()["conversation_id"] == cid
    assert buyer.post("/api/auth/delete", headers=H, json={"password": PW}).status_code == 200
    assert seller.get("/api/messages").json()["conversations"] == []


# ---------------------------------------------------------------------------- wanted + matching
def test_wanted_requests_match_existing_and_new_listings(app):
    seller, buyer, far = people(app, "seller", "buyer", "faraway")
    listing(seller, pid=1, price=400)
    r = buyer.post("/api/market/wanted", headers=H, json={"perfume_id": 1, "max_price": 300, "currency": "AED",
                                                         "lat": 25.2, "lng": 55.3, "radius_km": 40})
    w = r.json()
    assert r.status_code == 201 and w["wanted"]["matches"] == 0 and w["matches"] == []          # too expensive
    far.post("/api/market/wanted", headers=H, json={"perfume_id": 1, "lat": 24.71, "lng": 46.67, "radius_km": 20})
    assert buyer.post("/api/market/wanted", headers=H, json={"perfume_id": 1, "max_price": 100}).status_code == 422

    listing(seller, pid=1, price=280, where=MARINA)                              # cheap enough and within 40 km
    kinds = [(n["kind"], n["listing"]["title"] if n.get("listing") else None) for n in buyer.get("/api/notifications").json()["items"]]
    assert kinds[0][0] == "wanted_match"
    assert not any(n["kind"] == "wanted_match" for n in far.get("/api/notifications").json()["items"])   # Riyadh radius
    assert listing(seller, pid=1, price=250, currency="SAR").status_code == 201                          # other currency
    assert len([n for n in buyer.get("/api/notifications").json()["items"] if n["kind"] == "wanted_match"]) == 1
    mine = buyer.get("/api/market/mine").json()["wanted"]
    assert mine[0]["matches"] == 1 and mine[0]["max_price"] == 300
    assert len(buyer.get(f"/api/market/wanted/{mine[0]['id']}/matches").json()["listings"]) == 1
    assert buyer.get("/api/market/listings", params={"perfume_id": 1}).json()["wanted"] == 2
    assert far.delete(f"/api/market/wanted/{mine[0]['id']}", headers=H).status_code == 404
    assert buyer.delete(f"/api/market/wanted/{mine[0]['id']}", headers=H).json() == {"ok": True}
    assert buyer.get("/api/market/mine").json()["wanted"] == []


def test_geo_search_is_proxied_for_members(app, monkeypatch):
    (alice,) = people(app, "alice")
    monkeypatch.setattr(geo, "search", lambda q, lat=None, lng=None: [{"label": f"{q}, Dubai", "lat": 25.2, "lng": 55.3}])
    assert alice.get("/api/geo/search", params={"q": "rigga"}).json()["results"][0]["label"] == "rigga, Dubai"
    assert TestClient(app).get("/api/geo/search", params={"q": "rigga"}).status_code == 401
    def boom(*a, **k):
        raise OSError("down")
    monkeypatch.setattr(geo, "search", boom)
    assert alice.get("/api/geo/search", params={"q": "rigga"}).status_code == 502
    cfg = alice.get("/api/market/config").json()
    assert cfg["address_search"] == "osm" and "AED" in cfg["currencies"] and cfg["google_maps_key"] is None


def test_haversine():
    assert abs(geo.haversine_km(25.2711, 55.3075, 25.0805, 55.1403) - 27.0) < 1.5
    assert geo.approx(25.27114, 55.30752) == {"lat": 25.27, "lng": 55.31}
