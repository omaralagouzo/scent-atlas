"""Memory + latency check:   python app/memcheck.py [--serve] [--db PATH] [--image-mode remote] [--limit-mb 380]

Prints the process RSS after import, after the catalog load and after a set of representative queries.

  default   in-process (FastAPI TestClient): RSS of this python process
  --serve   starts a real single-worker uvicorn subprocess on a free port, queries it over HTTP and reports
            the RSS of that server process (what Render would meter). This is the headline number.

Exit status is 1 when the final RSS is above --limit-mb.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def mb(p: psutil.Process) -> float:
    return p.memory_info().rss / 1e6


def queries(get, post):
    """Yield (label, callable). `get`/`post` take a path (+ body) and return parsed JSON."""
    top = get("/api/notes?limit=8&sort=count")["notes"]
    a, b = top[0]["slug"], top[1]["slug"]
    adv = f"top:{a}*,{b}~middle:{top[2]['slug']},{top[3]['slug']}~base:{top[4]['slug']}*"
    bs = get(f"/api/search?q=any:{a}*&ff=1&per_page=1")["filter_facets"]["brands"]["items"]
    two = urllib.parse.quote("~".join(i["name"] for i in bs[:2]))
    pid = get("/api/search?per_page=1")["results"][0]["id"]
    pyr = {"notes": [{"slug": top[0]["slug"], "layer": "top"}, {"slug": top[1]["slug"], "layer": "middle"},
                     {"slug": top[2]["slug"], "layer": "base"}, {"slug": top[3]["slug"], "layer": "any"}], "limit": 30}
    return [
        ("status", lambda: get("/api/status")),
        ("notes list", lambda: get("/api/notes?limit=72")),
        ("notes search 'ros'", lambda: get("/api/notes?q=ros")),
        (f"note page ({a})", lambda: get(f"/api/notes/{a}?per_page=36")),
        (f"combine {a}+{b} (facets)", lambda: get(f"/api/search?include={a},{b}&per_page=36")),
        ("combine any + sort=name", lambda: get(f"/api/search?include={a},{b}&mode=any&sort=name&per_page=36")),
        ("combine sort=rating", lambda: get(f"/api/search?include={a}&sort=rating&per_page=36")),
        ("advanced AND/OR + all facets", lambda: get(f"/api/search?q={adv}&ff=1&per_page=36")),
        ("advanced + 2 brands + years + newest", lambda: get(f"/api/search?q={adv}&ff=1&per_page=36&brands={two}&year_min=2000&year_max=2022&sort=year")),
        ("advanced, sort=matches, page 3", lambda: get(f"/api/search?q={adv}&sort=matches&page=3&per_page=36&facets=0")),
        ("whole catalogue + facets", lambda: get("/api/search?ff=1&per_page=36")),
        ("facet typeahead (brand fq)", lambda: get(f"/api/search/facet?q={adv}&facet=brand&fq=a&limit=20")),
        ("name filter + accords + perfumers", lambda: get(f"/api/search?q=any:{a}*&name=rose&accords=fresh&perfumers=x&ff=1")),
        ("pyramid /api/similar", lambda: post("/api/similar", pyr)),
        ("pyramid + filters + facets", lambda: post("/api/similar", {**pyr, "ff": True, "filters": {"year_min": 2000, "votes_min": 100}})),
        (f"smells-like perfume {pid}", lambda: get(f"/api/perfumes/{pid}/similar?limit=24")),
        ("perfume detail", lambda: get(f"/api/perfumes/{pid}")),
        ("perfume find 'aventus'", lambda: get("/api/perfumes?q=aventus")),
        ("perfume find 'chanel no 5'", lambda: get("/api/perfumes?q=chanel%20no%205")),
        ("perfume find typo 'sauvge'", lambda: get("/api/perfumes?q=sauvge")),
        ("perfume find gibberish (fuzzy)", lambda: get("/api/perfumes?q=zzqxjkv")),
        ("brands", lambda: get("/api/brands?q=chan")),
        ("resolve names", lambda: post("/api/notes/resolve", {"names": ["bergamot", "pink pepper", "jasmin", "tonka"]})),
    ]


def run_queries(get, post, rss, rounds=3):
    rows = []
    for label, fn in queries(get, post):
        times = []
        for _ in range(rounds):
            t = time.perf_counter()
            fn()
            times.append((time.perf_counter() - t) * 1000)
        rows.append((label, statistics.median(times), max(times), rss()))
    return rows


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true", help="measure a real uvicorn subprocess")
    ap.add_argument("--db", help="catalog sqlite file (default: normal resolution)")
    ap.add_argument("--image-mode", default=None, choices=["local", "remote"])
    ap.add_argument("--limit-mb", type=float, default=380.0)
    a = ap.parse_args()

    env = dict(os.environ)
    tmp = tempfile.mkdtemp(prefix="memcheck-")
    env.setdefault("SCENT_NO_FETCH", "1")
    env["ALLOWED_HOSTS"] = "127.0.0.1,localhost,testserver"
    env["DATABASE_URL"] = ""  # local SQLite users db ...
    env["SCENT_USERS_TMP"] = tmp
    if a.db:
        env["SCENT_DB"] = a.db
    if a.image_mode:
        env["IMAGE_MODE"] = a.image_mode

    if a.serve:
        port = free_port()
        env["PORT"] = str(port)
        # users db in tmp so the check never touches data/users.db
        env["DATABASE_URL"] = "sqlite:///" + (Path(tmp) / "users.db").as_posix()
        t0 = time.time()
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.server:app", "--host", "127.0.0.1", "--port", str(port),
             "--workers", "1", "--no-server-header", "--log-level", "warning"],
            cwd=str(ROOT), env=env)
        ps = psutil.Process(proc.pid)
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(240):
                try:
                    urllib.request.urlopen(base + "/api/status", timeout=1).read()
                    break
                except Exception:
                    if proc.poll() is not None:
                        raise SystemExit("server exited during startup")
                    time.sleep(0.5)
            else:
                raise SystemExit("server did not start")
            print(f"server up in {time.time() - t0:.1f}s   RSS after startup/load: {mb(ps):.0f} MB")

            def get(path):
                with urllib.request.urlopen(base + path, timeout=30) as r:
                    return json.loads(r.read())

            def post(path, body):
                req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.loads(r.read())

            rows = run_queries(get, post, lambda: mb(ps))
            final = mb(ps)
            peak = getattr(ps.memory_info(), "peak_wset", None)
        finally:
            proc.terminate()
            try:
                proc.wait(10)
            except Exception:
                proc.kill()
    else:
        os.environ.update(env)
        os.environ["SCENT_SKIP_DEFAULT_APP"] = "1"
        os.environ["DATABASE_URL"] = "sqlite:///" + (Path(tmp) / "users.db").as_posix()
        sys.path.insert(0, str(HERE))
        me = psutil.Process()
        print(f"RSS at start: {mb(me):.0f} MB")
        import server  # noqa: E402
        print(f"RSS after importing the app modules: {mb(me):.0f} MB")
        from fastapi.testclient import TestClient
        t0 = time.time()
        app = server.create_app()
        print(f"RSS after create_app (catalog load {time.time() - t0:.1f}s): {mb(me):.0f} MB")
        c = TestClient(app, base_url="http://127.0.0.1")
        rows = run_queries(lambda p: c.get(p).json(), lambda p, b: c.post(p, json=b).json(), lambda: mb(me))
        final = mb(me)
        peak = getattr(me.memory_info(), "peak_wset", None)

    print(f"\n{'query':38s} {'median ms':>10s} {'max ms':>8s} {'RSS MB':>8s}")
    for label, med, mx, r in rows:
        print(f"{label:38s} {med:10.1f} {mx:8.1f} {r:8.0f}")
    print(f"\nFINAL RSS after warm-up queries: {final:.0f} MB" + (f"   (peak working set {peak / 1e6:.0f} MB)" if peak else ""))
    worst = max(r[1] for r in rows)
    print(f"slowest median latency: {worst:.0f} ms")
    ok = final <= a.limit_mb
    print(("OK" if ok else "OVER BUDGET") + f" (limit {a.limit_mb:.0f} MB)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
