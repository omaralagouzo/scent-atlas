"""First-party analytics: the app reports each page it shows; the owner reads the totals on the admin dashboard.

No third-party script, no cookie banner, nothing blocked by ad blockers, and the data stays in our own database.
What is kept per page view: time, path (never the query string), a random visitor id the browser made up, the
signed-in account (if any), the referring site's host (first page of a visit only), phone / tablet / desktop, the
browser family and the device's time zone (a rough location without looking up anyone's IP address). IP addresses
are used only for rate limiting, in memory, and never stored. Rows older than RETENTION_DAYS are deleted.
"""
from __future__ import annotations

import re
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import auth

RETENTION_DAYS = 400
VISITOR_RE = re.compile(r"^[A-Za-z0-9_-]{8,40}$")
PATH_RE = re.compile(r"^/[A-Za-z0-9/_.:@%+,~-]{0,199}$")
BOT_RE = re.compile(r"bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|python-requests|curl", re.I)

SECTIONS = [  # (key, label, matcher on the first path segment)
    ("perfume", "Perfume pages", ("perfume",)),
    ("like", "Smells like", ("like",)),
    ("layering", "Layering", ("layering",)),
    ("notes", "Notes library", ("notes", "note")),
    ("combine", "Combination search", ("combine",)),
    ("pyramid", "Scent pyramid builder", ("pyramid",)),
    ("people", "Discover people", ("people",)),
    ("profile", "Profiles", ("u", "atlas")),
    ("friends", "Friends", ("friends",)),
    ("collection", "My Collection", ("collection",)),
    ("about", "About", ("about",)),
]
SECTION_OF = {seg: (key, label) for key, label, segs in SECTIONS for seg in segs}


class Hit(BaseModel):
    path: str = Field(max_length=400)
    visitor: str = Field(max_length=60)
    session: str | None = Field(default=None, max_length=60)
    referrer: str | None = Field(default=None, max_length=1000)
    tz: str | None = Field(default=None, max_length=80)


def device_of(ua: str) -> str:
    if re.search(r"iPad|Tablet|PlayBook|Silk", ua) or ("Android" in ua and "Mobile" not in ua):
        return "tablet"
    if re.search(r"Mobi|iPhone|iPod|Android", ua):
        return "phone"
    return "desktop"


def browser_of(ua: str) -> str:
    for pat, name in ((r"Instagram", "Instagram app"), (r"FBAN|FBAV", "Facebook app"), (r"Snapchat", "Snapchat app"),
                      (r"Edg/|EdgA/|EdgiOS/", "Edge"), (r"OPR/|Opera", "Opera"), (r"SamsungBrowser", "Samsung Internet"),
                      (r"FxiOS|Firefox/", "Firefox"), (r"CriOS|Chrome/", "Chrome"), (r"Safari/", "Safari")):
        if re.search(pat, ua):
            return name
    return "Other"


def clean_path(raw: str) -> str | None:
    p = "/" + raw.lstrip("#").split("?", 1)[0].lstrip("/")
    p = p.rstrip("/") or "/"
    return p if PATH_RE.match(p) else None


def ref_host(referrer: str | None, own_hosts: set[str]) -> str | None:
    if not referrer:
        return None
    try:
        host = (urlsplit(referrer).hostname or "").lower()
    except ValueError:
        return None
    host = host[4:] if host.startswith("www.") else host
    if not host or host in own_hosts or not re.match(r"^[a-z0-9.-]{1,120}$", host):
        return None
    return host


def place_of(tz: str | None) -> str | None:
    """'America/Toronto' -> 'Toronto, America' (time-zone city and region)."""
    if not tz or "/" not in tz:
        return tz or None
    region, _, city = tz.partition("/")
    return f"{city.split('/')[-1].replace('_', ' ')}, {region}"


def make_router(ctx, current_user) -> APIRouter:
    """POST /api/t: record one page view (mounted inside the user API router, so it gets the same CSRF guard)."""
    store, settings = ctx.store, ctx.settings
    limiter = auth.RateLimiter(240, 60.0)
    own = {h.lstrip("*.") for h in settings.allowed_hosts} | ({settings.canonical_host} if settings.canonical_host else set())
    own = {h[4:] if h.startswith("www.") else h for h in own}
    state = {"n": 0}
    lock = threading.Lock()
    router = APIRouter()

    @router.post("/t", status_code=204)
    def track(hit: Hit, request: Request, user=Depends(current_user)):
        ua = request.headers.get("user-agent", "")
        path = clean_path(hit.path)
        if not ua or BOT_RE.search(ua) or not path or not VISITOR_RE.match(hit.visitor):
            return Response(status_code=204)
        ok, _ = limiter.hit(auth.client_ip(request, settings.trust_proxy, settings.proxy_hops))
        if not ok:
            raise HTTPException(429, "Slow down.")
        tz = hit.tz if hit.tz and re.match(r"^[A-Za-z0-9_+/-]{1,64}$", hit.tz) else None
        store.add_view({
            "ts": int(time.time()), "visitor": hit.visitor,
            "session": hit.session if hit.session and VISITOR_RE.match(hit.session) else None,
            "user_id": user["id"] if user else None, "path": path,
            "ref_host": ref_host(hit.referrer, own | {auth.host_only(request.headers.get("host", "").lower()).removeprefix("www.")}),
            "device": device_of(ua), "browser": browser_of(ua), "tz": tz,
        })
        with lock:
            state["n"] += 1
            prune = state["n"] % 1000 == 1      # the first hit after a start, then every 1000th
        if prune:
            store.prune_views(int(time.time()) - RETENTION_DAYS * 86400)
        return Response(status_code=204)

    return router


# ---------------------------------------------------------------------------- reading it back (admin)
class Labeller:
    """Human labels for paths: '/perfume/31861' -> 'Sauvage · Dior'."""

    def __init__(self, cat):
        self.cat = cat

    def perfume(self, pid: str):
        try:
            i = self.cat.idx_of(int(pid))
        except (TypeError, ValueError):
            return None
        return self.cat.summary(i) if i is not None else None

    def note(self, slug: str):
        j = self.cat.note_index.get(slug)
        return self.cat.note_name[j] if j is not None else None

    def label(self, path: str) -> str:
        parts = [p for p in path.split("/") if p]
        if not parts:
            return "Home"
        head, rest = parts[0], parts[1:]
        if head == "perfume" and rest:
            p = self.perfume(rest[0])
            return f"{p['name']} · {p['brand']}" if p else path
        if head == "note" and rest:
            return f"Note: {self.note(rest[0]) or rest[0]}"
        if head == "u" and rest:
            return f"Profile: @{rest[0]}"
        if head == "like" and rest:
            p = self.perfume(rest[0])
            return f"Smells like: {p['name']}" if p else "Smells like"
        if head == "layering" and rest:
            names = [p["name"] for p in (self.perfume(x) for x in rest[:2]) if p]
            return "Layering: " + " + ".join(names) if names else "Layering"
        return SECTION_OF.get(head, (None, path))[1]


def report(store, cat, days: int, tz_name: str | None, now: int | None = None) -> dict:
    now = int(now or time.time())
    try:
        tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    except (ZoneInfoNotFoundError, ValueError):
        tz = timezone.utc
    today = datetime.fromtimestamp(now, tz).replace(hour=0, minute=0, second=0, microsecond=0)
    start_today = int(today.timestamp())
    since = int(today.timestamp()) - (days - 1) * 86400
    since_30 = now - 30 * 86400
    first = min(since, since_30)

    times = store.view_times(first)
    def visitors(t0):
        return len({v for ts, v, _ in times if ts >= t0})

    def views(t0):
        return sum(1 for ts, _, _ in times if ts >= t0)

    day_key = lambda ts: datetime.fromtimestamp(ts, tz).strftime("%Y-%m-%d")  # noqa: E731
    keys = [datetime.fromtimestamp(since + k * 86400 + 3600 * 12, tz).strftime("%Y-%m-%d") for k in range(days)]
    dv, dvis, dsign = Counter(), defaultdict(set), Counter()
    for ts, v, _ in times:
        if ts >= since:
            k = day_key(ts)
            dv[k] += 1
            dvis[k].add(v)
    signups = store.signup_times(first)
    for ts in signups:
        if ts >= since:
            dsign[day_key(ts)] += 1

    lab = Labeller(cat)
    by_path = defaultdict(lambda: [0, set()])
    by_section = defaultdict(lambda: [0, set()])
    for path, visitor, _uid, n in store.views_by_path_visitor(since):
        by_path[path][0] += n
        by_path[path][1].add(visitor)
        head = (path.split("/") + ["", ""])[1]
        key = SECTION_OF.get(head, ("other", "Other"))
        by_section[key][0] += n
        by_section[key][1].add(visitor)

    def ranked(items, limit):
        return sorted(items, key=lambda x: (-x["visitors"], -x["views"]))[:limit]

    top_perfumes, top_notes = [], []
    for path, (n, vs) in by_path.items():
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "perfume":
            p = lab.perfume(parts[2])
            if p:
                top_perfumes.append({"id": p["id"], "name": p["name"], "brand": p["brand"], "image": p.get("image"),
                                     "views": n, "visitors": len(vs)})
        elif len(parts) == 3 and parts[1] == "note":
            top_notes.append({"slug": parts[2], "name": lab.note(parts[2]) or parts[2], "views": n, "visitors": len(vs)})
    accounts = store.count_users()
    return {
        "now": now, "days": days, "tz": getattr(tz, "key", "UTC"),
        "totals": {
            "visitors_today": visitors(start_today), "visitors_7d": visitors(now - 7 * 86400),
            "visitors_30d": visitors(since_30), "views_today": views(start_today), "views_7d": views(now - 7 * 86400),
            "views_30d": views(since_30), "active_now": visitors(now - 300),
            "signed_in_30d": len({u for ts, _, u in times if ts >= since_30 and u is not None}),
            "accounts_total": accounts,
            "accounts_new_7d": sum(1 for ts in signups if ts >= now - 7 * 86400),
            "accounts_new_30d": sum(1 for ts in signups if ts >= since_30),
        },
        "daily": [{"day": k, "visitors": len(dvis[k]), "views": dv[k], "signups": dsign[k]} for k in keys],
        "sections": ranked([{"key": k, "label": label, "views": n, "visitors": len(vs)}
                            for (k, label), (n, vs) in by_section.items()], 20),
        "top_perfumes": ranked(top_perfumes, 15),
        "top_notes": ranked(top_notes, 15),
        "top_pages": ranked([{"path": p, "label": lab.label(p), "views": n, "visitors": len(vs)}
                             for p, (n, vs) in by_path.items()], 25),
        "referrers": [{"host": h, "visitors": n} for h, n in store.visitors_by("ref_host", since)][:20],
        "devices": [{"name": h or "unknown", "visitors": n} for h, n in store.visitors_by("device", since)],
        "browsers": [{"name": h or "unknown", "visitors": n} for h, n in store.visitors_by("browser", since)][:12],
        "locations": [{"tz": h, "place": place_of(h) or "Unknown", "visitors": n} for h, n in store.visitors_by("tz", since)][:25],
    }


def activity_out(rows, cat, avatar_url, name_fields) -> list[dict]:
    lab = Labeller(cat)
    out = []
    for r in rows:
        user = None
        if r["user_id"] is not None and r.get("username"):
            u = {"id": r["user_id"], "username": r["username"], "first_name": r["first_name"],
                 "last_name": r["last_name"], "avatar_at": r["avatar_at"]}
            user = {"id": r["user_id"], "username": r["username"], **name_fields(u)}
        out.append({"id": r["id"], "ts": r["ts"], "path": r["path"], "label": lab.label(r["path"]),
                    "visitor": r["visitor"], "device": r["device"], "browser": r["browser"],
                    "place": place_of(r["tz"]), "user": user})
    return out
