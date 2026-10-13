"""Advanced note queries, filters, facets, sorting.   cd app && python -m pytest test_query.py -q

A seeded synthetic catalog (500 perfumes, 24 notes incl. "tea"/"amber" word families, ~25% flat-list perfumes,
unknown years, perfumers on ~40%) is built into SQLite; the expected sets are computed straight from SQL / the
generated rows, independently of the numpy code under test.
"""
from __future__ import annotations

import json
import os
import random
import re
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ["SCENT_SKIP_DEFAULT_APP"] = "1"
os.environ["SCENT_NO_FETCH"] = "1"
os.environ["ALLOWED_HOSTS"] = "127.0.0.1,localhost,testserver"

import make_fixture  # noqa: E402
import query  # noqa: E402
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

H = {"X-Requested-With": "scent-atlas"}
NOTES = ["Tea", "Green Tea", "White Tea", "Tea Leaf", "Mint", "Rose", "White Rose", "Lily", "Amber", "White Amber",
         "Black Amber", "Amber Wood", "Ambergris", "Ambrette", "Oud", "Vetiver", "Musk", "Vanilla", "Jasmine",
         "Bergamot", "Cedar", "Iris", "Teak", "Steam"]            # "Teak"/"Steam" must NOT match the word "tea"
BRANDS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu"]
PERFUMERS = ["Anne Flipo", "Jacques Polge", "Dominique Ropion", "Alberto Morillas", "Francis Kurkdjian",
             "Olivier Cresp", "Christine Nagel", "Jean-Claude Ellena"]
COUNTRIES = ["France", "Italy", "USA", "UK"]
ACCORDS = ["fresh", "woody", "floral", "amber", "sweet", "citrus", "musky", "green"]
LAYERS = ["top", "middle", "base"]
N = 500


def slug(n):
    return n.lower().replace(" ", "-")


def build_db(path: Path):
    rnd = random.Random(7)
    con = sqlite3.connect(path)
    con.executescript(make_fixture.SCHEMA)
    nid = {n: i for i, n in enumerate(NOTES, 1)}
    con.executemany("INSERT INTO notes(id,slug,name,family,perfume_count) VALUES (?,?,?,?,0)",
                    [(i, slug(n), n, "other") for n, i in nid.items()])
    for pid in range(1, N + 1):
        year = None if rnd.random() < 0.2 else rnd.randint(1980, 2024)
        gender = rnd.choice(["women", "men", "unisex", None])
        country = None if rnd.random() < 0.5 else rnd.choice(COUNTRIES)
        votes = rnd.randint(0, 5000)
        rating = round(rnd.uniform(2.5, 4.8), 2) if votes else None
        pf = rnd.sample(PERFUMERS, rnd.randint(1, 2)) if rnd.random() < 0.4 else []
        acc = [{"name": a, "strength": round(1 - 0.15 * k, 2)} for k, a in enumerate(rnd.sample(ACCORDS, rnd.randint(1, 5)))]
        con.execute(
            "INSERT INTO perfumes(id,name,brand,year,gender,country,rating,rating_count,perfumers,accords) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pid, f"Scent {pid:03d} {rnd.choice(['Noir', 'Blanc', 'Rouge', 'Dream'])}", rnd.choice(BRANDS), year, gender, country,
             rating, votes, json.dumps(pf), json.dumps(acc)))
        kind = rnd.random()
        rows = set()
        if kind < 0.25:
            for n in rnd.sample(NOTES, rnd.randint(2, 6)):
                rows.add((pid, nid[n], "general"))
        elif kind < 0.95:
            for layer in LAYERS:
                for n in rnd.sample(NOTES, rnd.randint(0, 3)):
                    rows.add((pid, nid[n], layer))
            if not rows:
                rows.add((pid, nid[rnd.choice(NOTES)], "base"))
        for pos, r in enumerate(sorted(rows)):
            con.execute("INSERT INTO perfume_notes VALUES (?,?,?,?)", (*r, pos))
    con.commit()
    con.close()
    return path


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    d = tmp_path_factory.mktemp("qdb")
    db = build_db(d / "q.db")
    app = server.create_app(db_path=db, data_dir=d, fetch_images=False)
    return TestClient(app), db, app


@pytest.fixture(scope="module")
def client(world):
    return world[0]


@pytest.fixture(scope="module")
def con(world):
    c = sqlite3.connect(world[1])
    c.row_factory = sqlite3.Row
    return c


def all_ids(client, **params):
    """Every result id of a /api/search query (pages through), plus the total."""
    ids, page = [], 1
    while True:
        r = client.get("/api/search", params={**params, "per_page": 200, "page": page, "facets": 0}).json()
        ids += [x["id"] for x in r["results"]]
        if page >= r["pages"]:
            return ids, r["total"]
        page += 1


# ---------------------------------------------------------------------------------------- ground truth
def words(slugs_with_star, con):
    """Expected note slugs for 'tea*'-style tokens, using a regex whole-word test on the display name."""
    out = set()
    for tok in slugs_with_star:
        s = tok.rstrip("*")
        if tok.endswith("*"):
            name = con.execute("SELECT name FROM notes WHERE slug=?", (s,)).fetchone()[0].lower()
            pat = re.compile(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])")
            out |= {r["slug"] for r in con.execute("SELECT slug,name FROM notes") if pat.search(r["name"].lower())}
        else:
            out.add(s)
    return out


def sql_clause(con, tokens, layer, gen):
    slugs = words(tokens, con)
    marks = ",".join("?" * len(slugs))
    base = f"SELECT DISTINCT pn.perfume_id FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id WHERE n.slug IN ({marks})"
    if layer == "any":
        return {r[0] for r in con.execute(base, tuple(slugs))}
    got = {r[0] for r in con.execute(base + " AND pn.layer=?", (*slugs, layer))}
    if gen:
        got |= {r[0] for r in con.execute(
            base + " AND pn.layer='general' AND pn.perfume_id NOT IN (SELECT perfume_id FROM perfume_notes WHERE layer!='general')",
            tuple(slugs))}
    return got


def sql_query(con, clauses, exclude=(), gen=True):
    res = {r[0] for r in con.execute("SELECT id FROM perfumes")}
    for layer, tokens in clauses:
        res &= sql_clause(con, tokens, layer, gen)
    if exclude:
        res -= sql_clause(con, list(exclude), "any", gen)
    return res


def q_param(clauses):
    return "~".join(f"{layer}:{','.join(tokens)}" for layer, tokens in clauses)


# ---------------------------------------------------------------------------------------- clause semantics
def test_and_or_example_from_the_brief(client, con):
    clauses = [("top", ["tea", "mint"]), ("middle", ["rose", "lily"]), ("base", ["amber"])]
    ids, total = all_ids(client, q=q_param(clauses))
    assert total == len(ids) == len(set(ids))
    assert set(ids) == sql_query(con, clauses)
    assert total > 0
    # OR inside a clause is a union, AND across clauses an intersection
    a, _ = all_ids(client, q="top:tea")
    b, _ = all_ids(client, q="top:mint")
    ab, _ = all_ids(client, q="top:tea,mint")
    assert set(ab) == set(a) | set(b)
    c, _ = all_ids(client, q="middle:rose")
    both, _ = all_ids(client, q="top:tea~middle:rose")
    assert set(both) == set(a) & set(c)


def test_random_queries_match_sql(client, con):
    rnd = random.Random(11)
    slugs = [slug(n) for n in NOTES]
    for _ in range(60):
        clauses = []
        for _c in range(rnd.randint(1, 3)):
            toks = [s + ("*" if rnd.random() < 0.3 else "") for s in rnd.sample(slugs, rnd.randint(1, 3))]
            clauses.append((rnd.choice(["top", "middle", "base", "any"]), toks))
        exc = [s + ("*" if rnd.random() < 0.3 else "") for s in rnd.sample(slugs, rnd.randint(0, 2))]
        gen = rnd.random() < 0.7
        params = {"q": q_param(clauses), "gen": int(gen)}
        if exc:
            params["x"] = ",".join(exc)
        ids, total = all_ids(client, **params)
        assert set(ids) == sql_query(con, clauses, exc, gen), params
        assert total == len(ids)


def test_layer_semantics_and_general_toggle(client, con):
    flat = {r[0] for r in con.execute(
        "SELECT DISTINCT perfume_id FROM perfume_notes WHERE perfume_id NOT IN (SELECT perfume_id FROM perfume_notes WHERE layer!='general')")}
    assert len(flat) > 80                                   # ~25% of the catalogue are flat lists
    with_flat, _ = all_ids(client, q="base:musk", gen=1)
    without, _ = all_ids(client, q="base:musk", gen=0)
    anyl, _ = all_ids(client, q="any:musk")
    assert set(without) < set(with_flat) <= set(anyl)
    assert set(with_flat) - set(without) <= flat and set(with_flat) - set(without)
    assert not (set(without) & flat - {r[0] for r in con.execute(
        "SELECT perfume_id FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id WHERE n.slug='musk' AND layer='base'")})
    # the toggle is on by default for advanced queries
    default, _ = all_ids(client, q="base:musk")
    assert set(default) == set(with_flat)
    # "any" layer never needs the toggle
    assert set(all_ids(client, q="any:musk", gen=0)[0]) == set(anyl)


def test_variant_expansion_is_whole_word(client, con):
    r = client.get("/api/notes/tea/variants").json()
    assert {n["slug"] for n in r["notes"]} == {"tea", "green-tea", "white-tea", "tea-leaf"}   # not Teak
    assert r["notes"][0]["slug"] == "tea" and r["count"] == 4
    r = client.get("/api/notes/amber/variants").json()
    assert {n["slug"] for n in r["notes"]} == {"amber", "white-amber", "black-amber", "amber-wood"}   # not Ambergris/Ambrette
    assert client.get("/api/notes/nope/variants").status_code == 404
    # searching with the star equals the OR of the expanded notes, and is larger than the plain note
    plain, _ = all_ids(client, q="any:amber")
    star, _ = all_ids(client, q="any:amber*")
    expanded, _ = all_ids(client, q="any:amber,white-amber,black-amber,amber-wood")
    assert set(star) == set(expanded) and set(plain) < set(star)
    echo = client.get("/api/search", params={"q": "any:amber*,rose"}).json()["query"]
    assert echo["clauses"][0]["notes"][0] == {"slug": "amber", "name": "Amber", "variants": True, "expands": 4}
    assert echo["clauses"][0]["notes"][1]["variants"] is False


def test_exclude_with_and_without_variants(client, con):
    base, _ = all_ids(client, q="any:rose")
    ex, _ = all_ids(client, q="any:rose", x="amber")
    ex_v, _ = all_ids(client, q="any:rose", x="amber*")
    amber = sql_clause(con, ["amber"], "any", True)
    amber_v = sql_clause(con, ["amber*"], "any", True)
    assert set(ex) == set(base) - amber and set(ex_v) == set(base) - amber_v
    assert len(ex_v) < len(ex) < len(base)


def test_simple_mode_still_works_and_matches_the_same_engine(client, con):
    ids, _ = all_ids(client, include="tea,mint", mode="all")
    assert set(ids) == sql_query(con, [("any", ["tea"]), ("any", ["mint"])], gen=False)
    ids, _ = all_ids(client, include="tea,mint", mode="any")
    assert set(ids) == sql_clause(con, ["tea", "mint"], "any", False)
    ids, _ = all_ids(client, include="tea@top", exclude="mint")
    assert set(ids) == sql_clause(con, ["tea"], "top", False) - sql_clause(con, ["mint"], "any", False)   # gen off in simple mode
    r = client.get("/api/search", params={"include": "tea,zzz", "mode": "all"}).json()
    assert r["total"] == 0 and r["unknown"] == ["zzz"]
    assert client.get("/api/search", params={"q": "sideways:tea"}).status_code == 400
    assert client.get("/api/search", params={"q": "tea", "sort": "bogus"}).status_code == 400
    assert client.get("/api/search", params={"year_min": "abc"}).status_code == 400


def test_unknown_notes_in_advanced_clause(client):
    r = client.get("/api/search", params={"q": "top:nope~base:musk"}).json()
    assert r["total"] == 0 and "nope" in r["unknown"]
    r2 = client.get("/api/search", params={"q": "top:nope,tea"}).json()
    assert r2["total"] > 0 and r2["unknown"] == ["nope"]


# ---------------------------------------------------------------------------------------- filters
def rows(con):
    return {r["id"]: r for r in con.execute("SELECT * FROM perfumes")}


def matching(con, pred, q="any:tea,mint,rose,musk,vanilla,iris"):
    base = sql_clause(con, ["tea", "mint", "rose", "musk", "vanilla", "iris"], "any", True)
    rs = rows(con)
    return {i for i in base if pred(rs[i])}


Q = "any:tea,mint,rose,musk,vanilla,iris"


def test_year_range_and_unknown(client, con):
    ids, _ = all_ids(client, q=Q, year_min=1995, year_max=2010)
    assert set(ids) == matching(con, lambda r: r["year"] is not None and 1995 <= r["year"] <= 2010)
    ids, _ = all_ids(client, q=Q, year_min=1995, year_max=2010, year_unknown=1)
    assert set(ids) == matching(con, lambda r: r["year"] is None or 1995 <= r["year"] <= 2010)
    ids, _ = all_ids(client, q=Q, year_min=2015)
    assert set(ids) == matching(con, lambda r: r["year"] is not None and r["year"] >= 2015)
    ids, _ = all_ids(client, q=Q, year_max=1990, year_unknown="1")
    assert set(ids) == matching(con, lambda r: r["year"] is None or r["year"] <= 1990)
    # "unknown" alone without a range is a no-op
    assert all_ids(client, q=Q, year_unknown=1)[1] == all_ids(client, q=Q)[1]


def test_brand_multi_select_and_legacy_text(client, con):
    ids, _ = all_ids(client, q=Q, brands="Alpha~Gamma")
    assert set(ids) == matching(con, lambda r: r["brand"] in ("Alpha", "Gamma"))
    ids, _ = all_ids(client, q=Q, brands="alpha~NOPE")        # case-insensitive, unknown names ignored
    assert set(ids) == matching(con, lambda r: r["brand"] == "Alpha")
    ids, _ = all_ids(client, include="tea", brand="alp")       # old free-text brand still works
    assert set(ids) == sql_clause(con, ["tea"], "any", False) & {i for i, r in rows(con).items() if r["brand"] == "Alpha"}


def test_perfumer_multi_select(client, con):
    def has(r, *names):
        return bool(set(json.loads(r["perfumers"])) & set(names))
    ids, _ = all_ids(client, q=Q, perfumers="Anne Flipo~Jacques Polge")
    assert set(ids) == matching(con, lambda r: has(r, "Anne Flipo", "Jacques Polge"))
    assert ids and len(ids) < all_ids(client, q=Q)[1]


def test_accord_gender_country_rating_votes_name(client, con):
    def accs(r, main=False):
        a = json.loads(r["accords"])
        return {x["name"] for x in (a[:3] if main else a)}
    ids, _ = all_ids(client, q=Q, accords="fresh~woody")                  # all of them
    assert set(ids) == matching(con, lambda r: {"fresh", "woody"} <= accs(r))
    ids, _ = all_ids(client, q=Q, accords="fresh~woody", acc_any=1)
    assert set(ids) == matching(con, lambda r: bool({"fresh", "woody"} & accs(r)))
    ids, _ = all_ids(client, q=Q, accords="fresh", acc_main=1)
    assert set(ids) == matching(con, lambda r: "fresh" in accs(r, True))
    ids, _ = all_ids(client, q=Q, gender="women,men")
    assert set(ids) == matching(con, lambda r: r["gender"] in ("women", "men"))
    ids, _ = all_ids(client, q=Q, countries="France~UK")
    assert set(ids) == matching(con, lambda r: r["country"] in ("France", "UK"))
    ids, _ = all_ids(client, q=Q, rating_min=4, votes_min=1000)
    assert set(ids) == matching(con, lambda r: (r["rating"] or 0) >= 4 and r["rating_count"] >= 1000)
    ids, _ = all_ids(client, q=Q, name="scent 01")
    assert set(ids) == matching(con, lambda r: "scent" in r["name"].lower() and "01" in r["name"].lower())
    ids, _ = all_ids(client, q=Q, name="noir alpha")      # brand + name text, order-independent
    assert set(ids) == matching(con, lambda r: "noir" in r["name"].lower() and r["brand"] == "Alpha")


def test_must_and_must_not_refinements(client, con):
    base, _ = all_ids(client, q="any:rose")
    ids, _ = all_ids(client, q="any:rose", must="musk,amber*")
    assert set(ids) == set(base) & sql_clause(con, ["musk"], "any", 0) & sql_clause(con, ["amber*"], "any", 0)
    ids, _ = all_ids(client, q="any:rose", **{"not": "oud,vetiver"})
    assert set(ids) == set(base) - sql_clause(con, ["oud", "vetiver"], "any", 0)


def test_combined_filters(client, con):
    ids, _ = all_ids(client, q="top:tea*,mint~base:amber*", brands="Alpha~Beta~Gamma~Delta", year_min=1990, gender="women,unisex",
                     rating_min=3)
    exp = sql_query(con, [("top", ["tea*", "mint"]), ("base", ["amber*"])])
    rs = rows(con)
    exp = {i for i in exp if rs[i]["brand"] in ("Alpha", "Beta", "Gamma", "Delta") and (rs[i]["year"] or 0) >= 1990
           and rs[i]["gender"] in ("women", "unisex") and (rs[i]["rating"] or 0) >= 3}
    assert set(ids) == exp


# ---------------------------------------------------------------------------------------- sorting
def test_sort_orders(client, con):
    rs = rows(con)

    def order(sort, **kw):
        out, page = [], 1
        while True:
            r = client.get("/api/search", params={"q": Q, "sort": sort, "per_page": 50, "page": page, "facets": 0, **kw}).json()
            out += [x["id"] for x in r["results"]]
            if page >= r["pages"]:
                return out
            page += 1

    pop = order("popularity")
    assert [rs[i]["rating_count"] for i in pop] == sorted((rs[i]["rating_count"] for i in pop), reverse=True)
    newest = order("year")
    ys = [rs[i]["year"] for i in newest]
    known = [y for y in ys if y is not None]
    assert known == sorted(known, reverse=True) and ys[len(known):] == [None] * (len(ys) - len(known))   # unknown last
    oldest = order("year_asc")
    ys = [rs[i]["year"] for i in oldest]
    known = [y for y in ys if y is not None]
    assert known == sorted(known) and ys[len(known):] == [None] * (len(ys) - len(known))
    byname = order("name")
    assert [rs[i]["name"].lower() for i in byname] == sorted(rs[i]["name"].lower() for i in byname)
    bybrand = order("brand")
    bs = [rs[i]["brand"] for i in bybrand]
    assert bs == sorted(bs)
    rating = order("rating")
    rated = [r["rating"] for r in rs.values() if r["rating"]]
    c_mean = sum(rated) / len(rated)

    def weighted(i):                       # the existing vote-weighted rating (m = 25)
        r, v = rs[i]["rating"] or 0, rs[i]["rating_count"] or 0
        return (v / (v + 25)) * r + (25 / (v + 25)) * c_mean if r > 0 else 0.0
    ws = [round(weighted(i), 3) for i in rating]
    assert ws == sorted(ws, reverse=True)
    # same ids whatever the sort; paging is stable (no duplicates / gaps)
    for s in (newest, oldest, byname, bybrand, rating, pop, order("matches")):
        assert len(s) == len(set(s)) == len(pop) and set(s) == set(pop)


def test_sort_by_matches_counts_matched_notes(client, con):
    r = client.get("/api/search", params={"q": "any:tea,mint,rose~any:musk,vanilla", "sort": "matches", "per_page": 200, "facets": 0}).json()
    counts = [len(x["matched"]) for x in r["results"]]
    assert counts == sorted(counts, reverse=True) and counts[0] >= 3
    first = r["results"][0]
    exp = {s for s in ("tea", "mint", "rose", "musk", "vanilla")
           if s in {row[0] for row in con.execute(
               "SELECT n.slug FROM perfume_notes pn JOIN notes n ON n.id=pn.note_id WHERE pn.perfume_id=?", (first["id"],))}}
    assert set(first["matched"]) == exp


# ---------------------------------------------------------------------------------------- facets
def ff(client, **params):
    return client.get("/api/search", params={**params, "ff": 1, "per_page": 1, "facets": 0, "ff_limit": 50}).json()


def test_facet_counts_equal_filtered_totals(client):
    base = {"q": "top:tea*,mint~base:amber*", "year_min": 1990, "gender": "women,unisex"}
    r = ff(client, **base, brands="Alpha~Beta", countries="France")
    f = r["filter_facets"]
    total_of = lambda **extra: client.get("/api/search", params={**base, "per_page": 1, "facets": 0, **extra}).json()["total"]  # noqa: E731
    # brand facet: other filters (country) apply, the brand filter itself does not
    assert f["brands"]["items"]
    for it in f["brands"]["items"]:
        assert it["count"] == total_of(countries="France", brands=it["name"]), it
    # country facet ignores the country filter but respects brands
    for it in f["countries"]["items"]:
        assert it["count"] == total_of(brands="Alpha~Beta", countries=it["name"]), it
    for it in f["genders"]["items"]:
        extra = {k: v for k, v in base.items() if k != "gender"}
        n = client.get("/api/search", params={**extra, "gender": it["name"], "brands": "Alpha~Beta", "countries": "France",
                                              "per_page": 1, "facets": 0}).json()["total"]
        assert it["count"] == n
    for it in f["perfumers"]["items"]:
        assert it["count"] == total_of(brands="Alpha~Beta", countries="France", perfumers=it["name"]), it
    # accords (none selected yet): counts = totals when that accord is required
    for it in f["accords"]["items"]:
        assert it["count"] == total_of(brands="Alpha~Beta", countries="France", accords=it["name"]), it
    # year histogram sums to the result set without the year filter
    y = f["years"]
    no_year = {k: v for k, v in base.items() if k != "year_min"}
    n = client.get("/api/search", params={**no_year, "brands": "Alpha~Beta", "countries": "France", "per_page": 1, "facets": 0}).json()["total"]
    assert sum(y["counts"]) + y["before"] + y["unknown"] == n


def test_accord_facet_with_selected_accords(client):
    # AND-mode accords: counts are what you would get by adding that accord to the selection
    base = {"q": "any:tea,mint,rose,musk"}
    f = ff(client, **base, accords="fresh")["filter_facets"]["accords"]["items"]
    for it in f:
        want = client.get("/api/search", params={**base, "accords": "fresh~" + it["name"] if it["name"] != "fresh" else "fresh",
                                                  "per_page": 1, "facets": 0}).json()["total"]
        assert it["count"] == want, it
    # OR-mode: own filter excluded
    f = ff(client, **base, accords="fresh", acc_any=1)["filter_facets"]["accords"]["items"]
    for it in f:
        want = client.get("/api/search", params={**base, "accords": it["name"], "per_page": 1, "facets": 0}).json()["total"]
        assert it["count"] == want, it


def test_facets_selected_values_pinned_and_sorted(client):
    r = ff(client, q=Q, brands="Mu")
    items = r["filter_facets"]["brands"]["items"]
    assert items[0]["name"] == "Mu" and items[0]["selected"] is True
    rest = [i["count"] for i in items[1:]]
    assert rest == sorted(rest, reverse=True)
    pf = r["filter_facets"]["perfumers"]
    assert pf["coverage"]["with"] < pf["coverage"]["all"]          # perfumers exist for only some perfumes


def test_facet_endpoint_search_beyond_top_n(client):
    top = client.get("/api/search/facet", params={"q": Q, "facet": "brand", "limit": 3}).json()
    assert len(top["items"]) == 3 and top["total"] == 12
    page2 = client.get("/api/search/facet", params={"q": Q, "facet": "brand", "limit": 3, "offset": 3}).json()
    assert not ({i["name"] for i in top["items"]} & {i["name"] for i in page2["items"]})
    hit = client.get("/api/search/facet", params={"q": Q, "facet": "brand", "fq": "lamb"}).json()
    assert [i["name"] for i in hit["items"]] == ["Lambda"]
    pf = client.get("/api/search/facet", params={"q": Q, "facet": "perfumer", "fq": "flip"}).json()
    assert [i["name"] for i in pf["items"]] == ["Anne Flipo"]
    notes = client.get("/api/search/facet", params={"q": "any:tea", "facet": "note", "fq": "rose"}).json()
    assert {n["slug"] for n in notes["items"]} <= {"rose", "white-rose"} and notes["items"]
    assert "tea" not in {n["slug"] for n in client.get("/api/search/facet", params={"q": "any:tea", "facet": "note", "limit": 100}).json()["items"]}
    assert client.get("/api/search/facet", params={"q": Q, "facet": "year"}).json()["lo"] == 1900
    assert client.get("/api/search/facet", params={"q": Q, "facet": "bogus"}).status_code == 400


def test_cooccurring_note_suggestions_still_returned(client):
    r = client.get("/api/search", params={"q": "top:tea*"}).json()
    slugs = {f["slug"] for f in r["facets"]}
    assert slugs and not (slugs & {"tea", "green-tea", "white-tea", "tea-leaf"})   # already-queried notes are not suggested


# ---------------------------------------------------------------------------------------- other views + saved searches
def test_note_page_accepts_the_same_filters(client, con):
    r = client.get("/api/notes/tea", params={"brands": "Alpha~Beta", "year_min": 2000, "ff": 1, "per_page": 100}).json()["perfumes"]
    rs = rows(con)
    exp = {i for i in sql_clause(con, ["tea"], "any", False) if rs[i]["brand"] in ("Alpha", "Beta") and (rs[i]["year"] or 0) >= 2000}
    assert {x["id"] for x in r["results"]} == exp and r["total"] == len(exp)
    assert "filter_facets" in r
    lay = client.get("/api/notes/tea", params={"layer": "top", "per_page": 200}).json()["perfumes"]
    assert {x["id"] for x in lay["results"]} == sql_clause(con, ["tea"], "top", False)


def test_similar_endpoints_accept_filters_and_facets(client, con):
    body = {"notes": [{"slug": "tea", "layer": "top"}, {"slug": "musk", "layer": "base"}], "limit": 200,
            "filters": {"brands": "Alpha~Beta", "year_min": 2000}, "ff": True}
    r = client.post("/api/similar", json=body).json()
    rs = rows(con)
    assert r["results"] and all(rs[x["id"]]["brand"] in ("Alpha", "Beta") and (rs[x["id"]]["year"] or 0) >= 2000 for x in r["results"])
    assert r["filter_facets"]["brands"]["items"]
    f = client.post("/api/similar/facet", json={"notes": body["notes"], "facet": "brand", "fq": "alp", "filters": {"year_min": 2000}}).json()
    assert [i["name"] for i in f["items"]] == ["Alpha"]
    pid = r["results"][0]["id"]
    s = client.get(f"/api/perfumes/{pid}/similar", params={"gender": "women,unisex", "votes_min": 100, "ff": 1, "limit": 100}).json()
    assert all(rs[x["id"]]["gender"] in ("women", "unisex") and rs[x["id"]]["rating_count"] >= 100 for x in s["results"])
    assert "filter_facets" in s
    sf = client.get(f"/api/perfumes/{pid}/similar/facet", params={"facet": "gender"}).json()
    assert {i["name"] for i in sf["items"]} == {"women", "men", "unisex"}


# --- saved searches --------------------------------------------------------------------------------------------
def signed_in(world):
    client = TestClient(world[2])
    r = client.post("/api/auth/signup", headers=H, json={"username": "qsaver", "email": "q@example.com", "password": "correct-horse-9"})
    assert r.status_code == 201, r.text
    return client


def test_saved_advanced_state_round_trips_and_old_shape_is_migrated(world):
    c = signed_in(world)
    adv = {"adv": "1", "q": "top:tea*,mint~middle:rose,lily~base:amber*", "x": "oud*", "gen": "0", "brands": "Alpha~Beta",
           "perfumers": "Anne Flipo", "accords": "fresh~woody", "acc_any": "1", "gender": "women,unisex", "countries": "France",
           "year_min": "1990", "year_max": "2020", "year_unknown": "1", "rating_min": "3.5", "votes_min": "100",
           "must": "musk", "not": "vanilla*", "name": "noir", "sort": "year", "evil": "<script>"}
    assert c.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "Adv", "state": adv}).status_code == 201
    old = {"include": "tea@top,mint", "exclude": "oud", "mode": "any", "sort": "year", "gender": "women", "brand": "Alpha",
           "year_min": "1990", "year_max": "2010"}
    assert c.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "Old", "state": old}).status_code == 201
    items = {i["name"]: i for i in c.get("/api/me/saved").json()["items"]}
    got = items["Adv"]["state"]
    exp = {k: v for k, v in adv.items() if k != "evil"}
    assert got == exp
    assert items["Adv"]["summary"].startswith("Top has tea-ish or mint · Heart has rose or lily · Base has amber-ish")
    assert "without oud-ish" in items["Adv"]["summary"]
    assert [n["slug"] for n in items["Adv"]["notes"]][:3] == ["tea", "mint", "rose"]
    # the old shape: free-text brand that names a brand exactly is migrated to the multi-select
    assert items["Old"]["state"] == {"include": "tea@top,mint", "exclude": "oud", "mode": "any", "sort": "year", "gender": "women",
                                     "brands": "Alpha", "year_min": "1990", "year_max": "2010"}
    # ...and both states, replayed as search params, give the expected sets
    r = c.get("/api/search", params={**items["Old"]["state"], "per_page": 200}).json()
    assert r["results"]
    # legacy rows already stored in the DB with the old shape (written before this feature) are normalised on read
    uid = c.get("/api/me").json()["user"]["id"]
    app = world[2]
    app.state.store.save_search(uid, "combine", "Legacy raw", old)
    raw = {i["name"]: i for i in c.get("/api/me/saved").json()["items"]}["Legacy raw"]
    assert raw["state"]["brands"] == "Alpha" and "brand" not in raw["state"]
    assert raw["summary"] == "Tea (top) or Mint, without Oud"
    # empty advanced queries are rejected like empty simple ones
    assert c.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "Nope", "state": {"adv": "1", "q": "top:zzz"}}).status_code == 422
    # pyramid searches keep working and may carry filters
    pyr = {"top": "tea", "base": "musk", "brands": "Alpha~Nope", "year_min": "2000"}
    assert c.post("/api/me/saved", headers=H, json={"kind": "pyramid", "name": "P", "state": pyr}).status_code == 201
    p = {i["name"]: i for i in c.get("/api/me/saved", params={"kind": "pyramid"}).json()["items"]}["P"]
    assert p["state"] == {"top": "tea", "base": "musk", "brands": "Alpha", "year_min": "2000"}
    # history uses the same normaliser
    assert c.post("/api/me/history", headers=H, json={"kind": "combine", "state": adv}).status_code == 201
    h = c.get("/api/me/history", params={"kind": "combine"}).json()["items"][0]
    assert h["state"]["q"] == adv["q"] and "evil" not in h["state"]


def test_canonical_state_unit(world):
    cat = world[2].state.cat
    st = query.canonical_state(cat, {"q": "TOP:tea*,nope~lol:musk", "brands": "alpha~nowhere", "votes_min": "x", "mode": "bogus"})
    assert st == {"adv": "1", "q": "top:tea*", "brands": "Alpha"}
    assert query.canonical_state(cat, "garbage") == {}
    assert query.dec_list(query.enc_list(["a~b", "c\\d", "e"])) == ["a~b", "c\\d", "e"]


# ---------------------------------------------------------------------------------------- shipped fixture sanity
def test_whole_word_variants_on_the_shipped_fixture(tmp_path):
    db = tmp_path / "fx.db"
    make_fixture.build(db)
    app = server.create_app(db_path=db, data_dir=tmp_path, fetch_images=False)
    c = TestClient(app)
    amber = {n["slug"] for n in c.get("/api/notes/amber/variants").json()["notes"]}
    assert {"amber", "white-amber", "black-amber"} <= amber
    assert not ({"ambergris", "ambrette", "amberwood"} & amber)
    tea = {n["slug"] for n in c.get("/api/notes/tea/variants").json()["notes"]}
    assert tea == {"tea", "green-tea"}
    r = c.get("/api/search", params={"q": "top:tea*~base:amber*", "ff": 1}).json()
    assert r["total"] >= 0 and "filter_facets" in r
