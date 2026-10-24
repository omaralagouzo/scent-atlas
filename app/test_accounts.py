"""Accounts, per-user data, security headers, image modes, deploy artifact.   cd app && python -m pytest -q"""
from __future__ import annotations

import gzip
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "pipeline"))

from test_api import img_server, tiny_db  # noqa: E402,F401  (shared fixtures)
from test_api import TINY_PERFUMES  # noqa: E402

import auth  # noqa: E402
import config  # noqa: E402
import server  # noqa: E402
import userdb  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

H = {"X-Requested-With": "scent-atlas"}
PW = "correct-horse-9"


def make_app(tmp_path, tiny_db, **kw):
    base = config.Settings.from_env().with_(**{k: v for k, v in kw.items() if k in config.Settings.__dataclass_fields__})
    extra = {k: v for k, v in kw.items() if k not in config.Settings.__dataclass_fields__}
    return server.create_app(db_path=tiny_db, data_dir=tmp_path, fetch_images=False, settings=base, **extra)


@pytest.fixture()
def app(tmp_path, tiny_db):
    return make_app(tmp_path, tiny_db)


@pytest.fixture()
def c(app):
    return TestClient(app)


def signup(client, username="alice", email=None, password=PW):
    return client.post("/api/auth/signup", headers=H, json={
        "username": username, "email": email or f"{username}@example.com", "password": password})


def login(client, ident, password=PW):
    return client.post("/api/auth/login", headers=H, json={"identifier": ident, "password": password})


# ============================================================================ signup / login / logout
def test_signup_login_logout_me(app):
    c = TestClient(app)
    assert c.get("/api/me").json()["user"] is None
    r = signup(c)
    assert r.status_code == 201 and r.json()["user"]["username"] == "alice"
    me = c.get("/api/me").json()
    assert me["user"]["username"] == "alice" and me["user"]["email"] == "alice@example.com"
    assert "password_hash" not in json.dumps(me)
    assert c.post("/api/auth/logout", headers=H, json={}).json() == {"ok": True}
    assert c.get("/api/me").json()["user"] is None
    # log back in by username, then (new client) by e-mail, case-insensitively
    assert login(c, "ALICE").status_code == 200
    c2 = TestClient(app)
    assert login(c2, "Alice@Example.COM").status_code == 200
    assert c2.get("/api/me").json()["user"]["username"] == "alice"


def test_duplicate_username_and_email_case_insensitive(app):
    c = TestClient(app)
    assert signup(c, "alice").status_code == 201
    other = TestClient(app)
    r = signup(other, "ALICE", "other@example.com")
    assert r.status_code == 409 and "username" in r.json()["detail"].lower()
    r = signup(other, "bob", "Alice@Example.com")
    assert r.status_code == 409 and "email" in r.json()["detail"].lower()
    assert signup(other, "bob", "bob@example.com").status_code == 201


def test_wrong_password_and_unknown_user_give_the_same_generic_error(app):
    c = TestClient(app)
    signup(c)
    c.post("/api/auth/logout", headers=H, json={})
    bad_pw = login(c, "alice", "not-the-password")
    no_user = login(c, "nobody", "not-the-password")
    no_email = login(c, "nobody@example.com", "not-the-password")
    assert bad_pw.status_code == no_user.status_code == no_email.status_code == 401
    assert bad_pw.json() == no_user.json() == no_email.json()
    assert "alice" not in bad_pw.text.lower().replace("invalid username/email or password.", "")
    assert "set-cookie" not in bad_pw.headers


@pytest.mark.parametrize("username,email,password,fragment", [
    ("ab", "a@example.com", PW, "username"),
    ("bad name!", "a@example.com", PW, "username"),
    ("alice", "not-an-email", PW, "email"),
    ("alice", "a@example.com", "short1", "at least 8"),
    ("alice", "a@example.com", "password123", "common"),
    ("alice", "a@example.com", "12345678", "common"),
    ("alice", "a@example.com", "x" * 200, "at most"),
])
def test_signup_validation(app, username, email, password, fragment):
    r = signup(TestClient(app), username, email, password)
    assert r.status_code == 422 and fragment in r.json()["detail"].lower()


def test_password_is_argon2id_and_token_is_stored_hashed(app):
    c = TestClient(app)
    signup(c)
    store = app.state.store
    u = store.find_user("alice")
    assert u["password_hash"].startswith("$argon2id$") and PW not in u["password_hash"]
    token = c.cookies.get("sa_session")
    assert token and len(token) >= 43                       # 256-bit urlsafe token
    import sqlalchemy as sa
    with store.eng.connect() as con:
        rows = con.execute(sa.select(userdb.sessions.c.token_hash)).scalars().all()
    assert rows == [auth.token_hash(token)] and token not in rows and len(rows[0]) == 64


def test_cookie_flags_local_and_public_host(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, allowed_hosts=("127.0.0.1", "localhost", "testserver", "atlas.example.com"))
    local = signup(TestClient(app, base_url="http://127.0.0.1"))
    sc = local.headers["set-cookie"].lower()
    assert "httponly" in sc and "samesite=lax" in sc and "secure" not in sc and "max-age=2592000" in sc
    pub = signup(TestClient(app, base_url="https://atlas.example.com"), "bob")
    sc = pub.headers["set-cookie"].lower()
    assert "httponly" in sc and "samesite=lax" in sc and "secure" in sc


def test_forwarded_proto_is_honoured_behind_a_proxy(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, allowed_hosts=("atlas.example.com",), trust_proxy=True)
    cl = TestClient(app, base_url="http://atlas.example.com")
    r = cl.get("/api/notes", headers={"X-Forwarded-Proto": "https"})
    assert "strict-transport-security" in r.headers
    r = cl.get("/api/notes")
    assert "strict-transport-security" not in r.headers
    untrusted = TestClient(make_app(tmp_path / "u", tiny_db, allowed_hosts=("atlas.example.com",)), base_url="http://atlas.example.com")
    assert "strict-transport-security" not in untrusted.get("/api/notes", headers={"X-Forwarded-Proto": "https"}).headers


# ============================================================================ rate limiting
def test_login_rate_limit_per_ip_and_per_account(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, rate_limit_per_min=3)
    c = TestClient(app)
    signup(c, "alice")
    c.post("/api/auth/logout", headers=H, json={})
    app.state.ctx.limit_login_ip.reset(); app.state.ctx.limit_login_acct.reset()
    codes = [login(c, "alice", "wrong-password-1").status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    r = login(c, "alice", "wrong-password-1")
    assert r.headers.get("retry-after") and "too many" in r.json()["detail"].lower()
    # a different account from a different IP is not affected by alice's account limit
    app.state.ctx.limit_login_ip.reset()
    assert login(c, "someone-else", "x" * 10).status_code == 401
    # per-account limit holds even when the IP window is reset
    app.state.ctx.limit_login_ip.reset()
    assert login(c, "alice", PW).status_code == 429


def test_signup_rate_limit(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, rate_limit_per_min=3)
    c = TestClient(app)
    codes = [signup(c, f"user{i}").status_code for i in range(5)]
    assert codes == [201, 201, 201, 429, 429]


def test_rate_limiter_window_expires():
    now = [0.0]
    rl = auth.RateLimiter(2, 60, clock=lambda: now[0])
    assert rl.hit("k")[0] and rl.hit("k")[0] and not rl.hit("k")[0]
    now[0] = 61
    assert rl.hit("k")[0]


def test_client_ip_uses_trusted_hop_not_leftmost():
    class Req:
        client = type("C", (), {"host": "10.0.0.1"})()
        headers = {"x-forwarded-for": "6.6.6.6, 203.0.113.9"}   # attacker prepended 6.6.6.6
    assert auth.client_ip(Req, True, 1) == "203.0.113.9"
    assert auth.client_ip(Req, False, 1) == "10.0.0.1"


# ============================================================================ sessions
def test_session_expiry_and_sliding_refresh(app):
    c = TestClient(app)
    signup(c)
    store = app.state.store
    th = auth.token_hash(c.cookies.get("sa_session"))
    ttl = 30 * 86400
    now = int(time.time())
    assert abs(store.session_expiry(th) - (now + ttl)) < 5
    # 10 days left -> a request slides the expiry back out to 30 days and re-issues the cookie
    store.expire_session_for_test(th, now + 10 * 86400)
    r = c.get("/api/me")
    assert r.json()["user"]["username"] == "alice"
    assert abs(store.session_expiry(th) - (int(time.time()) + ttl)) < 5
    assert "sa_session=" in r.headers.get("set-cookie", "")
    # no refresh churn when it was just extended
    r = c.get("/api/me")
    assert "set-cookie" not in r.headers
    # expired -> anonymous, and the dead session row is gone
    store.expire_session_for_test(th, int(time.time()) - 5)
    assert c.get("/api/me").json()["user"] is None
    assert store.session_expiry(th) is None


def test_unknown_or_garbage_cookie_is_anonymous(app):
    c = TestClient(app)
    c.cookies.set("sa_session", "garbage")
    r = c.get("/api/me")
    assert r.status_code == 200 and r.json()["user"] is None


# ============================================================================ CSRF
def test_csrf_header_required_on_state_changing_endpoints(app):
    c = TestClient(app)
    body = {"username": "alice", "email": "alice@example.com", "password": PW}
    assert c.post("/api/auth/signup", json=body).status_code == 403             # no header
    assert signup(c).status_code == 201
    assert c.post("/api/favorites", json={"type": "perfume", "id": 1}).status_code == 403
    assert c.put("/api/me/perfumes/1", json={"status": "owned"}).status_code == 403
    assert c.delete("/api/me/history").status_code == 403
    assert c.post("/api/auth/logout", json={}).status_code == 403
    assert c.get("/api/me").status_code == 200                                    # reads need nothing
    assert c.post("/api/favorites", headers=H, json={"type": "perfume", "id": 1}).status_code == 200


def test_csrf_requires_json_content_type_and_same_origin(app):
    c = TestClient(app)
    signup(c)
    form = c.post("/api/favorites", headers=H, content="type=perfume&id=1",
                  )
    assert form.status_code == 415
    text = c.post("/api/favorites", headers={**H, "Content-Type": "text/plain"}, content=json.dumps({"type": "perfume", "id": 1}))
    assert text.status_code == 415
    ok = {"type": "perfume", "id": 1}
    assert c.post("/api/favorites", headers={**H, "Origin": "https://evil.example"}, json=ok).status_code == 403
    assert c.post("/api/favorites", headers={**H, "Origin": "null"}, json=ok).status_code == 403
    assert c.post("/api/favorites", headers={**H, "Sec-Fetch-Site": "cross-site"}, json=ok).status_code == 403
    assert c.post("/api/favorites", headers={**H, "Origin": "http://testserver"}, json=ok).status_code == 200
    assert c.post("/api/favorites", headers={**H, "Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}, json=ok).status_code == 200


def test_oversized_body_rejected(app):
    c = TestClient(app)
    r = c.post("/api/auth/login", headers={**H, "Content-Length": "999999"}, content=b"{}")
    assert r.status_code == 413


# ============================================================================ anonymous browsing
def test_anonymous_can_browse_everything_but_saving_needs_sign_in(app):
    c = TestClient(app)
    assert c.get("/api/search", params={"include": "peach"}).status_code == 200
    assert c.get("/api/notes").status_code == 200
    assert c.get("/api/notes/peach").status_code == 200
    assert c.get("/api/perfumes/1").status_code == 200
    assert c.get("/api/perfumes/1/similar").status_code == 200
    assert c.post("/api/similar", json={"notes": [{"slug": "peach", "layer": "top"}]}).status_code == 200
    assert c.get("/api/perfumes", params={"q": "peach"}).status_code == 200
    fav = c.get("/api/favorites").json()
    assert fav["authenticated"] is False and fav["perfumes"] == []
    for call in (lambda: c.post("/api/favorites", headers=H, json={"type": "perfume", "id": 1}),
                 lambda: c.put("/api/me/perfumes/1", headers=H, json={"status": "owned"}),
                 lambda: c.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "x", "state": {"include": "peach"}}),
                 lambda: c.post("/api/me/history", headers=H, json={"kind": "view", "perfume_id": 1}),
                 lambda: c.get("/api/me/atlas"), lambda: c.get("/api/me/profile")):
        assert call().status_code == 401


# ============================================================================ per-user data + isolation
def two_users(app):
    a, b = TestClient(app), TestClient(app)
    assert signup(a, "alice").status_code == 201
    assert signup(b, "bob").status_code == 201
    return a, b


def test_favorites_crud_and_isolation(app):
    a, b = two_users(app)
    a.post("/api/favorites", headers=H, json={"type": "perfume", "id": 3})
    a.post("/api/favorites", headers=H, json={"type": "perfume", "id": 1})
    a.post("/api/favorites", headers=H, json={"type": "note", "id": "peach"})
    a.post("/api/favorites", headers=H, json={"type": "note", "id": "oud"})
    r = a.get("/api/favorites").json()
    assert r["perfumes"] == [1, 3] and r["notes"] == ["oud", "peach"]           # newest first
    assert [p["id"] for p in r["perfume_items"]] == [1, 3] and [n["slug"] for n in r["note_items"]] == ["oud", "peach"]
    assert b.get("/api/favorites").json()["perfumes"] == []
    b.post("/api/favorites", headers=H, json={"type": "perfume", "id": 5})
    a.post("/api/favorites", headers=H, json={"type": "perfume", "id": 3, "liked": False})
    assert a.get("/api/favorites").json()["perfumes"] == [1]
    assert b.get("/api/favorites").json()["perfumes"] == [5]
    me = a.get("/api/me").json()
    assert me["favorites"] == {"perfumes": [1], "notes": ["oud", "peach"]}
    assert a.post("/api/favorites", headers=H, json={"type": "perfume", "id": 999}).status_code == 404
    assert a.post("/api/favorites", headers=H, json={"type": "note", "id": "nope"}).status_code == 404
    assert a.post("/api/favorites", headers=H, json={"type": "banana", "id": 1}).status_code == 400


def test_session_resolves_to_its_own_user_when_ids_differ(app):
    """Regression: an unlabelled sessions.id used to shadow users.id when resolving the session cookie, so a user whose
    session id differed from their user id was treated as another account (or got errors when that id did not exist)."""
    first = TestClient(app)
    signup(first, "alice")
    for _ in range(3):                     # extra sessions push session ids past user ids
        assert login(TestClient(app), "alice").status_code == 200
    bob = TestClient(app)
    signup(bob, "bobby")                   # user id 2, session id 5
    assert bob.get("/api/me").json()["user"]["username"] == "bobby"
    assert bob.post("/api/favorites", headers=H, json={"type": "perfume", "id": 3, "liked": True}).status_code == 200
    assert bob.get("/api/me").json()["favorites"]["perfumes"] == [3]
    assert first.get("/api/me").json()["favorites"]["perfumes"] == []
    store = app.state.store
    uid = store.find_user("bobby")["id"]
    with store.eng.connect() as con:
        import sqlalchemy as sa
        sid = con.execute(sa.select(userdb.sessions.c.id).where(userdb.sessions.c.user_id == uid)).scalar()
    assert sid != uid


def test_status_rating_note_crud_and_isolation(app):
    a, b = two_users(app)
    r = a.put("/api/me/perfumes/1", headers=H, json={"status": "owned", "rating": 5, "note": " my signature "})
    assert r.json() == {"status": "owned", "rating": 5, "note": "my signature"}
    # partial update keeps the other fields
    assert a.put("/api/me/perfumes/1", headers=H, json={"rating": 4}).json() == {"status": "owned", "rating": 4, "note": "my signature"}
    a.put("/api/me/perfumes/2", headers=H, json={"status": "wishlist"})
    a.put("/api/me/perfumes/3", headers=H, json={"status": "tried", "rating": 2})
    assert a.get("/api/me/perfumes/1").json()["rating"] == 4
    assert [i["id"] for i in a.get("/api/me/perfumes", params={"status": "owned"}).json()["items"]] == [1]
    assert {i["id"] for i in a.get("/api/me/perfumes").json()["items"]} == {1, 2, 3}
    mine = a.get("/api/me").json()["statuses"]
    assert mine["1"] == {"status": "owned", "rating": 4, "has_note": True} and mine["2"]["status"] == "wishlist"
    # bob sees none of it and has his own row for the same perfume
    assert b.get("/api/me/perfumes").json()["items"] == [] and b.get("/api/me/perfumes/1").json()["status"] is None
    b.put("/api/me/perfumes/1", headers=H, json={"status": "tried", "note": "bob's private note"})
    assert a.get("/api/me/perfumes/1").json()["note"] == "my signature"
    assert b.get("/api/me/perfumes/1").json() == {"status": "tried", "rating": None, "note": "bob's private note"}
    # clearing everything deletes the row; validation
    a.put("/api/me/perfumes/2", headers=H, json={"status": None})
    assert 2 not in {i["id"] for i in a.get("/api/me/perfumes").json()["items"]}
    assert a.put("/api/me/perfumes/1", headers=H, json={"status": "hoarded"}).status_code == 400
    assert a.put("/api/me/perfumes/1", headers=H, json={"rating": 6}).status_code == 422
    assert a.put("/api/me/perfumes/1", headers=H, json={"note": "x" * 501}).status_code == 422
    assert a.put("/api/me/perfumes/999", headers=H, json={"status": "owned"}).status_code == 404
    assert a.delete("/api/me/perfumes/1", headers=H).status_code == 200
    assert a.get("/api/me/perfumes/1").json() == {"status": None, "rating": None, "note": None}


def test_saved_searches_crud_sanitising_and_isolation(app):
    a, b = two_users(app)
    st = {"include": "peach@top,jasmine,not-a-note", "exclude": "oud", "mode": "any", "gender": "women", "year_min": "1990", "evil": "<script>"}
    r = a.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "Summer", "state": st})
    assert r.status_code == 201
    sid = r.json()["id"]
    pyr = {"top": "peach", "middle": "jasmine", "base": "musk", "any": "", "gender": "pirate"}
    assert a.post("/api/me/saved", headers=H, json={"kind": "pyramid", "name": "Soft", "state": pyr}).status_code == 201
    items = a.get("/api/me/saved").json()["items"]
    by_name = {i["name"]: i for i in items}
    assert by_name["Summer"]["state"] == {"include": "peach@top,jasmine", "exclude": "oud", "mode": "any", "gender": "women", "year_min": "1990"}
    assert by_name["Soft"]["state"] == {"top": "peach", "middle": "jasmine", "base": "musk"}
    assert [n["slug"] for n in by_name["Summer"]["notes"]] == ["peach", "jasmine"]
    assert by_name["Summer"]["summary"].startswith("Peach (top) or Jasmine")
    assert [i["name"] for i in a.get("/api/me/saved", params={"kind": "pyramid"}).json()["items"]] == ["Soft"]
    # same name (any case) overwrites instead of duplicating
    a.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "summer", "state": {"include": "rose"}})
    assert len(a.get("/api/me/saved", params={"kind": "combine"}).json()["items"]) == 1
    # isolation: bob has none and cannot touch alice's
    assert b.get("/api/me/saved").json()["items"] == []
    assert b.delete(f"/api/me/saved/{sid}", headers=H).status_code == 404
    assert b.patch(f"/api/me/saved/{sid}", headers=H, json={"name": "mine now"}).status_code == 404
    assert a.patch(f"/api/me/saved/{sid}", headers=H, json={"name": "Renamed"}).status_code == 200
    assert a.delete(f"/api/me/saved/{sid}", headers=H).status_code == 200
    assert a.delete(f"/api/me/saved/{sid}", headers=H).status_code == 404
    # empty / bad
    assert a.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "Empty", "state": {"include": "nope"}}).status_code == 422
    assert a.post("/api/me/saved", headers=H, json={"kind": "bogus", "name": "x", "state": {}}).status_code == 400


def test_history_crud_dedup_cap_and_isolation(app):
    a, b = two_users(app)
    view = lambda pid: a.post("/api/me/history", headers=H, json={"kind": "view", "perfume_id": pid})  # noqa: E731
    assert view(1).status_code == 201
    view(1)                                 # consecutive duplicate -> collapsed
    view(2)
    view(1)                                 # not consecutive -> new entry
    a.post("/api/me/history", headers=H, json={"kind": "like", "perfume_id": 3})
    a.post("/api/me/history", headers=H, json={"kind": "pyramid", "state": {"top": "peach", "middle": "jasmine"}})
    a.post("/api/me/history", headers=H, json={"kind": "combine", "state": {"include": "peach,musk"}})
    items = a.get("/api/me/history").json()["items"]
    assert [i["kind"] for i in items] == ["combine", "pyramid", "like", "view", "view", "view"]
    assert [i["perfume"]["id"] for i in items if i["kind"] == "view"] == [1, 2, 1]
    assert items[0]["label"] == "Peach + Musk" and items[1]["label"] == "Top: Peach · Heart: Jasmine"
    assert items[2]["label"].startswith("C Peach Mid")
    assert a.get("/api/me/history", params={"kind": "view"}).json()["items"].__len__() == 3
    assert b.get("/api/me/history").json()["items"] == []
    # cannot delete someone else's entry
    assert b.delete(f"/api/me/history/{items[0]['id']}", headers=H).status_code == 404
    assert a.delete(f"/api/me/history/{items[0]['id']}", headers=H).status_code == 200
    # bad input
    assert a.post("/api/me/history", headers=H, json={"kind": "view", "perfume_id": 999}).status_code == 404
    assert a.post("/api/me/history", headers=H, json={"kind": "pyramid", "state": {"top": "nope"}}).status_code == 422
    assert a.post("/api/me/history", headers=H, json={"kind": "dance"}).status_code == 400
    # clear is per-user
    b.post("/api/me/history", headers=H, json={"kind": "view", "perfume_id": 4})
    assert a.delete("/api/me/history", headers=H).status_code == 200
    assert a.get("/api/me/history").json()["items"] == [] and len(b.get("/api/me/history").json()["items"]) == 1


def test_history_is_capped_per_user(app):
    a, b = two_users(app)
    store = app.state.store
    uid = store.find_user("alice")["id"]
    for i in range(userdb.HISTORY_CAP + 25):
        store.add_history(uid, "view", str(1 + i % 2) if i % 3 else str(3 + i % 2), f"label {i}", None)
    store.add_history(store.find_user("bob")["id"], "view", "1", "bob", None)
    rows = store.list_history(uid, limit=1000)
    assert len(rows) == userdb.HISTORY_CAP
    assert rows[0]["label"] == f"label {userdb.HISTORY_CAP + 24}"
    assert len(store.list_history(store.find_user("bob")["id"])) == 1


def test_my_atlas_and_taste_profile(app):
    a, b = two_users(app)
    assert a.get("/api/me/profile").json()["notes"] == []
    a.put("/api/me/perfumes/4", headers=H, json={"status": "owned", "rating": 5})      # D Oud Rose
    a.put("/api/me/perfumes/5", headers=H, json={"status": "owned"})                    # E Peach Oud
    a.post("/api/favorites", headers=H, json={"type": "perfume", "id": 5})
    a.put("/api/me/perfumes/7", headers=H, json={"status": "tried", "rating": 1})       # G Vanilla: disliked -> ignored
    a.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "x", "state": {"include": "oud"}})
    a.post("/api/me/history", headers=H, json={"kind": "view", "perfume_id": 5})
    prof = a.get("/api/me/profile").json()
    slugs = [n["slug"] for n in prof["notes"]]
    assert slugs[0] == "oud" and "vanilla" not in slugs and "peach" in slugs
    assert prof["notes"][0]["share"] == 1.0 and prof["based_on"]["owned"] == 2 and prof["based_on"]["favorites"] == 1
    assert "oud" in prof["pyramid_params"]["base"].split(",")
    atlas = a.get("/api/me/atlas").json()
    assert {p["id"] for p in atlas["collection"]["owned"]} == {4, 5} and [p["id"] for p in atlas["collection"]["tried"]] == [7]
    assert atlas["collection"]["owned"][0]["my"]["status"] == "owned"
    assert [p["id"] for p in atlas["favorites"]["perfumes"]] == [5] and len(atlas["saved"]) == 1 and len(atlas["history"]) == 1
    # bob's atlas is empty
    other = b.get("/api/me/atlas").json()
    assert other["favorites"]["perfumes"] == [] and other["saved"] == [] and other["history"] == []
    assert other["profile"]["notes"] == []


# ============================================================================ password change / delete
def test_change_password_signs_out_other_sessions(app):
    c1, c2 = TestClient(app), TestClient(app)
    signup(c1)
    login(c2, "alice")
    assert c2.get("/api/me").json()["user"] is not None
    assert c1.post("/api/auth/password", headers=H, json={"current_password": "wrong-one-123", "new_password": "brand-new-pass-1"}).status_code == 403
    assert c1.post("/api/auth/password", headers=H, json={"current_password": PW, "new_password": "short"}).status_code == 422
    assert c1.post("/api/auth/password", headers=H, json={"current_password": PW, "new_password": "brand-new-pass-1"}).status_code == 200
    assert c1.get("/api/me").json()["user"] is not None            # the session that changed it survives
    assert c2.get("/api/me").json()["user"] is None                # every other device is signed out
    fresh = TestClient(app)
    assert login(fresh, "alice", PW).status_code == 401
    assert login(fresh, "alice", "brand-new-pass-1").status_code == 200


def test_delete_account_removes_everything(app):
    a, b = two_users(app)
    a.post("/api/favorites", headers=H, json={"type": "perfume", "id": 1})
    a.put("/api/me/perfumes/1", headers=H, json={"status": "owned"})
    a.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "x", "state": {"include": "peach"}})
    a.post("/api/me/history", headers=H, json={"kind": "view", "perfume_id": 1})
    b.post("/api/favorites", headers=H, json={"type": "perfume", "id": 2})
    assert a.post("/api/auth/delete", headers=H, json={"password": "nope-nope-1"}).status_code == 403
    assert a.post("/api/auth/delete", headers=H, json={"password": PW}).status_code == 200
    assert a.get("/api/me").json()["user"] is None
    assert login(a, "alice").status_code == 401
    import sqlalchemy as sa
    with app.state.store.eng.connect() as con:
        for t in (userdb.favorites, userdb.perfume_status, userdb.saved_searches, userdb.history):
            assert con.execute(sa.select(sa.func.count()).select_from(t).where(t.c.user_id == 1)).scalar() == 0
        assert con.execute(sa.select(sa.func.count()).select_from(userdb.sessions)).scalar() == 1   # only bob's
    assert b.get("/api/favorites").json()["perfumes"] == [2]
    assert signup(TestClient(app), "alice", "alice@example.com").status_code == 201       # name is free again


def test_first_account_adopts_legacy_user_json(tmp_path, tiny_db):
    (tmp_path / "user.json").write_text(json.dumps({"perfumes": [3, 1, 999], "notes": ["oud", "nope", "peach"]}))
    app = make_app(tmp_path, tiny_db)
    a, b = TestClient(app), TestClient(app)
    signup(a, "alice")
    signup(b, "bob")
    fa = a.get("/api/favorites").json()
    assert fa["perfumes"] == [3, 1] and fa["notes"] == ["oud", "peach"]       # order kept, unknown ids dropped
    assert b.get("/api/favorites").json()["perfumes"] == []                  # only the first account imports
    # and not again after a restart
    app2 = make_app(tmp_path, tiny_db)
    assert signup(TestClient(app2), "carol").status_code == 201
    assert TestClient(app2).get("/api/favorites").json()["perfumes"] == []


# ============================================================================ headers / hosts
def test_canonical_host_redirect(tmp_path, tiny_db):
    """With CANONICAL_HOST set, page visits on another allowed host (the old *.onrender.com) move to the domain."""
    app = make_app(tmp_path, tiny_db, allowed_hosts=("scentatlas.app", "old.onrender.com", "testserver"), canonical_host="scentatlas.app")
    c = TestClient(app, follow_redirects=False)
    r = c.get("/next/?x=1", headers={"host": "old.onrender.com"})
    assert r.status_code == 301 and r.headers["location"] == "https://scentatlas.app/next/?x=1"
    assert c.get("/", headers={"host": "scentatlas.app"}).status_code == 200                   # already canonical
    assert c.get("/api/status", headers={"host": "old.onrender.com"}).status_code == 200      # health check stays
    assert c.post("/api/auth/login", headers={**H, "host": "old.onrender.com"}, json={}).status_code != 301
    assert c.get("/", headers={"host": "evil.example.com"}).status_code == 400                 # still host-guarded
    # unset by default: nothing redirects
    assert TestClient(make_app(tmp_path, tiny_db), follow_redirects=False).get("/").status_code == 200


def test_security_headers(app):
    r = TestClient(app).get("/")
    csp = r.headers["content-security-policy"]
    assert "img-src 'self' data: https://fimgs.net https://upload.wikimedia.org" in csp
    assert "frame-ancestors 'none'" in csp and "default-src 'self'" in csp
    # scripts stay strictly same-origin; inline *styles* are allowed (React / Radix set style attributes)
    assert "script-src 'self';" in csp and csp.count("'unsafe-inline'") == 1 and "style-src 'self' 'unsafe-inline'" in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert r.headers["x-frame-options"] == "DENY"
    api_r = TestClient(app).get("/api/notes")
    assert api_r.headers["x-content-type-options"] == "nosniff" and "content-security-policy" in api_r.headers


def test_allowed_hosts_env_driven(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, allowed_hosts=("atlas.example.com", "*.onrender.com"))
    for host, code in (("atlas.example.com", 200), ("atlas.example.com:443", 200), ("x.onrender.com", 200),
                       ("evil.com", 400), ("127.0.0.1", 400), ("atlas.example.com.evil.com", 400)):
        assert TestClient(app).get("/api/notes", headers={"host": host}).status_code == code, host
    assert TestClient(app).get("/api/status", headers={"host": "anything.invalid"}).status_code == 200
    s = config.Settings.from_env({"ALLOWED_HOSTS": " Atlas.Example.com , 127.0.0.1 ", "IMAGE_MODE": "REMOTE", "RENDER": "true"})
    assert s.allowed_hosts == ("atlas.example.com", "127.0.0.1") and s.image_mode == "remote" and s.trust_proxy
    assert config.Settings.from_env({}).allowed_hosts == ("127.0.0.1", "localhost") and not config.Settings.from_env({}).trust_proxy


def test_status_does_not_leak_paths_for_deploy_catalog(tmp_path, tiny_db):
    gz = tmp_path / "catalog.db.gz"
    with open(tiny_db, "rb") as f_in, gzip.open(gz, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    app = server.create_app(data_dir=tmp_path / "d", fetch_images=False, settings=config.Settings.from_env().with_(
        catalog_db_gz=str(gz), work_dir=str(tmp_path / "work")))
    st = TestClient(app).get("/api/status").json()
    assert st["kind"] == "deploy" and "db" not in st and st["perfumes"] == len(TINY_PERFUMES)


# ============================================================================ storage layer
def test_database_url_normalisation():
    n = config.normalize_database_url
    assert n("postgres://u:p@h:5432/db") == "postgresql+psycopg://u:p@h:5432/db"
    assert n("postgresql://u:p@h/db?sslmode=require") == "postgresql+psycopg://u:p@h/db?sslmode=require"
    assert n("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert n(None, Path("/tmp/x/users.db")).startswith("sqlite:///") and n("").endswith("users.db")


def test_schema_init_is_idempotent_and_recorded(tmp_path):
    url = "sqlite:///" + (tmp_path / "u.db").as_posix()
    s1 = userdb.UserStore(url)
    s1.create_user("zed", "zed@example.com", "x")
    s2 = userdb.UserStore(url)             # second start on the same file: no error, data kept
    assert s2.find_user("zed") and s2.count_users() == 1
    import sqlalchemy as sa
    with s2.eng.connect() as con:
        versions = con.execute(sa.select(userdb.schema_migrations.c.version).order_by(userdb.schema_migrations.c.version)).scalars().all()
        assert versions == list(range(1, userdb.SCHEMA_VERSION + 1))


def test_postgres_statements_compile():
    """No Postgres in CI: make sure the Core statements and DDL compile for that dialect."""
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.dialects.postgresql import insert
    from sqlalchemy.schema import CreateTable

    for t in userdb.metadata.sorted_tables:
        ddl = str(CreateTable(t).compile(dialect=postgresql.dialect()))
        assert "CREATE TABLE" in ddl
    assert "BIGSERIAL" in str(CreateTable(userdb.users).compile(dialect=postgresql.dialect()))
    stmt = insert(userdb.perfume_status).values(user_id=1, perfume_id=2, status="owned", updated_at=1)
    sql = str(stmt.on_conflict_do_update(index_elements=["user_id", "perfume_id"], set_={"status": stmt.excluded.status}).compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT (user_id, perfume_id) DO UPDATE" in sql
    ins = insert(userdb.favorites).values(user_id=1, kind="note", ref="x", created_at=1, seq=1).on_conflict_do_nothing(index_elements=["user_id", "kind", "ref"])
    assert "DO NOTHING" in str(ins.compile(dialect=postgresql.dialect()))


# ============================================================================ image modes
def test_remote_image_mode_returns_direct_urls_and_writes_nothing(tmp_path, tiny_db):
    con = sqlite3.connect(tiny_db)
    con.execute("UPDATE perfumes SET fragrantica_id = id * 100 WHERE id IN (1, 2)")
    con.execute("UPDATE notes SET image_source = 'Fragrantica CDN https://fimgs.net/mdimg/sastojci/o.717.jpg (x)' WHERE slug = 'peach'")
    con.execute("UPDATE notes SET image_source = 'https://en.wikipedia.org/wiki/Rose File:Rosa_rubiginosa_1.jpg | CC BY-SA 3.0 | Someone' WHERE slug = 'rose'")
    con.commit()
    con.close()
    data = tmp_path / "data"
    app = server.create_app(db_path=tiny_db, data_dir=data, fetch_images=True, image_mode="remote",
                            settings=config.Settings.from_env())
    c = TestClient(app)
    assert c.get("/api/status").json()["image_mode"] == "remote"
    d = c.get("/api/perfumes/1").json()
    assert d["image"] == "https://fimgs.net/mdimg/perfume/375x500.100.jpg"
    assert c.get("/api/perfumes/2").json()["image"] == "https://fimgs.net/mdimg/perfume/375x500.200.jpg"
    assert c.get("/api/perfumes/3").json()["image"] == "/img/perfume/3"                     # no fragrantica id -> generated
    assert c.get("/api/search", params={"include": "peach"}).json()["results"][0]["image"].startswith("https://fimgs.net/")
    notes = {n["slug"]: n for n in c.get("/api/notes", params={"limit": 50}).json()["notes"]}
    assert notes["peach"]["image"] == "https://fimgs.net/mdimg/sastojci/t.717.jpg"           # thumbnail form
    assert notes["rose"]["image"].startswith("https://upload.wikimedia.org/wikipedia/commons/thumb/")
    assert notes["rose"]["image"].endswith("/330px-Rosa_rubiginosa_1.jpg")
    assert notes["oud"]["image"] == "/img/note/oud"                                          # unknown -> generated
    assert "Rosa_rubiginosa_1.jpg" in c.get("/api/credits").json()["note_images"]["rose"]
    # the /img fallbacks stay: SVG, never a proxied fetch, nothing written to disk
    for url in ("/img/perfume/1", "/img/perfume/3", "/img/note/peach", "/img/note/oud"):
        r = c.get(url)
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg") and "<svg" in r.text
    assert not (data / "images").exists()
    assert c.get("/api/notes/peach").json()["note"]["image"].startswith("https://fimgs.net")
    m = c.post("/api/notes/resolve", json={"names": ["peach", "zzz"]}).json()["matches"]
    assert m[0]["image"] == "https://fimgs.net/mdimg/sastojci/t.717.jpg" and m[1]["image"] is None


def test_local_image_mode_keeps_local_paths(tmp_path, tiny_db):
    app = server.create_app(db_path=tiny_db, data_dir=tmp_path, fetch_images=False, image_mode="local", settings=config.Settings.from_env())
    c = TestClient(app)
    assert c.get("/api/perfumes/1").json()["image"] == "/img/perfume/1"
    assert c.get("/api/notes/peach").json()["note"]["image"] == "/img/note/peach"


def test_remote_url_helpers():
    import remote_images as ri
    assert ri.note_remote_url("Fragrantica CDN https://fimgs.net/mdimg/sastojci/o.1644.jpg (note image 1644; (c) F)") == "https://fimgs.net/mdimg/sastojci/t.1644.jpg"
    assert ri.note_remote_url("x https://fimgs.net/mdimg/sastojci/t.1389.jpg y") == "https://fimgs.net/mdimg/sastojci/t.1389.jpg"
    u = ri.note_remote_url("https://en.wikipedia.org/wiki/Scone File:Scone_varieties.jpg | CC BY-SA 2.5 | User:Dave souza")
    assert u == "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Scone_varieties.jpg/330px-Scone_varieties.jpg"
    assert ri.note_remote_url(None) is None and ri.note_remote_url("nonsense") is None
    assert ri.bottle_url(12345) == "https://fimgs.net/mdimg/perfume/375x500.12345.jpg" and ri.bottle_url(None) is None and ri.bottle_url(0) is None
    assert "CC BY-SA 2.5" in ri.note_credit("https://en.wikipedia.org/wiki/Scone File:Scone_varieties.jpg | CC BY-SA 2.5 | User:Dave souza")
    assert ri.note_credit("Fragrantica CDN https://fimgs.net/mdimg/sastojci/o.1.jpg") is None


# ============================================================================ deploy artifact
def test_make_deploy_db_roundtrip(tmp_path, tiny_db):
    import make_deploy_db as mk
    con = sqlite3.connect(tiny_db)
    con.execute("UPDATE perfumes SET fragrantica_id = id, image_url = 'https://fimgs.net/mdimg/perfume/375x500.' || id || '.jpg' WHERE id IN (1, 2)")
    con.execute("UPDATE notes SET image_source = 'Fragrantica CDN https://fimgs.net/mdimg/sastojci/o.55.jpg (x)' WHERE slug = 'musk'")
    con.commit()
    con.close()
    out = tmp_path / "deploy"
    info = mk.build(Path(tiny_db), out, max_mb=50)
    assert info["counts"]["perfumes"] == len(TINY_PERFUMES) and (out / "catalog.db").exists() and (out / "catalog.db.gz").exists()
    db = sqlite3.connect(out / "catalog.db")
    cols = {r[1] for r in db.execute("PRAGMA table_info(perfumes)")}
    assert "sources" not in cols
    assert db.execute("SELECT image_remote FROM notes WHERE slug='musk'").fetchone()[0] == "https://fimgs.net/mdimg/sastojci/t.55.jpg"
    assert db.execute("SELECT image_url FROM perfumes WHERE id=1").fetchone()[0] is None       # derivable -> not stored
    assert db.execute("SELECT COUNT(*) FROM perfume_notes").fetchone()[0] == sum(len(n) for p in TINY_PERFUMES.values() for n in p[5].values())
    db.close()
    mk.verify(out, Path(tiny_db))
    # gz is deterministic
    first = (out / "catalog.db.gz").read_bytes()
    mk.build(Path(tiny_db), out, max_mb=50)
    assert (out / "catalog.db.gz").read_bytes() == first
    with pytest.raises(SystemExit):
        mk.build(Path(tiny_db), tmp_path / "tiny_limit", max_mb=0.000001)
    # the server serves the artifact in remote mode with identical search results
    app = server.create_app(data_dir=tmp_path / "d", fetch_images=False, settings=config.Settings.from_env().with_(
        catalog_db_gz=str(out / "catalog.db.gz"), work_dir=str(tmp_path / "work"), image_mode="remote"))
    c = TestClient(app)
    assert {r["id"] for r in c.get("/api/search", params={"include": "peach", "per_page": 50}).json()["results"]} == {1, 2, 3, 5, 6}
    assert c.get("/api/perfumes/1").json()["image"] == "https://fimgs.net/mdimg/perfume/375x500.1.jpg"
    assert c.get("/api/notes/musk").json()["note"]["image"] == "https://fimgs.net/mdimg/sastojci/t.55.jpg"


def test_gz_is_decompressed_once_and_only_when_missing(tmp_path, tiny_db):
    gz = tmp_path / "c.db.gz"
    with open(tiny_db, "rb") as f_in, gzip.open(gz, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    s = config.Settings.from_env().with_(catalog_db_gz=str(gz), work_dir=str(tmp_path / "w"))
    p1, kind = config.pick_catalog_db(s, tmp_path)
    assert kind == "deploy" and p1.exists() and p1.read_bytes()[:15] == b"SQLite format 3"
    mtime = p1.stat().st_mtime_ns
    p2, _ = config.pick_catalog_db(s, tmp_path)
    assert p2 == p1 and p2.stat().st_mtime_ns == mtime                      # reused, not rewritten
    p1.unlink()
    p3, _ = config.pick_catalog_db(s, tmp_path)
    assert p3.exists()                                                      # missing -> decompressed again
    bad = tmp_path / "bad.gz"
    bad.write_bytes(gzip.compress(b"not a database"))
    with pytest.raises(RuntimeError):
        config.decompress_catalog(bad, tmp_path / "bad.db")
    assert not (tmp_path / "bad.db").exists()


def test_memory_layout_is_compact(tiny_db):
    import numpy as np
    import catalog
    cat = catalog.Catalog(tiny_db)
    for name in ("p_id", "p_fid", "pn_note", "nl_perf", "na_perf", "pn_indptr"):
        assert getattr(cat, name).dtype == np.int32, name
    assert cat.pn_layer.dtype == np.int8 and cat.p_rating.dtype == np.float32 and cat.acc_w.dtype == np.float32
    assert cat.acc_pct.dtype == np.uint8 and cat.p_year.dtype == np.int16
    assert not any(isinstance(v, (list, dict)) and len(v) > 100 for k, v in vars(cat).items() if k.startswith("p_"))
    # accord cosine: a perfume is most similar to itself
    for i in range(cat.n_perf):
        assert cat.accord_cosine(i)[i] == pytest.approx(1.0, abs=1e-5)
