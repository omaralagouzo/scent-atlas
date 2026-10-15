"""In-memory catalog: loads master.db / catalog.db into compact numpy structures.

Memory budget (140k perfumes, 2.6k notes, 1.17M perfume_notes rows) is a few tens of MB:

  * everything per perfume is a fixed-width array (int8/int16/int32/float32);
  * names live in ONE UTF-8 blob + offsets, the normalised "brand name" search text in one ASCII
    string + offsets (no per-perfume Python objects);
  * the pyramid is CSR-like (indptr int32, note int32, layer int8); the inverted index is the same
    data sorted by (note, layer) so "perfumes with note j in layer L" is a plain slice;
  * accords are three flat arrays (uint8 name id, uint8 percent, float32 unit-normalised weight);
  * rarely needed display fields (url, perfumers, remote image url, ...) are read lazily from SQLite by id.

Everything a request needs is a handful of vectorised operations over these arrays.
"""
from __future__ import annotations

import difflib
import json
import math
import re
import sqlite3
import threading
import time
import unicodedata
from array import array
from pathlib import Path

import numpy as np

import palette
import remote_images
import similarity as sim

GENDERS = {"women": 1, "men": 2, "unisex": 3}
GENDER_NAMES = {0: None, 1: "women", 2: "men", 3: "unisex"}
LAYER_ALIASES = {"top": 0, "middle": 1, "mid": 1, "heart": 1, "base": 2, "general": 3}
LAYER_LABEL = {0: "top", 1: "middle", 2: "base", 3: "general"}
SORTS = ("popularity", "rating", "year", "year_asc", "name", "brand", "matches", "dupes")

# brand tags: one uint8 bitmask per perfume (via its brand).  Bits 1..64 are filterable tags, 128 flags "inferred".
BTAG_BITS = {"niche": 1, "designer": 2, "dupe": 4, "middle_eastern": 8, "middle_eastern_original": 16,
             "middle_eastern_dupe": 32, "untagged": 64}
BTAG_LABELS = {"niche": "Niche", "designer": "Designer", "dupe": "Dupe house", "middle_eastern": "Middle Eastern",
               "middle_eastern_original": "ME original", "middle_eastern_dupe": "ME dupe", "untagged": "Untagged"}
BTAG_ALL = 127
BTAG_INFERRED = 128
CONF_CODE = {"low": 0, "medium": 1, "high": 2}
CONF_NAME = ("low", "medium", "high")
BASIS_CODE = {"name": 0, "community": 1, "brand_stated": 2, "web": 3}
BASIS_NAME = ("name", "community", "brand_stated", "web")
BASIS_LABEL = {"web": "web-verified", "community": "community votes", "name": "name match", "brand_stated": "brand-stated"}
MAX_DUPES_OUT = 24


def derive_tag_mask(tags) -> int:
    """Base tags (niche / designer / dupe / middle_eastern; derived ones are recomputed) -> bitmask incl. derived bits."""
    t = {x for x in tags if isinstance(x, str)}
    m = 0
    for name in ("niche", "designer", "dupe", "middle_eastern"):
        if name in t:
            m |= BTAG_BITS[name]
    if "middle_eastern" in t:
        m |= BTAG_BITS["middle_eastern_dupe" if "dupe" in t else "middle_eastern_original"]
    return m or BTAG_BITS["untagged"]
CHUNK = 20000


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9&' ]+", " ", s)).strip()


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _loads(s, default):
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


def _cols(con: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


class _Blob:
    """Immutable list of strings stored as one UTF-8 buffer + offsets."""

    __slots__ = ("buf", "off")

    def __init__(self, buf: bytes, lens: np.ndarray):
        self.buf = buf
        self.off = np.concatenate([[0], np.cumsum(lens.astype(np.int64))])

    def __len__(self):
        return len(self.off) - 1

    def get(self, i: int) -> str:
        return self.buf[self.off[i]:self.off[i + 1]].decode("utf-8")


class Catalog:
    def __init__(self, db_path: str | Path, image_mode: str = "local"):
        self.db_path = Path(db_path)
        self.image_mode = image_mode if image_mode in ("local", "remote") else "local"
        self._db_lock = threading.Lock()
        self._db: sqlite3.Connection | None = None
        t0 = time.time()
        self._load()
        self.load_seconds = time.time() - t0

    # ------------------------------------------------------------------ lazy SQLite access
    def _con(self) -> sqlite3.Connection:
        if self._db is None:
            uri = self.db_path.resolve().as_uri() + "?mode=ro"
            con = sqlite3.connect(uri, uri=True, check_same_thread=False)
            con.execute("PRAGMA query_only=ON")
            con.execute("PRAGMA cache_size=-256")
            con.execute("PRAGMA mmap_size=0")
            self._db = con
        return self._db

    def raw_row(self, i: int) -> dict:
        """Rarely needed per-perfume fields, fetched on demand by id."""
        cols = self._perfume_cols
        want = [c for c in ("url", "perfumers", "image_url") if c in cols]
        row = {}
        if want:
            with self._db_lock:
                r = self._con().execute(
                    f"SELECT {','.join(want)} FROM perfumes WHERE id=?", (int(self.p_id[i]),)).fetchone()
            if r:
                row = dict(zip(want, r))
        return row

    # ------------------------------------------------------------------ loading
    def _load(self):
        con = sqlite3.connect(str(self.db_path))
        con.execute("PRAGMA query_only=ON")
        self._perfume_cols = _cols(con, "perfumes")
        self._load_perfumes(con)
        self._load_notes(con)
        self._load_pyramids(con)
        self._load_tags(con)
        con.close()
        self._finish()

    def _load_perfumes(self, con):
        has_pf = "perfumers" in self._perfume_cols
        cur = con.execute(
            "SELECT id, fragrantica_id, name, brand, year, gender, country, rating, rating_count, accords"
            + (", perfumers" if has_pf else ", NULL") + " FROM perfumes ORDER BY id"
        )
        # compact accumulators (array.array holds raw C values; no per-row Python objects survive a chunk)
        ids, fids, years, genders = array("i"), array("i"), array("h"), array("b")
        ratings, votes, ctry, brand_ix = array("f"), array("i"), array("h"), array("i")
        name_buf, name_len = bytearray(), array("i")
        srch_buf, srch_len = bytearray(), array("i")
        a_name, a_pct, a_cnt = array("H"), array("B"), array("H")
        brand_map: dict[str, int] = {}
        brand_norm_of: list[str] = []
        country_map: dict[str, int] = {}
        acc_vocab: dict[str, int] = {}
        pf_map: dict[str, int] = {}           # normalised perfumer name -> id
        pf_names: list[str] = []              # display name per id (first spelling seen)
        pf_ids, pf_cnt = array("i"), array("H")
        while True:
            rows = cur.fetchmany(CHUNK)
            if not rows:
                break
            for (pid, fid, name, brand, year, gender, country, rating, rcount, accords, perfumers) in rows:
                ids.append(pid)
                fids.append(fid or 0)
                years.append(year or 0)
                genders.append(GENDERS.get((gender or "").lower(), 0))
                ratings.append(rating if rating is not None else 0.0)
                votes.append(rcount or 0)
                name = name or ""
                brand = brand or ""
                nb = name.encode("utf-8")
                name_buf += nb
                name_len.append(len(nb))
                k = brand_map.get(brand)
                if k is None:
                    k = brand_map[brand] = len(brand_map)
                    brand_norm_of.append(norm(brand))
                brand_ix.append(k)
                sb = f"{brand_norm_of[k]} {norm(name)}".encode("ascii", "ignore")
                srch_buf += sb
                srch_buf += b"\n"
                srch_len.append(len(sb))
                if country:
                    ck = country_map.get(country)
                    if ck is None:
                        ck = country_map[country] = len(country_map) + 1
                    ctry.append(ck)
                else:
                    ctry.append(0)
                cnt = 0
                if accords:
                    for a in _loads(accords, []):
                        nm = str(a.get("name", ""))
                        if not nm.strip():
                            continue
                        v = acc_vocab.get(nm)
                        if v is None:
                            v = acc_vocab[nm] = len(acc_vocab)
                        a_name.append(v)
                        a_pct.append(min(255, int(round(float(a.get("strength", 0.5)) * 100))))
                        cnt += 1
                a_cnt.append(cnt)
                pc = 0
                if perfumers:
                    seen_pf = set()
                    for pn in _loads(perfumers, []):
                        pn = str(pn).strip()
                        key = norm(pn) or pn.lower()
                        if not key or key in seen_pf:
                            continue
                        seen_pf.add(key)
                        k = pf_map.get(key)
                        if k is None:
                            k = pf_map[key] = len(pf_names)
                            pf_names.append(pn)
                        pf_ids.append(k)
                        pc += 1
                pf_cnt.append(pc)
            del rows
        n = self.n_perf = len(ids)
        self.p_id = np.frombuffer(ids, dtype=np.int32).copy()
        self.p_fid = np.frombuffer(fids, dtype=np.int32).copy()
        self.p_year = np.frombuffer(years, dtype=np.int16).copy()
        self.p_gender = np.frombuffer(genders, dtype=np.int8).copy()
        self.p_rating = np.frombuffer(ratings, dtype=np.float32).copy()
        self.p_votes = np.frombuffer(votes, dtype=np.int32).copy()
        self.p_country = np.frombuffer(ctry, dtype=np.int16).copy()
        self.country_list = [None] + sorted(country_map, key=country_map.get)
        del ids, fids, years, genders, ratings, votes, ctry

        # names: one utf-8 blob; search text: one ascii string (lines separated by \n)
        self.names = _Blob(bytes(name_buf), np.frombuffer(name_len, dtype=np.int32))
        del name_buf, name_len
        self._s_lens = np.frombuffer(srch_len, dtype=np.int32).copy()
        self._s_off = np.concatenate([[0], np.cumsum(self._s_lens.astype(np.int64) + 1)]).astype(np.int64)
        search_bytes = bytes(srch_buf)
        del srch_buf, srch_len
        self.search_text = search_bytes.decode("ascii")  # compact 1-byte-per-char str
        self._search_u8 = np.frombuffer(search_bytes, dtype=np.uint8)
        bix = np.frombuffer(brand_ix, dtype=np.int32).copy()
        del brand_ix

        # name sort rank (normalised name, then brand): numpy sort of fixed-width byte keys
        keys = self._name_sort_keys(brand_norm_of, bix)
        order = np.argsort(keys, kind="stable")
        del keys
        self.p_name_rank = np.empty(n, dtype=np.int32)
        self.p_name_rank[order] = np.arange(n, dtype=np.int32)
        del order

        # brands, sorted by normalised name
        brands = sorted(brand_map, key=lambda b: norm(b))
        remap = np.empty(len(brands), dtype=np.int32)
        for new, b in enumerate(brands):
            remap[brand_map[b]] = new
        self.brand_list = brands
        self.brand_norm = [norm(b) for b in brands]
        self.p_brand_idx = remap[bix] if n else bix
        self.brand_count = np.bincount(self.p_brand_idx, minlength=len(brands))
        del bix

        mx = max(int(self.p_votes.max()) if n else 1, 1)
        self.p_pop = (np.log1p(self.p_votes) / math.log1p(mx)).astype(np.float32)
        has_r = self.p_rating > 0
        c_mean = float(self.p_rating[has_r].mean()) if has_r.any() else 3.5
        m = 25.0
        v = self.p_votes.astype(np.float64)
        self.p_wrating = np.where(has_r, (v / (v + m)) * self.p_rating + (m / (v + m)) * c_mean, 0.0).astype(np.float32)
        del v

        # accords: flat per-entry arrays + unit-normalised weights for cosine similarity
        self.acc_names = list(acc_vocab)
        lower_ids: dict[str, int] = {}
        colmap = np.zeros(max(len(acc_vocab), 1), dtype=np.int32)
        for nm, k in acc_vocab.items():
            colmap[k] = lower_ids.setdefault(nm.lower(), len(lower_ids))
        self._acc_col = colmap
        self.n_acc_cols = len(lower_ids)
        cnt = np.frombuffer(a_cnt, dtype=np.uint16)
        self.acc_indptr = np.concatenate([[0], np.cumsum(cnt.astype(np.int64))]).astype(np.int32)
        self.acc_name = np.frombuffer(a_name, dtype=np.uint16).astype(np.uint8 if len(acc_vocab) < 256 else np.uint16)
        self.acc_pct = np.frombuffer(a_pct, dtype=np.uint8).copy()
        del a_name, a_pct, a_cnt, cnt
        w = self.acc_pct.astype(np.float32) / 100.0
        if w.size:
            rows = np.repeat(np.arange(n, dtype=np.int32), np.diff(self.acc_indptr))
            ss = np.bincount(rows, weights=(w.astype(np.float64) ** 2), minlength=n)
            nrm = np.sqrt(ss)
            nrm[nrm == 0] = 1.0
            self.acc_w = (w / nrm[rows].astype(np.float32)).astype(np.float32)
            del rows
        else:
            self.acc_w = w
        self._acc_colors = [palette.accord_color(nm) for nm in self.acc_names]

        # accord entry -> (perfume row, lower-cased accord column, rank within the perfume) for facets / filters
        nacc = len(self.acc_name)
        self.acc_row = np.repeat(np.arange(n, dtype=np.int32), np.diff(self.acc_indptr)) if nacc else np.zeros(0, np.int32)
        self.acc_colid = (colmap[self.acc_name.astype(np.int64)].astype(np.uint8 if len(lower_ids) < 256 else np.uint16)
                          if nacc else np.zeros(0, np.uint8))
        self.acc_rank = ((np.arange(nacc, dtype=np.int64) - self.acc_indptr[self.acc_row]).clip(0, 255).astype(np.uint8)
                         if nacc else np.zeros(0, np.uint8))
        self.acc_col_names = list(lower_ids)  # lower-cased accord name per column

        # perfumers: CSR (perfume -> perfumer ids) plus the flat entry -> perfume row array
        self.perfumer_names = pf_names
        self.perfumer_index = {norm(nm) or nm.lower(): k for k, nm in enumerate(pf_names)}
        pcnt = np.frombuffer(pf_cnt, dtype=np.uint16).astype(np.int64)
        self.pf_indptr = np.concatenate([[0], np.cumsum(pcnt)]).astype(np.int32)
        self.pf_ids = np.frombuffer(pf_ids, dtype=np.int32).copy()
        self.pf_row = np.repeat(np.arange(n, dtype=np.int32), pcnt) if pf_names else np.zeros(0, np.int32)
        self.perfumer_count = np.bincount(self.pf_ids, minlength=len(pf_names)).astype(np.int32)
        self.p_has_perfumer = pcnt > 0
        del pf_ids, pf_cnt

    def _name_sort_keys(self, brand_norm_of, bix):
        """Fixed-width byte keys 'name_norm\x00brand_norm' (truncated) -> numpy 'S' array for argsort."""
        n = self.n_perf
        width = 48
        keys = np.zeros(n, dtype=f"S{width}")
        txt = self.search_text
        off = self._s_off.tolist()
        lens = self._s_lens.tolist()
        bl = [len(b) for b in brand_norm_of]
        bl_of = bix.tolist()
        for i in range(n):
            a = off[i]
            full = txt[a:a + lens[i]]
            b = bl[bl_of[i]]
            keys[i] = (full[b + 1:] + "\x00" + full[:b])[:width].encode("ascii")
        return keys

    def _load_notes(self, con):
        cols = _cols(con, "notes")
        sel = "id, slug, name, family, image_local" + (", image_remote" if "image_remote" in cols else ", NULL")
        sel += ", image_source" if "image_source" in cols else ", NULL"
        sel += ", image_credit" if "image_credit" in cols else ", NULL"
        nrows = con.execute(f"SELECT {sel} FROM notes ORDER BY id").fetchall()
        nn = self.n_notes = len(nrows)
        self.note_id = np.array([r[0] for r in nrows], dtype=np.int32)
        self.note_slug = [r[1] for r in nrows]
        self.note_name = [r[2] for r in nrows]
        self.note_family = [(r[3] or "other") for r in nrows]
        self.note_image_local = [r[4] for r in nrows]
        self.note_image_remote = [(r[5] or remote_images.note_remote_url(r[6])) for r in nrows]
        self.note_norm = [norm(x) for x in self.note_name]
        self.note_index = {s: i for i, s in enumerate(self.note_slug)}
        self.note_alt = {}  # normalized names / slugs -> idx, for pasted lists
        for i, (s, nm) in enumerate(zip(self.note_slug, self.note_norm)):
            self.note_alt[nm] = i
            self.note_alt[s.replace("-", " ")] = i
        self._note_credits = {r[1]: (r[7] or remote_images.note_credit(r[6])) for r in nrows if r[7] or remote_images.note_credit(r[6])}

    def _load_pyramids(self, con):
        n, nn = self.n_perf, self.n_notes
        cur = con.execute(
            "SELECT perfume_id, note_id, CASE layer WHEN 'top' THEN 0 WHEN 'middle' THEN 1 WHEN 'base' THEN 2 ELSE 3 END,"
            " COALESCE(position, 0) FROM perfume_notes"
        )
        P, N, L, S = [], [], [], []
        while True:
            rows = cur.fetchmany(250000)
            if not rows:
                break
            arr = np.array(rows, dtype=np.int64)
            pi = np.searchsorted(self.p_id, arr[:, 0])
            ni = np.searchsorted(self.note_id, arr[:, 1])
            pi_c = np.minimum(pi, max(n - 1, 0))
            ni_c = np.minimum(ni, max(nn - 1, 0))
            ok = (self.p_id[pi_c] == arr[:, 0]) & (self.note_id[ni_c] == arr[:, 1])
            P.append(pi_c[ok].astype(np.int32))
            N.append(ni_c[ok].astype(np.int32))
            L.append(arr[ok, 2].astype(np.int8))
            S.append(arr[ok, 3].astype(np.int32))
            del rows, arr
        pi = np.concatenate(P) if P else np.zeros(0, np.int32)
        ni = np.concatenate(N) if N else np.zeros(0, np.int32)
        lay = np.concatenate(L) if L else np.zeros(0, np.int8)
        pos = np.concatenate(S) if S else np.zeros(0, np.int32)
        del P, N, L, S
        order = np.lexsort((pos, lay, pi))
        pi, ni, lay = pi[order], ni[order], lay[order]
        del order, pos
        self.pn_note = ni
        self.pn_layer = lay
        self.pn_indptr = np.concatenate([[0], np.cumsum(np.bincount(pi, minlength=n))]).astype(np.int32)

        # inverted index sorted by (note, layer): entries within a key stay perfume-ascending (stable sort)
        key = ni.astype(np.int32) * 4 + lay
        o2 = np.argsort(key, kind="stable")
        self.nl_perf = pi[o2].astype(np.int32)
        self.nl_indptr = np.concatenate([[0], np.cumsum(np.bincount(key, minlength=nn * 4))]).astype(np.int32)
        del o2, key
        # deduplicated (note, perfume) index for "has this note in any layer"
        comb = np.unique(ni.astype(np.int64) * max(n, 1) + pi)
        self.na_perf = (comb % max(n, 1)).astype(np.int32)
        na_note = (comb // max(n, 1)).astype(np.int32)
        self.na_indptr = np.concatenate([[0], np.cumsum(np.bincount(na_note, minlength=nn))]).astype(np.int32)
        del comb, na_note
        self.note_df = np.diff(self.na_indptr).astype(np.int64)
        # perfumes whose notes are a flat list only (no top/middle/base): they match a layered clause "in any layer"
        layered = np.bincount(pi[lay < 3], minlength=n) > 0
        general = np.bincount(pi[lay == 3], minlength=n) > 0
        self.p_flat = general & ~layered
        self.idf = sim.compute_idf(n, self.note_df)
        # W(P): summed idf over the perfume's (note, layer) items
        self.p_weight = np.bincount(pi, weights=self.idf[ni], minlength=n).astype(np.float32)

    def _load_tags(self, con):
        """Brand tags -> one bitmask per brand / perfume; dupe links -> forward + reverse CSR arrays (all numpy, ~1 MB)."""
        n, nb = self.n_perf, len(self.brand_list)
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.tags_loaded = "brand_tags" in tables
        self.brand_tagmask = np.zeros(nb, dtype=np.uint8)
        self.brand_meta: dict[int, tuple] = {}     # brand idx -> (dupe_style, country, parent, confidence, notes)
        if self.tags_loaded:
            index = {b: k for k, b in enumerate(self.brand_list)}
            self.brand_tagmask[:] = BTAG_BITS["untagged"]
            for brand, tags, style, ctry, parent, conf, inferred, notes in con.execute(
                    "SELECT brand, tags, dupe_style, origin_country, parent_company, confidence, inferred, notes FROM brand_tags"):
                k = index.get(brand)
                if k is None:
                    continue
                self.brand_tagmask[k] = derive_tag_mask(_loads(tags, [])) | (BTAG_INFERRED if inferred else 0)
                self.brand_meta[k] = (style, ctry, parent, conf, notes)
        self.p_btags = self.brand_tagmask[self.p_brand_idx] if n else np.zeros(0, np.uint8)
        self._mask_names_cache: dict[int, list] = {}

        z = np.zeros(0, np.int32)
        self.dl_indptr = np.zeros(n + 1, np.int32)
        self.dl_target, self.dl_conf, self.dl_basis = z, np.zeros(0, np.uint8), np.zeros(0, np.uint8)
        self.dr_indptr = np.zeros(n + 1, np.int32)
        self.dr_perf, self.dr_conf, self.dr_basis = z, np.zeros(0, np.uint8), np.zeros(0, np.uint8)
        if "perfume_dupes" in tables and n:
            rows = con.execute("SELECT perfume_id, target_id, confidence, basis FROM perfume_dupes ORDER BY perfume_id, rank").fetchall()
            if rows:
                pid = np.array([r[0] for r in rows], dtype=np.int64)
                tid = np.array([r[1] for r in rows], dtype=np.int64)
                conf = np.array([CONF_CODE.get(r[2], 0) for r in rows], dtype=np.uint8)
                bas = np.array([BASIS_CODE.get(r[3], 0) for r in rows], dtype=np.uint8)
                pi, ti = np.searchsorted(self.p_id, pid), np.searchsorted(self.p_id, tid)
                pc, tc = np.minimum(pi, n - 1), np.minimum(ti, n - 1)
                ok = (self.p_id[pc] == pid) & (self.p_id[tc] == tid) & (pc != tc)
                pi, ti, conf, bas = pc[ok].astype(np.int32), tc[ok].astype(np.int32), conf[ok], bas[ok]
                self.dl_indptr = np.concatenate([[0], np.cumsum(np.bincount(pi, minlength=n))]).astype(np.int32)
                self.dl_target, self.dl_conf, self.dl_basis = ti, conf, bas
                # reverse: per original, its dupes ordered by confidence, then popularity
                order = np.lexsort((pi, -self.p_votes[pi].astype(np.int64), -conf.astype(np.int64), ti))
                self.dr_indptr = np.concatenate([[0], np.cumsum(np.bincount(ti, minlength=n))]).astype(np.int32)
                self.dr_perf, self.dr_conf, self.dr_basis = pi[order], conf[order], bas[order]
        self.p_nlinks = np.diff(self.dl_indptr).astype(np.int32)     # originals this perfume is a dupe of
        self.p_ndupes = np.diff(self.dr_indptr).astype(np.int32)     # known dupes of this perfume
        # researched flag (bit 0) and "researched original" (bit 1)
        self.p_dstatus = np.zeros(n, dtype=np.uint8)
        if "perfume_dupe_status" in tables and n:
            rows = con.execute("SELECT perfume_id, is_original FROM perfume_dupe_status").fetchall()
            if rows:
                pid = np.array([r[0] for r in rows], dtype=np.int64)
                pi = np.minimum(np.searchsorted(self.p_id, pid), n - 1)
                ok = self.p_id[pi] == pid
                isorig = np.array([1 if r[1] else 0 for r in rows], dtype=np.uint8)
                self.p_dstatus[pi[ok]] = 1 | (isorig[ok] << 1)
        self.p_dstatus[self.p_nlinks > 0] |= 1

    def _finish(self):
        self.family_counts_all = None

    # ------------------------------------------------------------------ small accessors used by similarity.py
    def layer_rows(self, L: int, j: int) -> np.ndarray:
        k = 4 * j + L
        return self.nl_perf[self.nl_indptr[k]:self.nl_indptr[k + 1]]

    def layer_count(self, L: int, j: int) -> int:
        k = 4 * j + L
        return int(self.nl_indptr[k + 1] - self.nl_indptr[k])

    def any_rows(self, j: int) -> np.ndarray:
        return self.na_perf[self.na_indptr[j]:self.na_indptr[j + 1]]

    def perfume_pairs(self, i: int):
        a, b = self.pn_indptr[i], self.pn_indptr[i + 1]
        return list(zip(self.pn_note[a:b].tolist(), self.pn_layer[a:b].tolist()))

    def perfume_items(self, i: int):
        """Query items for 'smells like perfume i': general-layer notes stay 'general'."""
        return [(j, sim.Q_GENERAL if L == sim.GENERAL else L) for j, L in self.perfume_pairs(i)]

    def counts_for(self, mask: np.ndarray) -> np.ndarray:
        """For every note: how many perfumes in `mask` carry it (any layer)."""
        g = mask[self.na_perf]
        cs = np.empty(g.size + 1, dtype=np.int32)
        cs[0] = 0
        np.cumsum(g, dtype=np.int32, out=cs[1:])
        return cs[self.na_indptr[1:]] - cs[self.na_indptr[:-1]]

    # ------------------------------------------------------------------ perfume field accessors
    def name(self, i: int) -> str:
        return self.names.get(i)

    def brand(self, i: int) -> str:
        return self.brand_list[self.p_brand_idx[i]]

    def country(self, i: int):
        return self.country_list[self.p_country[i]]

    def fragrantica_id(self, i: int):
        f = int(self.p_fid[i])
        return f or None

    def _search_str(self, i: int) -> str:
        a = int(self._s_off[i])
        return self.search_text[a:a + int(self._s_lens[i])]

    def name_norm(self, i: int) -> str:
        return self._search_str(i)[len(self.brand_norm[self.p_brand_idx[i]]) + 1:]

    def brand_norm_of(self, i: int) -> str:
        return self.brand_norm[self.p_brand_idx[i]]

    # ---- accords
    def accord_names(self, i: int) -> list[str]:
        a, b = self.acc_indptr[i], self.acc_indptr[i + 1]
        return [self.acc_names[k] for k in self.acc_name[a:b].tolist()]

    def accords_out(self, i: int, limit: int | None = None):
        a, b = int(self.acc_indptr[i]), int(self.acc_indptr[i + 1])
        if limit:
            b = min(b, a + limit)
        return [
            {"name": self.acc_names[k], "strength": p / 100.0, "color": self._acc_colors[k]}
            for k, p in zip(self.acc_name[a:b].tolist(), self.acc_pct[a:b].tolist())
        ]

    def accord_cosine(self, i: int) -> np.ndarray:
        """Cosine similarity of every perfume's accord vector with perfume i."""
        a, b = int(self.acc_indptr[i]), int(self.acc_indptr[i + 1])
        out = np.zeros(self.n_perf, dtype=np.float32)
        if a == b or not self.acc_w.size:
            return out
        v = np.zeros(self.n_acc_cols, dtype=np.float32)
        np.add.at(v, self._acc_col[self.acc_name[a:b].astype(np.int64)], self.acc_w[a:b])
        prod = np.zeros(self.acc_w.size + 1, dtype=np.float32)  # trailing 0 keeps reduceat indices in range
        prod[:-1] = v[self._acc_col[self.acc_name]] * self.acc_w
        starts = self.acc_indptr[:-1]
        nonempty = self.acc_indptr[1:] > starts
        s = np.add.reduceat(prod, starts.astype(np.intp))
        out[nonempty] = s[nonempty]
        return out

    # ------------------------------------------------------------------ presentation helpers
    def note_image(self, j: int) -> str:
        if self.image_mode == "remote" and self.note_image_remote[j]:
            return self.note_image_remote[j]
        return f"/img/note/{self.note_slug[j]}"

    def perfume_image(self, i: int) -> str:
        if self.image_mode == "remote":
            u = remote_images.bottle_url(self.p_fid[i])
            if u:
                return u
        return f"/img/perfume/{int(self.p_id[i])}"

    def note_obj(self, j: int, **extra) -> dict:
        fam = self.note_family[j]
        d = {
            "slug": self.note_slug[j],
            "name": self.note_name[j],
            "family": fam,
            "color": palette.family_color(fam),
            "count": int(self.note_df[j]),
            "image": self.note_image(j),
        }
        d.update(extra)
        return d

    def mask_names(self, mask: int) -> list[str]:
        """Bitmask -> tag names (without 'untagged'), cached per distinct mask."""
        mask = int(mask) & BTAG_ALL
        got = self._mask_names_cache.get(mask)
        if got is None:
            got = self._mask_names_cache[mask] = [t for t, b in BTAG_BITS.items() if mask & b and t != "untagged"]
        return got

    def summary(self, i: int) -> dict:
        d = {
            "id": int(self.p_id[i]),
            "name": self.name(i),
            "brand": self.brand(i),
            "year": int(self.p_year[i]) or None,
            "gender": GENDER_NAMES[int(self.p_gender[i])],
            "rating": round(float(self.p_rating[i]), 2) if self.p_rating[i] > 0 else None,
            "rating_count": int(self.p_votes[i]) or None,
            "accords": self.accords_out(i, 5),
            "image": self.perfume_image(i),
        }
        m = int(self.p_btags[i])
        tags = self.mask_names(m)
        if tags:
            d["brand_tags"] = list(tags)
            if m & BTAG_INFERRED:
                d["brand_tags_inferred"] = True
        if self.p_nlinks[i]:
            d["is_dupe"] = True
        if self.p_ndupes[i]:
            d["n_dupes"] = int(self.p_ndupes[i])
        return d

    # ------------------------------------------------------------------ brand tags + dupe links
    def brand_index(self, name: str):
        ix = self.__dict__.get("_brand_ix")
        if ix is None:
            ix = self._brand_ix = {b: j for j, b in enumerate(self.brand_list)}
            self._brand_ix_low = {}
            for j, b in enumerate(self.brand_list):
                self._brand_ix_low.setdefault(b.lower(), j)
        got = ix.get(name)
        return got if got is not None else self._brand_ix_low.get(str(name).lower())

    def brand_info(self, name_or_idx, with_sources=True) -> dict | None:
        """Tags + origin / parent / notes of one brand (None when the brand does not exist)."""
        k = name_or_idx if isinstance(name_or_idx, (int, np.integer)) else self.brand_index(name_or_idx)
        if k is None or not (0 <= int(k) < len(self.brand_list)):
            return None
        k = int(k)
        m = int(self.brand_tagmask[k])
        meta = self.brand_meta.get(k)
        d = {"name": self.brand_list[k], "count": int(self.brand_count[k]), "tags": list(self.mask_names(m)),
             "tagged": bool(m & BTAG_ALL) and not (m & BTAG_BITS["untagged"]), "inferred": bool(m & BTAG_INFERRED),
             "dupe_style": None, "origin_country": None, "parent_company": None, "confidence": None, "notes": None,
             "sources": []}
        if meta:
            d.update(dupe_style=meta[0], origin_country=meta[1], parent_company=meta[2], confidence=meta[3], notes=meta[4])
            if with_sources:
                with self._db_lock:
                    r = self._con().execute("SELECT sources FROM brand_tags WHERE brand=?", (self.brand_list[k],)).fetchone()
                d["sources"] = _loads(r[0], []) if r else []
        return d

    def _link_item(self, j: int, conf: int, basis: int, sources=None) -> dict:
        d = self.summary(j)
        d.update(confidence=CONF_NAME[int(conf)], basis=BASIS_NAME[int(basis)], basis_label=BASIS_LABEL[BASIS_NAME[int(basis)]],
                 sources=sources or [])
        return d

    def dupe_of(self, i: int) -> list[dict]:
        """The originals perfume i is a dupe of (best evidence first)."""
        a, b = int(self.dl_indptr[i]), int(self.dl_indptr[i + 1])
        if a == b:
            return []
        with self._db_lock:
            src = dict(self._con().execute("SELECT target_id, sources FROM perfume_dupes WHERE perfume_id=?",
                                           (int(self.p_id[i]),)).fetchall())
        return [self._link_item(int(j), c, bs, _loads(src.get(int(self.p_id[j])), []))
                for j, c, bs in zip(self.dl_target[a:b], self.dl_conf[a:b], self.dl_basis[a:b])]

    def dupes_of(self, i: int, limit: int = MAX_DUPES_OUT, offset: int = 0) -> dict:
        """Known dupes of perfume i: confidence, then popularity.  {total, counts{high,medium,low}, items}."""
        a, b = int(self.dr_indptr[i]), int(self.dr_indptr[i + 1])
        cc = np.bincount(self.dr_conf[a:b], minlength=3) if b > a else np.zeros(3, int)
        out = {"total": b - a, "counts": {"high": int(cc[2]), "medium": int(cc[1]), "low": int(cc[0])}, "items": []}
        lo, hi = a + max(offset, 0), min(b, a + max(offset, 0) + limit)
        if hi > lo:
            ids = [int(self.p_id[j]) for j in self.dr_perf[lo:hi]]
            with self._db_lock:
                src = {r[0]: r[1] for r in self._con().execute(
                    f"SELECT perfume_id, sources FROM perfume_dupes WHERE target_id=? AND perfume_id IN ({','.join('?' * len(ids))})",
                    (int(self.p_id[i]), *ids)).fetchall()}
            out["items"] = [self._link_item(int(j), c, bs, _loads(src.get(int(self.p_id[j])), []))
                            for j, c, bs in zip(self.dr_perf[lo:hi], self.dr_conf[lo:hi], self.dr_basis[lo:hi])]
        return out

    def dupe_status(self, i: int) -> dict:
        st = int(self.p_dstatus[i])
        notes = None
        if st:
            with self._db_lock:
                try:
                    r = self._con().execute("SELECT notes FROM perfume_dupe_status WHERE perfume_id=?", (int(self.p_id[i]),)).fetchone()
                except sqlite3.Error:
                    r = None
            notes = r[0] if r else None
        return {"researched": bool(st & 1), "is_original": bool(st & 2) and not self.p_nlinks[i], "notes": notes}

    def linked_mask(self, i: int) -> np.ndarray:
        """bool [n]: perfumes linked to perfume i as one of its originals or one of its dupes."""
        m = np.zeros(self.n_perf, dtype=bool)
        m[self.dl_target[self.dl_indptr[i]:self.dl_indptr[i + 1]]] = True
        m[self.dr_perf[self.dr_indptr[i]:self.dr_indptr[i + 1]]] = True
        return m

    def link_relation(self, i: int, j: int):
        """How perfume j relates to perfume i: ('dupe'|'original', confidence, basis) or None."""
        a, b = int(self.dr_indptr[i]), int(self.dr_indptr[i + 1])
        hit = np.flatnonzero(self.dr_perf[a:b] == j)
        if hit.size:
            return "dupe", CONF_NAME[int(self.dr_conf[a + hit[0]])], BASIS_NAME[int(self.dr_basis[a + hit[0]])]
        a, b = int(self.dl_indptr[i]), int(self.dl_indptr[i + 1])
        hit = np.flatnonzero(self.dl_target[a:b] == j)
        if hit.size:
            return "original", CONF_NAME[int(self.dl_conf[a + hit[0]])], BASIS_NAME[int(self.dl_basis[a + hit[0]])]
        return None

    def pyramid(self, i: int) -> dict:
        out = {"top": [], "middle": [], "base": [], "general": []}
        a, b = self.pn_indptr[i], self.pn_indptr[i + 1]
        for k in range(a, b):
            out[LAYER_LABEL[int(self.pn_layer[k])]].append(self.note_obj(int(self.pn_note[k])))
        return out

    def pyramid_slim(self, i: int) -> dict:
        out = {"top": [], "middle": [], "base": [], "general": []}
        a, b = self.pn_indptr[i], self.pn_indptr[i + 1]
        for k in range(a, b):
            j = int(self.pn_note[k])
            out[LAYER_LABEL[int(self.pn_layer[k])]].append({"slug": self.note_slug[j], "name": self.note_name[j]})
        return out

    def detail(self, i: int) -> dict:
        d = self.summary(i)
        raw = self.raw_row(i)
        url = raw.get("url")
        brand, name = self.brand(i), self.name(i)
        d.update(
            country=self.country(i),
            perfumers=_loads(raw.get("perfumers"), []),
            accords=self.accords_out(i),
            pyramid=self.pyramid(i),
            url=url,
            link=url or "https://www.fragrantica.com/search/?query=" + (brand + " " + name).replace(" ", "+"),
            link_is_exact=bool(url),
            fragrantica_id=self.fragrantica_id(i),
        )
        d["brand_tags"] = list(self.mask_names(int(self.p_btags[i])))
        d["brand_info"] = self.brand_info(int(self.p_brand_idx[i]))
        d["is_dupe"] = bool(self.p_nlinks[i])
        d["n_dupes"] = int(self.p_ndupes[i])
        d["dupe_of"] = self.dupe_of(i)
        dd = self.dupes_of(i)
        d["dupes"], d["dupes_total"], d["dupes_counts"] = dd["items"], dd["total"], dd["counts"]
        d["dupe_status"] = self.dupe_status(i)
        return d

    def idx_of(self, pid: int):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return None
        if pid < 0 or pid > 2**31 - 1:
            return None
        k = int(np.searchsorted(self.p_id, pid))
        if k < self.n_perf and int(self.p_id[k]) == pid:
            return k
        return None

    def note_credits(self) -> dict:
        return dict(self._note_credits)

    # ------------------------------------------------------------------ filters
    def filter_mask(self, brand=None, gender=None, year_min=None, year_max=None):
        mask = None

        def _and(m):
            nonlocal mask
            mask = m if mask is None else (mask & m)

        if brand:
            b = norm(brand)
            ids = [k for k, bn in enumerate(self.brand_norm) if b == bn]
            if not ids:
                ids = [k for k, bn in enumerate(self.brand_norm) if b in bn]
            _and(np.isin(self.p_brand_idx, ids) if ids else np.zeros(self.n_perf, bool))
        if gender:
            g = GENDERS.get(gender.lower())
            _and(self.p_gender == g if g else np.zeros(self.n_perf, bool))
        if year_min:
            _and((self.p_year >= int(year_min)))
        if year_max:
            _and((self.p_year > 0) & (self.p_year <= int(year_max)))
        return mask

    def presence(self, j: int, layer: int | None) -> np.ndarray:
        m = np.zeros(self.n_perf, dtype=bool)
        m[self.any_rows(j) if layer is None else self.layer_rows(layer, j)] = True
        return m

    # ------------------------------------------------------------------ combination search
    def search(self, include=(), exclude=(), mode="all", default_layer=None, filters=None, sort="popularity",
               page=1, per_page=48, facet_limit=30, want_facets=True, spec=None, filter_facets=False, ff_limit=10):
        """Combination search (see query.py). Either pass a parsed `spec`, or the legacy include / exclude lists of
        (slug, layer_code|None) plus mode all|any and a `filters` dict (brand, gender, year_min, year_max)."""
        import query

        if spec is None:
            def ser(items):
                return ",".join(s + ("@" + query.LAYER_NAME[L] if L in (0, 1, 2) else "") for s, L in items)

            p = {"include": ser(include), "exclude": ser(exclude), "mode": mode}
            p.update({k: v for k, v in (filters or {}).items() if v not in (None, "")})
            spec = query.parse_spec(self, p, default_layer)
        return query.run(self, spec, sort=sort, page=page, per_page=per_page, facet_limit=facet_limit,
                         want_facets=want_facets, filter_facets=filter_facets, ff_limit=ff_limit)

    def _has(self, i: int, j: int, layer):
        a, b = self.pn_indptr[i], self.pn_indptr[i + 1]
        notes, lays = self.pn_note[a:b], self.pn_layer[a:b]
        sel = notes == j
        if layer is None:
            return bool(sel.any())
        return bool((sel & (lays == layer)).any())

    def facets(self, mask: np.ndarray, skip=(), limit=30, min_count=1):
        if not mask.any():
            return []
        counts = self.counts_for(mask)
        for j in skip:
            counts[j] = 0
        k = min(limit, int((counts >= min_count).sum()))
        if k <= 0:
            return []
        top = np.argpartition(-counts, k - 1)[:k]
        top = top[np.argsort(-counts[top], kind="stable")]
        return [self.note_obj(int(j), count=int(counts[j])) for j in top if counts[j] >= min_count]

    # ------------------------------------------------------------------ notes
    def list_notes(self, q="", family=None, limit=60, offset=0, sort="count"):
        qn = norm(q)
        idxs = []
        for j in range(self.n_notes):
            if qn:
                nm = self.note_norm[j]
                if nm.startswith(qn):
                    rk = 0
                elif any(w.startswith(qn) for w in nm.split()):
                    rk = 1
                elif qn in nm:
                    rk = 2
                else:
                    continue
            else:
                rk = 0
            idxs.append((rk, j))
        fam_counts: dict[str, int] = {}
        for _, j in idxs:
            fam_counts[self.note_family[j]] = fam_counts.get(self.note_family[j], 0) + 1
        if family:
            idxs = [(rk, j) for rk, j in idxs if self.note_family[j] == family]
        if sort == "name":
            idxs.sort(key=lambda t: (t[0], self.note_norm[t[1]]))
        else:
            idxs.sort(key=lambda t: (t[0], -int(self.note_df[t[1]]), self.note_norm[t[1]]))
        total = len(idxs)
        sel = idxs[offset:offset + limit]
        return {
            "total": total,
            "notes": [self.note_obj(j) for _, j in sel],
            "families": [
                {"name": f, "color": palette.family_color(f), "count": c}
                for f, c in sorted(fam_counts.items(), key=lambda kv: -kv[1])
            ],
        }

    def note_pairs(self, j: int, limit=24):
        """Notes that co-occur with note j, ranked by cosine of the perfume sets."""
        rows = self.any_rows(j)
        v = np.zeros(self.n_perf, dtype=bool)
        v[rows] = True
        co = self.counts_for(v)
        co[j] = 0
        df_j = max(int(self.note_df[j]), 1)
        min_co = 2 if df_j >= 10 else 1
        cand = np.flatnonzero(co >= min_co)
        if cand.size == 0:
            return []
        cos = co[cand] / np.sqrt(df_j * np.maximum(self.note_df[cand], 1))
        order = np.argsort(-cos, kind="stable")[:max(limit, 0)]
        return [
            self.note_obj(int(cand[k]), cooccur=int(co[cand[k]]), share=round(float(co[cand[k]]) / df_j, 3))
            for k in order
        ]

    def resolve_note_names(self, names):
        """Free text -> note slugs (exact, then close match)."""
        out = []
        all_norm = list(self.note_alt.keys())
        for raw in names:
            nm = norm(raw)
            if not nm:
                continue
            j = self.note_alt.get(nm)
            if j is None and nm.endswith("s"):
                j = self.note_alt.get(nm[:-1])
            if j is None:
                cand = [k for k in all_norm if nm in k.split() or k in nm.split()]
                if len(cand) == 1:
                    j = self.note_alt[cand[0]]
            if j is None:
                close = difflib.get_close_matches(nm, all_norm, n=1, cutoff=0.8)
                if close:
                    j = self.note_alt[close[0]]
            out.append({"input": raw, "slug": self.note_slug[j] if j is not None else None,
                        "name": self.note_name[j] if j is not None else None,
                        "image": self.note_image(j) if j is not None else None})
        return out

    # ------------------------------------------------------------------ perfume lookup
    def _containing(self, anchor: str) -> np.ndarray:
        """Indices of perfumes whose search text contains `anchor` (vectorised substring scan)."""
        a = np.frombuffer(anchor.encode("ascii", "ignore"), dtype=np.uint8)
        k = a.size
        buf = self._search_u8
        if k == 0 or buf.size < k:
            return np.zeros(0, dtype=np.int64)
        pos = np.flatnonzero(buf[: buf.size - k + 1] == a[0])
        for t in range(1, k):
            if pos.size == 0:
                break
            pos = pos[buf[pos + t] == a[t]]
        if pos.size == 0:
            return pos
        idx = np.searchsorted(self._s_off, pos, side="right") - 1
        return np.unique(idx)

    def find_perfumes(self, q: str, limit=20, budget=0.3):
        qn = norm(q)
        toks = qn.split()
        if not toks:
            return []
        longest = max(toks, key=len)
        hits = [int(i) for i in self._containing(longest) if all(tok in self._search_str(int(i)) for tok in toks)]
        if not hits:  # tolerate typos: shorter prefixes of each token, then difflib
            short = [t[: max(3, len(t) - 2)] for t in toks]
            anchor = max(short, key=len)
            hits = [int(i) for i in self._containing(anchor) if all(tok in self._search_str(int(i)) for tok in short)]
        if not hits:
            t0 = time.time()
            scored = []
            for i in range(self.n_perf):
                if time.time() - t0 > budget:
                    break
                t = self._search_str(i)
                sm = difflib.SequenceMatcher(None, qn, t)
                if sm.real_quick_ratio() > 0.5 and sm.quick_ratio() > 0.5:
                    r = sm.ratio()
                    if r > 0.55:
                        scored.append((r, i))
            scored.sort(reverse=True)
            return [self.summary(i) for _, i in scored[:limit]]

        def rank(i):
            full = self._search_str(i)
            nm = full[len(self.brand_norm_of(i)) + 1:]
            if qn in (nm, full):
                r = 0
            elif nm.startswith(qn) or full.startswith(qn):
                r = 1
            elif all(any(w.startswith(tok) for w in full.split()) for tok in toks):
                r = 2
            else:
                r = 3
            # one match tier ~ one order of magnitude of votes, so a famous
            # partial match ("Chanel No 5 Parfum") beats an obscure exact clone ("No 5")
            return r - math.log10(1 + int(self.p_votes[i]))

        hits.sort(key=rank)
        return [self.summary(i) for i in hits[:limit]]

    def find_brands(self, q="", limit=20):
        qn = norm(q)
        idx = [k for k, b in enumerate(self.brand_norm) if (not qn or qn in b)]
        idx.sort(key=lambda k: (not self.brand_norm[k].startswith(qn), -int(self.brand_count[k])))
        return [{"name": self.brand_list[k], "count": int(self.brand_count[k])} for k in idx[:limit]]
