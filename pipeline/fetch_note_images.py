"""Fetch one recognizable image per fragrance note.

Sources (in order of preference):
  1. Fragrantica CDN note thumbnails  https://fimgs.net/mdimg/sastojci/o.<image_id>.jpg
     The image_id per note name comes from the Decant raw dump (notes[].image_id) -- no
     fragrantica.com pages are scraped, only the static image CDN.
  2. Wikipedia / Wikimedia Commons via the official MediaWiki API (pageimages + extmetadata).

The mapping lives in pipeline/note_image_titles.json (slug -> entry) and is HAND-TUNABLE:
  {"slug": {"name": "...", "source": "fragrantica", "image_id": 75}}
  {"slug": {"name": "...", "source": "wikipedia",  "title": "Bergamot orange"}}
  {"slug": {"name": "...", "source": "none"}}          # leave NULL -> SVG tile
Entries already in the file are never overwritten by auto-mapping; edit them and re-run with
--force-slug <slug> (or --force for everything).  Files already on disk are skipped unless --force.

Usage:
  python pipeline/fetch_note_images.py [--limit N] [--min-count 0] [--force] [--force-slug a,b]
                                      [--rebuild-map] [--no-db] [--workers 4]
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DB = DATA / "master.db"
OUT = DATA / "images" / "notes"
MAPFILE = ROOT / "pipeline" / "note_image_titles.json"
DECANT = DATA / "raw" / "decant_kaggle" / "perfumes.jsonl"

BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0.0.0 Safari/537.36")
WIKI_UA = "ScentAtlasLocal/0.1 (personal local fragrance explorer; omaragouz@gmail.com) python-urllib"
SIZE = 300
MAX_BYTES = 60_000

sys.path.insert(0, str(ROOT / "pipeline"))
import norm  # noqa: E402

LAYER_PREFIX = re.compile(r"^(top|middle|base)-")
SUFFIX_WORDS = ("absolute", "essence", "accord", "oil", "extract", "note", "notes")

# Synthetics / abstract notes for which no photo of the thing exists: wikipedia stand-ins.
# slug -> Wikipedia title (only used when there is no Fragrantica image, or by hand).
WIKI_HINTS = {
    "ambroxan": "Ambroxide", "ambrox": "Ambroxide", "aldehydes": "Aldehyde", "musk": "Musk",
    "white-musk": "Musk", "iso-e-super": "Iso E Super", "hedione": "Methyl dihydrojasmonate",
    "oud": "Agarwood", "oud-wood": "Agarwood", "ambergris": "Ambergris", "lisianthus": "Eustoma",
    "eustoma": "Eustoma", "tuber": "Polianthes tuberosa", "orange-blossom": "Neroli",
}


# ----------------------------------------------------------------------------- mapping
def build_decant_ids() -> dict[str, dict]:
    """note slug -> most common Fragrantica note image_id (reads JSON only, never executes)."""
    from collections import Counter, defaultdict
    m: dict[str, Counter] = defaultdict(Counter)
    if not DECANT.exists():
        return {}
    with open(DECANT, encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            notes = d.get("notes") or {}
            lists = list((notes.get("tiered") or {}).values()) + [notes.get("flat") or []]
            for lst in lists:
                for x in lst or []:
                    if isinstance(x, dict) and x.get("image_id") and x.get("name"):
                        m[norm.note_slug(x["name"])][int(x["image_id"])] += 1
    return {k: {"image_id": c.most_common(1)[0][0], "n": sum(c.values())} for k, c in m.items()}


def auto_entry(slug: str, name: str, ids: dict) -> dict:
    cands = [slug]
    s2 = LAYER_PREFIX.sub("", slug)
    if s2 != slug:
        cands.append(s2)
    for c in list(cands):
        parts = c.split("-")
        while len(parts) > 1 and parts[-1] in SUFFIX_WORDS:
            parts.pop()
            cands.append("-".join(parts))
    for c in cands:
        if c in ids:
            return {"name": name, "source": "fragrantica", "image_id": ids[c]["image_id"]}
    for c in cands:
        if c in WIKI_HINTS:
            return {"name": name, "source": "wikipedia", "title": WIKI_HINTS[c]}
    return {"name": name, "source": "wikipedia", "title": re.sub(r"^(Top|Middle|Base) ", "", name).strip()}


def load_map() -> dict:
    if MAPFILE.exists():
        return json.loads(MAPFILE.read_text(encoding="utf-8"))
    return {}


def save_map(m: dict) -> None:
    MAPFILE.write_text(json.dumps(m, indent=1, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")


# ----------------------------------------------------------------------------- http
class Throttle:
    def __init__(self, interval: float):
        self.interval, self.lock, self.next = interval, threading.Lock(), 0.0

    def wait(self):
        with self.lock:
            now = time.time()
            t = max(now, self.next)
            self.next = t + self.interval
        if t > now:
            time.sleep(t - now)


CDN_THROTTLE = Throttle(0.15)
WIKI_THROTTLE = Throttle(1.0)


def http_get(url: str, ua: str, throttle: Throttle, referer: str | None = None, retries: int = 4) -> bytes:
    for attempt in range(retries):
        throttle.wait()
        headers = {"User-Agent": ua, "Accept": "image/*,application/json;q=0.9,*/*;q=0.5"}
        if referer:
            headers["Referer"] = referer
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
                return r.read(15_000_000)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                ra = e.headers.get("Retry-After")
                delay = float(ra) if ra and ra.isdigit() else 5 * (attempt + 1)
                print(f"  {e.code} from {urllib.parse.urlparse(url).netloc}, sleeping {delay:.0f}s", flush=True)
                time.sleep(min(delay, 120))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("retries exhausted")


# ----------------------------------------------------------------------------- image
def process(data: bytes) -> bytes:
    """Center-crop to square, resize to SIZE, JPEG <= MAX_BYTES."""
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    else:
        im = im.convert("RGB")
    w, h = im.size
    if w < 60 or h < 60:
        raise ValueError("too small")
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    for q in (85, 78, 70, 62, 55, 48, 40):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= MAX_BYTES:
            break
    return buf.getvalue()


# ----------------------------------------------------------------------------- wikipedia
BAD_FILE = re.compile(r"(flag|map|logo|locator|coat_of_arms|symbol|icon|\.svg|diagram|structure|formula|portrait)", re.I)


def wiki_api(params: dict) -> dict:
    params = {**params, "format": "json", "formatversion": "2"}
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url, WIKI_UA, WIKI_THROTTLE))


def wiki_lookup(titles: list[str]) -> dict[str, dict]:
    """title -> {thumb, file, page, license, author}; batches of 50."""
    out: dict[str, dict] = {}
    uniq = sorted(set(titles))
    for i in range(0, len(uniq), 50):
        batch = uniq[i:i + 50]
        j = wiki_api({"action": "query", "prop": "pageimages", "piprop": "thumbnail|name", "pithumbsize": 400,
                      "titles": "|".join(batch), "redirects": 1})
        q = j.get("query", {})
        # map requested title -> final title through normalized + redirects
        alias = {t: t for t in batch}
        for n in q.get("normalized", []):
            for k, v in alias.items():
                if v == n["from"]:
                    alias[k] = n["to"]
        for r in q.get("redirects", []):
            for k, v in alias.items():
                if v == r["from"]:
                    alias[k] = r["to"]
        pages = {p["title"]: p for p in q.get("pages", [])}
        files = {}
        for req, final in alias.items():
            p = pages.get(final)
            if not p or "thumbnail" not in p or p.get("missing"):
                continue
            fn = p.get("pageimage", "")
            if BAD_FILE.search(fn):
                continue
            out[req] = {"thumb": p["thumbnail"]["source"], "file": fn, "page": p["title"]}
            files[fn] = req
        # license/author
        fl = list(files)
        for k in range(0, len(fl), 50):
            fb = fl[k:k + 50]
            try:
                jj = wiki_api({"action": "query", "prop": "imageinfo", "iiprop": "extmetadata",
                               "titles": "|".join("File:" + f for f in fb)})
            except Exception:
                continue
            for p in jj.get("query", {}).get("pages", []):
                fn = p.get("title", "").removeprefix("File:").replace(" ", "_")
                for f, req in files.items():
                    if f.replace(" ", "_") == fn:
                        md = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
                        lic = re.sub(r"<[^>]+>", "", md.get("LicenseShortName", {}).get("value", ""))
                        au = re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", ""))[:80]
                        out[req]["license"], out[req]["author"] = lic, au
        print(f"  wiki lookup {min(i + 50, len(uniq))}/{len(uniq)}", flush=True)
    return out


# ----------------------------------------------------------------------------- main
def ext_path(slug: str) -> Path:
    return OUT / f"{slug}.jpg"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only the top N notes by perfume_count")
    ap.add_argument("--min-count", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--force-slug", default="")
    ap.add_argument("--rebuild-map", action="store_true", help="discard auto entries and rebuild (keeps nothing)")
    ap.add_argument("--no-db", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=30)
    rows = db.execute("SELECT slug, name, perfume_count FROM notes WHERE perfume_count >= ? "
                      "ORDER BY perfume_count DESC, slug", (a.min_count,)).fetchall()
    if a.limit:
        rows = rows[:a.limit]
    print(f"{len(rows)} notes")

    mp = {} if a.rebuild_map else load_map()
    need = [r for r in rows if r[0] not in mp]
    if need:
        ids = build_decant_ids()
        print(f"Decant note ids: {len(ids)}; auto-mapping {len(need)} notes")
        for slug, name, _ in need:
            mp[slug] = auto_entry(slug, name, ids)
        save_map(mp)

    forced = set(filter(None, a.force_slug.split(",")))
    todo = [(s, n, c) for s, n, c in rows
            if mp[s].get("source") != "none" and (a.force or s in forced or not ext_path(s).exists())]
    print(f"{len(todo)} to fetch")

    results: dict[str, tuple[str, str] | None] = {}  # slug -> (rel path, source string)
    failed: list[tuple[str, str]] = []

    # --- wikipedia lookups (entries with source wikipedia)
    wiki_todo = [s for s, _, _ in todo if mp[s]["source"] == "wikipedia"]
    wiki_info = wiki_lookup([mp[s]["title"] for s in wiki_todo]) if wiki_todo else {}

    def fetch_one(item):
        slug, name, _ = item
        e = mp[slug]
        try:
            if e["source"] == "fragrantica":
                iid = e["image_id"]
                data = None
                for pre in ("o", "t"):  # original first, 120px thumb if the original is missing/unusable
                    url = f"https://fimgs.net/mdimg/sastojci/{pre}.{iid}.jpg"
                    try:
                        data = http_get(url, BROWSER_UA, CDN_THROTTLE, referer="https://www.fragrantica.com/")
                        jpg = process(data)
                        break
                    except urllib.error.HTTPError as ex:
                        if ex.code != 404:
                            raise
                    except Image.DecompressionBombError:
                        pass
                    data = None
                if data is None:
                    raise ValueError("no CDN image")
                src = f"Fragrantica CDN {url} (note image {iid}; (c) Fragrantica, personal local use)"
            else:
                info = wiki_info.get(e["title"])
                if not info:
                    raise ValueError(f"no wikipedia image for '{e['title']}'")
                data = http_get(info["thumb"], WIKI_UA, WIKI_THROTTLE)
                src = (f"https://en.wikipedia.org/wiki/{urllib.parse.quote(info['page'].replace(' ', '_'))} "
                       f"File:{info['file']} | {info.get('license', '?')} | {info.get('author', '?')}")
            ext_path(slug).write_bytes(jpg if e["source"] == "fragrantica" else process(data))
            results[slug] = (f"images/notes/{slug}.jpg", src)
        except Exception as ex:
            failed.append((slug, f"{type(ex).__name__}: {ex}"))

    done = [0]
    def wrapped(item):
        fetch_one(item)
        done[0] += 1
        if done[0] % 100 == 0:
            print(f"  {done[0]}/{len(todo)}", flush=True)

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(wrapped, todo))

    # --- fallback: failed fragrantica -> wikipedia by name
    retry = [s for s, _ in failed if mp[s]["source"] == "fragrantica"]
    if retry:
        names = {s: re.sub(r"^(Top|Middle|Base) ", "", mp[s]["name"]) for s in retry}
        info2 = wiki_lookup(list(names.values()))
        for s in retry:
            info = info2.get(names[s])
            if not info:
                continue
            try:
                data = http_get(info["thumb"], WIKI_UA, WIKI_THROTTLE)
                ext_path(s).write_bytes(process(data))
                results[s] = (f"images/notes/{s}.jpg",
                              f"https://en.wikipedia.org/wiki/{urllib.parse.quote(info['page'].replace(' ', '_'))} "
                              f"File:{info['file']} | {info.get('license', '?')} | {info.get('author', '?')}")
                mp[s] = {"name": mp[s]["name"], "source": "wikipedia", "title": names[s], "fallback_from": "fragrantica"}
                failed[:] = [f for f in failed if f[0] != s]
            except Exception:
                pass
        save_map(mp)

    # --- write DB (also covers files already on disk that have no DB row yet)
    if not a.no_db:
        for slug, name, _ in rows:
            if slug in results:
                continue
            p = ext_path(slug)
            if p.exists():
                cur = db.execute("SELECT image_local FROM notes WHERE slug=?", (slug,)).fetchone()
                if cur and not cur[0]:
                    e = mp.get(slug, {})
                    srcs = (f"Fragrantica CDN note image {e['image_id']}" if e.get("source") == "fragrantica"
                            else f"Wikipedia: {e.get('title')}")
                    results[slug] = (f"images/notes/{slug}.jpg", srcs)
        db.executemany("UPDATE notes SET image_local=?, image_source=? WHERE slug=?",
                       [(rel, src, slug) for slug, (rel, src) in results.items()])
        db.commit()
    print(f"fetched {len(results)} ok, {len(failed)} failed")
    for s, why in failed[:60]:
        print("  FAIL", s, why)
    if failed:
        (ROOT / "pipeline" / "note_image_failures.json").write_text(json.dumps(failed, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
