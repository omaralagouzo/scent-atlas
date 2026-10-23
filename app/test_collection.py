"""My Collection: leaderboard order, profile, schema upgrade, and the session -> user id regression.   cd app && python -m pytest -q"""
from __future__ import annotations

import sys
from pathlib import Path

import sqlalchemy as sa
from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401  (shared fixtures)
from test_accounts import H, app, c, signup  # noqa: E402,F401

import userdb  # noqa: E402


def owned(client, *ids):
    for pid in ids:
        assert client.post("/api/me/collection", headers=H, json={"perfume_id": pid}).status_code == 200


def test_collection_needs_sign_in(c):
    assert c.get("/api/me/collection").status_code == 401
    assert c.post("/api/me/collection", headers=H, json={"perfume_id": 1}).status_code == 401
    assert c.put("/api/me/collection/order", headers=H, json={"ids": [1]}).status_code == 401


def test_add_rank_reorder_and_remove(c):
    signup(c)
    owned(c, 1, 2, 3, 4)
    r = c.get("/api/me/collection").json()
    assert {it["id"] for it in r["items"]} == {1, 2, 3, 4} and r["order"] == []
    assert all(it["rank"] is None and it["my"]["status"] == "owned" for it in r["items"])

    r = c.put("/api/me/collection/order", headers=H, json={"ids": [3, 1, 99, 3, 2]}).json()  # unknown + repeated ids ignored
    assert r["order"] == [3, 1, 2]
    assert [it["id"] for it in r["items"]][:3] == [3, 1, 2] and r["items"][3]["rank"] is None

    # adding with a rank inserts at that place; re-adding an owned one moves it
    r = c.post("/api/me/collection", headers=H, json={"perfume_id": 4, "rank": 1}).json()
    assert r["order"] == [4, 3, 1, 2]
    r = c.post("/api/me/collection", headers=H, json={"perfume_id": 2, "rank": 2}).json()
    assert r["order"] == [4, 2, 3, 1]
    assert c.post("/api/me/collection", headers=H, json={"perfume_id": 5, "rank": 50}).json()["order"] == [4, 2, 3, 1, 5]

    # leaving "owned" drops the perfume from the leaderboard and closes the gap; rating/note survive
    c.put("/api/me/perfumes/2", headers=H, json={"rating": 5, "note": "summer"})
    c.put("/api/me/perfumes/2", headers=H, json={"status": "tried"})
    r = c.get("/api/me/collection").json()
    assert r["order"] == [4, 3, 1, 5] and [it["rank"] for it in r["items"]] == [1, 2, 3, 4]
    assert c.get("/api/me/perfumes/2").json() == {"status": "tried", "rating": 5, "note": "summer"}
    # owning it again brings it back unranked
    owned(c, 2)
    r = c.get("/api/me/collection").json()
    assert r["order"] == [4, 3, 1, 5] and next(it for it in r["items"] if it["id"] == 2)["rank"] is None

    # an empty order unranks everything but keeps the collection
    r = c.put("/api/me/collection/order", headers=H, json={"ids": []}).json()
    assert r["order"] == [] and len(r["items"]) == 5


def test_collection_validation(c):
    signup(c)
    assert c.post("/api/me/collection", headers=H, json={"perfume_id": 999999}).status_code == 404
    assert c.post("/api/me/collection", headers=H, json={"perfume_id": 1, "rank": 0}).status_code == 422
    too_many = list(range(userdb.COLLECTION_CAP + 1))
    assert c.put("/api/me/collection/order", headers=H, json={"ids": too_many}).status_code == 422


def test_collections_are_private(app):
    a, b = TestClient(app), TestClient(app)
    signup(a, "alice")
    signup(b, "bobby")
    owned(a, 1, 2)
    a.put("/api/me/collection/order", headers=H, json={"ids": [2, 1]})
    assert b.get("/api/me/collection").json()["items"] == []
    # b cannot rank a's perfumes: ids that b does not own are ignored
    assert b.put("/api/me/collection/order", headers=H, json={"ids": [1, 2]}).json()["order"] == []
    assert a.get("/api/me/collection").json()["order"] == [2, 1]


def test_profile_shape_and_rank_weighting(c):
    signup(c)
    assert c.get("/api/me/collection").json()["profile"] == {"count": 0, "ranked": 0}
    owned(c, 4, 7, 8)
    p = c.get("/api/me/collection").json()["profile"]
    assert p["count"] == 3 and p["ranked"] == 0
    assert p["favorite_accord"]["name"] == "woody"
    assert p["archetype"]["title"] and p["archetype"]["blurb"]
    assert {n["slug"] for n in p["notes"]} >= {"oud", "rose", "vanilla", "musk"}
    assert next(n for n in p["common_notes"] if n["slug"] == "musk")["perfumes"] == 2
    # ranking G Vanilla first lifts its notes above H Plain Rose's
    c.put("/api/me/collection/order", headers=H, json={"ids": [7, 4, 8]})
    p = c.get("/api/me/collection").json()["profile"]
    order = [n["slug"] for n in p["notes"]]
    assert order.index("vanilla") < order.index("jasmine")


def test_v1_database_is_upgraded_in_place(tmp_path):
    """A users DB created before the leaderboard / layering tables gets the new column and tables, data intact."""
    url = "sqlite:///" + (tmp_path / "old.db").as_posix()
    eng = userdb.make_engine(url)
    old = sa.MetaData()
    for t in (userdb.users, userdb.sessions, userdb.favorites, userdb.saved_searches, userdb.history, userdb.meta,
              userdb.schema_migrations):
        t.to_metadata(old)
    sa.Table("perfume_status", old,
             sa.Column("user_id", sa.Integer, primary_key=True), sa.Column("perfume_id", sa.Integer, primary_key=True),
             sa.Column("status", sa.String(10)), sa.Column("rating", sa.SmallInteger), sa.Column("note", sa.Text),
             sa.Column("updated_at", sa.BigInteger, nullable=False))
    old.create_all(eng)
    with eng.begin() as con:
        con.execute(userdb.schema_migrations.insert().values(version=1, applied_at=0))
        con.execute(userdb.users.insert().values(id=1, username="old", username_lower="old", email="o@x.com",
                                                 email_lower="o@x.com", password_hash="h", created_at=0))
        con.execute(sa.text("INSERT INTO perfume_status (user_id, perfume_id, status, updated_at) VALUES (1, 7, 'owned', 1)"))
    eng.dispose()

    store = userdb.UserStore(url)
    assert {c["name"] for c in sa.inspect(store.eng).get_columns("perfume_status")} >= {"rank_pos"}
    assert {"layer_combos", "layer_votes"} <= set(sa.inspect(store.eng).get_table_names())
    assert store.list_status(1)[0]["status"] == "owned"
    assert store.set_collection_order(1, [7]) == [7]
    userdb.UserStore(url)                  # and starting again is a no-op
