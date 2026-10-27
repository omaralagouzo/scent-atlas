"""People, friends, profiles, profile photos, notifications and reviews.

Privacy: a profile's shelf, favourites and scent profile are visible to the owner and to accepted friends only.
Everyone signed in sees a member's name, username, photo, join date and counts. Private notes, history and saved
searches are never shown to anyone else. Reviews are public (the review form says so).

Notifications are rows in the database that the client polls for (a cheap unread count every minute and when the
tab regains focus). At a few hundred or thousand members that is lighter and sturdier than holding a live connection
open per visitor; if live delivery is ever needed, the same table can feed Server-Sent Events."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

import auth
import avatar
from userdb import PLACEHOLDER_NAME, STATUSES

PENDING_CAP = 100     # outstanding friend requests one account may have at a time
REVIEW_MAX = 2000     # characters in a review


def avatar_url(u: dict) -> str | None:
    return f"/api/avatars/{u['id']}.webp?v={u['avatar_at']}" if u.get("avatar_at") else None


def needs_name(u: dict) -> bool:
    return (u.get("first_name"), u.get("last_name")) == PLACEHOLDER_NAME or not u.get("first_name")


def name_fields(u: dict) -> dict:
    """The public identity of a member: names, display name and photo."""
    first, last = u.get("first_name") or "", u.get("last_name") or ""
    return {"first_name": first, "last_name": last, "name": " ".join(x for x in (first, last) if x) or u["username"],
            "avatar": avatar_url(u)}


class NameBody(BaseModel):
    first_name: str = Field(max_length=200)
    last_name: str = Field(default="", max_length=200)


class AvatarBody(BaseModel):
    data: str = Field(max_length=300_000)   # a data: URL; the server request limit is 256 KB anyway


class ReadBody(BaseModel):
    ids: list[int] | None = Field(default=None, max_length=500)


class ReviewBody(BaseModel):
    rating: int = Field(ge=1, le=5)
    longevity: int | None = Field(default=None, ge=1, le=5)
    sillage: int | None = Field(default=None, ge=1, le=5)
    body: str | None = Field(default=None, max_length=REVIEW_MAX + 200)


def make_router(ctx, current_user, require_user, collection_out) -> APIRouter:
    store, cat = ctx.store, ctx.cat
    router = APIRouter()

    def relations(me: dict | None) -> dict[int, str]:
        """{user id: relation} for everyone I have a friendship row with (one query for a whole list)."""
        if not me:
            return {}
        lists = store.list_friends(me["id"])
        return {p["id"]: kind for kind, rows in lists.items() for p in rows} | {me["id"]: "self"}

    def person(u: dict, me: dict | None, rel: dict[int, str] | None = None) -> dict:
        r = rel.get(u["id"], "none") if rel is not None else store.relation(me["id"], u["id"]) if me else "none"
        out = {"username": u["username"], "created_at": u["created_at"], "relation": r, **name_fields(u)}
        if "owned" in u:
            out["owned"] = u["owned"]
        return out

    def target(username: str) -> dict:
        u = store.user_by_username(username)
        if not u:
            raise HTTPException(404, "No one goes by that name.")
        return u

    def perfume_or_404(pid: int) -> int:
        if cat.idx_of(pid) is None:
            raise HTTPException(404, "Unknown perfume.")
        return pid

    # ---- people ------------------------------------------------------------------------------
    @router.get("/users/search")
    def search_users(response: Response, q: str = "", user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        q = q.strip()[:40]
        rel = relations(user)
        return {"users": [person(u, user, rel) for u in store.search_users(q, 10, exclude=user["id"])] if q else []}

    @router.get("/people")
    def people(response: Response, q: str = "", offset: int = Query(0, ge=0, le=100_000),
               limit: int = Query(30, ge=1, le=60), user=Depends(require_user)):
        """The member directory: everyone (except me), or those matching q by username or name."""
        response.headers["Cache-Control"] = "no-store"
        rows, total = store.people(q.strip()[:40], limit, offset, exclude=user["id"])
        rel = relations(user)
        return {"people": [person(u, user, rel) for u in rows], "total": total,
                "next_offset": offset + len(rows) if offset + len(rows) < total else None}

    # ---- my name and photo ---------------------------------------------------------------------
    @router.put("/me/name")
    def set_name(body: NameBody, user=Depends(require_user)):
        r = auth.clean_name(body.first_name, body.last_name)
        if isinstance(r, str):
            raise HTTPException(422, r)
        u = store.set_name(user["id"], *r)
        store.unnotify(user["id"], "name_reminder")
        return {"user": {**name_fields(u), "needs_name": needs_name(u)}}

    @router.put("/me/avatar")
    def set_avatar(body: AvatarBody, user=Depends(require_user)):
        try:
            data = avatar.process(avatar.decode_data_url(body.data))
        except avatar.AvatarError as e:
            raise HTTPException(422, str(e))
        at = store.set_avatar(user["id"], data, "image/webp")
        return {"avatar": avatar_url({"id": user["id"], "avatar_at": at})}

    @router.delete("/me/avatar")
    def delete_avatar(user=Depends(require_user)):
        store.delete_avatar(user["id"])
        return {"avatar": None}

    @router.get("/avatars/{uid}.webp", include_in_schema=False)
    def get_avatar(uid: int):
        a = store.get_avatar(uid)
        if not a:
            raise HTTPException(404, "No photo.")
        # the URL carries ?v=<version>, so a changed photo gets a new URL and this one can be cached for good
        return Response(a["data"], media_type=a["mime"], headers={"Cache-Control": "public, max-age=31536000, immutable"})

    # ---- friends -------------------------------------------------------------------------------
    @router.get("/friends")
    def friends(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        return {kind: [{**person(p, user, {p["id"]: kind}), "id": p["id"], "since": p["since"]} for p in rows]
                for kind, rows in store.list_friends(user["id"]).items()}

    @router.post("/friends/{username}")
    def add_friend(username: str, user=Depends(require_user)):
        other = target(username)
        if other["id"] == user["id"]:
            raise HTTPException(400, "That's you.")
        rel = store.relation(user["id"], other["id"])
        if rel == "none" and store.pending_outgoing(user["id"]) >= PENDING_CAP:
            raise HTTPException(429, "You have too many unanswered friend requests. Wait for some replies first.")
        new = store.request_friend(user["id"], other["id"])
        if rel == "none" and new == "outgoing":
            store.notify(other["id"], "friend_request", user["id"])
        elif rel == "incoming" and new == "friends":
            store.notify(other["id"], "friend_accept", user["id"])
            store.mark_read_from(user["id"], "friend_request", other["id"])
        return {"relation": new}

    @router.delete("/friends/{username}")
    def remove_friend(username: str, user=Depends(require_user)):
        other = target(username)
        rel = store.relation(user["id"], other["id"])
        store.remove_friend(user["id"], other["id"])
        if rel == "outgoing":      # a request I withdrew should not linger in their notifications
            store.unnotify(other["id"], "friend_request", user["id"])
        elif rel == "incoming":    # declined: clear it from mine
            store.unnotify(user["id"], "friend_request", other["id"])
        return {"relation": "none" if other["id"] != user["id"] else "self"}

    # ---- notifications -------------------------------------------------------------------------
    @router.get("/notifications")
    def notifications(response: Response, limit: int = Query(30, ge=1, le=100), user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        items = []
        for n in store.list_notifications(user["id"], limit):
            actor = None
            if n["actor_id"] is not None:
                a = {"id": n["actor_id"], "username": n["actor_username"], "first_name": n["actor_first_name"],
                     "last_name": n["actor_last_name"], "avatar_at": n["actor_avatar_at"]}
                actor = {"username": a["username"], **name_fields(a)}
            items.append({"id": n["id"], "kind": n["kind"], "ref": n["ref"], "created_at": n["created_at"],
                          "read": n["read_at"] is not None, "actor": actor})
        return {"items": items, "unread": store.unread_count(user["id"])}

    @router.get("/notifications/unread")
    def unread(response: Response, user=Depends(current_user)):
        response.headers["Cache-Control"] = "no-store"
        return {"unread": store.unread_count(user["id"]) if user else 0}

    @router.post("/notifications/read")
    def mark_read(body: ReadBody, user=Depends(require_user)):
        store.mark_read(user["id"], body.ids)
        return {"unread": store.unread_count(user["id"])}

    # ---- profiles ------------------------------------------------------------------------------
    @router.get("/users/{username}")
    def profile(username: str, response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        u = target(username)
        out = person(u, user)
        uid = u["id"]
        statuses = store.list_status(uid)
        out["counts"] = {"owned": sum(r["status"] == "owned" for r in statuses), "friends": store.friend_count(uid),
                         "reviews": store.review_count(uid)}
        out["visible"] = out["relation"] in ("self", "friends")
        if not out["visible"]:
            return out
        coll = collection_out(uid)
        for it in coll["items"]:            # private notes stay private
            it["my"] = {"status": it["my"]["status"], "rating": it["my"]["rating"]}
        shelf = {s: [] for s in STATUSES if s != "owned"}
        for r in statuses:
            i = cat.idx_of(r["perfume_id"])
            if i is not None and r["status"] in shelf:
                shelf[r["status"]].append({**cat.summary(i), "my": {"status": r["status"], "rating": r["rating"]}})
        fav = store.list_favorites(uid)
        out.update({
            "collection": coll,
            "tried": shelf["tried"], "wishlist": shelf["wishlist"],
            "favorites": {
                "perfumes": [cat.summary(i) for i in (cat.idx_of(p) for p in fav["perfumes"]) if i is not None],
                "notes": [cat.note_obj(j) for j in (cat.note_index.get(s) for s in fav["notes"]) if j is not None],
            },
        })
        out["counts"].update({"tried": len(shelf["tried"]), "wishlist": len(shelf["wishlist"]),
                              "favorites": len(out["favorites"]["perfumes"]) + len(out["favorites"]["notes"])})
        return out

    # ---- reviews and what members think of a perfume -----------------------------------------
    def review_out(r: dict, me: dict | None, friend_set: set[int]) -> dict:
        who = {"id": r["user_id"], "username": r["username"], "first_name": r["first_name"],
               "last_name": r["last_name"], "avatar_at": r["avatar_at"]}
        return {"rating": r["rating"], "longevity": r["longevity"], "sillage": r["sillage"], "body": r["body"],
                "created_at": r["created_at"], "updated_at": r["updated_at"],
                "author": {"username": r["username"], **name_fields(who)},
                "mine": bool(me and r["user_id"] == me["id"]), "friend": r["user_id"] in friend_set}

    @router.get("/perfumes/{pid}/community")
    def community(pid: int, response: Response, offset: int = Query(0, ge=0, le=100_000),
                  limit: int = Query(20, ge=1, le=50), user=Depends(current_user)):
        """Member reviews (friends first), review stats, how many members own / tried / want it, and which of my
        friends do. Signed-out visitors see the reviews and totals."""
        response.headers["Cache-Control"] = "no-store"
        perfume_or_404(pid)
        friend_ids = store.friend_ids(user["id"]) if user else []
        fs = set(friend_ids)
        rows = store.reviews_for(pid, limit, offset, first=friend_ids)
        stats = store.review_stats(pid)
        out = {"stats": stats, "members": store.status_counts(pid),
               "reviews": [review_out(r, user, fs) for r in rows],
               "next_offset": offset + len(rows) if offset + len(rows) < stats["count"] else None,
               "mine": None, "friends": []}
        if user:
            mine = store.get_review(user["id"], pid)
            if mine:
                out["mine"] = {k: mine[k] for k in ("rating", "longevity", "sillage", "body", "created_at", "updated_at")}
            st = store.statuses_of(pid, friend_ids)
            ppl = store.people_by_id(list(st))
            out["friends"] = sorted(({"username": ppl[i]["username"], **name_fields(ppl[i]), "status": s}
                                     for i, s in st.items() if i in ppl), key=lambda p: (STATUSES.index(p["status"]), p["name"].lower()))
        return out

    @router.put("/me/reviews/{pid}")
    def put_review(pid: int, body: ReviewBody, user=Depends(require_user)):
        perfume_or_404(pid)
        text = "\n".join(line.rstrip() for line in (body.body or "").strip().splitlines()).strip() or None
        if text and len(text) > REVIEW_MAX:
            raise HTTPException(422, f"Reviews can be at most {REVIEW_MAX} characters.")
        r = store.put_review(user["id"], pid, body.rating, body.longevity, body.sillage, text)
        return {"review": {k: r[k] for k in ("rating", "longevity", "sillage", "body", "created_at", "updated_at")},
                "stats": store.review_stats(pid)}

    @router.delete("/me/reviews/{pid}")
    def delete_review(pid: int, user=Depends(require_user)):
        store.delete_review(user["id"], pid)
        return {"review": None, "stats": store.review_stats(pid)}

    return router
