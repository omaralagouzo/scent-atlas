"""Analytics (page-view tracking + the admin report), two-factor admin sign-in and the admin host.
cd app && python -m pytest test_analytics.py -q"""
from __future__ import annotations

import base64
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401
from test_accounts import H, PW, make_app, signup  # noqa: E402
from test_admin import APW, admin_login, built_admin  # noqa: E402,F401
import admin  # noqa: E402
import analytics  # noqa: E402

PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
DESK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SECRET = base64.b32encode(b"0123456789abcdefghij").decode().rstrip("=")


@pytest.fixture()
def app(tmp_path, tiny_db):
    return make_app(tmp_path, tiny_db, admin_password=APW)


def hit(c, path, visitor="visitor-aaaa1111", ua=DESK, **kw):
    return c.post("/api/t", headers={**H, "User-Agent": ua}, json={"path": path, "visitor": visitor, **kw})


# ---------------------------------------------------------------------------- tracking
def test_tracking_records_views_without_ip_or_query(app):
    c = TestClient(app)
    assert hit(c, "/perfume/1?secret=search", session="sess-0001aaaa", referrer="https://www.instagram.com/p/x",
               tz="America/Toronto", ua=PHONE).status_code == 204
    signup(c, "alice")
    assert hit(c, "#/notes").status_code == 204
    rows = app.state.store.recent_views(10)
    assert [r["path"] for r in rows] == ["/notes", "/perfume/1"]
    first = rows[1]
    assert (first["ref_host"], first["device"], first["browser"], first["tz"], first["user_id"]) == \
        ("instagram.com", "phone", "Safari", "America/Toronto", None)
    assert rows[0]["user_id"] is not None and rows[0]["device"] == "desktop" and rows[0]["browser"] == "Chrome"
    assert "ip" not in rows[0] and not any("testclient" in str(v) for v in rows[0].values())


def test_tracking_ignores_bots_and_junk_and_needs_the_csrf_header(app):
    c = TestClient(app)
    assert hit(c, "/notes", ua="WhatsApp/2.23 A").status_code == 204
    assert hit(c, "/notes", ua="Mozilla/5.0 HeadlessChrome/120").status_code == 204
    assert hit(c, "/notes", visitor="x").status_code == 204                    # bad visitor id
    assert hit(c, "/<script>").status_code == 204                               # bad path
    assert hit(c, "/notes", referrer="http://testserver/x", visitor="visitor-bbbb2222").status_code == 204
    rows = app.state.store.recent_views(10)
    assert len(rows) == 1 and rows[0]["ref_host"] is None                       # own site is not a referrer
    assert c.post("/api/t", json={"path": "/notes", "visitor": "visitor-aaaa1111"}).status_code == 403


def test_deleting_an_account_keeps_anonymous_views(app):
    c = TestClient(app)
    signup(c, "alice")
    hit(c, "/notes")
    assert c.post("/api/auth/delete", headers=H, json={"password": PW}).status_code == 200
    rows = app.state.store.recent_views(10)
    assert len(rows) == 1 and rows[0]["user_id"] is None


def test_old_views_are_pruned(app):
    store = app.state.store
    store.add_view({"ts": int(time.time()) - (analytics.RETENTION_DAYS + 5) * 86400, "visitor": "visitor-old00000", "path": "/notes"})
    hit(TestClient(app), "/notes")                                               # the first hit after start prunes
    assert [r["visitor"] for r in store.recent_views(10)] == ["visitor-aaaa1111"]


# ---------------------------------------------------------------------------- report
def test_admin_report_and_activity(app):
    v = TestClient(app)
    signup(v, "alice")
    hit(v, "/perfume/1", tz="Europe/London", referrer="https://instagram.com/")
    hit(v, "/perfume/1")
    hit(v, "/note/rose")
    hit(TestClient(app), "/perfume/1", visitor="visitor-bbbb2222", ua=PHONE, tz="Asia/Dubai")
    hit(TestClient(app), "/u/alice", visitor="visitor-cccc3333")
    a = TestClient(app)
    assert a.get("/api/admin/analytics").status_code == 401
    admin_login(a)
    r = a.get("/api/admin/analytics", params={"days": 7, "tz": "Europe/London"}).json()
    t = r["totals"]
    assert (t["visitors_today"], t["views_today"], t["active_now"], t["signed_in_30d"], t["accounts_total"], t["accounts_new_7d"]) == \
        (3, 5, 3, 1, 1, 1)
    assert len(r["daily"]) == 7 and r["daily"][-1]["views"] == 5 and r["daily"][-1]["signups"] == 1
    assert r["top_perfumes"][0]["id"] == 1 and (r["top_perfumes"][0]["views"], r["top_perfumes"][0]["visitors"]) == (3, 2)
    assert r["top_notes"][0]["slug"] == "rose"
    assert {s["key"]: s["visitors"] for s in r["sections"]} == {"perfume": 2, "notes": 1, "profile": 1}
    labels = {p["path"]: p["label"] for p in r["top_pages"]}
    assert labels["/u/alice"] == "Profile: @alice" and labels["/note/rose"].startswith("Note: ")
    assert {x["host"] for x in r["referrers"]} == {"instagram.com", None}
    assert {d["name"]: d["visitors"] for d in r["devices"]} == {"desktop": 2, "phone": 1}
    assert {x["place"] for x in r["locations"]} >= {"London, Europe", "Dubai, Asia"}
    assert a.get("/api/admin/analytics", params={"tz": "Not/AZone"}).json()["tz"] == "UTC"

    act = a.get("/api/admin/activity", params={"limit": 3}).json()
    assert [x["path"] for x in act["items"]] == ["/u/alice", "/perfume/1", "/note/rose"] and act["next_before"]
    more = a.get("/api/admin/activity", params={"limit": 3, "before": act["next_before"]}).json()
    assert len(more["items"]) == 2 and more["next_before"] is None
    mine = a.get("/api/admin/activity", params={"user_id": 1}).json()["items"]
    assert len(mine) == 3 and mine[0]["user"]["username"] == "alice" and mine[0]["user"]["name"] == "User Name"
    u = a.get("/api/admin/users").json()["users"][0]
    assert u["views_30d"] == 3 and u["last_seen_at"]


# ---------------------------------------------------------------------------- two-factor
def test_totp_matches_rfc_6238_vectors():
    key = b"12345678901234567890"
    for t, code in ((59, "287082"), (1111111109, "081804"), (1234567890, "005924"), (2000000000, "279037")):
        assert admin.totp_code(key, t // 30) == code
    assert admin.totp_key("not base32 !!!") is None and admin.totp_key("AAAA") is None   # junk or too short
    assert admin.totp_key(SECRET.lower()) == b"0123456789abcdefghij"


def test_two_factor_login(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, admin_password=APW, admin_totp_secret=SECRET)
    c = TestClient(app)
    assert c.get("/api/admin/me").json() == {"authenticated": False, "two_factor": True}
    key = admin.totp_key(SECRET)
    now = int(time.time() // 30)
    assert admin_login(c).status_code == 401                                     # password alone is not enough
    r = c.post("/api/admin/login", headers=H, json={"password": "wrong-password-123", "code": admin.totp_code(key, now)})
    assert r.status_code == 401 and r.json()["detail"] == "Invalid password or code."
    app.state.ctx.admin_ip_limit.reset()
    ok = c.post("/api/admin/login", headers=H, json={"password": APW, "code": admin.totp_code(key, now)})
    assert ok.status_code == 200 and c.get("/api/admin/me").json()["authenticated"] is True
    replay = TestClient(app).post("/api/admin/login", headers=H, json={"password": APW, "code": admin.totp_code(key, now)})
    assert replay.status_code == 401                                             # a code works once


def test_unreadable_totp_secret_switches_admin_off(tmp_path, tiny_db):
    app = make_app(tmp_path, tiny_db, admin_password=APW, admin_totp_secret="!!not-base32!!")
    assert TestClient(app).get("/api/admin/me").status_code == 404


# ---------------------------------------------------------------------------- admin host
def test_admin_host_serves_only_the_admin(tmp_path, tiny_db, built_admin):
    app = make_app(tmp_path, tiny_db, admin_password=APW, admin_host="admin.scentatlas.app",
                   allowed_hosts=("testserver", "admin.scentatlas.app"), canonical_host="testserver")
    adm = TestClient(app, base_url="https://admin.scentatlas.app")
    r = adm.get("/")
    assert r.status_code == 200 and "Scent Atlas admin" in r.text and "noindex" in r.headers["x-robots-tag"]
    assert adm.get("/admin").status_code == 200
    assert adm.get("/api/notes").status_code == 404 and adm.get("/about.html").status_code == 404
    assert adm.get("/api/admin/me").status_code == 200                           # not redirected to the canonical host
    adm.headers.update({"Origin": "https://admin.scentatlas.app"})
    r = adm.post("/api/admin/login", headers=H, json={"password": APW})
    assert r.status_code == 200 and "__host-sa_admin=" in r.headers["set-cookie"].lower() and "secure" in r.headers["set-cookie"].lower()
    assert "domain=" not in r.headers["set-cookie"].lower()
    assert adm.get("/api/admin/me").json()["authenticated"] is True

    pub = TestClient(app)                                                         # the public site has no admin
    assert pub.get("/admin").status_code == 404 and pub.get("/api/admin/me").status_code == 404
    assert pub.get("/api/status").status_code == 200 and pub.get("/").status_code == 200


def test_admin_host_is_allowed_automatically():
    import config
    s = config.Settings.from_env({"ALLOWED_HOSTS": "scentatlas.app", "ADMIN_HOST": " Admin.ScentAtlas.app ",
                                  "ADMIN_TOTP_SECRET": "abcd efgh ijkl mnop"})
    assert s.admin_host == "admin.scentatlas.app" and "admin.scentatlas.app" in s.allowed_hosts
    assert s.admin_totp_secret == "abcdefghijklmnop" and "abcd" not in repr(s)
