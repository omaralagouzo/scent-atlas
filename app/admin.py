"""Owner-only admin: account recovery without email.  Enabled only when ADMIN_PASSWORD is set (>= 12 chars).

* separate in-memory admin sessions (single worker): random token, HttpOnly + SameSite=Strict cookie, 12 h, no sliding
* login: constant-time compare of SHA-256 digests; 5/min per IP plus a global lockout after 20 failures per hour
* same CSRF/header/Origin guard as the user API; when disabled every /api/admin/* answers 404
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field

import auth
import user_api

log = logging.getLogger("scent-atlas.admin")
ADMIN_COOKIE = "sa_admin"
ADMIN_TTL = 12 * 3600
MIN_ADMIN_PASSWORD = 12
HERE = Path(__file__).resolve().parent
ADMIN_DIR = HERE / "admin_static"


def admin_enabled(settings) -> bool:
    return bool(settings.admin_password) and len(settings.admin_password) >= MIN_ADMIN_PASSWORD


class FailureLockout:
    """Global counter: after `limit` failed logins within `window` seconds every login is refused until it drains."""

    def __init__(self, limit=20, window=3600.0, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._fails: deque = deque()
        self._lock = threading.Lock()

    def _drain(self, now):
        while self._fails and now - self._fails[0] >= self.window:
            self._fails.popleft()

    def locked(self) -> int:
        """Seconds until unlocked (0 = not locked)."""
        now = self.clock()
        with self._lock:
            self._drain(now)
            if len(self._fails) >= self.limit:
                return max(1, int(self.window - (now - self._fails[0])) + 1)
            return 0

    def fail(self):
        with self._lock:
            self._fails.append(self.clock())


class AdminSessions:
    def __init__(self, clock=time.time):
        self._s: dict[str, float] = {}
        self._lock = threading.Lock()
        self.clock = clock

    def create(self) -> str:
        token = auth.new_token()
        now = self.clock()
        with self._lock:
            self._s = {k: v for k, v in self._s.items() if v > now}
            self._s[auth.token_hash(token)] = now + ADMIN_TTL
        return token

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        h = auth.token_hash(token)
        with self._lock:
            exp = self._s.get(h)
            if exp is None:
                return False
            if exp <= self.clock():
                del self._s[h]
                return False
            return True

    def drop(self, token: str | None):
        if token:
            with self._lock:
                self._s.pop(auth.token_hash(token), None)


class LoginBody(BaseModel):
    password: str = Field(max_length=1024)


class NewPasswordBody(BaseModel):
    new_password: str = Field(max_length=1024)


class UpdateBody(BaseModel):
    username: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=320)


def _digest(s: str) -> bytes:
    return hashlib.sha256(s.encode("utf-8")).digest()


def make_admin_router(ctx) -> APIRouter:
    store, settings = ctx.store, ctx.settings
    sessions = AdminSessions()
    ip_limit = auth.RateLimiter(5, 60.0)
    lockout = FailureLockout(20, 3600.0)
    ctx.admin_sessions, ctx.admin_ip_limit, ctx.admin_lockout = sessions, ip_limit, lockout

    def enabled():
        if not admin_enabled(settings):
            raise HTTPException(404, "Not Found")

    def require_admin(request: Request):
        if not sessions.valid(request.cookies.get(ADMIN_COOKIE)):
            raise HTTPException(401, "Admin sign-in required.")

    def ip_of(request):
        return auth.client_ip(request, settings.trust_proxy, settings.proxy_hops)

    router = APIRouter(prefix="/api/admin", dependencies=[Depends(enabled), Depends(user_api.csrf_guard)])

    @router.get("/me")
    def me(request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"authenticated": sessions.valid(request.cookies.get(ADMIN_COOKIE))}

    @router.post("/login")
    def login(body: LoginBody, request: Request, response: Response):
        ip = ip_of(request)
        wait = lockout.locked()
        if wait:
            log.warning("admin login refused (global lockout) from %s", ip)
            raise HTTPException(429, "Too many failed attempts. Try again later.", headers={"Retry-After": str(wait)})
        ok, retry = ip_limit.hit(ip)
        if not ok:
            log.warning("admin login rate-limited from %s", ip)
            raise HTTPException(429, "Too many attempts. Wait a minute.", headers={"Retry-After": str(retry)})
        good = hmac.compare_digest(_digest(body.password), _digest(settings.admin_password))
        if not good:
            lockout.fail()
            log.warning("failed admin login from %s", ip)  # never log the attempted password
            raise HTTPException(401, "Invalid password.")
        token = sessions.create()
        response.set_cookie(ADMIN_COOKIE, token, max_age=ADMIN_TTL, path="/", httponly=True, samesite="strict",
                            secure=user_api.cookie_is_secure(request, settings))
        log.info("admin login from %s", ip)
        return {"ok": True}

    @router.post("/logout")
    def logout(request: Request, response: Response):
        sessions.drop(request.cookies.get(ADMIN_COOKIE))
        response.delete_cookie(ADMIN_COOKIE, path="/", httponly=True, samesite="strict",
                               secure=user_api.cookie_is_secure(request, settings))
        return {"ok": True}

    def user_out(u):
        return u  # list_users already selects only safe columns (never the hash)

    @router.get("/users", dependencies=[Depends(require_admin)])
    def list_users(q: str = ""):
        return {"users": [user_out(u) for u in store.list_users(q)]}

    def target(uid: int):
        u = store.get_user(uid)
        if not u:
            raise HTTPException(404, "User not found.")
        return u

    @router.post("/users/{uid}/password", dependencies=[Depends(require_admin)])
    def reset_password(uid: int, body: NewPasswordBody, request: Request):
        u = target(uid)
        problem = auth.password_problem(body.new_password, u["username"], u["email"])
        if problem:
            raise HTTPException(422, problem)
        store.set_password(uid, auth.hash_password(body.new_password))  # also revokes every session
        log.info("admin reset password for user id=%s from %s", uid, ip_of(request))
        return {"ok": True}

    @router.post("/users/{uid}/revoke-sessions", dependencies=[Depends(require_admin)])
    def revoke(uid: int, request: Request):
        target(uid)
        n = store.revoke_sessions(uid)
        log.info("admin revoked %s sessions of user id=%s from %s", n, uid, ip_of(request))
        return {"ok": True, "revoked": n}

    @router.patch("/users/{uid}", dependencies=[Depends(require_admin)])
    def update(uid: int, body: UpdateBody, request: Request):
        target(uid)
        username = body.username.strip() if body.username is not None else None
        email = body.email.strip() if body.email is not None else None
        problem = (auth.valid_username(username) if username is not None else None) or \
                  (auth.valid_email(email) if email is not None else None)
        if problem:
            raise HTTPException(422, problem)
        try:
            u = store.update_user(uid, username, email)
        except ValueError as e:
            raise HTTPException(409, "That username is already taken." if str(e) == "username"
                                else "An account with that email already exists.")
        except LookupError:
            raise HTTPException(404, "User not found.")
        log.info("admin updated user id=%s from %s", uid, ip_of(request))
        return {"user": {k: u[k] for k in ("id", "username", "email")}}

    @router.delete("/users/{uid}", dependencies=[Depends(require_admin)])
    def delete(uid: int, request: Request):
        target(uid)
        store.delete_user(uid)
        log.info("admin deleted user id=%s from %s", uid, ip_of(request))
        return {"ok": True}

    return router


def add_admin_pages(app, settings):
    """/admin (page) and its script. Not linked from the public UI; never indexed."""
    robots = {"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store"}

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/", include_in_schema=False)
    def admin_page():
        if not admin_enabled(settings):
            return HTMLResponse(
                '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">'
                "<title>Admin disabled</title><body><p>Admin disabled.</p>",
                status_code=404, headers=robots)
        return FileResponse(ADMIN_DIR / "admin.html", headers=robots)

    @app.get("/admin/admin.js", include_in_schema=False)
    def admin_js():
        if not admin_enabled(settings):
            raise HTTPException(404, "Not Found")
        return FileResponse(ADMIN_DIR / "admin.js", media_type="text/javascript", headers=robots)
