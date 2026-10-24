"""Layering engine rules + the layering / community-combo API.   cd app && python -m pytest -q"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_accounts import H, signup  # noqa: E402

import catalog  # noqa: E402
import layer_api  # noqa: E402
import layering as L  # noqa: E402
import make_fixture  # noqa: E402
import server  # noqa: E402

BIG = ["n%02d" % k for k in range(16)]
# id: (name, brand, votes, accords {name: strength}, {layer: [notes]})
PERFUMES = {
    1: ("Citrus Cologne", "Alpha", 3000, {"citrus": 1.0, "aromatic": 0.6, "fresh": 0.5},
        {"top": ["bergamot", "lemon"], "middle": ["lavender"], "base": ["musk"]}),
    2: ("Amber Wood", "Beta", 5000, {"amber": 1.0, "woody": 0.8, "warm spicy": 0.6, "vanilla": 0.5},
        {"middle": ["cinnamon"], "base": ["amber", "sandalwood", "vanilla", "musk"]}),
    3: ("Sea Breeze", "Gamma", 2500, {"aquatic": 1.0, "marine": 0.8, "fresh": 0.6},
        {"top": ["sea-salt"], "middle": ["sea-notes"], "base": ["musk"]}),
    4: ("Caramel Bomb", "Delta", 2500, {"sweet": 1.0, "caramel": 0.9, "vanilla": 0.8},
        {"base": ["caramel", "vanilla", "tonka"]}),
    5: ("Amber Wood Intense", "Beta", 900, {"amber": 1.0, "woody": 0.8, "warm spicy": 0.6, "vanilla": 0.5},
        {"middle": ["cinnamon"], "base": ["amber", "sandalwood", "vanilla", "musk"]}),
    6: ("Rose Oud", "Epsilon", 4000, {"rose": 1.0, "oud": 0.9, "warm spicy": 0.4},
        {"top": ["saffron"], "middle": ["rose"], "base": ["oud"]}),
    7: ("Vanilla Musk", "Zeta", 1500, {"vanilla": 1.0, "musky": 0.8},
        {"base": ["vanilla", "musk"]}),
    8: ("Grand Opera", "Eta", 1200, {"floral": 1.0, "woody": .9, "amber": .8, "powdery": .7, "fruity": .6, "warm spicy": .5,
                                       "citrus": .45, "animalic": .4}, {"general": BIG}),
    9: ("Grand Ballet", "Theta", 1100, {"rose": 1.0, "woody": .9, "sweet": .8, "powdery": .7, "fruity": .6, "warm spicy": .5,
                                        "citrus": .45, "musky": .4}, {"general": BIG[4:] + ["rose", "x1", "x2", "x3", "x4"]}),
    10: ("Obscure Thing", "Iota", 12, {"citrus": 1.0, "woody": 0.8}, {"top": ["lemon"], "base": ["cedar"]}),
}


@pytest.fixture(scope="module")
def layer_db(tmp_path_factory):
    path = tmp_path_factory.mktemp("layer") / "layer.db"
    con = sqlite3.connect(path)
    con.executescript(make_fixture.SCHEMA)
    notes = sorted({n for *_x, layers in PERFUMES.values() for ns in layers.values() for n in ns})
    nid = {n: k for k, n in enumerate(notes, 1)}
    con.executemany("INSERT INTO notes(id,slug,name,family,perfume_count) VALUES (?,?,?,?,?)",
                    [(k, n, n.replace("-", " ").title(), "other", 0) for n, k in nid.items()])
    for pid, (name, brand, votes, acc, layers) in PERFUMES.items():
        con.execute("INSERT INTO perfumes(id,name,brand,year,gender,rating,rating_count,perfumers,accords) VALUES (?,?,?,?,?,?,?,?,?)",
                    (pid, name, brand, 2015, "unisex", 4.1, votes, "[]",
                     json.dumps([{"name": k, "strength": v} for k, v in acc.items()])))
        for layer, ns in layers.items():
            for pos, n in enumerate(ns):
                con.execute("INSERT INTO perfume_notes VALUES (?,?,?,?)", (pid, nid[n], layer, pos))
    con.commit()
    con.close()
    return path


@pytest.fixture()
def curated(tmp_path, monkeypatch):
    f = tmp_path / "curated.json"
    f.write_text(json.dumps([{"a_brand": "Alpha", "a_name": "Citrus Cologne", "b_brand": "Epsilon", "b_name": "Rose Oud",
                              "note": "A house favourite.", "source_url": "https://www.example.com/layering"},
                             {"a_brand": "Nobody", "a_name": "Missing", "b_brand": "Beta", "b_name": "Amber Wood",
                              "note": "x", "source_url": "https://example.com"}]))
    monkeypatch.setattr(L, "CURATED_FILE", f)
    return f


@pytest.fixture()
def cat(layer_db, curated):
    return catalog.Catalog(layer_db, "local")


def ix(cat, pid):
    return cat.idx_of(pid)


def rep(cat, a, b):
    return L.pair_report(cat, ix(cat, a), ix(cat, b))


# ============================================================================ engine
def test_pair_table_is_symmetric_and_bounded():
    assert np.allclose(L.K, L.K.T)
    assert L.K.min() >= -2 and L.K.max() <= 2
    assert all(a in L.FI and b in L.FI for a, b in L.PAIRS)


def test_pool_keeps_only_known_perfumes_and_curated_pairs_resolve(cat):
    m = L.model(cat)
    pool_ids = {int(cat.p_id[i]) for i in m.pool.idx}
    assert 10 not in pool_ids and {1, 2, 3, 4} <= pool_ids        # 12 votes is below the pool bar
    assert ix(cat, 6) in {j for j, _n, _u in m.curated[ix(cat, 1)]}
    assert len(m.curated_missing) == 1                            # a perfume that is not in the catalog
    assert L.model(cat) is m                                      # built once per catalog


def test_documented_clash_is_never_recommended(cat):
    r = rep(cat, 3, 4)                                            # aquatic + dense gourmand
    assert not r["recommended"] and r["verdict"] == "blocked"
    assert any(c["kind"] == "clash" for c in r["cons"])
    rows, _r, _fi, _t = L.candidates(cat, ix(cat, 3), L.model(cat).pool, min_score=-9)
    assert ix(cat, 4) not in {int(L.model(cat).pool.idx[k]) for k in rows}


def test_same_scent_in_another_edition_is_not_layering(cat):
    r = rep(cat, 2, 5)
    assert not r["recommended"] and r["cons"][0]["kind"] == "duplicate"


def test_two_complex_compositions_are_excluded(cat):
    r = rep(cat, 8, 9)
    assert not r["recommended"] and any(c["kind"] == "complex" for c in r["cons"])


def test_fresh_over_deep_scores_and_explains(cat):
    r = rep(cat, 1, 2)                                            # citrus cologne over amber wood: a textbook layer
    assert r["recommended"] and r["verdict"] in ("good", "great", "classic")
    kinds = {p["kind"] for p in r["pros"]}
    assert "accord" in kinds and ("structure" in kinds or "bridge" in kinds)
    assert r["how_to"]["first"] == 2 and r["how_to"]["second"] == 1   # heavier one goes on first
    assert sum(b["share"] for b in r["blend"]) == pytest.approx(1.0, abs=0.06)


def test_curated_pair_is_boosted_and_sourced(cat):
    r = rep(cat, 6, 1)
    assert r["recommended"] and r["curated"]["source"] == "example.com/layering".split("/")[0]
    assert r["pros"][0]["kind"] == "curated" and r["pros"][0]["url"].startswith("https://")


def test_sparse_and_dense_pair_stats_agree(cat):
    m = L.model(cat)
    i, cand = ix(cat, 2), np.array([ix(cat, p) for p in (1, 3, 4, 6, 7, 8)])
    dense = (L.note_cosine(cat, m, i, cand), L.bridge_scores(cat, m, i, cand), cat.accord_cosine(i)[cand])
    sparse = L.pair_stats(cat, m, i, cand)
    for a, b in zip(dense, sparse):
        assert np.allclose(a, b, atol=1e-5)


def test_within_a_collection(cat):
    pairs = L.within(cat, [ix(cat, p) for p in (1, 2, 3, 4, 5)])
    keys = {frozenset((int(cat.p_id[i]), int(cat.p_id[j]))) for i, j, _b in pairs}
    assert frozenset((1, 2)) in keys
    assert frozenset((3, 4)) not in keys and frozenset((2, 5)) not in keys
    assert all(b["score"] >= L.SHOW for _i, _j, b in pairs)
    assert L.within(cat, [ix(cat, 1)]) == []


def test_verdicts_and_percentiles_are_monotonic():
    scores = [-0.5, 0.3, 0.47, 0.6, 0.67, 0.74, 0.9]
    tops = [L.top_share(s) for s in scores]
    assert tops == sorted(tops, reverse=True) and 0 < tops[-1] <= 1
    assert [L.verdict(s)[0] for s in scores] == ["weak", "weak", "neutral", "good", "great", "classic", "classic"]


def test_wilson_ranks_confidence_over_tiny_samples():
    assert layer_api.wilson(40, 5) > layer_api.wilson(3, 0) > layer_api.wilson(1, 1) > 0
    assert layer_api.wilson(0, 0) == 0


# ============================================================================ API
@pytest.fixture()
def app(tmp_path, layer_db, curated):
    return server.create_app(db_path=layer_db, data_dir=tmp_path, fetch_images=False)


def test_layering_page_anonymous_and_signed_in(app):
    c = TestClient(app)
    r = c.get("/api/layering/2").json()
    assert "collection" not in r and r["source"]["traits"]["role"] == "base"
    ids = [p["id"] for p in r["catalog"]["items"]]
    assert 1 in ids and 5 not in ids and 10 not in ids
    assert all(p["pair"]["score"] >= L.SHOW for p in r["catalog"]["items"])
    assert c.get("/api/layering/2", params={"offset": 12}).json().keys() == {"catalog"}
    assert c.get("/api/layering/99999").status_code == 404

    signup(c)
    assert c.get("/api/layering/2").json()["collection"] == {"owned": 0, "items": []}
    for pid in (1, 3, 5):
        c.post("/api/me/collection", headers=H, json={"perfume_id": pid})
    col = c.get("/api/layering/2").json()["collection"]
    assert col["owned"] == 3 and [p["id"] for p in col["items"]] == [1]   # 5 is the same scent, 3 not good enough

    cur = c.get("/api/layering/6").json()["curated"]
    assert [p["id"] for p in cur] == [1] and cur[0]["pair"]["source_url"].startswith("https://")


def test_pair_endpoint(app):
    c = TestClient(app)
    r = c.get("/api/layering/1/with/2").json()
    assert r["a"]["id"] == 1 and r["report"]["recommended"] and r["community"] is None
    assert r["a"]["pyramid"]["top"] and r["report"]["how_to"]["steps"]
    assert c.get("/api/layering/1/with/1").status_code == 400


def test_collection_layering(app):
    c = TestClient(app)
    assert c.get("/api/me/collection/layering").status_code == 401
    signup(c)
    for pid in (1, 2, 3, 4):
        c.post("/api/me/collection", headers=H, json={"perfume_id": pid})
    r = c.get("/api/me/collection/layering").json()
    assert r["owned"] == 4
    pairs = {frozenset((p["a"]["id"], p["b"]["id"])) for p in r["pairs"]}
    assert frozenset((1, 2)) in pairs and frozenset((3, 4)) not in pairs
    assert r["partners"]["1"] >= 1


def test_community_combos_and_votes(app):
    a, b = TestClient(app), TestClient(app)
    assert a.post("/api/layering/combos", headers=H, json={"a": 1, "b": 2}).status_code == 401
    signup(a, "alice")
    signup(b, "bobby")
    assert a.post("/api/layering/combos", json={"a": 1, "b": 2}).status_code == 403          # CSRF header required
    assert a.post("/api/layering/combos", headers=H, json={"a": 1, "b": 1}).status_code == 422
    assert a.post("/api/layering/combos", headers=H, json={"a": 1, "b": 99999}).status_code == 404

    combo = a.post("/api/layering/combos", headers=H, json={"a": 2, "b": 1}).json()
    assert (combo["up"], combo["down"], combo["my_vote"]) == (1, 0, 1)                        # author's thumbs up
    assert combo["by"] == "alice" and combo["created_at"] > 0                                # for the feed card
    assert {combo["a"]["id"], combo["b"]["id"]} == {1, 2} and "verdict" in combo["ours"]
    again = b.post("/api/layering/combos", headers=H, json={"a": 1, "b": 2}).json()          # same pair = a vote
    assert again["id"] == combo["id"] and again["up"] == 2
    cid = combo["id"]
    r = b.post(f"/api/layering/combos/{cid}/vote", headers=H, json={"vote": -1}).json()
    assert (r["up"], r["down"], r["my_vote"]) == (1, 1, -1)
    r = b.post(f"/api/layering/combos/{cid}/vote", headers=H, json={"vote": 0}).json()
    assert (r["up"], r["down"], r["my_vote"]) == (1, 0, 0)
    assert b.post(f"/api/layering/combos/{cid}/vote", headers=H, json={"vote": 2}).status_code == 422
    assert b.post("/api/layering/combos/424242/vote", headers=H, json={"vote": 1}).status_code == 404

    # shows up for both perfumes, the pair page and the home page; my_vote is per viewer
    assert [x["partner"]["id"] for x in a.get("/api/layering/1").json()["community"]] == [2]
    assert a.get("/api/layering/2/with/1").json()["community"]["my_vote"] == 1
    assert b.get("/api/layering/2/with/1").json()["community"]["my_vote"] == 0
    assert TestClient(app).get("/api/layering").json()["community"][0]["my_vote"] == 0
    assert a.get("/api/layering").json()["community"][0]["id"] == cid
    assert a.get("/api/layering/1").json()["community"][0]["by"] == "alice"


def test_combo_creation_is_rate_limited(app, monkeypatch):
    monkeypatch.setattr(layer_api, "COMBOS_PER_DAY", 2)
    c = TestClient(app)
    signup(c)
    assert c.post("/api/layering/combos", headers=H, json={"a": 1, "b": 2}).status_code == 201
    assert c.post("/api/layering/combos", headers=H, json={"a": 1, "b": 3}).status_code == 201
    assert c.post("/api/layering/combos", headers=H, json={"a": 1, "b": 4}).status_code == 429
    assert c.post("/api/layering/combos", headers=H, json={"a": 2, "b": 1}).status_code == 201   # voting is not limited


def test_deleting_an_account_takes_its_votes_back(app):
    a, b = TestClient(app), TestClient(app)
    signup(a, "alice")
    signup(b, "bobby")
    cid = a.post("/api/layering/combos", headers=H, json={"a": 1, "b": 2}).json()["id"]
    b.post(f"/api/layering/combos/{cid}/vote", headers=H, json={"vote": 1})
    assert b.post("/api/auth/delete", headers=H, json={"password": "correct-horse-9"}).status_code == 200
    c = app.state.store.get_combo(cid)
    assert (c["up"], c["down"]) == (1, 0)
    assert a.post("/api/auth/delete", headers=H, json={"password": "correct-horse-9"}).status_code == 200
    c = app.state.store.get_combo(cid)
    assert (c["up"], c["created_by"]) == (0, None)                 # the combo itself stays, anonymously
