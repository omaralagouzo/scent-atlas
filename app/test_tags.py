"""Brand tags + dupe links: merge_tags validation, catalog bitmasks, filters / facets / sort, drawer data.

    cd app && python -m pytest test_tags.py -q

A 38-perfume catalog with 8 brands is built into SQLite, hand-made tagging files are merged with
pipeline/tagging/merge_tags.py and the real app is queried; expected sets are computed from the SQL tables.
"""
from __future__ import annotations

import json
import os
import random
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "pipeline" / "tagging"))
sys.path.insert(0, str(ROOT / "pipeline"))
os.environ["SCENT_SKIP_DEFAULT_APP"] = "1"
os.environ["SCENT_NO_FETCH"] = "1"
os.environ["ALLOWED_HOSTS"] = "127.0.0.1,localhost,testserver"

import make_fixture  # noqa: E402
import merge_tags  # noqa: E402
import query  # noqa: E402
import server  # noqa: E402
from catalog import BTAG_BITS, Catalog  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

H = {"X-Requested-With": "scent-atlas"}

# brand -> first perfume id, count
BRANDS = [("Aria", 1, 6), ("Bleu", 7, 6), ("Cloud", 13, 6), ("Dubai Oud", 19, 6), ("Emirates House", 25, 6),
          ("Fumo", 31, 4), ("Gold", 35, 2), ("Hamra", 37, 2)]
NOTES = ["Rose", "Oud", "Amber", "Musk", "Vanilla", "Cedar"]
BRAND_OF = {pid: b for b, a, n in BRANDS for pid in range(a, a + n)}


def build_master(path: Path):
    rnd = random.Random(3)
    con = sqlite3.connect(path)
    con.executescript(make_fixture.SCHEMA)
    con.executemany("INSERT INTO notes(id,slug,name,family,perfume_count) VALUES (?,?,?,?,0)",
                    [(i, n.lower(), n, "other") for i, n in enumerate(NOTES, 1)])
    for pid, brand in BRAND_OF.items():
        name = {1: "Aria Noir", 7: "Bleu Intense"}.get(pid, f"{brand.split()[0]} {pid:02d}")
        votes = 9000 - 150 * pid if pid in (1, 2, 7, 19, 20) else rnd.randint(10, 3000)
        con.execute("INSERT INTO perfumes(id,name,brand,year,gender,rating,rating_count,perfumers,accords) VALUES (?,?,?,?,?,?,?,?,?)",
                    (pid, name, brand, 2000 + pid % 20, "unisex", 4.0, votes, "[]",
                     json.dumps([{"name": "woody", "strength": 1.0}])))
        for layer in ("top", "middle", "base"):
            for nt in rnd.sample(range(1, len(NOTES) + 1), 2):
                con.execute("INSERT OR IGNORE INTO perfume_notes VALUES (?,?,?,?)", (pid, nt, layer, 0))
    con.commit()
    con.close()


def jl(path: Path, rows):
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")


def brand(b, tags, style=None, conf="high", **kw):
    return {"brand": b, "tags": tags, "dupe_style": style, "origin_country": kw.pop("origin_country", None),
            "parent_company": kw.pop("parent_company", None), "confidence": conf, "notes": kw.pop("notes", f"{b} notes"),
            "sources": kw.pop("sources", ["https://example.org/" + b.split()[0].lower()]), **kw}


def link(tid, conf="high", basis="web", name="", brand_="", sources=("https://example.org/s",)):
    return {"target_id": tid, "target_name": name, "target_brand": brand_, "confidence": conf, "basis": basis, "sources": list(sources)}


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    d = tmp_path_factory.mktemp("tags")
    db = d / "master.db"
    build_master(db)
    out = d / "out"
    out.mkdir()
    jl(out / "brand_tags_1.jsonl", [
        brand("Aria", ["niche"], origin_country="France"),
        brand("Bleu", ["designer"], parent_company="BigGroup"),
        brand("Cloud", ["dupe", "designer", "middle_eastern_dupe"], "partial"),            # dupe replaces designer; derived input ignored
        brand("Dubai Oud", ["dupe", "middle_eastern"], "open", origin_country="UAE"),
        brand("Emirates House", ["niche", "middle_eastern"], origin_country="UAE"),
        brand("gold", []),                                                                  # case repair -> "Gold"
        brand("Nowhere Brand", ["niche"]),                                                  # unknown brand: dropped
        brand("Bleu", ["designer", "niche"], conf="medium", notes="second Bleu row"),       # last writer wins; niche+designer -> designer
    ])
    jl(out / "brand_tags_longtail.jsonl", [
        brand("Hamra", ["dupe", "middle_eastern"], "unstated", conf="low", inferred=True, notes="heuristic"),
        brand("Aria", ["designer"], conf="low", inferred=True, notes="should lose to the researched row"),
        {"not": "a row"},
    ])
    (out / "broken.jsonl").write_text("{not json\n\n", encoding="utf8")
    jl(out / "perfume_dupes_1.jsonl", [
        {"perfume_id": 13, "dupe_of": [link(1), link(7, "medium", "community")], "is_original": False, "notes": "two originals"},
        {"perfume_id": 19, "dupe_of": [link(1, "high", "brand_stated")], "is_original": False, "notes": ""},
        {"perfume_id": 20, "dupe_of": [link(1, "medium", "name")], "is_original": False, "notes": ""},
        {"perfume_id": 21, "dupe_of": [link(7, "low", "name")], "is_original": False, "notes": ""},
        {"perfume_id": 22, "dupe_of": [link(2)], "is_original": False, "notes": ""},
        {"perfume_id": 14, "dupe_of": [link(19, "low", "name")], "is_original": False, "notes": "target is a dupe house, low: dropped"},
        {"perfume_id": 15, "dupe_of": [link(20, "high", "web")], "is_original": False, "notes": "dupe-house target kept with high"},
        {"perfume_id": 16, "dupe_of": [link(16)], "is_original": False, "notes": "self"},
        {"perfume_id": 17, "dupe_of": [link(13)], "is_original": False, "notes": "same brand"},
        {"perfume_id": 23, "dupe_of": [link(999, name="Aria Noir", brand_="Aria")], "is_original": False, "notes": "bad id, resolved by name"},
        {"perfume_id": 24, "dupe_of": [link(8, name="Aria Noir", brand_="Aria")], "is_original": False, "notes": "wrong id repaired"},
        {"perfume_id": 38, "dupe_of": [link(None, name="Does Not Exist", brand_="Aria")], "is_original": False, "notes": ""},
        {"perfume_id": 35, "dupe_of": [], "is_original": True, "notes": "gold original"},
        {"perfume_id": 2, "dupe_of": [], "is_original": True, "notes": "an original"},
        {"perfume_id": 26, "dupe_of": [link(7, "medium", "community")], "is_original": True, "notes": "contradiction"},
        {"perfume_id": 29, "dupe_of": [link(31, "high", "web")], "is_original": False, "notes": "two way, stronger"},
        {"perfume_id": 31, "dupe_of": [link(29, "medium", "community")], "is_original": False, "notes": "two way, weaker"},
        {"perfume_id": 5000, "dupe_of": [], "is_original": True},                           # unknown perfume
        {"perfume_id": 13, "dupe_of": [link(1), link(7, "medium", "community"), link(2, "low", "name")], "is_original": False,
         "notes": "last writer wins for 13"},
    ])
    result = merge_tags.merge(db, out, quiet=True)
    app = server.create_app(db_path=db, data_dir=d, fetch_images=False)
    return {"client": TestClient(app), "db": db, "out": out, "dir": d, "result": result, "app": app}


@pytest.fixture(scope="module")
def client(world):
    return world["client"]


@pytest.fixture(scope="module")
def con(world):
    c = sqlite3.connect(world["db"])
    c.row_factory = sqlite3.Row
    return c


def brand_tags_of(con):
    return {r["brand"]: json.loads(r["tags"]) for r in con.execute("SELECT brand, tags FROM brand_tags")}


def links_of(con):
    return {(r["perfume_id"], r["target_id"]): (r["confidence"], r["basis"], r["rank"])
            for r in con.execute("SELECT * FROM perfume_dupes")}


def all_ids(client, **params):
    ids, page = [], 1
    while True:
        r = client.get("/api/search", params={**params, "per_page": 200, "page": page, "facets": 0}).json()
        ids += [x["id"] for x in r["results"]]
        if page >= r["pages"]:
            return ids
        page += 1


def ids_of_brands(*names):
    return {pid for pid, b in BRAND_OF.items() if b in names}


# ------------------------------------------------------------------------------------------------ merge_tags
def test_brand_validation_and_derived_tags(con, world):
    tags = brand_tags_of(con)
    assert "Nowhere Brand" not in tags and "gold" not in tags
    assert tags["Gold"] == []                                          # repaired case, explicit empty tag list
    assert tags["Aria"] == ["niche"]                                   # researched row beats the inferred longtail row
    assert tags["Bleu"] == ["designer"]                                # last writer wins; niche + designer keeps the first
    assert tags["Cloud"] == ["dupe"]                                   # dupe replaces designer, derived input ignored
    assert tags["Dubai Oud"] == ["dupe", "middle_eastern", "middle_eastern_dupe"]
    assert tags["Emirates House"] == ["niche", "middle_eastern", "middle_eastern_original"]
    assert tags["Hamra"] == ["dupe", "middle_eastern", "middle_eastern_dupe"]
    assert "Fumo" not in tags                                          # never tagged
    row = con.execute("SELECT * FROM brand_tags WHERE brand='Bleu'").fetchone()
    assert row["notes"] == "second Bleu row" and row["confidence"] == "medium" and row["inferred"] == 0
    assert json.loads(row["sources"]) == ["https://example.org/bleu"]
    h = con.execute("SELECT * FROM brand_tags WHERE brand='Hamra'").fetchone()
    assert h["inferred"] == 1 and h["dupe_style"] == "unstated"
    assert con.execute("SELECT dupe_style FROM brand_tags WHERE brand='Aria'").fetchone()[0] is None
    st = world["result"]["stats"]
    assert st["brand_unknown_dropped"] == 1 and st["brand_name_repaired"] == 1 and st["bad_json_lines"] == 1


def test_dupe_link_validation(con):
    got = links_of(con)
    assert got[(13, 1)][:2] == ("high", "web") and got[(13, 7)][:2] == ("medium", "community")
    assert got[(13, 2)][:2] == ("low", "name")                         # last writer wins for perfume 13
    assert [got[(13, t)][2] for t in (1, 7, 2)] == [0, 1, 2]           # rank: confidence order
    assert (19, 1) in got and (20, 1) in got and (21, 7) in got and (22, 2) in got
    assert (14, 19) not in got                                         # low-confidence link to a dupe house dropped
    assert (15, 20) in got                                             # ... kept when high
    assert not any(p == t for p, t in got)                             # no self links
    assert (17, 13) not in got                                         # same brand
    assert (23, 1) in got and (24, 1) in got                           # resolved by name / repaired id
    assert not any(p == 38 for p, _ in got)                            # unresolvable target
    assert (29, 31) in got and (31, 29) not in got                     # two-way: stronger direction survives
    assert all(p != 5000 for p, _ in got)
    assert con.execute("SELECT COUNT(*) FROM perfume_dupes WHERE target_id NOT IN (SELECT id FROM perfumes)").fetchone()[0] == 0


def test_status_rows(con):
    s = {r["perfume_id"]: (r["is_original"], r["notes"]) for r in con.execute("SELECT * FROM perfume_dupe_status")}
    assert s[2] == (1, "an original") and s[35] == (1, "gold original")
    assert s[26][0] == 0                                               # is_original contradicted by its link
    assert s[13][0] == 0 and s[38][0] == 0 and 5000 not in s


def test_merge_is_idempotent(world):
    db = world["db"]
    c = sqlite3.connect(db)
    before = [c.execute(f"SELECT * FROM {t} ORDER BY 1,2").fetchall() for t in ("brand_tags", "perfume_dupes", "perfume_dupe_status")]
    c.close()
    merge_tags.merge(db, world["out"], quiet=True)
    c = sqlite3.connect(db)
    after = [c.execute(f"SELECT * FROM {t} ORDER BY 1,2").fetchall() for t in ("brand_tags", "perfume_dupes", "perfume_dupe_status")]
    assert before == after
    assert c.execute("SELECT name FROM sqlite_master WHERE name LIKE 'brand_tags%' OR name='perfume_dupes'").fetchall()


def test_coverage_stats(world, con):
    cov = world["result"]["coverage"]
    assert cov["brands_total"] == 8 and cov["brands_covered"] == 7 and cov["brands_inferred"] == 1
    assert cov["by_tag"]["dupe"]["brands"] == 3 and cov["by_tag"]["middle_eastern_dupe"]["perfumes"] == 8
    assert cov["perfumes_with_links"] == len({p for p, _ in links_of(con)})


# ------------------------------------------------------------------------------------------------ catalog
def test_catalog_bitmasks(world):
    cat = world["app"].state.cat
    assert cat.tags_loaded
    i = cat.idx_of(19)
    m = int(cat.p_btags[i])
    assert m & BTAG_BITS["dupe"] and m & BTAG_BITS["middle_eastern"] and m & BTAG_BITS["middle_eastern_dupe"]
    assert not m & BTAG_BITS["middle_eastern_original"] and not m & BTAG_BITS["niche"]
    j = cat.idx_of(25)
    assert int(cat.p_btags[j]) & BTAG_BITS["middle_eastern_original"]
    for pid in (31, 35):                                               # never tagged / tagged with []
        assert int(cat.p_btags[cat.idx_of(pid)]) & BTAG_BITS["untagged"]
    assert cat.p_btags.dtype.itemsize == 1
    assert cat.summary(i)["brand_tags"] == ["dupe", "middle_eastern", "middle_eastern_dupe"]
    assert "brand_tags" not in cat.summary(cat.idx_of(31))
    assert cat.summary(cat.idx_of(37)).get("brand_tags_inferred") is True


def test_reverse_links_match_forward(world, con):
    cat = world["app"].state.cat
    fwd = {(int(cat.p_id[i]), int(cat.p_id[t])) for i in range(cat.n_perf)
           for t in cat.dl_target[cat.dl_indptr[i]:cat.dl_indptr[i + 1]]}
    rev = {(int(cat.p_id[d]), int(cat.p_id[i])) for i in range(cat.n_perf)
           for d in cat.dr_perf[cat.dr_indptr[i]:cat.dr_indptr[i + 1]]}
    assert fwd == rev == set(links_of(con))
    # reverse order: confidence, then popularity
    i1 = cat.idx_of(1)
    order = [int(cat.p_id[d]) for d in cat.dr_perf[cat.dr_indptr[i1]:cat.dr_indptr[i1 + 1]]]
    assert order[0] in (13, 19) and set(order) == {13, 19, 20, 23, 24}
    confs = cat.dr_conf[cat.dr_indptr[i1]:cat.dr_indptr[i1 + 1]].tolist()
    assert confs == sorted(confs, reverse=True)
    assert int(cat.p_ndupes[i1]) == 5


# ------------------------------------------------------------------------------------------------ filters
def test_btags_or_within_selection(client, world):
    got = set(all_ids(client, btags="dupe~middle_eastern"))
    assert got == ids_of_brands("Cloud", "Dubai Oud", "Emirates House", "Hamra")
    assert set(all_ids(client, btags="dupe,middle_eastern")) == got        # comma works too
    assert set(all_ids(client, btags="middle_eastern_dupe")) == ids_of_brands("Dubai Oud", "Hamra")
    assert set(all_ids(client, btags="middle_eastern_original")) == ids_of_brands("Emirates House")
    assert set(all_ids(client, btags="niche")) == ids_of_brands("Aria", "Emirates House")
    assert set(all_ids(client, btags="untagged")) == ids_of_brands("Fumo", "Gold")


def test_btags_not_and_combination(client):
    assert set(all_ids(client, btags="middle_eastern", btags_not="dupe")) == ids_of_brands("Emirates House")
    everyone = set(BRAND_OF)
    assert set(all_ids(client, btags_not="dupe~untagged")) == everyone - ids_of_brands("Cloud", "Dubai Oud", "Hamra", "Fumo", "Gold")
    assert all_ids(client, btags="niche", btags_not="niche") == []            # exclusion wins
    r = client.get("/api/search", params={"btags": "nonsense~dupe"}).json()
    assert "nonsense" in r["query"]["unknown"] and r["total"] == len(ids_of_brands("Cloud", "Dubai Oud", "Hamra"))


def test_has_dupes_and_is_dupe(client, con):
    originals = {t for _, t in links_of(con)}
    dupes = {p for p, _ in links_of(con)}
    assert set(all_ids(client, has_dupes="1")) == originals
    assert set(all_ids(client, is_dupe="1")) == dupes
    assert set(all_ids(client, has_dupes="1", is_dupe="1")) == originals & dupes
    assert set(all_ids(client, is_dupe="1", btags="niche")) == {p for p in dupes if BRAND_OF[p] in ("Aria", "Emirates House")}
    # composes with note filters + brand filter
    assert set(all_ids(client, has_dupes="1", brands="Aria")) == originals & ids_of_brands("Aria")


def test_sort_dupes(client, con):
    r = client.get("/api/search", params={"sort": "dupes", "per_page": 5, "facets": 0}).json()
    assert r["results"][0]["id"] == 1 and r["results"][0]["n_dupes"] == 5
    counts = {}
    for _, t in links_of(con):
        counts[t] = counts.get(t, 0) + 1
    got = [x.get("n_dupes", 0) for x in client.get("/api/search", params={"sort": "dupes", "per_page": 200, "facets": 0}).json()["results"]]
    assert got == sorted(got, reverse=True)
    assert client.get("/api/search", params={"sort": "nope"}).status_code == 400


def test_brand_tags_facet(client):
    r = client.get("/api/search", params={"ff": 1, "per_page": 1}).json()["filter_facets"]
    items = {i["name"]: i for i in r["brand_tags"]["items"]}
    cat_counts = {"niche": 12, "designer": 6, "dupe": 14, "middle_eastern": 14, "middle_eastern_original": 6,
                  "middle_eastern_dupe": 8, "untagged": 6}
    assert {k: v["count"] for k, v in items.items()} == cat_counts
    assert items["dupe"]["label"] == "Dupe house" and r["brand_tags"]["available"]
    assert r["dupe_flags"]["has_dupes"]["count"] == 5 and r["dupe_flags"]["is_dupe"]["count"] > 0
    # counts leave the own group out: selecting dupe still shows niche's count within the other filters
    r2 = client.get("/api/search", params={"ff": 1, "per_page": 1, "btags": "dupe", "btags_not": "niche", "gender": "unisex"}).json()
    it = {i["name"]: i for i in r2["filter_facets"]["brand_tags"]["items"]}
    assert it["niche"]["selected"] == "exclude" and it["dupe"]["selected"] == "include"
    assert it["niche"]["count"] == 12 and it["dupe"]["count"] == 14
    # other facets honour the btags filter
    brands = {b["name"] for b in r2["filter_facets"]["brands"]["items"] if b["count"]}
    assert brands == {"Cloud", "Dubai Oud", "Hamra"}
    f = client.get("/api/search/facet", params={"facet": "brand_tags", "btags": "niche"}).json()
    assert [i["name"] for i in f["items"]][:3] == ["niche", "designer", "dupe"]


def test_filters_on_other_endpoints(client):
    r = client.get("/api/perfumes/1/similar", params={"btags": "dupe", "limit": 50}).json()
    assert r["results"] and all(BRAND_OF[x["id"]] in ("Cloud", "Dubai Oud", "Hamra") for x in r["results"])
    body = {"notes": [{"slug": "rose", "layer": "any"}, {"slug": "oud", "layer": "any"}], "filters": {"btags": "niche", "has_dupes": True}, "limit": 50}
    r = client.post("/api/similar", json=body).json()
    assert r["results"] and all(x["id"] in (1, 2) for x in r["results"])
    n = client.get("/api/notes/rose", params={"btags": "designer"}).json()["perfumes"]
    assert all(BRAND_OF[x["id"]] == "Bleu" for x in n["results"])


def test_saved_search_state_roundtrip(world):
    cat = world["app"].state.cat
    st = query.canonical_state(cat, {"q": "any:rose", "btags": "dupe,middle_eastern", "btags_not": "NICHE", "has_dupes": "1",
                                     "is_dupe": "true", "sort": "dupes", "btags_bogus": "x"})
    assert st["btags"] == "dupe~middle_eastern" and st["btags_not"] == "niche"
    assert st["has_dupes"] == "1" and st["is_dupe"] == "1" and st["sort"] == "dupes"
    assert query.canonical_state(cat, st) == st


# ------------------------------------------------------------------------------------------------ drawer data
def test_drawer_data_for_a_dupe(client):
    d = client.get("/api/perfumes/13").json()
    assert d["brand"] == "Cloud" and d["brand_tags"] == ["dupe"] and d["is_dupe"] is True
    assert [x["id"] for x in d["dupe_of"]] == [1, 7, 2]
    first = d["dupe_of"][0]
    assert first["confidence"] == "high" and first["basis"] == "web" and first["basis_label"] == "web-verified"
    assert first["sources"] == ["https://example.org/s"] and first["name"] == "Aria Noir" and "image" in first
    assert first["brand_tags"] == ["niche"]
    assert d["brand_info"]["tags"] == ["dupe"] and d["brand_info"]["dupe_style"] == "partial"
    assert d["dupes"] == [] and d["dupes_total"] == 0
    assert d["dupe_status"] == {"researched": True, "is_original": False, "notes": "last writer wins for 13"}


def test_drawer_data_for_an_original(client):
    d = client.get("/api/perfumes/1").json()
    assert d["dupe_of"] == [] and d["dupes_total"] == 5 and d["n_dupes"] == 5
    assert d["dupes_counts"] == {"high": 4, "medium": 1, "low": 0}
    confs = [x["confidence"] for x in d["dupes"]]
    order = {"high": 0, "medium": 1, "low": 2}
    assert confs == sorted(confs, key=order.get)
    assert {x["id"] for x in d["dupes"]} == {13, 19, 20, 23, 24}
    assert all(x["brand_tags"] for x in d["dupes"])
    assert d["brand_info"]["origin_country"] == "France" and d["brand_tags"] == ["niche"]
    assert client.get("/api/perfumes/2").json()["dupe_status"] == {"researched": True, "is_original": True, "notes": "an original"}
    plain = client.get("/api/perfumes/32").json()
    assert plain["dupe_of"] == [] and plain["dupes"] == [] and plain["dupe_status"]["researched"] is False
    assert plain["brand_tags"] == [] and plain["brand_info"]["tagged"] is False


def test_dupes_paging_endpoint(client):
    r = client.get("/api/perfumes/1/dupes", params={"limit": 2, "offset": 2}).json()
    assert r["total"] == 5 and len(r["items"]) == 2
    assert client.get("/api/perfumes/99999/dupes").status_code == 404


def test_compare_endpoint(client):
    r = client.get("/api/perfumes/1/compare/13").json()
    assert r["a"]["id"] == 1 and r["b"]["id"] == 13 and set(r["a"]["pyramid"]) == {"top", "middle", "base", "general"}
    both = {n["slug"] for L in r["a"]["pyramid"].values() for n in L} & {n["slug"] for L in r["b"]["pyramid"].values() for n in L}
    assert set(r["shared"]) == both and 0 <= r["score"] <= 1
    assert r["link"] == {"relation": "dupe", "confidence": "high", "basis": "web", "basis_label": "web-verified"}
    me = client.get("/api/perfumes/1/similar", params={"limit": 200, "include_self": "true"}).json()
    got = {x["id"]: x["score"] for x in me["results"]}
    assert abs(got[13] - r["score"]) < 1e-3                                 # same number as the smells-like page
    assert client.get("/api/perfumes/1/compare/31").json()["link"] is None
    assert client.get("/api/perfumes/1/compare/99999").status_code == 404


def test_similar_only_dupes_and_dupe_link(client):
    r = client.get("/api/perfumes/1/similar", params={"only_dupes": "1", "limit": 200}).json()
    ids = {x["id"] for x in r["results"]}
    expect = {13, 19, 20, 23, 24} | ids_of_brands("Cloud", "Dubai Oud", "Hamra")
    assert ids <= expect - {1} and {13, 19, 20, 23, 24} & ids
    links = {x["id"]: x["dupe_link"] for x in r["results"] if "dupe_link" in x}
    assert links[13]["relation"] == "dupe" and links[13]["confidence"] == "high"
    plain = client.get("/api/perfumes/1/similar", params={"limit": 200}).json()
    assert len(plain["results"]) >= len(r["results"])
    # a dupe: its originals show up as "original"
    r13 = client.get("/api/perfumes/13/similar", params={"only_dupes": "1", "limit": 200}).json()
    rel = {x["id"]: x["dupe_link"]["relation"] for x in r13["results"] if "dupe_link" in x}
    assert rel.get(1) == "original"
    f = client.get("/api/perfumes/1/similar/facet", params={"facet": "brand", "only_dupes": "1"}).json()
    assert {i["name"] for i in f["items"]} <= {"Cloud", "Dubai Oud", "Hamra"}


def test_brand_info_endpoint(client):
    d = client.get("/api/brands/info", params={"name": "Dubai Oud"}).json()
    assert d["tags"] == ["dupe", "middle_eastern", "middle_eastern_dupe"] and d["origin_country"] == "UAE"
    assert d["dupe_style"] == "open" and d["count"] == 6 and d["sources"] and d["tagged"] is True
    assert client.get("/api/brands/info", params={"name": "dubai oud"}).json()["name"] == "Dubai Oud"
    assert client.get("/api/brands/info", params={"name": "Hamra"}).json()["inferred"] is True
    assert client.get("/api/brands/info", params={"name": "Fumo"}).json()["tagged"] is False
    assert client.get("/api/brands/info", params={"name": "Nope"}).status_code == 404
    st = client.get("/api/status").json()
    assert st["brand_tags"] is True and st["dupe_links"] > 0


def test_catalog_without_tag_tables_still_works(tmp_path):
    db = tmp_path / "plain.db"
    build_master(db)
    c = Catalog(db)
    assert not c.tags_loaded and int(c.p_btags.sum()) == 0 and len(c.dl_target) == 0
    d = c.detail(0)
    assert d["brand_tags"] == [] and d["dupe_of"] == [] and d["dupes"] == []
    app = server.create_app(db_path=db, data_dir=tmp_path, fetch_images=False)
    r = TestClient(app).get("/api/search", params={"ff": 1, "per_page": 1}).json()
    assert r["filter_facets"]["brand_tags"]["available"] is False


# ------------------------------------------------------------------------------------------------ deploy DB
def test_deploy_db_carries_tag_tables(world, con, tmp_path):
    import make_deploy_db

    src = world["db"]
    out = tmp_path / "deploy"
    # the fixture note table has no source urls; the deploy builder only needs the columns of the real master schema
    info = make_deploy_db.build(src, out, max_mb=50)
    assert info["counts"]["brand_tags"] == 7 and info["counts"]["perfume_dupes"] == len(links_of(con))
    assert info["counts"]["perfume_dupe_status"] > 0
    a, b = Catalog(src), Catalog(out / "catalog.db")
    assert (a.p_btags == b.p_btags).all()
    assert (a.dl_target == b.dl_target).all() and (a.dr_perf == b.dr_perf).all() and (a.p_dstatus == b.p_dstatus).all()
    d = b.detail(b.idx_of(13))
    assert [x["id"] for x in d["dupe_of"]] == [1, 7, 2] and d["dupe_of"][0]["sources"]
    assert b.brand_info("Dubai Oud")["sources"]
