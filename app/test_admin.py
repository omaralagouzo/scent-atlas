"""Admin page / API.   cd app && python -m pytest test_admin.py -q"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_api import img_server, tiny_db  # noqa: E402,F401
from test_accounts import H, PW, login, make_app, signup  # noqa: E402
import admin  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

APW = "owner-admin-pass-42"


@pytest.fixture()
def app(tmp_path, tiny_db):
    return make_app(tmp_path, tiny_db, admin_password=APW)


def admin_login(c, pw=APW):
    return c.post("/api/admin/login", headers=H, json={"password": pw})


def test_admin_disabled_when_env_unset_or_short(tmp_path, tiny_db):
    for pw in (None, "", "short-12345"):          # 11 chars
        app = make_app(tmp_path / str(pw), tiny_db, admin_password=pw)
        c = TestClient(app)
        r = c.get("/admin")
        assert r.status_code == 404 and "admin disabled" in r.text.lower() and "noindex" in r.text
        assert c.get("/admin/admin.js").status_code == 404
        for call in (lambda: c.get("/api/admin/me"), lambda: admin_login(c, pw or "x" * 20),
                     lambda: c.get("/api/admin/users"), lambda: c.post("/api/admin/logout", headers=H, json={}),
                     lambda: c.delete("/api/admin/users/1", headers=H)):
            assert call().status_code == 404
    assert not admin.admin_enabled(type("S", (), {"admin_password": "x" * 11})())
    assert admin.admin_enabled(type("S", (), {"admin_password": "x" * 12})())


def test_admin_page_is_noindex_and_not_linked_publicly(app):
    c = TestClient(app)
    r = c.get("/admin")
    assert r.status_code == 200 and 'name="robots" content="noindex, nofollow"' in r.text
    assert "noindex" in r.headers["x-robots-tag"] and "content-security-policy" in r.headers
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert c.get("/admin/admin.js").status_code == 200
    for url in ("/", "/js/main.js", "/js/auth.js", "/js/views/about.js"):
        assert "admin" not in c.get(url).text.lower().replace("administrator", ""), url


def test_wrong_password_rejected_generic_and_rate_limited(app, caplog):
    c = TestClient(app)
    import logging
    with caplog.at_level(logging.WARNING, logger="scent-atlas.admin"):
        r1 = admin_login(c, "wrong-password-123")
        assert r1.status_code == 401 and r1.json() == {"detail": "Invalid password."}
        assert "sa_admin" not in r1.headers.get("set-cookie", "")
    assert "failed admin login" in caplog.text and "wrong-password-123" not in caplog.text
    assert c.get("/api/admin/users").status_code == 401
    codes = [admin_login(c, "wrong-password-123").status_code for _ in range(5)]
    assert codes == [401, 401, 401, 401, 429]                     # 5 attempts/min per IP (1 used above)
    assert admin_login(c).status_code == 429                      # even the right password waits out the window


def test_global_lockout_after_20_failures_per_hour(app):
    ctx = app.state.ctx
    c = TestClient(app)
    for _ in range(20):
        ctx.admin_ip_limit.reset()
        assert admin_login(c, "wrong-password-123").status_code == 401
    ctx.admin_ip_limit.reset()
    r = admin_login(c)                                            # correct password, but locked out
    assert r.status_code == 429 and r.headers.get("retry-after")
    ctx.admin_lockout._fails.clear()
    assert admin_login(c).status_code == 200


def test_admin_login_cookie_flags_and_logout(app):
    c = TestClient(app)
    r = admin_login(c)
    assert r.status_code == 200
    sc = r.headers["set-cookie"].lower()
    assert "sa_admin=" in sc and "httponly" in sc and "samesite=strict" in sc and "path=/" in sc and "max-age=43200" in sc
    assert c.get("/api/admin/me").json() == {"authenticated": True}
    assert c.get("/api/admin/users").status_code == 200
    assert c.post("/api/admin/logout", headers=H, json={}).status_code == 200
    assert c.get("/api/admin/me").json() == {"authenticated": False}
    assert c.get("/api/admin/users").status_code == 401
    # token is stored hashed
    admin_login(c)
    token = c.cookies.get("sa_admin")
    assert token not in app.state.ctx.admin_sessions._s and len(app.state.ctx.admin_sessions._s) == 1


def test_admin_session_expires(app):
    c = TestClient(app)
    admin_login(c)
    sessions = app.state.ctx.admin_sessions
    for k in list(sessions._s):
        sessions._s[k] = 1.0
    assert c.get("/api/admin/users").status_code == 401


def test_user_session_cannot_use_admin_api(app):
    u = TestClient(app)
    signup(u, "alice")
    assert u.get("/api/admin/me").json() == {"authenticated": False}
    assert u.get("/api/admin/users").status_code == 401
    assert u.post("/api/admin/users/1/password", headers=H, json={"new_password": "another-pass-77"}).status_code == 401
    assert u.delete("/api/admin/users/1", headers=H).status_code == 401
    assert u.patch("/api/admin/users/1", headers=H, json={"username": "root"}).status_code == 401
    # and an admin cookie is no user session
    a = TestClient(app)
    admin_login(a)
    assert a.get("/api/me").json()["user"] is None


def test_admin_csrf_protection(app):
    c = TestClient(app)
    assert c.post("/api/admin/login", json={"password": APW}).status_code == 403            # no header
    assert c.post("/api/admin/login", headers=H, content="password=x").status_code == 415   # not JSON
    assert admin_login_with(c, {"Origin": "https://evil.example"}).status_code == 403
    assert admin_login_with(c, {"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert admin_login_with(c, {"Origin": "http://testserver"}).status_code == 200
    signup(TestClient(app), "alice")
    assert c.post("/api/admin/users/1/password", json={"new_password": "another-pass-77"}).status_code == 403
    assert c.post("/api/admin/users/1/revoke-sessions", json={}).status_code == 403
    assert c.patch("/api/admin/users/1", json={"username": "x1y2z3"}).status_code == 403
    assert c.delete("/api/admin/users/1").status_code == 403
    assert c.post("/api/admin/logout", json={}).status_code == 403


def admin_login_with(c, extra):
    return c.post("/api/admin/login", headers={**H, **extra}, json={"password": APW})


def test_reset_password_revokes_sessions_and_old_password_fails(app):
    victim = TestClient(app)
    signup(victim, "alice")
    other_device = TestClient(app)
    login(other_device, "alice")
    assert victim.get("/api/me").json()["user"] and other_device.get("/api/me").json()["user"]
    a = TestClient(app)
    admin_login(a)
    uid = victim.get("/api/me").json()["user"]["id"]
    assert a.post(f"/api/admin/users/{uid}/password", headers=H, json={"new_password": "short"}).status_code == 422
    assert a.post(f"/api/admin/users/{uid}/password", headers=H, json={"new_password": "password123"}).status_code == 422
    assert a.post(f"/api/admin/users/{uid}/password", headers=H, json={"new_password": "alice"}).status_code == 422
    assert a.post("/api/admin/users/999/password", headers=H, json={"new_password": "another-pass-77"}).status_code == 404
    assert a.post(f"/api/admin/users/{uid}/password", headers=H, json={"new_password": "another-pass-77"}).status_code == 200
    assert victim.get("/api/me").json()["user"] is None and other_device.get("/api/me").json()["user"] is None
    fresh = TestClient(app)
    assert login(fresh, "alice", PW).status_code == 401
    assert login(fresh, "alice", "another-pass-77").status_code == 200
    stored = app.state.store.find_user("alice")["password_hash"]
    assert stored.startswith("$argon2id$") and "another-pass-77" not in stored


def test_list_users_counts_filter_and_no_hashes(app):
    a1, b = TestClient(app), TestClient(app)
    signup(a1, "alice")
    signup(b, "bob", "robert@example.com")
    a1.post("/api/favorites", headers=H, json={"type": "perfume", "id": 1})
    a1.put("/api/me/perfumes/2", headers=H, json={"status": "owned"})
    a1.put("/api/me/perfumes/3", headers=H, json={"rating": 4})            # rated only: not in collection
    a1.post("/api/me/saved", headers=H, json={"kind": "combine", "name": "x", "state": {"include": "peach"}})
    login(TestClient(app), "alice")                                         # second session
    a = TestClient(app)
    admin_login(a)
    r = a.get("/api/admin/users")
    assert r.status_code == 200
    users = {u["username"]: u for u in r.json()["users"]}
    assert set(users) == {"alice", "bob"}
    al = users["alice"]
    assert (al["favorites"], al["collection"], al["saved"], al["sessions"]) == (1, 1, 1, 2)
    assert al["email"] == "alice@example.com" and al["created_at"] and al["last_login_at"]
    assert (users["bob"]["favorites"], users["bob"]["sessions"]) == (0, 1)
    assert "password" not in r.text.lower() and "argon2" not in r.text
    assert [u["username"] for u in a.get("/api/admin/users", params={"q": "ROBERT"}).json()["users"]] == ["bob"]
    assert [u["username"] for u in a.get("/api/admin/users", params={"q": "ali"}).json()["users"]] == ["alice"]
    assert a.get("/api/admin/users", params={"q": "%"}).json()["users"] == []   # wildcards are escaped


def test_revoke_sessions_rename_and_delete(app):
    al, bo = TestClient(app), TestClient(app)
    signup(al, "alice")
    signup(bo, "bob")
    al.post("/api/favorites", headers=H, json={"type": "perfume", "id": 1})
    a = TestClient(app)
    admin_login(a)
    uid = al.get("/api/me").json()["user"]["id"]
    bid = bo.get("/api/me").json()["user"]["id"]
    assert a.post(f"/api/admin/users/{uid}/revoke-sessions", headers=H, json={}).json() == {"ok": True, "revoked": 1}
    assert al.get("/api/me").json()["user"] is None and bo.get("/api/me").json()["user"]
    assert login(al, "alice").status_code == 200                           # password unchanged
    # rename / email with uniqueness checks
    assert a.patch(f"/api/admin/users/{uid}", headers=H, json={"username": "BOB"}).status_code == 409
    assert a.patch(f"/api/admin/users/{uid}", headers=H, json={"email": "Bob@Example.com"}).status_code == 409
    assert a.patch(f"/api/admin/users/{uid}", headers=H, json={"username": "x"}).status_code == 422
    assert a.patch(f"/api/admin/users/{uid}", headers=H, json={"email": "nope"}).status_code == 422
    r = a.patch(f"/api/admin/users/{uid}", headers=H, json={"username": "alicia", "email": "alicia@example.com"})
    assert r.json()["user"] == {"id": uid, "username": "alicia", "email": "alicia@example.com"}
    assert login(TestClient(app), "alicia@example.com").status_code == 200
    assert a.patch("/api/admin/users/999", headers=H, json={"username": "ghost1"}).status_code == 404
    # delete reuses the normal account deletion (all data gone, other users untouched)
    assert a.delete(f"/api/admin/users/{uid}", headers=H).status_code == 200
    assert a.delete(f"/api/admin/users/{uid}", headers=H).status_code == 404
    assert app.state.store.find_user("alicia") is None and bo.get("/api/me").json()["user"]["id"] == bid
    import sqlalchemy as sa
    import userdb
    with app.state.store.eng.connect() as con:
        assert con.execute(sa.select(sa.func.count()).select_from(userdb.favorites).where(userdb.favorites.c.user_id == uid)).scalar() == 0
