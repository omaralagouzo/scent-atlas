"""Names, profile photos, the member directory, notifications and reviews.   cd app && python -m pytest -q"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401  (shared fixtures)
from test_accounts import H, PW, app, login, signup  # noqa: E402,F401
from test_social import people  # noqa: E402

import userdb  # noqa: E402


def named(app, username, first, last=""):
    c = TestClient(app)
    r = c.post("/api/auth/signup", headers=H, json={"username": username, "email": f"{username}@example.com",
                                                    "password": PW, "first_name": first, "last_name": last})
    assert r.status_code == 201, r.text
    return c


def photo(fmt="PNG", size=(900, 600), exif=False) -> str:
    im = Image.new("RGB", size, (200, 80, 40))
    buf = io.BytesIO()
    kw = {}
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SpyCam"          # Make
        kw["exif"] = ex.tobytes()
    im.save(buf, fmt, **kw)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------- names
def test_signup_with_names_and_validation(app):
    c = named(app, "alice", "  Alice ", " van  Dijk ")
    u = c.get("/api/me").json()["user"]
    assert (u["first_name"], u["last_name"], u["name"], u["needs_name"]) == ("Alice", "van Dijk", "Alice van Dijk", False)
    bad = TestClient(app).post("/api/auth/signup", headers=H, json={
        "username": "bob", "email": "bob@example.com", "password": PW, "first_name": "  ", "last_name": "x"})
    assert bad.status_code == 422 and "first name" in bad.json()["detail"]
    bad = TestClient(app).post("/api/auth/signup", headers=H, json={
        "username": "bob", "email": "bob@example.com", "password": PW, "first_name": "x" * 41})
    assert bad.status_code == 422
    bad = TestClient(app).post("/api/auth/signup", headers=H, json={
        "username": "bob", "email": "bob@example.com", "password": PW, "first_name": "12345"})
    assert bad.status_code == 422


def test_placeholder_name_gets_one_reminder_that_goes_away(app):
    c = TestClient(app)
    assert signup(c, "alice").status_code == 201          # no name given (e.g. an older client)
    u = c.get("/api/me").json()["user"]
    assert (u["name"], u["needs_name"]) == ("User Name", True)
    assert login(c, "alice").status_code == 200
    assert login(c, "alice").status_code == 200
    items = c.get("/api/notifications").json()["items"]
    assert [n["kind"] for n in items] == ["name_reminder"]   # once, however often they sign in
    r = c.put("/api/me/name", headers=H, json={"first_name": "Alice", "last_name": "Smith"})
    assert r.status_code == 200 and r.json()["user"]["needs_name"] is False
    assert c.get("/api/notifications").json() == {"items": [], "unread": 0}
    assert c.put("/api/me/name", headers=H, json={"first_name": ""}).status_code == 422


def test_v3_database_upgrades_to_named_accounts(tmp_path):
    url = "sqlite:///" + (tmp_path / "v3.db").as_posix()
    eng = userdb.make_engine(url)
    with eng.begin() as c:   # build a v3-shaped users table by hand
        userdb.metadata.create_all(c, tables=[userdb.schema_migrations])
        c.execute(userdb.sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(32) NOT NULL, "
                                 "username_lower VARCHAR(32) NOT NULL UNIQUE, email VARCHAR(254) NOT NULL, "
                                 "email_lower VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, "
                                 "created_at BIGINT NOT NULL, last_login_at BIGINT)"))
        c.execute(userdb.sa.text("INSERT INTO users VALUES (1, 'old', 'old', 'o@x.com', 'o@x.com', 'h', 1, 1)"))
        for v in (1, 2, 3):
            c.execute(userdb.schema_migrations.insert().values(version=v, applied_at=1))
        userdb.metadata.create_all(c, tables=[t for t in userdb.metadata.sorted_tables
                                              if t.name not in ("users", "avatars", "notifications", "reviews")])
    eng.dispose()
    store = userdb.UserStore(url)
    u = store.get_user(1)
    assert (u["first_name"], u["last_name"], u["avatar_at"]) == ("User", "Name", None)
    assert {"avatars", "notifications", "reviews"} <= set(userdb.sa.inspect(store.eng).get_table_names())


# ---------------------------------------------------------------------------- directory
def test_people_directory_lists_everyone_and_searches_names(app):
    me = named(app, "zed", "Zed", "Zulu")
    named(app, "alice", "Alice", "Smith")
    named(app, "bobby", "Bob", "Stone")
    TestClient(app).post("/api/auth/signup", headers=H, json={"username": "anon1", "email": "a1@example.com", "password": PW})
    r = me.get("/api/people").json()
    assert r["total"] == 3 and [p["username"] for p in r["people"]] == ["alice", "bobby", "anon1"]   # placeholders last
    assert r["people"][0]["name"] == "Alice Smith" and r["people"][0]["relation"] == "none" and r["people"][0]["owned"] == 0
    assert [p["username"] for p in me.get("/api/people", params={"q": "smith"}).json()["people"]] == ["alice"]
    assert [p["username"] for p in me.get("/api/people", params={"q": "bob stone"}).json()["people"]] == ["bobby"]
    assert [p["username"] for p in me.get("/api/people", params={"q": "s"}).json()["people"]][:2] == ["alice", "bobby"]
    page = me.get("/api/people", params={"limit": 2}).json()
    assert len(page["people"]) == 2 and page["next_offset"] == 2
    assert me.get("/api/people", params={"offset": 2, "limit": 2}).json()["next_offset"] is None
    me.post("/api/friends/alice", headers=H, json={})
    assert me.get("/api/people", params={"q": "alice"}).json()["people"][0]["relation"] == "outgoing"
    assert me.get("/api/people", params={"q": "example.com"}).json()["total"] == 0      # never by email
    assert TestClient(app).get("/api/people").status_code == 401


# ---------------------------------------------------------------------------- photos
def test_profile_photo_upload_is_reencoded_and_served(app):
    alice, bobby = people(app, "alice", "bobby")
    r = alice.put("/api/me/avatar", headers=H, json={"data": photo("PNG", exif=False)})
    assert r.status_code == 200, r.text
    url = r.json()["avatar"]
    assert url.startswith("/api/avatars/") and "?v=" in url
    assert alice.get("/api/me").json()["user"]["avatar"] == url
    img = bobby.get(url)
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
    assert "immutable" in img.headers["cache-control"]
    with Image.open(io.BytesIO(img.content)) as im:
        assert im.format == "WEBP" and im.size == (512, 512)
    assert bobby.get("/api/users/alice").json()["avatar"] == url

    r = alice.put("/api/me/avatar", headers=H, json={"data": photo("JPEG", exif=True)})
    with Image.open(io.BytesIO(bobby.get(r.json()["avatar"]).content)) as im:
        assert not im.getexif()                                   # camera metadata is gone

    assert alice.put("/api/me/avatar", headers=H, json={"data": "data:image/png;base64,bm90IGFuIGltYWdl"}).status_code == 422
    assert alice.put("/api/me/avatar", headers=H, json={"data": "%%%"}).status_code == 422
    assert alice.delete("/api/me/avatar", headers=H).json() == {"avatar": None}
    assert bobby.get(url).status_code == 404


# ---------------------------------------------------------------------------- notifications
def test_friend_requests_notify_and_withdrawals_clean_up(app):
    alice, bobby, carol = people(app, "alice", "bobby", "carol")
    for c in (alice, bobby, carol):
        c.put("/api/me/name", headers=H, json={"first_name": c.get("/api/me").json()["user"]["username"].title()})
    alice.post("/api/friends/bobby", headers=H, json={})
    alice.post("/api/friends/bobby", headers=H, json={})            # repeating does not stack
    n = bobby.get("/api/notifications").json()
    assert n["unread"] == 1 and n["items"][0]["kind"] == "friend_request"
    assert n["items"][0]["actor"]["username"] == "alice" and n["items"][0]["actor"]["name"] == "Alice"
    assert bobby.get("/api/notifications/unread").json() == {"unread": 1}

    bobby.post("/api/friends/alice", headers=H, json={})             # accept
    assert bobby.get("/api/notifications").json()["unread"] == 0      # their request is now read
    a = alice.get("/api/notifications").json()
    assert [x["kind"] for x in a["items"]] == ["friend_accept"] and a["unread"] == 1
    assert alice.post("/api/notifications/read", headers=H, json={}).json() == {"unread": 0}
    assert alice.get("/api/notifications").json()["items"][0]["read"] is True

    carol.post("/api/friends/alice", headers=H, json={})
    assert alice.get("/api/notifications/unread").json()["unread"] == 1
    carol.delete("/api/friends/alice", headers=H)                    # withdrawn before alice saw it
    assert alice.get("/api/notifications/unread").json()["unread"] == 0
    assert TestClient(app).get("/api/notifications/unread").json() == {"unread": 0}
    assert TestClient(app).get("/api/notifications").status_code == 401


def test_notifications_are_capped(app):
    (alice,) = people(app, "alice")
    store = app.state.store
    uid = alice.get("/api/me").json()["user"]["id"]
    for k in range(userdb.NOTIFY_CAP + 15):
        store.notify(uid, "test", ref=str(k))
    assert len(store.list_notifications(uid, 1000)) == userdb.NOTIFY_CAP


# ---------------------------------------------------------------------------- reviews
def test_reviews_stats_friends_first_and_cleanup(app):
    alice, bobby, carol = people(app, "alice", "bobby", "carol")
    anon = TestClient(app)
    assert anon.get("/api/perfumes/1/community").json()["stats"]["count"] == 0
    assert anon.put("/api/me/reviews/1", headers=H, json={"rating": 5}).status_code == 401
    assert alice.put("/api/me/reviews/999999", headers=H, json={"rating": 5}).status_code == 404
    assert alice.put("/api/me/reviews/1", headers=H, json={"rating": 6}).status_code == 422
    assert alice.put("/api/me/reviews/1", headers=H, json={"rating": 4, "body": "x" * 2001}).status_code == 422

    r = bobby.put("/api/me/reviews/1", headers=H, json={"rating": 2, "longevity": 1, "body": "  Fades fast.  \n\n"})
    assert r.status_code == 200 and r.json()["review"]["body"] == "Fades fast."
    carol.put("/api/me/reviews/1", headers=H, json={"rating": 5, "sillage": 4, "body": "Gorgeous."})
    alice.put("/api/me/reviews/1", headers=H, json={"rating": 4})
    bobby.put("/api/me/perfumes/1", headers=H, json={"status": "owned"})
    carol.put("/api/me/perfumes/1", headers=H, json={"status": "wishlist"})

    alice.post("/api/friends/bobby", headers=H, json={})
    bobby.post("/api/friends/alice", headers=H, json={})
    c = alice.get("/api/perfumes/1/community").json()
    assert c["stats"]["count"] == 3 and c["stats"]["average"] == round(11 / 3, 2) and c["stats"]["written"] == 2
    assert c["stats"]["distribution"] == [0, 1, 0, 1, 1] and c["stats"]["longevity"] == 1.0 and c["stats"]["sillage"] == 4.0
    assert c["members"] == {"owned": 1, "tried": 0, "wishlist": 1}
    assert c["reviews"][0]["author"]["username"] == "bobby" and c["reviews"][0]["friend"] is True   # friends first
    assert [x["mine"] for x in c["reviews"]].count(True) == 1 and c["mine"]["rating"] == 4
    assert [(f["username"], f["status"]) for f in c["friends"]] == [("bobby", "owned")]             # carol is not a friend
    assert anon.get("/api/perfumes/1/community").json()["friends"] == []

    alice.put("/api/me/reviews/1", headers=H, json={"rating": 1})                  # editing replaces
    assert alice.get("/api/perfumes/1/community").json()["stats"]["count"] == 3
    assert alice.delete("/api/me/reviews/1", headers=H).json()["stats"]["count"] == 2
    assert bobby.get("/api/users/bobby").json()["counts"]["reviews"] == 1
    assert bobby.post("/api/auth/delete", headers=H, json={"password": PW}).status_code == 200
    assert anon.get("/api/perfumes/1/community").json()["stats"]["count"] == 1
