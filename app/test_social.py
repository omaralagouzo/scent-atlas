"""Friends and profiles: requests, accepting, privacy of shelves, search, account deletion.   cd app && python -m pytest -q"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401  (shared fixtures)
from test_accounts import H, PW, app, signup  # noqa: E402,F401

import userdb  # noqa: E402


def people(app, *names):
    out = []
    for n in names:
        c = TestClient(app)
        assert signup(c, n).status_code == 201
        out.append(c)
    return out


def test_friend_request_accept_and_remove(app):
    alice, bobby, carol = people(app, "alice", "bobby", "carol")
    assert TestClient(app).post("/api/friends/bobby", headers=H, json={}).status_code == 401
    assert alice.post("/api/friends/alice", headers=H, json={}).status_code == 400
    assert alice.post("/api/friends/nobody", headers=H, json={}).status_code == 404
    assert alice.post("/api/friends/bobby", json={}).status_code == 403                       # CSRF header required

    assert alice.post("/api/friends/BOBBY", headers=H, json={}).json() == {"relation": "outgoing"}  # case-insensitive
    assert alice.post("/api/friends/bobby", headers=H, json={}).json() == {"relation": "outgoing"}  # idempotent
    assert bobby.get("/api/users/alice").json()["relation"] == "incoming"
    lists = bobby.get("/api/friends").json()
    assert [u["username"] for u in lists["incoming"]] == ["alice"] and lists["friends"] == []
    assert bobby.post("/api/friends/alice", headers=H, json={}).json() == {"relation": "friends"}   # accept = request back
    assert [u["username"] for u in alice.get("/api/friends").json()["friends"]] == ["bobby"]

    # decline / cancel / unfriend are all DELETE
    carol.post("/api/friends/alice", headers=H, json={})
    assert alice.delete("/api/friends/carol", headers=H).json() == {"relation": "none"}
    assert alice.get("/api/friends").json()["incoming"] == []
    alice.delete("/api/friends/bobby", headers=H)
    assert bobby.get("/api/users/alice").json()["relation"] == "none"


def test_profiles_are_private_to_friends(app):
    alice, bobby, carol = people(app, "alice", "bobby", "carol")
    alice.post("/api/me/collection", headers=H, json={"perfume_id": 1})
    alice.post("/api/me/collection", headers=H, json={"perfume_id": 2, "rank": 1})
    alice.put("/api/me/perfumes/1", headers=H, json={"rating": 4, "note": "my secret"})
    alice.put("/api/me/perfumes/3", headers=H, json={"status": "wishlist"})
    alice.post("/api/favorites", headers=H, json={"type": "note", "id": "rose", "liked": True})

    stranger = carol.get("/api/users/alice").json()
    assert stranger["visible"] is False and stranger["counts"]["owned"] == 2
    assert "collection" not in stranger and "favorites" not in stranger and "wishlist" not in stranger
    assert TestClient(app).get("/api/users/alice").status_code == 401

    alice.post("/api/friends/bobby", headers=H, json={})
    assert bobby.get("/api/users/alice").json()["visible"] is False                 # pending is not enough
    bobby.post("/api/friends/alice", headers=H, json={})
    prof = bobby.get("/api/users/alice").json()
    assert prof["visible"] and prof["relation"] == "friends"
    assert prof["collection"]["order"] == [2] and [it["id"] for it in prof["collection"]["items"]] == [2, 1]
    assert all("note" not in it["my"] for it in prof["collection"]["items"])        # private notes never leak
    assert "my secret" not in str(prof)
    assert [p["id"] for p in prof["wishlist"]] == [3] and [n["slug"] for n in prof["favorites"]["notes"]] == ["rose"]
    assert "history" not in prof and "saved" not in prof
    assert alice.get("/api/users/alice").json()["relation"] == "self"


def test_search_people(app):
    alice, bobby, _ = people(app, "alice", "bobby", "alicia")
    names = [u["username"] for u in alice.get("/api/users/search", params={"q": "ali"}).json()["users"]]
    assert names == ["alicia"]                                                     # never yourself
    assert [u["username"] for u in bobby.get("/api/users/search", params={"q": "LI"}).json()["users"]] == ["alice", "alicia"]
    assert bobby.get("/api/users/search", params={"q": "%"}).json()["users"] == []  # LIKE wildcards are literal
    assert bobby.get("/api/users/search", params={"q": "example.com"}).json()["users"] == []   # never matches emails
    assert TestClient(app).get("/api/users/search", params={"q": "a"}).status_code == 401


def test_deleting_an_account_removes_its_friendships(app):
    alice, bobby = people(app, "alice", "bobby")
    alice.post("/api/friends/bobby", headers=H, json={})
    bobby.post("/api/friends/alice", headers=H, json={})
    assert alice.post("/api/auth/delete", headers=H, json={"password": PW}).status_code == 200
    assert bobby.get("/api/friends").json()["friends"] == []
    assert bobby.get("/api/users/alice").status_code == 404


def test_v2_database_gets_the_friends_table(tmp_path):
    url = "sqlite:///" + (tmp_path / "v2.db").as_posix()
    store = userdb.UserStore(url)
    with store.eng.begin() as c:
        c.execute(userdb.sa.text("DROP TABLE friendships"))
        c.execute(userdb.schema_migrations.delete().where(userdb.schema_migrations.c.version == 3))
    store.dispose()
    store = userdb.UserStore(url)
    assert "friendships" in userdb.sa.inspect(store.eng).get_table_names()
