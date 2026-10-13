"""Prefetch bottle images into data/images/perfumes/{id}.jpg (same format the app's BottleFetcher writes:
raw bytes of the fimgs.net image, stored as <perfume_id>.jpg).

  python pipeline/prefetch_bottles.py --top 1500 [--workers 6] [--verify 20]

--verify N : just HEAD/GET-check N sampled URLs (no writes) and print the status codes.
Skips files that already exist. Concurrency is capped at 6. Honors 429 / Retry-After.
"""
import argparse, os, random, sqlite3, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "images" / "perfumes"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")
MAX_BYTES = 4_000_000


def sniff(d: bytes):
    return d[:3] == b"\xff\xd8\xff" or d[:8] == b"\x89PNG\r\n\x1a\n" or (d[:4] == b"RIFF" and d[8:12] == b"WEBP") or d[:6] in (b"GIF87a", b"GIF89a")


def get(url: str, retries: int = 4) -> bytes:
    for i in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.fragrantica.com/",
                                                   "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                d = r.read(MAX_BYTES + 1)
            if len(d) > MAX_BYTES or not sniff(d):
                raise ValueError("not an acceptable image")
            return d
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                ra = e.headers.get("Retry-After")
                time.sleep(min(float(ra) if ra and ra.isdigit() else 5 * (i + 1), 120))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))
    raise RuntimeError("retries exhausted")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=1500)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--verify", type=int, default=0)
    a = ap.parse_args()
    workers = max(1, min(a.workers, 6))
    db = sqlite3.connect(ROOT / "data" / "master.db")
    rows = db.execute("SELECT id, fragrantica_id, image_url FROM perfumes WHERE rating_count IS NOT NULL "
                      "ORDER BY rating_count DESC, id LIMIT ?", (max(a.top, 5000) if a.verify else a.top,)).fetchall()
    urls = [(i, u or (f"https://fimgs.net/mdimg/perfume/375x500.{f}.jpg" if f else None)) for i, f, u in rows]
    if a.verify:
        for pid, url in random.sample(urls, a.verify):
            try:
                d = get(url, 2); print("OK  ", pid, len(d), url)
            except Exception as e:
                print("FAIL", pid, url, e)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [(i, u) for i, u in urls if u and not (OUT / f"{i}.jpg").exists()]
    print(f"{len(urls)} wanted, {len(urls) - len(todo)} already cached, {len(todo)} to fetch")
    stats = {"ok": 0, "fail": 0}; fails = []; lock = threading.Lock()

    def work(item):
        pid, url = item
        try:
            d = get(url)
            tmp = OUT / f"{pid}.tmp"; tmp.write_bytes(d); os.replace(tmp, OUT / f"{pid}.jpg")
            with lock: stats["ok"] += 1
        except Exception as e:
            with lock: stats["fail"] += 1; fails.append((pid, url, str(e)))
        time.sleep(0.05)
        n = stats["ok"] + stats["fail"]
        if n % 100 == 0: print(f"  {n}/{len(todo)} (fail {stats['fail']})", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, todo))
    print(stats)
    for f in fails[:30]: print("  FAIL", *f)


if __name__ == "__main__":
    main()
