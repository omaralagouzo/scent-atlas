"""Owner-only admin: analytics dashboard and account recovery.  Enabled only when ADMIN_PASSWORD is set (>= 16 chars).

* the password exists only in the environment (ADMIN_PASSWORD): never in the code, the front end or the database
* optional two-factor: ADMIN_TOTP_SECRET (base32) makes every sign-in also need the 6-digit code from an authenticator
  app (RFC 6238, 30 s steps, +-1 step of clock drift, a code works once). A malformed secret switches admin off.
* ADMIN_HOST (e.g. admin.scentatlas.app): the admin lives only on that host (the server returns 404 for it anywhere else),
  so its cookie never reaches the public site and the public site's pages never share an origin with it
* separate in-memory admin sessions (single worker): random token, HttpOnly + Secure + SameSite=Strict cookie with the
  __Host- prefix on HTTPS, 12 h, no sliding; a restart signs the admin out
* login: constant-time compares; 5/min per IP plus a global lockout after 20 failures per hour; failures are logged
  without the attempted password
* same CSRF/header/Origin guard as the user API; when disabled every /api/admin/* answers 404
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import struct
import threading
import time
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field

import analytics
import auth
import market_api
import social_api
import user_api

log = logging.getLogger("scent-atlas.admin")
ADMIN_COOKIE = "sa_admin"
ADMIN_TTL = 12 * 3600
MIN_ADMIN_PASSWORD = 16
HERE = Path(__file__).resolve().parent
ADMIN_PAGE = HERE / "static" / "next" / "admin.html"   # built from web/admin.html


def totp_key(secret: str | None) -> bytes | None:
    """Decode a base32 TOTP secret (spaces / lower case / missing padding tolerated); None if absent or invalid."""
    if not secret:
        return None
    s = secret.replace(" ", "").upper()
    try:
        key = base64.b32decode(s + "=" * (-len(s) % 8))
    except (binascii.Error, ValueError):
        return None
    return key if len(key) >= 10 else None


def totp_code(key: bytes, counter: int) -> str:
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    return f"{(struct.unpack('>I', mac[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def admin_enabled(settings) -> bool:
    if not settings.admin_password or len(settings.admin_password) < MIN_ADMIN_PASSWORD:
        return False
    if getattr(settings, "admin_totp_secret", None) and totp_key(settings.admin_totp_secret) is None:
        return False   # fail closed: a two-factor secret that cannot be read must not silently disable two-factor
    return True


def two_factor(settings) -> bool:
    return totp_key(getattr(settings, "admin_totp_secret", None)) is not None


class TotpGuard:
    """Checks codes against the current 30 s step +-1, and refuses a code (step) that was already used."""

    def __init__(self, key: bytes, clock=time.time):
        self.key, self.clock = key, clock
        self.last = -1
        self._lock = threading.Lock()

    def check(self, code: str | None, consume: bool = True) -> bool:
        """consume=False checks without using the code up (when the password was wrong, so a typo costs no code)."""
        code = (code or "").replace(" ", "")
        if len(code) != 6 or not code.isdigit():
            return False
        step = int(self.clock() // 30)
        with self._lock:
            for c in (step - 1, step, step + 1):
                if c > self.last and hmac.compare_digest(totp_code(self.key, c), code):
                    if consume:
                        self.last = c
                    return True
        return False


def cookie_name(secure: bool) -> str:
    # __Host- cookies must be Secure, Path=/ and have no Domain: the browser keeps them to this exact host
    return "__Host-sa_admin" if secure else ADMIN_COOKIE


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
    code: str | None = Field(default=None, max_length=12)


class NewPasswordBody(BaseModel):
    new_password: str = Field(max_length=1024)


class UpdateBody(BaseModel):
    username: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=320)


def _digest(s: str) -> bytes:
    return hashlib.sha256(s.encode("utf-8")).digest()


def make_admin_router(ctx) -> APIRouter:
    store, settings, cat = ctx.store, ctx.settings, ctx.cat
    sessions = AdminSessions()
    key = totp_key(getattr(settings, "admin_totp_secret", None))
    totp = TotpGuard(key) if key else None
    ip_limit = auth.RateLimiter(5, 60.0)
    lockout = FailureLockout(20, 3600.0)
    ctx.admin_sessions, ctx.admin_ip_limit, ctx.admin_lockout = sessions, ip_limit, lockout

    def enabled():
        if not admin_enabled(settings):
            raise HTTPException(404, "Not Found")

    def secure(request: Request) -> bool:
        return user_api.cookie_is_secure(request, settings)

    def token_of(request: Request):
        return request.cookies.get(cookie_name(secure(request)))

    def require_admin(request: Request):
        if not sessions.valid(token_of(request)):
            raise HTTPException(401, "Admin sign-in required.")

    def ip_of(request):
        return auth.client_ip(request, settings.trust_proxy, settings.proxy_hops)

    router = APIRouter(prefix="/api/admin", dependencies=[Depends(enabled), Depends(user_api.csrf_guard)])

    @router.get("/me")
    def me(request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"authenticated": sessions.valid(token_of(request)), "two_factor": totp is not None}

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
        if totp is not None:
            good = totp.check(body.code, consume=good) and good   # always checked, so timing says nothing about which failed
        if not good:
            lockout.fail()
            log.warning("failed admin login from %s", ip)  # never log the attempted password or code
            raise HTTPException(401, "Invalid password or code." if totp is not None else "Invalid password.")
        token = sessions.create()
        response.set_cookie(cookie_name(secure(request)), token, max_age=ADMIN_TTL, path="/", httponly=True,
                            samesite="strict", secure=secure(request))
        log.info("admin login from %s", ip)
        return {"ok": True}

    @router.post("/logout")
    def logout(request: Request, response: Response):
        sessions.drop(token_of(request))
        response.delete_cookie(cookie_name(secure(request)), path="/", httponly=True, samesite="strict", secure=secure(request))
        return {"ok": True}

    @router.get("/users", dependencies=[Depends(require_admin)])
    def list_users(q: str = ""):
        rows = store.admin_people(q[:80], since=int(time.time()) - 30 * 86400)   # selects safe columns only (never the hash)
        return {"users": [{
            "id": u["id"], "username": u["username"], "email": u["email"], **social_api.name_fields(u),
            "created_at": u["created_at"], "last_login_at": u["last_login_at"],
            "last_seen_at": max((t for t in (u["last_view"], u["last_session"], u["last_login_at"]) if t), default=None),
            "views_30d": u["views"], "owned": u["owned"], "friends": u["friends"], "reviews": u["reviews"],
            "sessions": u["sessions"]} for u in rows]}

    @router.get("/analytics", dependencies=[Depends(require_admin)])
    def analytics_report(response: Response, days: int = Query(30, ge=1, le=365), tz: str | None = Query(None, max_length=64)):
        response.headers["Cache-Control"] = "no-store"
        return analytics.report(store, cat, days, tz)

    @router.get("/activity", dependencies=[Depends(require_admin)])
    def activity(response: Response, limit: int = Query(100, ge=1, le=500), before: int | None = None,
                 user_id: int | None = None):
        response.headers["Cache-Control"] = "no-store"
        rows = store.recent_views(limit, before, user_id)
        return {"items": analytics.activity_out(rows, cat, social_api.avatar_url, social_api.name_fields),
                "next_before": rows[-1]["id"] if len(rows) == limit else None}

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

    market_api.make_admin_routes(router, ctx, require_admin, log, ip_of)
    return router


ROBOTS = {"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store"}


def admin_page(settings):
    """The admin app (one HTML page; its scripts and styles come from /next/assets/)."""
    if not admin_enabled(settings):
        return HTMLResponse(
            '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">'
            "<title>Admin disabled</title><body><p>Admin disabled.</p>",
            status_code=404, headers=ROBOTS)
    if not ADMIN_PAGE.is_file():
        return HTMLResponse("<!doctype html><title>Admin</title><p>The admin page has not been built (cd web && npm run build).</p>",
                            status_code=503, headers=ROBOTS)
    return FileResponse(ADMIN_PAGE, media_type="text/html", headers=ROBOTS)


def add_admin_pages(app, settings):
    """/admin (when no ADMIN_HOST is set; on the admin host the page is also served at /). Never linked or indexed."""

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/", include_in_schema=False)
    def admin_route():
        return admin_page(settings)
