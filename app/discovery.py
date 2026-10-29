"""New-release discovery: candidates found by research runs, reviewed by the owner, published into the catalogue.

Life of a candidate
  research (an engine run, or an imported JSON file) -> ingest(): cleaned, merged with an earlier find of the same
  perfume (key = brand | name | concentration), checked against the catalogue for duplicates, scored, image fetched
  -> state: incomplete | complete | duplicate -> owner: approve / reject / edit / "not a duplicate"
  -> approved -> publish -> published (merged into the catalogue the next time the app starts; see merged_catalog()).

Completeness: a candidate is complete when it has brand, name, a release year, at least MIN_NOTES notes, a fetched
image and a gender. Confidence is per field (0-1, as reported by the research, never raised by merging alone) plus an
overall weighted score.

Published perfumes get ids from ID_BASE upwards, so they never collide with catalogue ids.
"""
from __future__ import annotations

import ipaddress
import json
import re
import shutil
import socket
import sqlite3
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

import sqlalchemy as sa

import avatar
from userdb import discovery_images, discovery_items, discovery_runs

ID_BASE = 10_000_000
MIN_NOTES = 3
LAYERS = ("top", "middle", "base", "general")
REQUIRED = ("brand", "name", "release_date", "notes", "image", "gender")
RECOMMENDED = ("perfumers", "concentration")
CONF_FIELDS = ("identity", "release_date", "notes", "perfumers", "image", "gender", "concentration")
WEIGHTS = {"identity": 0.3, "notes": 0.25, "release_date": 0.15, "image": 0.1, "perfumers": 0.1, "gender": 0.05,
           "concentration": 0.05}
STATES = ("incomplete", "complete", "duplicate", "approved", "published", "rejected")
SOURCE_KINDS = ("official", "retailer", "news", "aggregator", "social")
IMAGE_MAX_BYTES = 6_000_000


# ---------------------------------------------------------------------------- cleaning
def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


CONC_WORDS = {
    "extrait de parfum": "Extrait de Parfum", "extrait": "Extrait de Parfum", "parfum": "Parfum", "pure parfum": "Parfum",
    "eau de parfum": "EDP", "edp": "EDP", "eau de toilette": "EDT", "edt": "EDT", "eau de cologne": "EDC", "edc": "EDC",
    "cologne": "Cologne", "perfume oil": "Perfume Oil", "oil": "Perfume Oil", "elixir": "Elixir", "body mist": "Body Mist",
    "hair mist": "Hair Mist", "eau fraiche": "Eau Fraiche", "intense": "Intense",
}


def clean_conc(c: str | None) -> str | None:
    if not c:
        return None
    k = norm(c)
    return CONC_WORDS.get(k, " ".join(w.capitalize() for w in str(c).split())[:40] or None)


def clean_str(s, n: int) -> str | None:
    s = " ".join(str(s or "").split())
    return s[:n] or None


def clean_date(d) -> str | None:
    m = re.match(r"^\s*(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?", str(d or ""))
    if not m:
        return None
    y = int(m.group(1))
    if not 1900 <= y <= 2100:
        return None
    out = f"{y}"
    if m.group(2) and 1 <= int(m.group(2)) <= 12:
        out += f"-{int(m.group(2)):02d}"
        if m.group(3) and 1 <= int(m.group(3)) <= 31:
            out += f"-{int(m.group(3)):02d}"
    return out


def clean_notes(notes) -> dict[str, list[str]]:
    out = {k: [] for k in LAYERS}
    if isinstance(notes, list):
        notes = {"general": notes}
    if not isinstance(notes, dict):
        return out
    seen = set()
    for layer in LAYERS:
        for n in notes.get(layer) or notes.get({"middle": "heart"}.get(layer, layer)) or []:
            name = clean_str(n, 60)
            if name and norm(name) not in seen and len(out[layer]) < 25:
                seen.add(norm(name))
                out[layer].append(name[0].upper() + name[1:])
    return out


def n_notes(notes: dict) -> int:
    return sum(len(notes.get(k) or []) for k in LAYERS)


def clean_url(u) -> str | None:
    u = str(u or "").strip()
    return u[:1000] if re.match(r"^https?://[^\s]+$", u) else None


def clean_sources(src) -> list[dict]:
    out, seen = [], set()
    for s in src or []:
        if not isinstance(s, dict):
            continue
        url = clean_url(s.get("url"))
        if not url or url in seen:
            continue
        seen.add(url)
        kind = s.get("kind") if s.get("kind") in SOURCE_KINDS else "news"
        supports = [x for x in (s.get("supports") or []) if x in CONF_FIELDS]
        out.append({"url": url, "title": clean_str(s.get("title"), 200), "kind": kind, "supports": supports})
    return out[:30]


def clean_conf(c) -> dict[str, float]:
    out = {}
    for k in CONF_FIELDS:
        try:
            v = float((c or {}).get(k))
        except (TypeError, ValueError):
            continue
        out[k] = max(0.0, min(1.0, round(v, 2)))
    return out


def clean_item(raw: dict) -> dict | None:
    """A research result -> a clean candidate dict (or None when brand / name are missing)."""
    brand, name = clean_str(raw.get("brand"), 120), clean_str(raw.get("name"), 160)
    if not brand or not name:
        return None
    gender = str(raw.get("gender") or "").strip().lower()
    gender = {"female": "women", "woman": "women", "feminine": "women", "male": "men", "man": "men",
              "masculine": "men", "shared": "unisex"}.get(gender, gender)
    perfumers = []
    for p in raw.get("perfumers") or []:
        p = clean_str(p, 80)
        if p and p not in perfumers:
            perfumers.append(p)
    status = str(raw.get("status") or raw.get("release_status") or "").lower()
    return {
        "brand": brand, "name": name, "concentration": clean_conc(raw.get("concentration")),
        "gender": gender if gender in ("women", "men", "unisex") else None,
        "release_date": clean_date(raw.get("release_date")),
        "release_status": status if status in ("released", "announced") else None,
        "perfumers": perfumers[:8], "notes": clean_notes(raw.get("notes")),
        "family": clean_str(raw.get("family"), 80), "description": clean_str(raw.get("description"), 600),
        "image_url": clean_url(raw.get("image_url")), "official_url": clean_url(raw.get("official_url")),
        "sources": clean_sources(raw.get("sources")), "confidence": clean_conf(raw.get("confidence")),
        "comment": clean_str(raw.get("comment"), 500),
    }


def brand_key(brand: str | None) -> str:
    """"D.S. & Durga" and "DS&Durga" -> "dsanddurga"."""
    return norm(brand).replace(" ", "")


def name_key(name: str | None) -> str:
    """Word order doesn't matter: "305 Bois Darshan" and "Bois Darshan 305" -> "305 bois darshan"."""
    return " ".join(sorted(norm(name).split()))


def item_key(brand: str, name: str, conc: str | None) -> str:
    return f"{brand_key(brand)}|{name_key(name)}|{norm(conc or '')}"[:300]


BRAND_TAIL = re.compile(r"\b(perfumes?|parfums?|fragrances?|parfumerie|australia|paris|london|milano|dubai)\b")
BRAND_ALIASES = {   # research spelling -> the catalogue's (brand_key form)
    "maisonmargiela": "maisonmartinmargiela", "margiela": "maisonmartinmargiela", "rojaparfums": "rojadove",
    "roja": "rojadove", "pacorabanne": "rabanne", "annickgoutal": "goutal",
}


def _stem(brand: str | None) -> str:
    return BRAND_TAIL.sub(" ", norm(brand)).replace(" ", "")


def _brand_index(cat) -> tuple[dict, dict]:
    idx = getattr(cat, "_discovery_brands", None)
    if idx is None:
        exact, stem, clash = {}, {}, set()
        for b in getattr(cat, "brand_list", []) or []:
            if not brand_key(b):          # non-Latin names normalise to "" and must not match everything
                continue
            exact.setdefault(brand_key(b), b)
            k = _stem(b)
            if k in stem and stem[k] != b:
                clash.add(k)
            stem.setdefault(k, b)
        idx = cat._discovery_brands = (exact, {k: v for k, v in stem.items() if k and k not in clash})
    return idx


def canonical_brand(cat, brand: str) -> str:
    """The catalogue's spelling of a house ("Lattafa" -> "Lattafa Perfumes"), so a published perfume joins its brand."""
    exact, stem = _brand_index(cat)
    k = brand_key(brand)
    return exact.get(k) or exact.get(BRAND_ALIASES.get(k, "")) or stem.get(_stem(brand)) or brand


def same_brand(a: str | None, b: str | None) -> bool:
    ca, cb = brand_key(a), brand_key(b)
    if not ca or not cb:          # brands that normalise to "" (non-Latin script) match nothing
        return False
    return ca == cb or (min(len(ca), len(cb)) >= 4 and (ca in cb or cb in ca))


# ---------------------------------------------------------------------------- scoring
def score(row: dict, has_image: bool) -> tuple[list[str], float]:
    """(missing required fields, overall confidence 0-1)."""
    notes = row["notes"] if isinstance(row["notes"], dict) else json.loads(row["notes"] or "{}")
    missing = []
    if not row.get("release_date"):
        missing.append("release_date")
    if n_notes(notes) < MIN_NOTES:
        missing.append("notes")
    if not has_image:
        missing.append("image")
    if not row.get("gender"):
        missing.append("gender")
    conf = row["confidence"] if isinstance(row["confidence"], dict) else json.loads(row["confidence"] or "{}")
    present = {"identity": True, "notes": n_notes(notes) > 0, "release_date": bool(row.get("release_date")),
               "image": has_image, "perfumers": bool(json.loads(row["perfumers"]) if isinstance(row["perfumers"], str) else row["perfumers"]),
               "gender": bool(row.get("gender")), "concentration": bool(row.get("concentration"))}
    tot = sum(WEIGHTS.values())
    overall = sum(WEIGHTS[k] * (conf.get(k, 0.5 if k == "identity" else 0.0) if present[k] else 0.0) for k in WEIGHTS) / tot
    if conf.get("identity", 0.5) < 0.5:
        overall *= 0.6
    return missing, round(overall, 3)


# ---------------------------------------------------------------------------- catalogue duplicates
CONC_STRIP = re.compile(r"\b(eau de parfum|eau de toilette|eau de cologne|extrait de parfum|parfum|edp|edt|edc|extrait|intense)\b")


def catalogue_match(cat, brand: str, name: str, conc: str | None = None) -> int | None:
    """Catalogue perfume id this candidate seems to repeat (same brand, same name; concentration-aware)."""
    nn = name_key(name)
    try:
        hits = cat.find_perfumes(f"{name}", 40, budget=0.05)
    except Exception:
        return None
    nc = norm(conc or "")
    for h in hits:
        hn = name_key(h.get("name"))
        if not hn or not same_brand(brand, h.get("brand")):
            continue
        if hn == nn or hn == name_key(display_name(name, conc)):
            return int(h["id"])
        # "Sauvage Elixir" vs "Sauvage" + conc "Elixir": compare with concentration words removed on both sides
        if (sorted(CONC_STRIP.sub("", hn).split()) == sorted(CONC_STRIP.sub("", nn).split())
                and (not nc or nc in norm(h.get("name")) or nc in norm(name))):
            return int(h["id"])
    return None


# ---------------------------------------------------------------------------- store helpers
def _row(c, iid: int) -> dict | None:
    r = c.execute(sa.select(discovery_items).where(discovery_items.c.id == iid)).mappings().first()
    return dict(r) if r else None


def _has_image(c, iid: int) -> bool:
    return c.execute(sa.select(discovery_images.c.item_id).where(discovery_images.c.item_id == iid)).first() is not None


def recompute(store, iid: int):
    """Refresh missing / overall / state after any change (sticky states are kept)."""
    with store.eng.begin() as c:
        r = _row(c, iid)
        if not r:
            return
        missing, overall = score(r, _has_image(c, iid))
        state = r["state"]
        if state in ("incomplete", "complete"):
            state = "complete" if not missing else "incomplete"
        c.execute(discovery_items.update().where(discovery_items.c.id == iid).values(
            missing=json.dumps(missing), overall=overall, state=state, updated_at=int(time.time())))


def _merge_list(a: list, b: list) -> list:
    out = list(a)
    for x in b:
        if norm(x) not in {norm(y) for y in out}:
            out.append(x)
    return out


def ingest(store, cat, raws: list[dict], run_id: int | None = None, origin: str = "engine") -> dict:
    """Add or merge research results. Returns {new, updated, skipped, ids}."""
    now = int(time.time())
    stats = {"new": 0, "updated": 0, "skipped": 0, "ids": []}
    for raw in raws:
        it = clean_item(raw) if isinstance(raw, dict) else None
        if not it:
            stats["skipped"] += 1
            continue
        it["brand"] = canonical_brand(cat, it["brand"])
        key = item_key(it["brand"], it["name"], it["concentration"])
        target = raw.get("item_id")
        with store.eng.begin() as c:
            cur = None
            if isinstance(target, int) and not isinstance(target, bool):   # completing a known candidate
                cur = c.execute(sa.select(discovery_items).where(discovery_items.c.id == target)).mappings().first()
            if cur is None:
                cur = c.execute(sa.select(discovery_items).where(discovery_items.c.key == key)).mappings().first()
            if cur is None:   # the same perfume reported once with and once without a concentration
                base = key.rsplit("|", 1)[0] + "|"
                for r in c.execute(sa.select(discovery_items).where(discovery_items.c.key.like(base + "%"))).mappings():
                    if not it["concentration"] or not r["concentration"]:
                        cur = r
                        break
            if cur is None:
                dup = catalogue_match(cat, it["brand"], it["name"], it["concentration"])
                vals = {k: it[k] for k in ("brand", "name", "concentration", "gender", "release_date", "release_status",
                                           "family", "description", "image_url", "official_url", "comment")}
                vals.update(key=key, perfumers=json.dumps(it["perfumers"]), notes=json.dumps(it["notes"]),
                            sources=json.dumps(it["sources"]), confidence=json.dumps(it["confidence"]), overall=0.0,
                            missing="[]", state="duplicate" if dup else "incomplete", duplicate_of=dup, origin=origin[:60],
                            first_run_id=run_id, last_run_id=run_id, attempts=1, created_at=now, updated_at=now)
                iid = int(c.execute(discovery_items.insert().values(**vals)).inserted_primary_key[0])
                stats["new"] += 1
            else:
                cur = dict(cur)
                iid = cur["id"]
                if cur["state"] in ("published", "rejected"):
                    stats["skipped"] += 1
                    continue
                conf_old, conf_new = json.loads(cur["confidence"] or "{}"), it["confidence"]
                notes_old = json.loads(cur["notes"] or "{}")
                upd: dict = {}
                # a field is replaced when it was empty, or the new finding is more confident about it
                def better(field):
                    return conf_new.get(field, 0) > conf_old.get(field, 0)
                for f, conf_f in (("release_date", "release_date"), ("gender", "gender"), ("concentration", "concentration")):
                    if it[f] and (not cur[f] or better(conf_f)):
                        upd[f] = it[f]
                if upd.get("concentration") and not cur["concentration"] and key != cur["key"] and not c.execute(
                        sa.select(discovery_items.c.id).where(discovery_items.c.key == key)).first():
                    upd["key"] = key
                if n_notes(it["notes"]) and (n_notes(notes_old) < MIN_NOTES or better("notes")):
                    upd["notes"] = json.dumps(it["notes"])
                if it["perfumers"]:
                    upd["perfumers"] = json.dumps(_merge_list(json.loads(cur["perfumers"] or "[]"), it["perfumers"]))
                for f in ("family", "description", "official_url", "release_status", "comment"):
                    if it[f] and not cur[f]:
                        upd[f] = it[f]
                if it["image_url"] and (not cur["image_url"] or better("image")):
                    upd["image_url"] = it["image_url"]
                srcs = json.loads(cur["sources"] or "[]")
                urls = {s["url"] for s in srcs}
                upd["sources"] = json.dumps((srcs + [s for s in it["sources"] if s["url"] not in urls])[:30])
                upd["confidence"] = json.dumps({k: max(conf_old.get(k, 0), conf_new.get(k, 0))
                                                for k in set(conf_old) | set(conf_new)})
                upd.update(last_run_id=run_id, attempts=(cur["attempts"] or 0) + 1, updated_at=now)
                c.execute(discovery_items.update().where(discovery_items.c.id == iid).values(**upd))
                stats["updated"] += 1
        stats["ids"].append(iid)
        recompute(store, iid)
    return stats


# ---------------------------------------------------------------------------- images
def _public_host(host: str) -> bool:
    """Refuse URLs that resolve to private / loopback / link-local addresses (the URLs come from research output)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


class _NoRedirectToPrivate(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlsplit(newurl).hostname or ""
        if not newurl.startswith(("http://", "https://")) or not _public_host(host):
            raise urllib.error.URLError("redirect to a disallowed address")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


WP_CDN = re.compile(r"^https?://i[0-3]\.wp\.com/([^?#]+)")


def download_image(url: str) -> bytes:
    """The image at url; for a WordPress CDN copy (i0.wp.com/<site>/...) the original file on the site itself."""
    m = WP_CDN.match(url)
    if m:
        try:
            return _download(f"https://{m.group(1)}")
        except Exception:   # noqa: BLE001
            pass
    return _download(url)


def _download(url: str) -> bytes:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or not _public_host(parts.hostname):
        raise ValueError("image URL not allowed")
    opener = urllib.request.build_opener(_NoRedirectToPrivate)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; ScentAtlasBot/1.0; +https://scentatlas.app)",
                                               "Accept": "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5"})
    with opener.open(req, timeout=15) as r:   # noqa: S310 (scheme and host checked above)
        ctype = (r.headers.get("Content-Type") or "").lower()
        if ctype and not ctype.startswith("image/"):
            raise ValueError(f"not an image ({ctype})")
        data = r.read(IMAGE_MAX_BYTES + 1)
    if len(data) > IMAGE_MAX_BYTES:
        raise ValueError("image too large")
    return data


def fetch_image(store, iid: int) -> bool:
    """Download, re-encode (WebP, <= 800 px, metadata dropped) and store the candidate's image."""
    with store.eng.connect() as c:
        r = _row(c, iid)
    if not r or not r["image_url"]:
        return False
    try:
        data = avatar.process_photo(download_image(r["image_url"]), max_side=800)
    except Exception:
        return False
    with store.eng.begin() as c:
        c.execute(discovery_images.delete().where(discovery_images.c.item_id == iid))
        c.execute(discovery_images.insert().values(item_id=iid, data=data, mime="image/webp",
                                                   source_url=r["image_url"], fetched_at=int(time.time())))
    recompute(store, iid)
    return True


def fetch_images_async(store, ids: list[int], workers: int = 4):
    def run():
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(workers) as ex:
            list(ex.map(lambda i: fetch_image(store, i), ids))
    threading.Thread(target=run, daemon=True, name="discovery-images").start()


def image_url(iid: int) -> str:
    """Public address of a published candidate's image (the admin previews through its own route)."""
    return f"/img/discovery/{iid}.webp"


# ---------------------------------------------------------------------------- accords from notes (published perfumes)
ACCORD_BY_NOTE = {
    "vanilla": "vanilla", "rose": "rose", "oud": "oud", "agarwood": "oud", "leather": "leather", "tobacco": "tobacco",
    "coffee": "coffee", "patchouli": "patchouli", "lavender": "lavender", "iris": "iris", "orris": "iris",
    "violet": "violet", "tuberose": "tuberose", "honey": "honey", "cinnamon": "cinnamon", "almond": "almond",
    "coconut": "coconut", "caramel": "caramel", "cherry": "cherry", "rum": "rum", "cacao": "cacao", "chocolate": "chocolate",
    "jasmine": "white floral", "orange blossom": "white floral", "neroli": "white floral", "gardenia": "white floral",
    "pink pepper": "fresh spicy", "black pepper": "fresh spicy", "pepper": "fresh spicy", "ginger": "fresh spicy",
    "cardamom": "fresh spicy", "saffron": "warm spicy", "clove": "warm spicy", "nutmeg": "warm spicy",
    "incense": "smoky", "olibanum": "smoky", "birch": "smoky", "musk": "musky", "white musk": "musky",
    "ambroxan": "amber", "amberwood": "woody", "cedar": "woody", "sandalwood": "woody", "vetiver": "earthy",
    "oakmoss": "mossy", "sea salt": "salty", "salt": "salty", "aldehydes": "aldehydic", "tonka bean": "sweet",
}
ACCORD_BY_FAMILY = {"citrus": "citrus", "floral": "floral", "gourmand": "sweet", "fruity": "fruity", "woody": "woody",
                    "green": "green", "herbal/aromatic": "aromatic", "spicy": "warm spicy", "musky/animalic": "musky",
                    "resinous/amber": "amber", "aquatic": "aquatic"}
LAYER_WEIGHT = {"top": 0.8, "middle": 0.95, "base": 1.0, "general": 0.9}


def derive_accords(notes: dict, family_of) -> list[dict]:
    """Approximate main accords from the notes (what the catalogue shows as accord bars)."""
    score_: dict[str, float] = {}
    for layer in LAYERS:
        for n in notes.get(layer) or []:
            k = norm(n)
            acc = ACCORD_BY_NOTE.get(k)
            fam = family_of(k)
            for a, w in ((acc, 1.0), (ACCORD_BY_FAMILY.get(fam or ""), 0.8)):
                if a:
                    score_[a] = score_.get(a, 0.0) + w * LAYER_WEIGHT[layer]
    if not score_:
        return []
    top = max(score_.values())
    return [{"name": a, "strength": round(v / top, 2)} for a, v in sorted(score_.items(), key=lambda kv: -kv[1])[:6]]


# ---------------------------------------------------------------------------- publishing into the catalogue
def published_rows(store) -> list[dict]:
    try:
        with store.eng.connect() as c:
            return [dict(r) for r in c.execute(sa.select(discovery_items).where(discovery_items.c.state == "published")
                                               .order_by(discovery_items.c.id)).mappings()]
    except Exception:
        return []


QUIET_CONC = {"EDP", "EDT", "EDC", None}


def display_name(name: str, conc: str | None) -> str:
    """Catalogue-style name: "Sauvage Elixir", but plain "Libre" for an ordinary EDP / EDT."""
    if conc in QUIET_CONC or norm(conc) in norm(name):
        return name
    return f"{name} {conc}"


def merged_catalog(base: Path, rows: list[dict], work_dir: Path) -> Path:
    """A copy of the catalogue database with the published discoveries added (base is never modified)."""
    work_dir.mkdir(parents=True, exist_ok=True)
    out = work_dir / "catalog-with-discoveries.db"
    tmp = work_dir / "catalog-with-discoveries.tmp"
    shutil.copyfile(base, tmp)
    con = sqlite3.connect(tmp)
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(perfumes)")}
        notes = {norm(name): (nid, fam) for nid, name, fam in con.execute("SELECT id, name, family FROM notes")}
        slugs = {s for (s,) in con.execute("SELECT slug FROM notes")}
        next_note = (con.execute("SELECT MAX(id) FROM notes").fetchone()[0] or 0) + 1
        for r in rows:
            pid = r["perfume_id"] or ID_BASE + r["id"]
            nts = json.loads(r["notes"] or "{}")
            name = display_name(r["name"], r["concentration"])
            year = int(r["release_date"][:4]) if r["release_date"] else None
            accords = derive_accords(nts, lambda k: (notes.get(k) or (None, None))[1])
            vals = {"id": pid, "fragrantica_id": None, "name": name, "brand": r["brand"], "year": year,
                    "gender": r["gender"], "country": None, "rating": None, "rating_count": None,
                    "url": r["official_url"], "image_url": None,
                    "perfumers": json.dumps(json.loads(r["perfumers"] or "[]")), "accords": json.dumps(accords)}
            vals = {k: v for k, v in vals.items() if k in cols}
            con.execute(f"INSERT OR REPLACE INTO perfumes ({','.join(vals)}) VALUES ({','.join('?' * len(vals))})", list(vals.values()))
            con.execute("DELETE FROM perfume_notes WHERE perfume_id=?", (pid,))
            for layer in LAYERS:
                for pos, n in enumerate(nts.get(layer) or []):
                    k = norm(n)
                    if k not in notes:
                        slug = re.sub(r"\s+", "-", k) or f"note-{next_note}"
                        while slug in slugs:
                            slug += "-x"
                        con.execute("INSERT INTO notes (id, slug, name, family, perfume_count) VALUES (?, ?, ?, ?, 0)",
                                    (next_note, slug, n, "other"))
                        notes[k] = (next_note, "other")
                        slugs.add(slug)
                        next_note += 1
                    con.execute("INSERT OR IGNORE INTO perfume_notes (perfume_id, note_id, layer, position) VALUES (?, ?, ?, ?)",
                                (pid, notes[k][0], layer, pos))
        con.execute("UPDATE notes SET perfume_count = (SELECT COUNT(DISTINCT perfume_id) FROM perfume_notes WHERE note_id = notes.id) "
                    "WHERE id IN (SELECT note_id FROM perfume_notes WHERE perfume_id >= ?)", (ID_BASE,))
        con.commit()
    finally:
        con.close()
    tmp.replace(out)
    return out


# ---------------------------------------------------------------------------- research files committed to the repo
def import_files(store, cat, folder: Path, fetch: bool = True) -> list[int]:
    """Import data/discovery/*.json once each (tracked by file name in meta), as runs of kind "import"."""
    if not folder.is_dir():
        return []
    done = set(json.loads(store.get_meta("discovery_imports") or "[]"))
    runs = []
    for f in sorted(folder.glob("*.json")):
        if f.name in done:
            continue
        try:
            raws = json.loads(f.read_text("utf-8"))
            if isinstance(raws, dict):
                raws = raws.get("fragrances") or raws.get("items") or []
        except (OSError, ValueError) as e:
            print(f"[scent-atlas] discovery import: could not read {f.name} ({e})")
            continue
        now = int(time.time())
        with store.eng.begin() as c:
            rid = int(c.execute(discovery_runs.insert().values(
                kind="import", status="running", params=json.dumps({"file": f.name}), stats="{}", log="",
                created_at=now, started_at=now)).inserted_primary_key[0])
        res = ingest(store, cat, raws if isinstance(raws, list) else [], run_id=rid, origin=f"import:{f.name}"[:60])
        done.add(f.name)
        store.set_meta("discovery_imports", json.dumps(sorted(done)))
        if fetch:
            for iid in res["ids"]:
                fetch_image(store, iid)
        with store.eng.begin() as c:
            c.execute(discovery_runs.update().where(discovery_runs.c.id == rid).values(
                status="done", finished_at=int(time.time()),
                stats=json.dumps({k: res[k] for k in ("new", "updated", "skipped")}),
                log=f"Imported {f.name}: {res['new']} new, {res['updated']} updated, {res['skipped']} skipped"))
        runs.append(rid)
    return runs
