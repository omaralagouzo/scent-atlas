"""Perfume-level candidate generator for dupe brands.

  python pipeline/tagging/dupe_candidates.py [--out-dir pipeline/tagging/out] [--brands "A" "B" ...]
                                             [--pool-tags niche designer] [--limit N]

Reads out/brand_tags_*.jsonl (brands whose tags contain "dupe"; or --brands), then for each perfume of those brands
writes work/perfume_candidates.jsonl, one JSON per line:
  {id, name, brand, year, votes,
   reminds: [{id,name,brand,year,up,down,net}]      top 5 reminds_me_of targets from NON-dupe brands, net>0, by net
   name_matches: [{name, brand, votes}]              famous perfume names (other brands) contained in its name
   note_matches: [{id,name,brand,year,sim}]          top 3 weighted-Jaccard note matches among niche/designer perfumes
  }
and work/perfume_candidates_summary.json (counts of perfumes with votes >= 1000 / 200 / 50 / 10).
"""
import argparse
import glob
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import scipy.sparse as sp

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import DB, OUT, WORK, build_famous_names, load_perfumes, load_raw, name_matches

LAYER_W = {"top": 0.8, "middle": 1.0, "base": 1.0, "general": 0.9}
CHUNK = 400


def read_tags(out_dir):
    tags = {}
    for fn in sorted(glob.glob(str(Path(out_dir) / "brand_tags_*.jsonl"))):
        with open(fn, encoding="utf8") as f:
            for line in f:
                line = line.strip()
                if line:
                    d = json.loads(line)
                    tags[d["brand"]] = set(d.get("tags") or [])
    return tags


def build_note_matrix(perfumes):
    """Row per perfume (same order as `perfumes`). Features: note (idf weight) and (note,layer) (0.5*idf*layer_w).
    Because a feature weight depends only on the feature, weighted Jaccard = (A.w.B^T) / (sa + sb - A.w.B^T)."""
    idx = {p["id"]: i for i, p in enumerate(perfumes)}
    con = sqlite3.connect(DB)
    rows, cols, layer_cols = [], [], []
    layer_ix = {}
    n_notes = con.execute("select max(id) from notes").fetchone()[0] + 1
    seen = set()
    for pid, nid, layer in con.execute("select perfume_id,note_id,layer from perfume_notes"):
        i = idx.get(pid)
        if i is None:
            continue
        if (i, nid) not in seen:
            seen.add((i, nid))
            rows.append(i)
            cols.append(nid)
        key = (nid, layer)
        j = layer_ix.setdefault(key, len(layer_ix))
        layer_cols.append((i, j))
    con.close()
    n = len(perfumes)
    A = sp.csr_matrix((np.ones(len(rows), np.float32), (rows, cols)), shape=(n, n_notes))
    A.data[:] = 1
    df = np.asarray(A.sum(axis=0)).ravel()
    idf = np.log((n + 1) / (df + 1)).astype(np.float32) + 0.1
    L = sp.csr_matrix((np.ones(len(layer_cols), np.float32), ([a for a, _ in layer_cols], [b for _, b in layer_cols])),
                      shape=(n, max(len(layer_ix), 1)))
    L.data[:] = 1
    lw = np.zeros(L.shape[1], np.float32)
    for (nid, layer), j in layer_ix.items():
        lw[j] = 0.5 * idf[nid] * LAYER_W.get(layer, 1.0)
    X = sp.hstack([A, L], format="csr")
    w = np.concatenate([idf, lw]).astype(np.float32)
    Xw = X.multiply(w).tocsr()  # row weights
    s = np.asarray(Xw.sum(axis=1)).ravel()
    return X, w, s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(OUT))
    ap.add_argument("--brands", nargs="*", help="explicit dupe brand names (overrides out/*.jsonl)")
    ap.add_argument("--pool-tags", nargs="*", default=["niche", "designer"])
    ap.add_argument("--limit", type=int, default=0, help="debug: max perfumes")
    a = ap.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    tags = read_tags(a.out_dir)
    dupe_brands = set(a.brands) if a.brands else {b for b, t in tags.items() if "dupe" in t}
    if not dupe_brands:
        sys.exit(f"no dupe brands found in {a.out_dir}/brand_tags_*.jsonl (or pass --brands)")
    pool_brands = {b for b, t in tags.items() if set(a.pool_tags) & t and "dupe" not in t}
    print(f"dupe brands: {len(dupe_brands)}; note-match pool brands: {len(pool_brands)}")

    perfumes = load_perfumes()
    pid = {p["id"]: p for p in perfumes}
    brand_votes = Counter()
    for p in perfumes:
        brand_votes[p["brand"]] += p["rating_count"]
    fam = build_famous_names(perfumes, brand_votes)

    targets = [p for p in perfumes if p["brand"] in dupe_brands]
    targets.sort(key=lambda p: -p["rating_count"])
    if a.limit:
        targets = targets[:a.limit]
    tset = {p["id"] for p in targets}
    print(f"perfumes of dupe brands: {len(targets)}")

    # reminds
    rem = {}
    for i, _, r in load_raw(want_desc=False):
        if i not in tset:
            continue
        lst = []
        for x in r:
            t = pid.get(x.get("id"))
            up, dn = x.get("up_votes") or 0, x.get("down_votes") or 0
            if t and t["brand"] not in dupe_brands and up - dn > 0:
                lst.append({"id": t["id"], "name": t["name"], "brand": t["brand"], "year": t["year"],
                            "up": up, "down": dn, "net": up - dn})
        lst.sort(key=lambda d: (-d["net"], -d["up"]))
        rem[i] = lst[:5]

    # note similarity vs pool
    X, w, s = build_note_matrix(perfumes)
    ix = {p["id"]: i for i, p in enumerate(perfumes)}
    pool_idx = np.array([i for i, p in enumerate(perfumes) if p["brand"] in pool_brands and s[i] > 0], dtype=np.int64)
    note_m = {}
    if len(pool_idx):
        XwP = (X[pool_idx].multiply(w)).tocsr().T.tocsc()  # features x pool (weighted)
        sP = s[pool_idx]
        tl = [p for p in targets if s[ix[p["id"]]] > 0]
        for c0 in range(0, len(tl), CHUNK):
            chunk = tl[c0:c0 + CHUNK]
            rows = [ix[p["id"]] for p in chunk]
            inter = (X[rows] @ XwP).toarray()
            union = s[rows][:, None] + sP[None, :] - inter
            sim = inter / np.maximum(union, 1e-6)
            for k, p in enumerate(chunk):
                top = np.argpartition(-sim[k], 3)[:3] if sim.shape[1] > 3 else np.arange(sim.shape[1])
                top = top[np.argsort(-sim[k][top])]
                out = []
                for t in top:
                    q = perfumes[pool_idx[t]]
                    out.append({"id": q["id"], "name": q["name"], "brand": q["brand"], "year": q["year"],
                                "sim": round(float(sim[k][t]), 3)})
                note_m[p["id"]] = out
            print(f"  note similarity {min(c0 + CHUNK, len(tl))}/{len(tl)}", flush=True)

    thr = {1000: 0, 200: 0, 50: 0, 10: 0}
    with open(WORK / "perfume_candidates.jsonl", "w", encoding="utf8") as f:
        for p in targets:
            v = p["rating_count"]
            for k in thr:
                if v >= k:
                    thr[k] += 1
            nm = [{"name": n, "brand": b, "votes": vv} for n, b, vv in name_matches(p["name"], p["brand"], fam)
                  if b not in dupe_brands]
            rec = {"id": p["id"], "name": p["name"], "brand": p["brand"], "year": p["year"], "votes": v,
                   "reminds": rem.get(p["id"], []), "name_matches": nm, "note_matches": note_m.get(p["id"], [])}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    summary = {"dupe_brands": len(dupe_brands), "perfumes": len(targets),
               **{f"votes_ge_{k}": v for k, v in thr.items()},
               "with_reminds": sum(1 for v in rem.values() if v),
               "with_name_match": sum(1 for p in targets if name_matches(p["name"], p["brand"], fam)),
               "with_note_match": len(note_m)}
    (WORK / "perfume_candidates_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf8")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
