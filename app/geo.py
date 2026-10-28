"""Locations for the marketplace: distances, rounding public coordinates, and a free fallback address search.

Address search in the browser uses Google Places when GOOGLE_MAPS_API_KEY is set (a browser key restricted to the
site's domains). Without it, /api/geo/search falls back to Photon (OpenStreetMap data, komoot.io), proxied here so the
browser never talks to a third party directly and we can cache and rate-limit it.
"""
from __future__ import annotations

import json
import math
import threading
import time
import urllib.parse
import urllib.request

PHOTON = "https://photon.komoot.io"
_cache: dict[str, tuple[float, list]] = {}
_lock = threading.Lock()
CACHE_SECONDS = 3600


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def approx(lat: float, lng: float) -> dict:
    """Public position of a pickup point: rounded to ~1 km so a seller's door is never shown to strangers."""
    return {"lat": round(lat, 2), "lng": round(lng, 2)}


def valid_point(lat, lng) -> bool:
    return isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and -90 <= lat <= 90 and -180 <= lng <= 180 \
        and not (lat == 0 and lng == 0)


def _get(url: str, timeout: float = 5.0):
    req = urllib.request.Request(url, headers={"User-Agent": "ScentAtlas/1.0 (+https://scentatlas.app)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (fixed https host)
        return json.loads(r.read().decode("utf-8"))


def _feature(f: dict) -> dict | None:
    g, p = f.get("geometry") or {}, f.get("properties") or {}
    coords = g.get("coordinates") or []
    if len(coords) != 2:
        return None
    street = " ".join(x for x in (p.get("housenumber"), p.get("street")) if x)
    area = p.get("district") or p.get("locality") or p.get("suburb")
    city = p.get("city") or p.get("county") or p.get("state")
    label = ", ".join(dict.fromkeys(x for x in (p.get("name"), street, area, city, p.get("country")) if x))
    return {"label": label, "lat": coords[1], "lng": coords[0], "building": p.get("name"), "street": street or None,
            "area": area, "city": city, "region": p.get("state"), "country": (p.get("countrycode") or "").upper()[:2] or None,
            "postal_code": p.get("postcode"), "place_id": f"osm:{p.get('osm_type', '')}{p.get('osm_id', '')}"}


def _cached(key: str, fetch):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    val = fetch()
    with _lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (now, val)
    return val


def search(q: str, lat: float | None = None, lng: float | None = None, limit: int = 6) -> list[dict]:
    params = {"q": q, "limit": limit, "lang": "en"}
    if lat is not None and lng is not None:
        params.update(lat=round(lat, 2), lon=round(lng, 2))          # bias results towards the searcher
    url = f"{PHOTON}/api/?{urllib.parse.urlencode(params)}"
    return _cached(url, lambda: [x for x in (_feature(f) for f in _get(url).get("features", [])) if x])


def reverse(lat: float, lng: float) -> dict | None:
    url = f"{PHOTON}/reverse?{urllib.parse.urlencode({'lat': round(lat, 5), 'lon': round(lng, 5), 'lang': 'en'})}"
    res = _cached(url, lambda: [x for x in (_feature(f) for f in _get(url).get("features", [])) if x])
    return res[0] if res else None
