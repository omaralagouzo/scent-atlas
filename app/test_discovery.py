"""New-release discovery: ingest / merge, scoring, duplicates, images, admin review, publishing, import, research runs.

    cd app && python -m pytest test_discovery.py -q
"""
from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401
from test_accounts import H, make_app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import discovery as dz  # noqa: E402
import discovery_engine as de  # noqa: E402

APW = "owner-admin-pass-42"


def png(w=40, h=60) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (w, h), (200, 120, 90)).save(b, "PNG")
    return b.getvalue()


@pytest.fixture()
def fake_images(monkeypatch):
    """Image URLs ending in /ok.png download a real PNG; anything else fails (no network in tests)."""
    def dl(url):
        if url.endswith("/ok.png"):
            return png()
        raise ValueError("not found")
    monkeypatch.setattr(dz, "download_image", dl)


@pytest.fixture()
def app(tmp_path, tiny_db, fake_images):
    return make_app(tmp_path, tiny_db, admin_password=APW)


@pytest.fixture()
def admin(app):
    c = TestClient(app)
    assert c.post("/api/admin/login", headers=H, json={"password": APW}).status_code == 200
    return c


def cand(**kw) -> dict:
    d = {"brand": "Nova", "name": "First Light", "concentration": "Eau de Parfum", "gender": "unisex",
         "release_date": "2026-09-15", "status": "released", "perfumers": ["Ann Perfumer"],
         "notes": {"top": ["Bergamot", "pink pepper"], "middle": ["Rose"], "base": ["Musk", "Vanilla"], "general": []},
         "family": "Floral Woody", "description": "A bright rose over soft musk.",
         "image_url": "https://img.example/ok.png", "official_url": "https://nova.example/first-light",
         "sources": [{"url": "https://nova.example/first-light", "title": "Nova", "kind": "official",
                      "supports": ["identity", "notes", "image"]}],
         "confidence": {"identity": 0.95, "release_date": 0.8, "notes": 0.9, "perfumers": 0.7, "image": 0.9,
                        "gender": 0.8, "concentration": 0.9}, "comment": None}
    d.update(kw)
    return d


def ingest(app, raws, fetch=True):
    st = app.state.store
    res = dz.ingest(st, app.state.cat, raws)
    if fetch:
        for iid in res["ids"]:
            dz.fetch_image(st, iid)
    return res


def row(app, iid):
    with app.state.store.eng.connect() as c:
        return dict(c.execute(dz.sa.select(dz.discovery_items).where(dz.discovery_items.c.id == iid)).mappings().first())


# ---------------------------------------------------------------------------- cleaning and scoring
def test_clean_item_normalises_fields():
    it = dz.clean_item({"brand": "  Nova ", "name": "First  Light", "concentration": "eau de parfum", "gender": "Female",
                        "release_date": "2026-9", "notes": ["rose", "Rose", "musk"], "image_url": "javascript:alert(1)",
                        "sources": [{"url": "ftp://x"}, {"url": "https://a.example", "kind": "blog", "supports": ["notes", "x"]}],
                        "confidence": {"identity": 1.4, "notes": "0.5", "bogus": 1}})
    assert it["brand"] == "Nova" and it["name"] == "First Light" and it["concentration"] == "EDP"
    assert it["gender"] == "women" and it["release_date"] == "2026-09"
    assert it["notes"]["general"] == ["Rose", "Musk"] and it["image_url"] is None
    assert it["sources"] == [{"url": "https://a.example", "title": None, "kind": "news", "supports": ["notes"]}]
    assert it["confidence"] == {"identity": 1.0, "notes": 0.5}
    assert dz.clean_item({"brand": "", "name": "x"}) is None
    assert dz.display_name("Sauvage", "Elixir") == "Sauvage Elixir" and dz.display_name("Libre", "EDP") == "Libre"


def test_ingest_scores_and_completes_with_an_image(app):
    res = ingest(app, [cand()], fetch=False)
    iid = res["ids"][0]
    r = row(app, iid)
    assert r["state"] == "incomplete" and json.loads(r["missing"]) == ["image"]
    assert dz.fetch_image(app.state.store, iid)
    r = row(app, iid)
    assert r["state"] == "complete" and json.loads(r["missing"]) == [] and 0.8 < r["overall"] <= 1
    # too few notes, no date, no gender -> incomplete, and listed
    iid2 = ingest(app, [cand(name="Second", notes={"top": ["Rose"]}, release_date=None, gender=None)])["ids"][0]
    assert set(json.loads(row(app, iid2)["missing"])) == {"release_date", "notes", "gender"}


def test_ingest_merges_repeat_finds(app):
    iid = ingest(app, [cand(notes={"top": ["Rose"]}, perfumers=["A"], gender=None,
                            confidence={"identity": 0.5, "notes": 0.3})])["ids"][0]
    res = ingest(app, [cand(perfumers=["B", "a"], sources=[{"url": "https://shop.example/x", "kind": "retailer", "supports": []}],
                            confidence={"identity": 0.9, "notes": 0.8, "gender": 0.7})])
    assert res["new"] == 0 and res["updated"] == 1 and res["ids"] == [iid]
    r = row(app, iid)
    assert json.loads(r["perfumers"]) == ["A", "B"] and r["gender"] == "unisex"
    assert dz.n_notes(json.loads(r["notes"])) == 5 and r["attempts"] == 2
    assert len(json.loads(r["sources"])) == 2
    assert json.loads(r["confidence"])["identity"] == 0.9
    # completing by id merges into that candidate even when the spelling differs
    res = ingest(app, [cand(item_id=iid, name="First-Light", family="Woody")])
    assert res["ids"] == [iid] and res["new"] == 0


def test_catalogue_duplicates_are_flagged(app):
    iid = ingest(app, [cand(brand="Beta", name="D Oud Rose", concentration=None)])["ids"][0]
    r = row(app, iid)
    assert r["state"] == "duplicate" and r["duplicate_of"] == 4
    assert dz.catalogue_match(app.state.cat, "Alpha", "A Peach Top", "Eau de Parfum") == 1
    assert dz.catalogue_match(app.state.cat, "Other", "A Peach Top") is None


def test_image_download_refuses_private_addresses():
    for url in ("http://127.0.0.1/x.png", "http://localhost/x.png", "http://10.0.0.1/x.png", "file:///etc/passwd",
                "http://169.254.169.254/latest"):
        with pytest.raises(Exception):
            dz.download_image.__wrapped__(url) if hasattr(dz.download_image, "__wrapped__") else dz.download_image(url)


# ---------------------------------------------------------------------------- admin review
def test_admin_queue_needs_sign_in(app):
    c = TestClient(app)
    assert c.get("/api/admin/discovery/items").status_code == 401
    assert c.post("/api/admin/discovery/runs", headers=H, json={"kind": "discover"}).status_code == 401


def test_admin_review_edit_approve_publish(app, admin, tmp_path, tiny_db):
    ok = ingest(app, [cand()])["ids"][0]
    inc = ingest(app, [cand(name="Half Done", notes={"top": ["Rose"]})])["ids"][0]
    r = admin.get("/api/admin/discovery/items?state=complete").json()
    assert [i["id"] for i in r["items"]] == [ok] and r["counts"]["complete"] == 1 and r["counts"]["incomplete"] == 1
    it = r["items"][0]
    assert it["image"].startswith(f"/api/admin/discovery/images/{ok}.webp") and it["confidence"]["notes"] == 0.9
    assert admin.get(it["image"]).headers["content-type"] == "image/webp"
    assert admin.get("/api/admin/discovery/items?state=all&q=half").json()["total"] == 1

    # an incomplete one needs force; editing it in completes it (owner edits count as verified)
    assert admin.post(f"/api/admin/discovery/items/{inc}/approve", headers=H, json={}).status_code == 409
    e = admin.patch(f"/api/admin/discovery/items/{inc}", headers=H,
                    json={"notes": {"top": ["Rose"], "middle": ["Iris"], "base": ["Musk"]}, "gender": "women"}).json()
    assert e["state"] == "complete" and e["confidence"]["notes"] == 1.0 and e["gender"] == "women"
    assert admin.patch(f"/api/admin/discovery/items/{inc}", headers=H, json={"gender": "robot"}).status_code == 422
    assert admin.patch(f"/api/admin/discovery/items/{inc}", headers=H, json={"name": "First Light"}).status_code == 409

    b = admin.post("/api/admin/discovery/bulk", headers=H, json={"ids": [ok, inc], "action": "approve"}).json()
    assert b["done"] == [ok, inc] and b["counts"]["approved"] == 2
    p = admin.post("/api/admin/discovery/publish", headers=H, json={}).json()
    assert p["published"] == 2 and p["restarting"] is False and p["pending_restart"] == 2

    # public image only once published
    assert TestClient(app).get(f"/img/discovery/{ok}.webp").headers["content-type"] == "image/webp"

    # the next start (same users database) has them in the catalogue
    app2 = make_app(tmp_path, tiny_db, admin_password=APW)
    c2 = TestClient(app2)
    pid = dz.ID_BASE + ok
    d = c2.get(f"/api/perfumes/{pid}").json()
    assert d["name"] == "First Light" and d["brand"] == "Nova" and d["year"] == 2026
    assert d["image"] == f"/img/discovery/{ok}.webp"
    assert c2.get(f"/img/perfume/{pid}", follow_redirects=False).headers["location"] == f"/img/discovery/{ok}.webp"
    assert any(p["id"] == pid for p in c2.get("/api/perfumes?q=first light").json()["results"])
    a2 = TestClient(app2)
    a2.post("/api/admin/login", headers=H, json={"password": APW})
    assert a2.get(f"/api/admin/discovery/items/{ok}").json()["live"] is True
    assert a2.get("/api/admin/discovery/config").json()["pending_restart"] == 0

    # unpublish -> back to approved; rejecting / restoring
    assert admin.post(f"/api/admin/discovery/items/{ok}/unpublish", headers=H, json={}).json()["state"] == "approved"
    assert admin.post(f"/api/admin/discovery/items/{ok}/reject", headers=H, json={"reason": "fake"}).json()["state"] == "rejected"
    assert admin.post(f"/api/admin/discovery/items/{ok}/restore", headers=H, json={}).json()["state"] == "complete"


def test_duplicate_flags_can_be_cleared_and_set(app, admin):
    iid = ingest(app, [cand(brand="Beta", name="D Oud Rose", concentration=None)])["ids"][0]
    it = admin.get(f"/api/admin/discovery/items/{iid}").json()
    assert it["state"] == "duplicate" and it["duplicate_of"]["name"] == "D Oud Rose"
    assert admin.post(f"/api/admin/discovery/items/{iid}/not-duplicate", headers=H, json={}).json()["state"] == "complete"
    assert admin.post(f"/api/admin/discovery/items/{iid}/duplicate", headers=H, json={"perfume_id": 999}).status_code == 422
    assert admin.post(f"/api/admin/discovery/items/{iid}/duplicate", headers=H, json={"perfume_id": 4}).json()["state"] == "duplicate"


def test_import_files_once(app, tmp_path):
    folder = tmp_path / "discovery"
    folder.mkdir()
    (folder / "run-a.json").write_text(json.dumps([cand(), cand(name="Other One")]))
    st = app.state.store
    assert len(dz.import_files(st, app.state.cat, folder)) == 1
    assert dz.import_files(st, app.state.cat, folder) == []           # not again
    with st.eng.connect() as c:
        assert c.execute(dz.sa.select(dz.sa.func.count()).select_from(dz.discovery_items)).scalar() == 2


# ---------------------------------------------------------------------------- research runs (fake Claude)
def block(type_, **kw):
    return SimpleNamespace(type=type_, **kw)


class FakeClient:
    """Plays back scripted responses; records the requests."""

    def __init__(self, script):
        self.script, self.requests = list(script), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.requests.append(kw)
        content, stop = self.script.pop(0) if self.script else ([block("text", text="done")], "end_turn")
        usage = SimpleNamespace(input_tokens=1000, output_tokens=500, cache_creation_input_tokens=0,
                                cache_read_input_tokens=0, server_tool_use=SimpleNamespace(web_search_requests=2))
        return SimpleNamespace(content=content, stop_reason=stop, usage=usage)


def wait_run(admin, rid, timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = admin.get(f"/api/admin/discovery/runs/{rid}").json()
        if r["status"] not in ("queued", "running"):
            return r
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_discover_run_with_fake_claude(app, admin):
    script = [
        ([block("server_tool_use", name="web_search", id="s1", input={})], "pause_turn"),
        ([block("tool_use", name="check_catalogue", id="t1", input={"brand": "Alpha", "name": "A Peach Top"})], "tool_use"),
        ([block("tool_use", name="submit_fragrances", id="t2", input={"fragrances": [cand(), cand(name="Late Bloom")]})], "tool_use"),
        ([block("text", text="Covered.")], "end_turn"),
    ]
    fake = FakeClient(script)
    app.state.ctx.discovery_engine._client_factory = lambda: fake
    assert admin.get("/api/admin/discovery/config").json()["engine_ready"] is True
    rid = admin.post("/api/admin/discovery/runs", headers=H, json={"kind": "discover", "segments": ["designer"]}).json()["id"]
    r = wait_run(admin, rid)
    assert r["stats"]["new"] == 2 and r["stats"]["requests"] == 4, (r["log"], r["stats"])
    assert r["stats"]["cost_usd"] == pytest.approx(4 * (1000 * 2 + 500 * 10) / 1e6 + 8 * 0.01)
    req = fake.requests[-1]
    assert req["model"] == "claude-sonnet-5-5" and req["output_config"] == {"effort": "high"}
    assert {t.get("name") for t in req["tools"]} >= {"web_search", "web_fetch", "submit_fragrances", "check_catalogue"}
    # the catalogue check answered with the match, and tool results were sent back
    results = [m for m in req["messages"] if m["role"] == "user" and isinstance(m["content"], list)]
    assert "A Peach Top" in results[0]["content"][0]["content"]
    assert any("submitted" in line or "saved 2 new" in line for line in r["log"])


def test_complete_run_and_budget(app, admin):
    iid = ingest(app, [cand(name="Gappy", notes={"top": ["Rose"]}, gender=None)])["ids"][0]
    script = [([block("tool_use", name="submit_fragrances", id="t1",
                      input={"fragrances": [cand(item_id=iid, name="Gappy", gender="men")]})], "tool_use")]
    fake = FakeClient(script)
    app.state.ctx.discovery_engine._client_factory = lambda: fake
    rid = admin.post("/api/admin/discovery/runs", headers=H, json={"kind": "complete", "complete_model": "haiku"}).json()["id"]
    r = wait_run(admin, rid)
    assert r["status"] == "done" and r["stats"]["updated"] == 1
    assert fake.requests[0]["model"] == "claude-haiku-5-5" and f'"id": {iid}' in fake.requests[0]["messages"][0]["content"]
    it = admin.get(f"/api/admin/discovery/items/{iid}").json()
    assert it["state"] == "complete" and it["gender"] == "men"

    # a tiny budget stops after the first request
    fake2 = FakeClient([([block("tool_use", name="check_catalogue", id=f"c{k}", input={"brand": "X", "name": "Y"})], "tool_use")
                        for k in range(10)])
    app.state.ctx.discovery_engine._client_factory = lambda: fake2
    rid = admin.post("/api/admin/discovery/runs", headers=H,
                     json={"kind": "discover", "segments": ["niche"], "budget_usd": 0.01}).json()["id"]
    r = wait_run(admin, rid)
    assert len(fake2.requests) == 1 and "budget" in (r["error"] or "")


def test_run_needs_api_key(app, admin, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert admin.get("/api/admin/discovery/config").json()["engine_ready"] is False
    assert admin.post("/api/admin/discovery/runs", headers=H, json={"kind": "discover"}).status_code == 409


def test_interrupted_runs_are_marked(app, tmp_path, tiny_db):
    st = app.state.store
    with st.eng.begin() as c:
        rid = c.execute(dz.discovery_runs.insert().values(kind="discover", status="running", created_at=1)).inserted_primary_key[0]
    de.Engine(st, app.state.cat)
    with st.eng.connect() as c:
        assert c.execute(dz.sa.select(dz.discovery_runs.c.status).where(dz.discovery_runs.c.id == rid)).scalar() == "interrupted"


def test_spelling_variants_match(app):
    assert dz.same_brand("DS&Durga", "D.S. & Durga") and not dz.same_brand("Северное", "Alpha")
    assert dz.name_key("305 Bois Darshan") == dz.name_key("Bois Darshan 305")
    assert dz.catalogue_match(app.state.cat, "alpha!", "Top A Peach") == 1
    a = ingest(app, [cand(concentration=None)], fetch=False)["ids"][0]
    b = ingest(app, [cand(brand="NOVA", concentration="EDP")], fetch=False)
    assert b["ids"] == [a] and b["new"] == 0
    assert row(app, a)["concentration"] == "EDP" and row(app, a)["key"].endswith("|edp")


def test_brand_takes_the_catalogue_spelling(app):
    cat = app.state.cat
    assert dz.canonical_brand(cat, "ALPHA Perfumes") == "Alpha" and dz.canonical_brand(cat, "Brand New") == "Brand New"
    iid = ingest(app, [cand(brand="Gamma Parfums", name="Fresh One")], fetch=False)["ids"][0]
    assert row(app, iid)["brand"] == "Gamma"
