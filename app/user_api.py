"""Accounts + per-user data API (everything under /api/auth and /api/me, plus /api/favorites)."""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import auth
import collection
import layer_api
import social_api
import query
import taste
import userdb
from userdb import STATUSES

SESSION_COOKIE = "sa_session"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "scent-atlas"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class Ctx:
    store: userdb.UserStore
    cat: object
    settings: object
    user_path: object                      # legacy data/user.json (imported into the first local account)
    limit_login_ip: auth.RateLimiter
    limit_login_acct: auth.RateLimiter
    limit_signup_ip: auth.RateLimiter
    limit_signup_acct: auth.RateLimiter
    limit_pw_acct: auth.RateLimiter
    import_lock: threading.Lock


# ---------------------------------------------------------------------------- request-level helpers
def is_https(request: Request, settings) -> bool:
    if settings.trust_proxy:
        proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
        if proto:
            return proto == "https"
    return request.url.scheme == "https"


def cookie_is_secure(request: Request, settings) -> bool:
    if settings.cookie_secure in ("1", "true", "yes"):
        return True
    if settings.cookie_secure in ("0", "false", "no"):
        return False
    return auth.host_only(request.headers.get("host", "")) not in auth.LOCAL_HOSTS


def set_session_cookie(response: Response, request: Request, settings, token: str):
    response.set_cookie(
        SESSION_COOKIE, token, max_age=settings.session_days * 86400, path="/", httponly=True,
        samesite="lax", secure=cookie_is_secure(request, settings))


def clear_session_cookie(response: Response, request: Request, settings):
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax",
                           secure=cookie_is_secure(request, settings))


def public_user(u: dict) -> dict:
    return {"id": u["id"], "username": u["username"], "email": u["email"], "created_at": u["created_at"],
            **social_api.name_fields(u), "needs_name": social_api.needs_name(u)}


def sanitize_state(cat, kind: str, state: dict) -> dict:
    """Whitelist + validate a saved/history query state (never trust the client's JSON).

    Combine states go through query.canonical_state, which also migrates the old saved shape
    (include / exclude / mode / sort / gender / brand / year_min / year_max) to the current one."""
    if kind == "combine":
        return query.canonical_state(cat, state)
    out: dict[str, str] = {}
    if not isinstance(state, dict):
        return out
    p = query._clean_params(state)
    for k in ("top", "middle", "base", "any"):
        res = []
        for part in p.get(k, "").split(",")[:60]:
            slug = part.strip().partition("@")[0]
            if slug in cat.note_index:
                res.append(slug)
        if res:
            out[k] = ",".join(res)
    out.update(query.canonical_filters(cat, p))
    return out


def state_has_notes(kind: str, state: dict) -> bool:
    return bool(state.get("include") or state.get("q")) if kind == "combine" else any(state.get(k) for k in ("top", "middle", "base", "any"))


def state_label(cat, kind: str, state: dict) -> str:
    def names(csvs):
        out = []
        for part in csvs.split(","):
            slug, _, layer = part.partition("@")
            j = cat.note_index.get(slug)
            if j is not None:
                out.append(cat.note_name[j] + (f" ({'heart' if layer == 'middle' else layer})" if layer else ""))
        return out

    if kind == "combine":
        if state.get("q") or state.get("adv"):
            return query.state_summary(cat, state)[:230]
        inc = names(state.get("include", ""))
        txt = (" + " if state.get("mode") != "any" else " or ").join(inc)
        if state.get("exclude"):
            txt += ", without " + ", ".join(names(state["exclude"]))
        return txt[:230]
    parts = []
    for k, lab in (("top", "Top"), ("middle", "Heart"), ("base", "Base"), ("any", "Any")):
        if state.get(k):
            parts.append(f"{lab}: " + ", ".join(names(state[k])))
    return " · ".join(parts)[:230]


# ---------------------------------------------------------------------------- bodies
class SignupBody(BaseModel):
    first_name: str | None = Field(default=None, max_length=200)
    last_name: str | None = Field(default=None, max_length=200)
    username: str = Field(max_length=64)
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class LoginBody(BaseModel):
    identifier: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class PasswordBody(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)


class DeleteBody(BaseModel):
    password: str = Field(max_length=1024)


class FavBody(BaseModel):
    type: str
    id: str | int
    liked: bool = True


class StatusBody(BaseModel):
    status: str | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    note: str | None = Field(default=None, max_length=500)


class CollectionAddBody(BaseModel):
    perfume_id: int
    rank: int | None = Field(default=None, ge=1, le=userdb.COLLECTION_CAP)


class OrderBody(BaseModel):
    ids: list[int] = Field(max_length=userdb.COLLECTION_CAP)


class SavedBody(BaseModel):
    kind: str
    name: str = Field(min_length=1, max_length=80)
    state: dict


class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class HistoryBody(BaseModel):
    kind: str
    perfume_id: int | None = None
    state: dict | None = None


def csrf_guard(request: Request):
    """State-changing requests need the custom header (forces a CORS preflight we never grant),
    a JSON content type when they carry a body, and - when present - a same-origin Origin."""
    if request.method in SAFE_METHODS:
        return
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise HTTPException(403, "Missing X-Requested-With header.")
    if request.method in ("POST", "PUT", "PATCH") and not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise HTTPException(415, "Content-Type must be application/json.")
    if request.headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
        raise HTTPException(403, "Cross-site request blocked.")
    origin = request.headers.get("origin")
    if origin is not None:
        host = request.headers.get("host", "").lower()
        o = origin.lower()
        netloc = o.split("://", 1)[1] if "://" in o else o
        if netloc.rstrip("/") != host:
            raise HTTPException(403, "Cross-origin request blocked.")


def make_router(ctx: Ctx) -> APIRouter:
    store, cat, settings = ctx.store, ctx.cat, ctx.settings

    # ---- guards ------------------------------------------------------------------------------
    def current_user(request: Request):
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return None
        th = auth.token_hash(token)
        user, refreshed = store.session_user(th, settings.session_days * 86400)
        request.state.session_token = token
        request.state.session_hash = th
        if user is None:
            request.state.clear_cookie = True
            return None
        if refreshed:
            request.state.refresh_cookie = token  # middleware re-issues the cookie (sliding expiry)
        return user

    def require_user(user=Depends(current_user)):
        if user is None:
            raise HTTPException(401, "Sign in to continue.")
        return user

    def limited(limiter: auth.RateLimiter, key: str):
        ok, retry = limiter.hit(key)
        if not ok:
            raise HTTPException(429, "Too many attempts. Please wait a minute and try again.", headers={"Retry-After": str(retry)})

    def ip_of(request: Request) -> str:
        return auth.client_ip(request, settings.trust_proxy, settings.proxy_hops)

    def start_session(response: Response, request: Request, uid: int):
        token = auth.new_token()
        store.create_session(uid, auth.token_hash(token), settings.session_days * 86400)
        set_session_cookie(response, request, settings, token)

    router = APIRouter(prefix="/api", dependencies=[Depends(csrf_guard)])

    # ---- auth --------------------------------------------------------------------------------
    @router.post("/auth/signup", status_code=201)
    def signup(body: SignupBody, request: Request, response: Response):
        username, email = body.username.strip(), body.email.strip()
        limited(ctx.limit_signup_ip, f"ip:{ip_of(request)}")
        limited(ctx.limit_signup_acct, f"u:{username.lower()}")
        limited(ctx.limit_signup_acct, f"e:{email.lower()}")
        names = auth.clean_name(body.first_name, body.last_name) if body.first_name is not None else None
        problem = (names if isinstance(names, str) else None) or auth.valid_username(username) or auth.valid_email(email) \
            or auth.password_problem(body.password, username, email)
        if problem:
            raise HTTPException(422, problem)
        try:
            user = store.create_user(username, email, auth.hash_password(body.password), *(names or (None, None)))
        except ValueError as e:
            raise HTTPException(409, "That username is already taken." if str(e) == "username"
                                else "An account with that email already exists.")
        import_legacy_favorites(user["id"])
        start_session(response, request, user["id"])
        return {"user": public_user(user)}

    @router.post("/auth/login")
    def login(body: LoginBody, request: Request, response: Response):
        ident = body.identifier.strip()
        limited(ctx.limit_login_ip, f"ip:{ip_of(request)}")
        limited(ctx.limit_login_acct, f"a:{ident.lower()}")
        user = store.find_user(ident) if ident else None
        ok = auth.verify_password(user["password_hash"] if user else None, body.password)
        if not (user and ok):
            raise HTTPException(401, "Invalid username/email or password.")
        if auth.needs_rehash(user["password_hash"]):
            store.update_hash(user["id"], auth.hash_password(body.password))
        store.touch_login(user["id"])
        if social_api.needs_name(user) and not store.has_notification(user["id"], "name_reminder"):
            store.notify(user["id"], "name_reminder")   # once; it goes away when they set their name
        start_session(response, request, user["id"])
        return {"user": public_user(user)}

    @router.post("/auth/logout")
    def logout(request: Request, response: Response):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            store.delete_session(auth.token_hash(token))
        clear_session_cookie(response, request, settings)
        request.state.clear_cookie = False
        return {"ok": True}

    @router.post("/auth/password")
    def change_password(body: PasswordBody, request: Request, user=Depends(require_user)):
        limited(ctx.limit_pw_acct, f"pw:{user['id']}")
        if not auth.verify_password(user["password_hash"], body.current_password):
            raise HTTPException(403, "Current password is incorrect.")
        problem = auth.password_problem(body.new_password, user["username"], user["email"])
        if problem:
            raise HTTPException(422, problem)
        store.set_password(user["id"], auth.hash_password(body.new_password), keep_token_hash=request.state.session_hash)
        return {"ok": True}

    @router.post("/auth/delete")
    def delete_account(body: DeleteBody, request: Request, response: Response, user=Depends(require_user)):
        limited(ctx.limit_pw_acct, f"pw:{user['id']}")
        if not auth.verify_password(user["password_hash"], body.password):
            raise HTTPException(403, "Password is incorrect.")
        store.delete_user(user["id"])
        clear_session_cookie(response, request, settings)
        request.state.clear_cookie = False
        return {"ok": True}

    # ---- me ----------------------------------------------------------------------------------
    def statuses_compact(uid):
        return {str(r["perfume_id"]): {"status": r["status"], "rating": r["rating"], "has_note": bool(r["note"])}
                for r in store.list_status(uid)}

    @router.get("/me")
    def me(response: Response, user=Depends(current_user)):
        response.headers["Cache-Control"] = "no-store"
        if user is None:
            return {"user": None, "favorites": {"perfumes": [], "notes": []}, "statuses": {}}
        return {"user": public_user(user), "favorites": store.list_favorites(user["id"]), "statuses": statuses_compact(user["id"])}

    # ---- favorites (kept at the old path) -------------------------------------------------
    @router.get("/favorites")
    def favorites(response: Response, user=Depends(current_user)):
        response.headers["Cache-Control"] = "no-store"
        d = store.list_favorites(user["id"]) if user else {"perfumes": [], "notes": []}
        pf = [cat.summary(i) for i in (cat.idx_of(p) for p in d["perfumes"]) if i is not None]
        nf = [cat.note_obj(j) for j in (cat.note_index.get(s) for s in d["notes"]) if j is not None]
        return {"authenticated": user is not None, "perfumes": d["perfumes"], "notes": d["notes"],
                "perfume_items": pf, "note_items": nf}

    @router.post("/favorites")
    def favorites_set(body: FavBody, user=Depends(require_user)):
        if body.type == "perfume":
            try:
                pid = int(body.id)
            except (TypeError, ValueError):
                raise HTTPException(400, "bad id")
            if cat.idx_of(pid) is None:
                raise HTTPException(404, "perfume not found")
            kind, ref = "perfume", str(pid)
        elif body.type == "note":
            if str(body.id) not in cat.note_index:
                raise HTTPException(404, "note not found")
            kind, ref = "note", str(body.id)
        else:
            raise HTTPException(400, "type must be perfume|note")
        store.set_favorite(user["id"], kind, ref, body.liked)
        return store.list_favorites(user["id"])

    # ---- personal status / rating / note ----------------------------------------------------
    def status_out(row):
        return {"status": row["status"], "rating": row["rating"], "note": row["note"]} if row else {"status": None, "rating": None, "note": None}

    @router.get("/me/perfumes")
    def my_perfumes(status: str | None = None, user=Depends(require_user)):
        if status and status not in STATUSES:
            raise HTTPException(400, "status must be owned|tried|wishlist")
        items = []
        for r in store.list_status(user["id"], status):
            i = cat.idx_of(r["perfume_id"])
            if i is not None:
                items.append({**cat.summary(i), "my": status_out(r), "updated_at": r["updated_at"]})
        return {"items": items}

    @router.get("/me/perfumes/{pid}")
    def my_perfume(pid: int, user=Depends(require_user)):
        return status_out(store.get_status(user["id"], pid))

    @router.put("/me/perfumes/{pid}")
    def put_my_perfume(pid: int, body: StatusBody, user=Depends(require_user)):
        if cat.idx_of(pid) is None:
            raise HTTPException(404, "perfume not found")
        fields = {}
        given = body.model_fields_set
        if "status" in given:
            if body.status is not None and body.status not in STATUSES:
                raise HTTPException(400, "status must be owned|tried|wishlist or null")
            fields["status"] = body.status
        if "rating" in given:
            fields["rating"] = body.rating
        if "note" in given:
            fields["note"] = body.note
        res = store.put_status(user["id"], pid, fields)
        return status_out(res)

    @router.delete("/me/perfumes/{pid}")
    def delete_my_perfume(pid: int, user=Depends(require_user)):
        store.put_status(user["id"], pid, {"status": None, "rating": None, "note": None})
        return status_out(None)

    # ---- My Collection: owned perfumes, the leaderboard order and the scent profile -----------------
    def collection_out(uid):
        rows = [r for r in store.list_status(uid, "owned") if cat.idx_of(r["perfume_id"]) is not None]
        rows.sort(key=lambda r: (r["rank_pos"] is None, r["rank_pos"] or 0, -r["updated_at"]))
        items = [{**cat.summary(cat.idx_of(r["perfume_id"])), "my": status_out(r), "rank": r["rank_pos"],
                  "added_at": r["updated_at"]} for r in rows]
        return {"items": items, "order": [r["perfume_id"] for r in rows if r["rank_pos"]],
                "profile": collection.build(cat, rows)}

    @router.get("/me/collection")
    def my_collection(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        return collection_out(user["id"])

    @router.post("/me/collection")
    def add_to_collection(body: CollectionAddBody, user=Depends(require_user)):
        """Mark a perfume as owned; with `rank` it is also placed on the leaderboard at that position (1 = best)."""
        if cat.idx_of(body.perfume_id) is None:
            raise HTTPException(404, "perfume not found")
        uid = user["id"]
        store.put_status(uid, body.perfume_id, {"status": "owned"})
        if body.rank is not None:
            order = [p for p in store.collection_order(uid) if p != body.perfume_id]
            order.insert(min(body.rank, len(order) + 1) - 1, body.perfume_id)
            store.set_collection_order(uid, order)
        return collection_out(uid)

    @router.put("/me/collection/order")
    def set_order(body: OrderBody, user=Depends(require_user)):
        store.set_collection_order(user["id"], body.ids)
        return collection_out(user["id"])

    # ---- saved searches ------------------------------------------------------------------------
    def saved_out(r):
        notes = []
        st = r["state"]
        st = sanitize_state(cat, r["kind"], st)   # old saved shapes are migrated on the way out
        if r["kind"] == "combine":
            slugs = query.state_note_slugs(cat, st)
        else:
            slugs = [p.partition("@")[0] for k in ("top", "middle", "base", "any") for p in (st.get(k) or "").split(",")]
        for slug in slugs:
            j = cat.note_index.get(slug)
            if j is not None and len(notes) < 6:
                notes.append({"slug": cat.note_slug[j], "name": cat.note_name[j], "image": cat.note_image(j)})
        return {"id": r["id"], "kind": r["kind"], "name": r["name"], "state": st, "notes": notes,
                "summary": state_label(cat, r["kind"], st), "updated_at": r["updated_at"]}

    @router.get("/me/saved")
    def list_saved(kind: str | None = None, user=Depends(require_user)):
        if kind and kind not in ("combine", "pyramid"):
            raise HTTPException(400, "kind must be combine|pyramid")
        return {"items": [saved_out(r) for r in store.list_saved(user["id"], kind)]}

    @router.post("/me/saved", status_code=201)
    def create_saved(body: SavedBody, user=Depends(require_user)):
        if body.kind not in ("combine", "pyramid"):
            raise HTTPException(400, "kind must be combine|pyramid")
        state = sanitize_state(cat, body.kind, body.state)
        if not state_has_notes(body.kind, state):
            raise HTTPException(422, "Add at least one note before saving.")
        try:
            sid = store.save_search(user["id"], body.kind, body.name.strip(), state)
        except OverflowError:
            raise HTTPException(409, f"You can keep up to {userdb.SAVED_CAP} saved searches.")
        return {"id": sid}

    @router.patch("/me/saved/{sid}")
    def rename_saved(sid: int, body: RenameBody, user=Depends(require_user)):
        try:
            ok = store.rename_saved(user["id"], sid, body.name.strip())
        except ValueError:
            raise HTTPException(409, "You already have a saved search with that name.")
        if not ok:
            raise HTTPException(404, "not found")
        return {"ok": True}

    @router.delete("/me/saved/{sid}")
    def delete_saved(sid: int, user=Depends(require_user)):
        if not store.delete_saved(user["id"], sid):
            raise HTTPException(404, "not found")
        return {"ok": True}

    # ---- history -------------------------------------------------------------------------------
    def history_out(r):
        st = sanitize_state(cat, r["kind"], r["state"]) if r["kind"] in ("combine", "pyramid") and r["state"] else r["state"]
        d = {"id": r["id"], "kind": r["kind"], "label": r["label"], "created_at": r["created_at"], "state": st}
        if r["kind"] in ("view", "like"):
            i = cat.idx_of(int(r["ref"])) if r["ref"].isdigit() else None
            if i is None:
                return None
            d["perfume"] = cat.summary(i)
        return d

    @router.get("/me/history")
    def list_history(kind: str | None = None, limit: int = 200, user=Depends(require_user)):
        rows = store.list_history(user["id"], kind, max(1, min(limit, userdb.HISTORY_CAP)))
        return {"items": [d for d in (history_out(r) for r in rows) if d]}

    @router.post("/me/history", status_code=201)
    def add_history(body: HistoryBody, user=Depends(require_user)):
        if body.kind in ("view", "like"):
            i = cat.idx_of(body.perfume_id) if body.perfume_id is not None else None
            if i is None:
                raise HTTPException(404, "perfume not found")
            store.add_history(user["id"], body.kind, str(body.perfume_id), f"{cat.name(i)} - {cat.brand(i)}", None)
        elif body.kind in ("pyramid", "combine"):
            state = sanitize_state(cat, body.kind, body.state or {})
            if not state_has_notes(body.kind, state):
                raise HTTPException(422, "empty query")
            ref = urlencode(sorted(state.items()))
            store.add_history(user["id"], body.kind, ref, state_label(cat, body.kind, state), state)
        else:
            raise HTTPException(400, "kind must be view|like|pyramid|combine")
        return {"ok": True}

    @router.delete("/me/history")
    def clear_history(user=Depends(require_user)):
        store.clear_history(user["id"])
        return {"ok": True}

    @router.delete("/me/history/{hid}")
    def delete_history(hid: int, user=Depends(require_user)):
        if not store.delete_history(user["id"], hid):
            raise HTTPException(404, "not found")
        return {"ok": True}

    # ---- taste profile + the whole "My Atlas" page in one call ----------------------------------
    def profile_for(uid):
        favs = store.list_favorites(uid)["perfumes"]
        return taste.build_profile(cat, favs, store.list_status(uid))

    @router.get("/me/profile")
    def my_profile(user=Depends(require_user)):
        return profile_for(user["id"])

    @router.get("/me/atlas")
    def atlas(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        uid = user["id"]
        fav = store.list_favorites(uid)
        coll = {s: [] for s in STATUSES}
        rated_only = []
        for r in store.list_status(uid):
            i = cat.idx_of(r["perfume_id"])
            if i is None:
                continue
            item = {**cat.summary(i), "my": status_out(r)}
            (coll[r["status"]] if r["status"] in coll else rated_only).append(item)
        hist = [d for d in (history_out(r) for r in store.list_history(uid, None, 60)) if d]
        return {
            "user": public_user(user),
            "favorites": {
                "perfumes": [cat.summary(i) for i in (cat.idx_of(p) for p in fav["perfumes"]) if i is not None],
                "notes": [cat.note_obj(j) for j in (cat.note_index.get(s) for s in fav["notes"]) if j is not None],
            },
            "collection": coll, "rated_only": rated_only,
            "saved": [saved_out(r) for r in store.list_saved(uid)],
            "history": hist,
            "profile": taste.build_profile(cat, fav["perfumes"], store.list_status(uid)),
        }

    # ---- legacy import ---------------------------------------------------------------------------
    def import_legacy_favorites(uid: int):
        """First account ever created on this install adopts the old data/user.json favourites."""
        path = ctx.user_path
        if not path:
            return
        with ctx.import_lock:
            try:
                if store.get_meta("legacy_user_json_imported") or store.count_users() != 1 or not path.exists():
                    return
                d = json.loads(path.read_text(encoding="utf-8"))
                perfumes = [int(x) for x in d.get("perfumes", []) if cat.idx_of(int(x)) is not None]
                notes = [str(x) for x in d.get("notes", []) if str(x) in cat.note_index]
                store.import_favorites(uid, perfumes, notes)
                store.set_meta("legacy_user_json_imported", "1")
            except Exception:
                pass  # a malformed legacy file must never block sign-up

    router.include_router(layer_api.make_router(ctx, current_user, require_user))
    router.include_router(social_api.make_router(ctx, current_user, require_user, collection_out))
    return router
