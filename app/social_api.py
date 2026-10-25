"""Friends and profiles: search people, send / accept / remove friend requests, and view a profile.

Privacy: a profile's shelf, favourites and scent profile are visible to the owner and to accepted friends only.
Everyone signed in sees just the username, join date and counts. Private notes, history and saved searches are
never shown to anyone else."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from userdb import STATUSES

PENDING_CAP = 100     # outstanding friend requests one account may have at a time


def make_router(ctx, current_user, require_user, collection_out) -> APIRouter:
    store, cat = ctx.store, ctx.cat
    router = APIRouter()

    def person(u: dict, me: dict | None) -> dict:
        return {"username": u["username"], "created_at": u["created_at"],
                "relation": store.relation(me["id"], u["id"]) if me else "none"}

    def target(username: str) -> dict:
        u = store.user_by_username(username)
        if not u:
            raise HTTPException(404, "No one goes by that name.")
        return u

    @router.get("/users/search")
    def search_users(response: Response, q: str = "", user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        q = q.strip()[:32]
        return {"users": [person(u, user) for u in store.search_users(q, 10, exclude=user["id"])] if q else []}

    @router.get("/friends")
    def friends(response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        return store.list_friends(user["id"])

    @router.post("/friends/{username}")
    def add_friend(username: str, user=Depends(require_user)):
        other = target(username)
        if other["id"] == user["id"]:
            raise HTTPException(400, "That's you.")
        rel = store.relation(user["id"], other["id"])
        if rel == "none" and store.pending_outgoing(user["id"]) >= PENDING_CAP:
            raise HTTPException(429, "You have too many unanswered friend requests. Wait for some replies first.")
        return {"relation": store.request_friend(user["id"], other["id"])}

    @router.delete("/friends/{username}")
    def remove_friend(username: str, user=Depends(require_user)):
        other = target(username)
        store.remove_friend(user["id"], other["id"])
        return {"relation": "none" if other["id"] != user["id"] else "self"}

    @router.get("/users/{username}")
    def profile(username: str, response: Response, user=Depends(require_user)):
        response.headers["Cache-Control"] = "no-store"
        u = target(username)
        out = person(u, user)
        uid = u["id"]
        statuses = store.list_status(uid)
        out["counts"] = {"owned": sum(r["status"] == "owned" for r in statuses), "friends": store.friend_count(uid)}
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

    return router
