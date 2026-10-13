"""pytest suite:  cd app && python -m pytest test_api.py -q

Two data sets are used:
  * a tiny hand-built DB (`tiny`) where exact scores/orderings are known,
  * the shipped fixture DB (`fx`) for end-to-end sanity checks.
"""
from __future__ import annotations

import base64
import http.server
import json
import os
import sqlite3
import sys
import threading
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ["SCENT_SKIP_DEFAULT_APP"] = "1"
os.environ["SCENT_NO_FETCH"] = "1"
os.environ["ALLOWED_HOSTS"] = "127.0.0.1,localhost,testserver"

import make_fixture  # noqa: E402
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# ---------------------------------------------------------------------------- tiny DB
TINY_NOTES = ["peach", "jasmine", "oud", "rose", "vanilla", "musk", "iris"]
# id: (name, brand, year, gender, votes, {layer: [notes]})
TINY_PERFUMES = {
    1: ("A Peach Top", "Alpha", 2000, "women", 900, {"top": ["peach"], "middle": ["jasmine"], "base": ["musk"]}),
    2: ("B Peach Base", "Alpha", 2005, "women", 800, {"top": ["jasmine"], "middle": ["musk"], "base": ["peach"]}),
    3: ("C Peach Mid", "Beta", 2010, "men", 700, {"top": ["jasmine"], "middle": ["peach"], "base": ["musk"]}),
    4: ("D Oud Rose", "Beta", 2012, "unisex", 600, {"top": ["rose"], "base": ["oud"]}),
    5: ("E Peach Oud", "Gamma", 2015, "unisex", 500, {"top": ["peach"], "base": ["oud"]}),
    6: ("F General", "Gamma", 2018, "women", 400, {"general": ["peach", "jasmine"]}),
    7: ("G Vanilla", "Delta", 2020, "men", 300, {"base": ["vanilla", "musk"], "middle": ["iris"]}),
    8: ("H Plain Rose", "Delta", None, "women", 200, {"middle": ["rose", "jasmine"], "base": ["musk"]}),
}


@pytest.fixture(scope="session")
def img_server():
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/ok"):
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.end_headers()
                self.wfile.write(PNG_1PX)
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(scope="session")
def tiny_db(tmp_path_factory, img_server):
    path = tmp_path_factory.mktemp("tiny") / "tiny.db"
    con = sqlite3.connect(path)
    con.executescript(make_fixture.SCHEMA)
    nid = {n: i for i, n in enumerate(TINY_NOTES, 1)}
    con.executemany(
        "INSERT INTO notes(id,slug,name,family,perfume_count) VALUES (?,?,?,?,?)",
        [(i, n, n.title(), "floral", 0) for n, i in nid.items()],
    )
    for pid, (name, brand, year, gender, votes, layers) in TINY_PERFUMES.items():
        img = f"{img_server}/ok.png" if pid == 1 else (f"{img_server}/missing.png" if pid == 2 else None)
        con.execute(
            "INSERT INTO perfumes(id,name,brand,year,gender,rating,rating_count,image_url,perfumers,accords) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pid, name, brand, year, gender, 4.0, votes, img, "[]", json.dumps([{"name": "woody", "strength": 1.0}])),
        )
        for layer, notes in layers.items():
            for pos, n in enumerate(notes):
                con.execute("INSERT INTO perfume_notes VALUES (?,?,?,?)", (pid, nid[n], layer, pos))
    con.commit()
    con.close()
    return path


@pytest.fixture()
def tiny(tiny_db, tmp_path):
    app = server.create_app(db_path=tiny_db, data_dir=tmp_path, fetch_images=True)
    return TestClient(app)


@pytest.fixture(scope="session")
def fx(tmp_path_factory):
    db = tmp_path_factory.mktemp("fx") / "fixture.db"
    make_fixture.build(db)
    d = tmp_path_factory.mktemp("fxdata")
    return TestClient(server.create_app(db_path=db, data_dir=d, fetch_images=False)), db


def names(resp_json):
    return [r["name"] for r in resp_json["results"]]


def ids(resp_json):
    return {r["id"] for r in resp_json["results"]}


# ---------------------------------------------------------------------------- search
def test_single_note_returns_every_perfume_with_it(tiny):
    r = tiny.get("/api/search", params={"include": "peach", "per_page": 100}).json()
    assert r["total"] == 5
    assert ids(r) == {1, 2, 3, 5, 6}


def test_search_all_vs_any(tiny):
    all_ = tiny.get("/api/search", params={"include": "peach,jasmine", "mode": "all"}).json()
    any_ = tiny.get("/api/search", params={"include": "peach,rose", "mode": "any", "per_page": 100}).json()
    assert ids(all_) == {1, 2, 3, 6}            # contain both
    assert ids(any_) == {1, 2, 3, 4, 5, 6, 8}  # contain either
    assert all_["total"] == 4 and any_["total"] == 7


def test_search_any_sort_by_matches_and_matched_field(tiny):
    r = tiny.get("/api/search", params={"include": "peach,jasmine", "mode": "any", "sort": "matches"}).json()
    first_two_matches = [len(x["matched"]) for x in r["results"]]
    assert first_two_matches == sorted(first_two_matches, reverse=True)
    assert set(r["results"][0]["matched"]) == {"peach", "jasmine"}


def test_search_exclude(tiny):
    r = tiny.get("/api/search", params={"include": "peach", "exclude": "oud", "per_page": 100}).json()
    assert ids(r) == {1, 2, 3, 6}


def test_layer_constraints(tiny):
    top = tiny.get("/api/search", params={"include": "peach@top"}).json()
    assert ids(top) == {1, 5}
    base = tiny.get("/api/search", params={"include": "peach@base"}).json()
    assert ids(base) == {2}
    heart = tiny.get("/api/search", params={"include": "peach@heart"}).json()
    assert ids(heart) == {3}
    combo = tiny.get("/api/search", params={"include": "peach@top,jasmine@middle"}).json()
    assert ids(combo) == {1}
    via_param = tiny.get("/api/search", params={"include": "peach", "layer": "top"}).json()
    assert ids(via_param) == {1, 5}
    # per-note layer on exclusion: exclude peach only when it is a top note
    ex = tiny.get("/api/search", params={"include": "peach", "exclude": "peach@top", "per_page": 100}).json()
    assert ids(ex) == {2, 3, 6}


def test_facets_are_co_occurrence_counts(tiny):
    r = tiny.get("/api/search", params={"include": "peach"}).json()
    facets = {f["slug"]: f["count"] for f in r["facets"]}
    assert "peach" not in facets
    assert facets["jasmine"] == 4      # A, B, C, F
    assert facets["musk"] == 3         # A, B, C
    assert facets["oud"] == 1          # E
    # adding a facet note really yields that many results (mode all)
    r2 = tiny.get("/api/search", params={"include": "peach,musk"}).json()
    assert r2["total"] == facets["musk"]


def test_filters_and_sorting(tiny):
    r = tiny.get("/api/search", params={"include": "peach", "gender": "women"}).json()
    assert ids(r) == {1, 2, 6}
    r = tiny.get("/api/search", params={"include": "peach", "brand": "alpha"}).json()
    assert ids(r) == {1, 2}
    r = tiny.get("/api/search", params={"include": "peach", "year_min": 2010, "year_max": 2016}).json()
    assert ids(r) == {3, 5}
    r = tiny.get("/api/search", params={"include": "peach", "sort": "year"}).json()
    assert [x["id"] for x in r["results"]] == [6, 5, 3, 2, 1]
    r = tiny.get("/api/search", params={"include": "peach", "sort": "popularity"}).json()
    assert [x["id"] for x in r["results"]] == [1, 2, 3, 5, 6]


def test_pagination(tiny):
    p1 = tiny.get("/api/search", params={"per_page": 3, "page": 1}).json()
    p3 = tiny.get("/api/search", params={"per_page": 3, "page": 3}).json()
    assert p1["total"] == 8 and p1["pages"] == 3
    assert len(p1["results"]) == 3 and len(p3["results"]) == 2


def test_unknown_note_in_all_mode_gives_no_results(tiny):
    r = tiny.get("/api/search", params={"include": "peach,unobtainium"}).json()
    assert r["total"] == 0 and r["unknown"] == ["unobtainium"]


def test_bad_layer_is_400(tiny):
    assert tiny.get("/api/search", params={"include": "peach@sideways"}).status_code == 400


# ---------------------------------------------------------------------------- similarity
def post_similar(client, notes, **kw):
    return client.post("/api/similar", json={"notes": notes, **kw}).json()


def test_same_layer_beats_adjacent_beats_distant(tiny):
    # A, B, C contain the same three notes; only peach's layer differs.
    r = post_similar(tiny, [{"slug": "peach", "layer": "top"}])
    order = [x["id"] for x in r["results"]]
    assert order.index(1) < order.index(3) < order.index(2)   # top(1.0) > middle(0.6) > base(0.4)
    by_id = {x["id"]: x for x in r["results"]}
    assert by_id[1]["score"] > by_id[3]["score"] > by_id[2]["score"]
    assert by_id[1]["explanation"][0]["kind"] == "exact"
    assert by_id[3]["explanation"][0]["kind"] == "adjacent"
    assert by_id[2]["explanation"][0]["kind"] == "distant"
    assert by_id[6]["explanation"][0]["kind"] == "loose"      # general-layer perfume
    ratio = by_id[3]["score"] / by_id[1]["score"]
    assert ratio == pytest.approx(0.6, abs=1e-3)


def test_any_layer_query_scores_all_layers_equally(tiny):
    r = post_similar(tiny, [{"slug": "peach", "layer": "any"}])
    by_id = {x["id"]: x["score"] for x in r["results"]}
    assert by_id[1] == pytest.approx(by_id[2]) == pytest.approx(by_id[3])


def test_idf_rare_notes_weigh_more(tiny):
    r = post_similar(tiny, [{"slug": "oud", "layer": "any"}, {"slug": "musk", "layer": "any"}])
    w = {e["slug"]: e["weight"] for e in r["results"][0]["explanation"]}
    assert w["oud"] > w["musk"]


def test_cosine_normalisation_penalises_big_pyramids(tiny):
    # E (2 notes) vs A (3 notes), both have peach on top: smaller pyramid wins
    r = post_similar(tiny, [{"slug": "peach", "layer": "top"}])
    by_id = {x["id"]: x["score"] for x in r["results"]}
    assert by_id[5] > by_id[1]


def test_perfume_is_most_similar_to_itself_tiny(tiny):
    for pid in TINY_PERFUMES:
        r = tiny.get(f"/api/perfumes/{pid}/similar", params={"include_self": True}).json()
        assert r["results"][0]["id"] == pid
        assert r["results"][0]["score"] == pytest.approx(1.0, abs=1e-4)
        assert r["results"][0]["relative"] == 1.0


def test_self_excluded_by_default(tiny):
    r = tiny.get("/api/perfumes/1/similar").json()
    assert 1 not in ids(r)
    assert r["source"]["id"] == 1
    # C holds the same notes with only peach moved one layer: it must be the nearest neighbour
    got = [x["id"] for x in r["results"]]
    assert got[0] == 3 and got.index(3) < got.index(2)


def test_perfume_is_most_similar_to_itself_fixture(fx):
    client, _ = fx
    all_ids = [p["id"] for p in client.get("/api/search", params={"per_page": 100}).json()["results"]]
    assert len(all_ids) >= 60
    for pid in all_ids:
        r = client.get(f"/api/perfumes/{pid}/similar", params={"include_self": True, "limit": 3}).json()
        assert r["results"][0]["id"] == pid, pid
        assert r["results"][0]["score"] == pytest.approx(1.0, abs=1e-4), pid
        assert r["results"][1]["score"] < 1.0


def test_pyramid_posted_as_query_finds_that_perfume_first(fx):
    client, _ = fx
    d = client.get("/api/perfumes", params={"q": "aventus"}).json()["results"][0]
    detail = client.get(f"/api/perfumes/{d['id']}").json()
    notes = [{"slug": n["slug"], "layer": layer} for layer in ("top", "middle", "base") for n in detail["pyramid"][layer]]
    r = post_similar(client, notes, limit=5)
    assert r["results"][0]["id"] == d["id"]
    assert r["results"][0]["score"] == pytest.approx(1.0, abs=1e-4)
    # explanation contributions add up to the score; every matched note is exact
    exp = r["results"][0]["explanation"]
    assert sum(e["contribution"] for e in exp) == pytest.approx(r["results"][0]["score"], abs=2e-3)
    assert all(e["kind"] == "exact" for e in exp)


def test_similar_filters_and_exclusions(tiny):
    r = post_similar(tiny, [{"slug": "peach", "layer": "any"}], exclude_ids=[1], filters={"gender": "women"})
    assert ids(r) == {2, 6}


def test_similar_unknown_and_bad_layer(tiny):
    r = post_similar(tiny, [{"slug": "peach", "layer": "top"}, {"slug": "nope", "layer": "top"}])
    assert r["unknown"] == ["nope"] and r["total"] > 0
    assert tiny.post("/api/similar", json={"notes": [{"slug": "peach", "layer": "sideways"}]}).status_code == 400


def test_similar_empty_query(tiny):
    r = post_similar(tiny, [])
    assert r["total"] == 0 and r["results"] == []


def test_similarity_constants_live_in_one_place():
    import similarity as s

    assert (s.SAME_LAYER, s.ADJACENT_LAYER, s.DISTANT_LAYER, s.ANY_OR_GENERAL) == (1.0, 0.6, 0.4, 0.5)
    assert s.LAYER_MATCH[s.TOP][s.BASE] == pytest.approx(0.4)
    assert s.LAYER_MATCH[s.MIDDLE][s.BASE] == pytest.approx(0.6)
    assert s.LAYER_MATCH[s.Q_ANY][s.BASE] == pytest.approx(0.5)


# ---------------------------------------------------------------------------- notes / perfumes / misc (fixture)
def test_notes_list_and_family_filter(fx):
    client, _ = fx
    r = client.get("/api/notes", params={"limit": 500}).json()
    assert r["total"] >= 100
    counts = [n["count"] for n in r["notes"]]
    assert counts == sorted(counts, reverse=True)
    fam = client.get("/api/notes", params={"family": "citrus", "limit": 500}).json()
    assert fam["total"] > 0 and {n["family"] for n in fam["notes"]} == {"citrus"}
    ac = client.get("/api/notes", params={"q": "berg"}).json()
    assert ac["notes"][0]["slug"] == "bergamot"
    assert any(f["name"] == "citrus" and f["color"].startswith("#") for f in ac["families"])


def test_note_detail_pairs_and_perfumes(fx):
    client, db = fx
    r = client.get("/api/notes/peach", params={"sort": "rating"}).json()
    con = sqlite3.connect(db)
    expected = con.execute(
        "SELECT COUNT(DISTINCT perfume_id) FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id WHERE n.slug='peach'"
    ).fetchone()[0]
    assert r["note"]["count"] == expected == r["perfumes"]["total"]
    assert r["pairs"] and all(p["slug"] != "peach" for p in r["pairs"])
    top = client.get("/api/notes/peach", params={"layer": "top"}).json()
    assert top["perfumes"]["total"] == r["note"]["layer_counts"]["top"]
    assert client.get("/api/notes/not-a-note").status_code == 404


def test_search_matches_sql_ground_truth_on_fixture(fx):
    client, db = fx
    con = sqlite3.connect(db)
    q = (
        "SELECT COUNT(*) FROM (SELECT perfume_id FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id "
        "WHERE n.slug IN ('jasmine','vanilla') GROUP BY perfume_id HAVING COUNT(DISTINCT n.slug)=2)"
    )
    assert client.get("/api/search", params={"include": "jasmine,vanilla"}).json()["total"] == con.execute(q).fetchone()[0]
    q_any = "SELECT COUNT(DISTINCT perfume_id) FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id WHERE n.slug IN ('jasmine','vanilla')"
    assert client.get("/api/search", params={"include": "jasmine,vanilla", "mode": "any"}).json()["total"] == con.execute(q_any).fetchone()[0]
    q_layer = (
        "SELECT COUNT(DISTINCT perfume_id) FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id "
        "WHERE n.slug='vanilla' AND pn.layer='base'"
    )
    assert client.get("/api/search", params={"include": "vanilla@base"}).json()["total"] == con.execute(q_layer).fetchone()[0]


def test_perfume_search_is_fuzzy(fx):
    client, _ = fx
    assert client.get("/api/perfumes", params={"q": "sauvage"}).json()["results"][0]["name"] == "Sauvage"
    assert client.get("/api/perfumes", params={"q": "sauvge"}).json()["results"][0]["name"] == "Sauvage"
    assert client.get("/api/perfumes", params={"q": "chanel bleu"}).json()["results"][0]["name"] == "Bleu de Chanel"
    assert client.get("/api/perfumes", params={"q": "zzzzzzqqq"}).json()["results"] == []


def test_perfume_detail_shape(fx):
    client, _ = fx
    pid = client.get("/api/perfumes", params={"q": "aventus"}).json()["results"][0]["id"]
    d = client.get(f"/api/perfumes/{pid}").json()
    assert d["brand"] == "Creed" and d["year"] == 2010
    assert d["pyramid"]["top"] and d["pyramid"]["base"]
    assert d["accords"][0]["color"].startswith("#")
    assert d["link"].startswith("https://www.fragrantica.com")
    assert client.get("/api/perfumes/99999999").status_code == 404


def test_resolve_note_names(fx):
    client, _ = fx
    m = client.post("/api/notes/resolve", json={"names": ["Bergamot", "pink pepper", "jasmin", "zzzz"]}).json()["matches"]
    assert [x["slug"] for x in m] == ["bergamot", "pink-pepper", "jasmine", None]


# ---------------------------------------------------------------------------- images
def test_note_and_perfume_placeholders(fx):
    client, _ = fx
    r = client.get("/img/note/peach")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg")
    assert "<svg" in r.text
    r = client.get("/img/perfume/1")
    assert r.headers["content-type"].startswith("image/svg") and "<svg" in r.text
    assert client.get("/img/note/nope").status_code == 404


def test_perfume_image_fetched_cached_then_served(tiny, tmp_path):
    cache = tiny.app.state.data_dir / "images" / "perfumes" / "1.jpg"
    assert not cache.exists()
    r = tiny.get("/img/perfume/1")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG_1PX
    assert cache.exists()
    r2 = tiny.get("/img/perfume/1")
    assert r2.content == PNG_1PX


def test_failed_remote_image_falls_back_to_svg(tiny):
    r = tiny.get("/img/perfume/2")   # remote 404
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg")
    r = tiny.get("/img/perfume/3")   # no image_url
    assert r.headers["content-type"].startswith("image/svg")


# ---------------------------------------------------------------------------- guard, static (favourites/accounts: test_accounts.py)
def test_host_guard(tiny):
    r = tiny.get("/api/notes", headers={"host": "evil.example.com"})
    assert r.status_code == 400
    assert tiny.get("/api/notes", headers={"host": "127.0.0.1:8765"}).status_code == 200
    assert tiny.get("/api/notes", headers={"host": "localhost"}).status_code == 200
    # the platform health check is exempt from the host list (it only exposes counts)
    assert tiny.get("/api/status", headers={"host": "evil.example.com"}).status_code == 200


def test_frontend_is_served(tiny):
    r = tiny.get("/")
    assert r.status_code == 200 and "Scent Atlas" in r.text
    assert tiny.get("/js/main.js").status_code == 200
