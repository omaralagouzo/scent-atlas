"""Research runs for new-release discovery, started from the admin.

A run asks Claude (Sonnet 5.5 or Haiku 5.5, effort high) to search the web, segment by segment, for fragrances the
catalogue doesn't have yet, or to fill the gaps in candidates that are still incomplete. Claude reports what it finds
through the submit_fragrances tool; every submission goes straight through discovery.ingest(), so partial work is
kept even when a run is cancelled or hits its budget. check_catalogue lets it skip what we already have.

Needs ANTHROPIC_API_KEY. Costs are estimated from the usage the API reports (list prices) and a run stops starting
new requests once its budget is spent.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import sqlalchemy as sa

import discovery as dz
from userdb import discovery_items, discovery_runs

log = logging.getLogger("scent-atlas.discovery")

MODELS = {"sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}
# USD per million tokens: input, output, cache write (5 min), cache read; web search is per request
PRICES = {"claude-sonnet-5-5": (2.0, 10.0, 2.5, 0.20), "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01)}
SEARCH_USD = 0.01
MAX_TOKENS = 16000
MAX_TURNS = 60                 # requests per segment (a paused server-tool turn counts as one)
WORKERS = 3
COMPLETE_BATCH = 6
DEFAULT_BUDGET_USD = 15.0
LOG_LINES = 400

SEGMENTS = [
    {"key": "aggregators", "title": "Release news and aggregators",
     "focus": "Release lists and fragrance news. Best so far: Now Smell This (nstperfume.com: its 'New perfumes' "
              "page for the year and its post feed), ScentAdvice (scentadvice.com new releases: notes, perfumer and "
              "image for most items), Parfumo's news blog, NewBeauty monthly round-ups, CaFleureBon, Persolaise and "
              "brand press rooms. Fragrantica and Basenotes usually refuse automated reading: use their listings "
              "only through search results. Cover every kind of house; this segment is about breadth."},
    {"key": "retailers", "title": "Retailers' new arrivals",
     "focus": "Retailers' 'new in' / 'new arrivals' fragrance pages. Luckyscent ('New and Noteworthy', 'New "
              "Additions') and Shopify shops (Aedes, Ministry of Scent, Indigo Perfumery, Bluemercury, Twisted Lily: "
              "read /products.json) work well; Sephora, Notino, Harrods and Selfridges often block reading, so use "
              "their pages through search results. Also Ounass, Faces (UAE), Douglas, LookFantastic, Escentual."},
    {"key": "designer", "title": "Designer houses",
     "focus": "Designer and fashion houses: Dior, Chanel, YSL, Armani, Prada, Gucci, Valentino, Versace, Dolce & "
              "Gabbana, Givenchy, Lancome, Carolina Herrera, Paco Rabanne (Rabanne), Jean Paul Gaultier, Hermes, "
              "Burberry, Tom Ford, Calvin Klein, Hugo Boss, Montblanc, Azzaro, Mugler, Viktor & Rolf, Narciso "
              "Rodriguez, Chloe, Coach, Michael Kors, Ralph Lauren, Bvlgari, Cartier, Louis Vuitton, Loewe, "
              "Balenciaga, Celine and similar."},
    {"key": "niche", "title": "Luxury niche houses",
     "focus": "Luxury niche houses: Maison Francis Kurkdjian, Parfums de Marly, Initio, Xerjoff, Creed, Amouage, "
              "Byredo, Le Labo, Diptyque, Frederic Malle, Kilian, Roja, Nishane, Memo, Mancera, Montale, "
              "Serge Lutens, Penhaligon's, Jo Malone, Acqua di Parma, Maison Margiela Replica, Juliette Has a Gun, "
              "Ex Nihilo, BDK, Atelier Cologne, Goldfield & Banks, Vilhelm, Tiziana Terenzi, Sospiro and similar."},
    {"key": "middle_east", "title": "Middle Eastern houses",
     "focus": "Middle Eastern and Gulf houses: Lattafa, Armaf, Afnan, Rasasi, Ajmal, Arabian Oud, Swiss Arabian, "
              "Al Haramain, Maison Alhambra, French Avenue, Fragrance World, Rayhaan, Paris Corner, Ard Al Zaafaran, "
              "Abdul Samad Al Qurashi, Junaid Jamshed, Khadlaj, Zimaya, Gissah, Ibraheem Al Qurashi, Nabeel and "
              "similar. Their own sites, Instagram launch posts and UAE / Saudi retailers are good sources."},
    {"key": "mass", "title": "Celebrity and mass market",
     "focus": "Celebrity and mass-market fragrances: Ariana Grande, Billie Eilish, Sabrina Carpenter, Kylie, "
              "Taylor Swift, Rihanna (Fenty), Sol de Janeiro, Bath & Body Works fine fragrance, Victoria's Secret, "
              "Zara, Adidas, Nautica, Antonio Banderas, Paris Hilton, Britney Spears and similar."},
    {"key": "indie", "title": "Indie and artisan niche",
     "focus": "Indie and artisan niche houses: Imaginary Authors, Zoologist, Sarah Baker, DS & Durga, Hiram Green, "
              "Rogue, Bortnikoff, Areej le Dore, Fueguia, Nasomatto, Orto Parisi, Etat Libre d'Orange, Heretic, "
              "Maison Crivelli, Matiere Premiere, Parfums Dusita, Ormonde Jayne, Sora Dora, Strangers Parfumerie and "
              "similar. Indie review blogs and shops (Luckyscent, Twisted Lily, Indigo Perfumery) list new arrivals."},
]
SEGMENT_KEYS = [s["key"] for s in SEGMENTS]

SYSTEM = """You research new fragrance releases for Scent Atlas, a fragrance encyclopedia. Its catalogue (140,000 \
perfumes from 8,300 houses) is a snapshot from about September 2026. Today is {today}.

What counts: fragrances released or officially announced from {since} onward (announced-but-upcoming included), and any \
2025-2026 release you come across that the catalogue is missing. A new flanker or concentration ("Elixir", "Intense", \
"Parfum") is its own fragrance. Never report gift sets, travel sizes, re-packaging of an existing scent, body products, \
candles, or rumours without a credible source.

How to work:
- Discover through pages that list many releases at once (release news, retailers' new-arrivals pages), then confirm \
each item from the best source you can (the brand's own page or press release first, then a major retailer).
- Shops built on Shopify publish their whole catalogue as JSON at /products.json (notes, perfumer and image are often in it): a quick way to read a retailer's or brand's new arrivals when its pages block fetching.
- Call check_catalogue before researching an item in depth, and skip it when the catalogue already has the same product.
- Never invent anything. Leave a field null or [] rather than guess.
- Note names in English, one ingredient per entry ("Bergamot", "Pink Pepper"). Use "general" when the brand gives a flat \
list with no pyramid.
- description: one or two sentences in your own words (never copied marketing copy).
- image_url: a direct link to a bottle image file (jpg / png / webp) from the brand site or a retailer CDN, taken from \
the product page; null if you can't find one.
- confidence, per field from 0 to 1: 0.9-1.0 official brand source, or two independent reliable sources agree; \
0.6-0.8 one reliable retailer or news source; 0.3-0.5 aggregator or user-generated only, or partial / conflicting. \
Below 0.3, leave the value empty and give 0. identity = it exists and the brand / name are right.
- List every source you used, with what it supports.

Report through the submit_fragrances tool, in batches of at most 8, as soon as each batch is ready: don't hold \
everything to the end. When you have covered your assignment, say so in one line and stop."""

DISCOVER_TASK = """Your segment: {title}.
{focus}

Find as many genuinely new fragrances in this segment as you can, with accurate data for each (25-60 is a good \
result). Submit them with submit_fragrances in batches as you go."""

COMPLETE_TASK = """These candidates are already in the review queue but some data is missing or uncertain. For each \
one, research what is missing (listed under "missing"; also improve any field with low confidence), then submit the \
complete record with submit_fragrances, setting item_id to the candidate's id and keeping brand / name / \
concentration as given unless you find they are wrong (then say so in comment). If you can't confirm the fragrance \
exists at all, submit it with identity confidence below 0.3 and explain in comment.

Candidates:
{items}"""

_conf_props = {k: {"type": "number", "description": "0-1"} for k in dz.CONF_FIELDS}
_nullable = lambda t, **kw: {"anyOf": [{"type": t, **kw}, {"type": "null"}]}  # noqa: E731
ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "item_id": _nullable("integer", description="Only when completing a candidate from the review queue: its id."),
        "brand": {"type": "string"}, "name": {"type": "string", "description": "Without the brand."},
        "concentration": _nullable("string", description="EDP, EDT, Parfum, Extrait de Parfum, Eau de Cologne, Perfume Oil..."),
        "gender": _nullable("string", enum=["women", "men", "unisex"]),
        "release_date": _nullable("string", description="YYYY-MM-DD, YYYY-MM or YYYY"),
        "status": _nullable("string", enum=["released", "announced"]),
        "perfumers": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "object", "additionalProperties": False, "required": list(dz.LAYERS),
                  "properties": {k: {"type": "array", "items": {"type": "string"}} for k in dz.LAYERS}},
        "family": _nullable("string"), "description": _nullable("string"),
        "image_url": _nullable("string"), "official_url": _nullable("string"),
        "sources": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["url", "title", "kind", "supports"],
            "properties": {"url": {"type": "string"}, "title": {"type": "string"},
                           "kind": {"type": "string", "enum": list(dz.SOURCE_KINDS)},
                           "supports": {"type": "array", "items": {"type": "string", "enum": list(dz.CONF_FIELDS)}}}}},
        "confidence": {"type": "object", "additionalProperties": False, "required": list(dz.CONF_FIELDS),
                       "properties": _conf_props},
        "comment": _nullable("string"),
    },
    "required": ["item_id", "brand", "name", "concentration", "gender", "release_date", "status", "perfumers", "notes",
                 "family", "description", "image_url", "official_url", "sources", "confidence", "comment"],
    "additionalProperties": False,
}
SUBMIT_TOOL = {
    "name": "submit_fragrances",
    "description": "Save researched fragrances to the Scent Atlas review queue (at most 8 per call). Returns what was "
                   "saved, which ones repeat a catalogue perfume, and what each one still lacks.",
    "strict": True,
    "input_schema": {"type": "object", "additionalProperties": False, "required": ["fragrances"],
                     "properties": {"fragrances": {"type": "array", "items": ITEM_SCHEMA}}},
}
CHECK_TOOL = {
    "name": "check_catalogue",
    "description": "Look a fragrance up in the Scent Atlas catalogue and review queue before researching it. Returns "
                   "the closest catalogue matches for the brand and name, and whether it is already a candidate.",
    "strict": True,
    "input_schema": {"type": "object", "additionalProperties": False, "required": ["brand", "name"],
                     "properties": {"brand": {"type": "string"}, "name": {"type": "string"}}},
}


def web_tools(model: str) -> list[dict]:
    if model == MODELS["sonnet"]:   # dynamic filtering versions
        return [{"type": "web_search_20260209", "name": "web_search", "max_uses": 40},
                {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 40}]
    return [{"type": "web_search_20250305", "name": "web_search", "max_uses": 40},
            {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 40}]


def cost_of(model: str, usage) -> tuple[float, int]:
    """(USD at list prices, web searches) for one response's usage."""
    p_in, p_out, p_cw, p_cr = PRICES.get(model, PRICES[MODELS["sonnet"]])
    g = (lambda k: getattr(usage, k, 0) or 0)
    stu = getattr(usage, "server_tool_use", None)
    searches = (getattr(stu, "web_search_requests", 0) or 0) if stu else 0
    usd = (g("input_tokens") * p_in + g("output_tokens") * p_out + g("cache_creation_input_tokens") * p_cw
           + g("cache_read_input_tokens") * p_cr) / 1e6 + searches * SEARCH_USD
    return usd, searches


def api_key() -> str | None:
    return os.environ.get("ANTHROPIC_API_KEY") or None


# ---------------------------------------------------------------------------- the engine
class Engine:
    """At most one run at a time; its segments run in parallel threads."""

    def __init__(self, store, cat, client_factory=None):
        self.store, self.cat = store, cat
        self._client_factory = client_factory
        self._lock = threading.Lock()
        self._current: dict | None = None    # {"id", "cancel": Event}
        self._fallbacks_ok = True
        self._mark_interrupted()

    # ------------------------------------------------------------ state
    def ready(self) -> bool:
        return bool(self._client_factory or api_key())

    def running(self) -> int | None:
        with self._lock:
            return self._current["id"] if self._current else None

    def _mark_interrupted(self):
        try:
            with self.store.eng.begin() as c:
                c.execute(discovery_runs.update().where(discovery_runs.c.status.in_(("queued", "running")))
                          .values(status="interrupted", finished_at=int(time.time()),
                                  error="The app restarted while this run was going; what it had found is kept."))
        except Exception:
            pass

    def _client(self):
        if self._client_factory:
            return self._client_factory()
        import anthropic
        return anthropic.Anthropic(max_retries=4, timeout=600.0)

    # ------------------------------------------------------------ starting / cancelling
    def start(self, kind: str, segments: list[str] | None = None, model: str | None = None,
              complete_model: str | None = None, budget_usd: float = DEFAULT_BUDGET_USD, max_items: int = 60,
              since: str = "2026-07-01") -> int:
        if kind not in ("discover", "complete", "full"):
            raise ValueError("unknown run kind")
        if not self.ready():
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        segs = [s for s in (segments or SEGMENT_KEYS) if s in SEGMENT_KEYS]
        params = {"segments": segs if kind != "complete" else [], "budget_usd": float(budget_usd),
                  "model": MODELS.get(model or "sonnet", MODELS["sonnet"]),
                  "complete_model": MODELS.get(complete_model or "haiku", MODELS["haiku"]),
                  "max_items": int(max_items), "since": since}
        with self._lock:
            if self._current:
                raise RuntimeError("a run is already going")
            now = int(time.time())
            with self.store.eng.begin() as c:
                rid = int(c.execute(discovery_runs.insert().values(
                    kind=kind, status="running", model=params["model"] if kind != "complete" else params["complete_model"],
                    params=json.dumps(params), stats=json.dumps({"cost_usd": 0.0}), log="", created_at=now,
                    started_at=now)).inserted_primary_key[0])
            self._current = {"id": rid, "cancel": threading.Event()}
        threading.Thread(target=self._run, args=(rid, kind, params, self._current["cancel"]), daemon=True, name=f"discovery-run-{rid}").start()
        return rid

    def cancel(self, rid: int) -> bool:
        with self._lock:
            if self._current and self._current["id"] == rid:
                self._current["cancel"].set()
                return True
        return False

    # ------------------------------------------------------------ one run
    def _run(self, rid: int, kind: str, params: dict, cancel: threading.Event):
        run = _Run(self, rid, params, cancel)
        status, error = "done", None
        try:
            if kind in ("discover", "full"):
                with ThreadPoolExecutor(WORKERS) as ex:
                    list(ex.map(run.discover, [s for s in SEGMENTS if s["key"] in params["segments"]]))
            if kind in ("complete", "full") and not run.stopped():
                run.complete()
            segs = run.stats["segments"].values()
            if run.cancel.is_set():
                status = "cancelled"
            elif segs and all(s["status"] == "failed" for s in segs):
                status, error = "failed", "Every part of the run failed; see the log."
            elif run.over_budget():
                status, error = "done", f"Stopped at the ${params['budget_usd']:.2f} budget."
        except Exception as e:   # noqa: BLE001
            log.exception("discovery run %s failed", rid)
            status, error = "failed", f"{type(e).__name__}: {e}"[:1000]
        finally:
            run.flush(status=status, error=error, finished=True)
            with self._lock:
                self._current = None


class _Run:
    def __init__(self, engine: Engine, rid: int, params: dict, cancel: threading.Event):
        self.e, self.rid, self.p, self.cancel = engine, rid, params, cancel
        self.lock = threading.Lock()
        self.stats = {"cost_usd": 0.0, "requests": 0, "searches": 0, "input_tokens": 0, "output_tokens": 0,
                      "new": 0, "updated": 0, "skipped": 0, "segments": {}}
        self.lines: list[str] = []
        self.new_ids: list[int] = []

    # ------------------------------------------------------------ bookkeeping
    def say(self, msg: str):
        line = time.strftime("%H:%M:%S ") + msg
        with self.lock:
            self.lines.append(line)
            self.lines = self.lines[-LOG_LINES:]
        self.flush()

    def flush(self, status: str | None = None, error: str | None = None, finished: bool = False):
        with self.lock:
            vals = {"stats": json.dumps(self.stats), "log": "\n".join(self.lines)}
        if status:
            vals["status"] = status
        if error:
            vals["error"] = error
        if finished:
            vals["finished_at"] = int(time.time())
        with self.e.store.eng.begin() as c:
            c.execute(discovery_runs.update().where(discovery_runs.c.id == self.rid).values(**vals))

    def over_budget(self) -> bool:
        return self.stats["cost_usd"] >= self.p["budget_usd"]

    def stopped(self) -> bool:
        return self.cancel.is_set() or self.over_budget()

    def seg(self, key: str) -> dict:
        with self.lock:
            return self.stats["segments"].setdefault(key, {"key": key, "status": "running", "requests": 0, "submitted": 0,
                                                           "new": 0, "updated": 0, "cost_usd": 0.0})

    # ------------------------------------------------------------ tools
    def check(self, brand: str, name: str) -> str:
        hits = []
        try:
            for h in self.e.cat.find_perfumes(f"{brand} {name}", 6, budget=0.05):
                hits.append(f"{h.get('brand')} - {h.get('name')} ({h.get('year') or 'year unknown'})")
        except Exception:
            pass
        key_prefix = f"{dz.brand_key(brand)}|{dz.name_key(name)}|"
        with self.e.store.eng.connect() as c:
            q = c.execute(sa.select(discovery_items.c.id, discovery_items.c.concentration, discovery_items.c.state,
                                    discovery_items.c.missing)
                          .where(discovery_items.c.key.like(key_prefix + "%")).limit(5)).all()
        out = {"catalogue_matches": hits or "none",
               "review_queue": [{"id": r.id, "concentration": r.concentration, "state": r.state,
                                 "missing": json.loads(r.missing or "[]")} for r in q] or "none"}
        return json.dumps(out)

    def submit(self, items: list, seg: dict) -> str:
        res = dz.ingest(self.e.store, self.e.cat, items or [], run_id=self.rid, origin=f"engine:{seg['key']}")
        with self.lock:
            for k in ("new", "updated", "skipped"):
                self.stats[k] += res[k]
            seg["submitted"] += len(items or [])
            seg["new"] += res["new"]
            seg["updated"] += res["updated"]
            self.new_ids.extend(res["ids"])
        dz.fetch_images_async(self.e.store, res["ids"])
        summary = []
        with self.e.store.eng.connect() as c:
            for iid in res["ids"]:
                r = c.execute(sa.select(discovery_items.c.brand, discovery_items.c.name, discovery_items.c.state,
                                        discovery_items.c.missing).where(discovery_items.c.id == iid)).first()
                if r:
                    summary.append(f"#{iid} {r.brand} - {r.name}: {r.state}"
                                   + (f", still missing {', '.join(json.loads(r.missing or '[]'))}" if r.missing not in (None, "[]") else ""))
        self.say(f"[{seg['key']}] saved {res['new']} new, {res['updated']} updated, {res['skipped']} skipped")
        return json.dumps({"saved": len(res["ids"]), "skipped": res["skipped"], "items": summary,
                           "note": "Images are fetched from image_url in the background."})

    # ------------------------------------------------------------ the agent loop
    def _create(self, client, model: str, messages: list):
        kw = dict(model=model, max_tokens=MAX_TOKENS, system=SYSTEM.format(today=time.strftime("%Y-%m-%d"), since=self.p["since"]),
                  messages=messages, tools=[*web_tools(model), SUBMIT_TOOL, CHECK_TOOL],
                  output_config={"effort": "high"}, cache_control={"type": "ephemeral"})
        betas = []
        if model == MODELS["haiku"]:
            betas.append("web-fetch-2025-09-10")
        if model == MODELS["sonnet"] and self.e._fallbacks_ok:
            betas.append("server-side-fallback-2026-07-01")
            kw["fallbacks"] = "default"
        try:
            return client.beta.messages.create(betas=betas, **kw) if betas else client.beta.messages.create(**kw)
        except Exception as err:   # an account without the fallback beta: carry on without it
            if kw.get("fallbacks") and "fallback" in str(err).lower():
                self.e._fallbacks_ok = False
                kw.pop("fallbacks")
                betas.remove("server-side-fallback-2026-07-01")
                return client.beta.messages.create(betas=betas, **kw) if betas else client.beta.messages.create(**kw)
            raise

    def converse(self, model: str, task: str, seg: dict):
        client = self.e._client()
        messages: list = [{"role": "user", "content": task}]
        nudged = False
        for _ in range(MAX_TURNS):
            if self.stopped():
                break
            resp = self._create(client, model, messages)
            usd, searches = cost_of(model, resp.usage)
            with self.lock:
                self.stats["cost_usd"] = round(self.stats["cost_usd"] + usd, 4)
                self.stats["requests"] += 1
                self.stats["searches"] += searches
                self.stats["input_tokens"] += (resp.usage.input_tokens or 0)
                self.stats["output_tokens"] += (resp.usage.output_tokens or 0)
                seg["requests"] += 1
                seg["cost_usd"] = round(seg["cost_usd"] + usd, 4)
            self.flush()
            messages.append({"role": "assistant", "content": resp.content})
            if resp.stop_reason == "pause_turn":
                continue
            if resp.stop_reason == "refusal":
                self.say(f"[{seg['key']}] the model declined to continue")
                break
            uses = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
            if not uses:
                if seg["submitted"] or nudged:
                    break
                nudged = True
                messages.append({"role": "user", "content": "If you found anything, submit it now with "
                                 "submit_fragrances; otherwise reply that there was nothing new."})
                continue
            results = []
            for b in uses:
                if resp.stop_reason == "max_tokens":
                    out, err = "Your output was cut off. Submit fewer fragrances per call (at most 4).", True
                elif b.name == "submit_fragrances":
                    items = (b.input or {}).get("fragrances")
                    out, err = (self.submit(items, seg), False) if isinstance(items, list) else ("fragrances must be a list", True)
                elif b.name == "check_catalogue":
                    out, err = self.check(str((b.input or {}).get("brand", "")), str((b.input or {}).get("name", ""))), False
                else:
                    out, err = f"unknown tool {b.name}", True
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": out, **({"is_error": True} if err else {})})
            messages.append({"role": "user", "content": results})

    def discover(self, segment: dict):
        seg = self.seg(segment["key"])
        self.say(f"[{segment['key']}] searching: {segment['title']}")
        try:
            self.converse(self.p["model"], DISCOVER_TASK.format(**segment), seg)
            seg["status"] = "cancelled" if self.cancel.is_set() else ("budget" if self.over_budget() else "done")
        except Exception as e:   # one segment failing doesn't end the run
            seg["status"] = "failed"
            self.say(f"[{segment['key']}] failed: {type(e).__name__}: {str(e)[:300]}")
        self.say(f"[{segment['key']}] {seg['status']}: {seg['new']} new, {seg['updated']} updated, ${seg['cost_usd']:.2f}")

    def complete(self):
        with self.e.store.eng.connect() as c:
            rows = [dict(r) for r in c.execute(
                sa.select(discovery_items).where(discovery_items.c.state == "incomplete")
                .order_by(discovery_items.c.attempts, discovery_items.c.overall.desc())
                .limit(self.p["max_items"])).mappings()]
        if not rows:
            self.say("[complete] nothing incomplete to work on")
            return
        batches = [rows[i:i + COMPLETE_BATCH] for i in range(0, len(rows), COMPLETE_BATCH)]
        self.say(f"[complete] {len(rows)} incomplete candidates in {len(batches)} batches")

        def one(k_batch):
            k, batch = k_batch
            seg = self.seg(f"complete-{k + 1}")
            listing = "\n".join(json.dumps({
                "id": r["id"], "brand": r["brand"], "name": r["name"], "concentration": r["concentration"],
                "missing": json.loads(r["missing"] or "[]"), "confidence": json.loads(r["confidence"] or "{}"),
                "known": {"gender": r["gender"], "release_date": r["release_date"], "notes": json.loads(r["notes"] or "{}"),
                          "perfumers": json.loads(r["perfumers"] or "[]"), "image_url": r["image_url"],
                          "official_url": r["official_url"]}}, ensure_ascii=False) for r in batch)
            try:
                self.converse(self.p["complete_model"], COMPLETE_TASK.format(items=listing), seg)
                seg["status"] = "cancelled" if self.cancel.is_set() else "done"
            except Exception as e:
                seg["status"] = "failed"
                self.say(f"[{seg['key']}] failed: {type(e).__name__}: {str(e)[:300]}")
            with self.e.store.eng.begin() as c:   # count the attempt even when nothing new was found
                c.execute(discovery_items.update().where(discovery_items.c.id.in_([r["id"] for r in batch]))
                          .where(discovery_items.c.last_run_id.is_distinct_from(self.rid))
                          .values(attempts=discovery_items.c.attempts + 1, last_run_id=self.rid))

        with ThreadPoolExecutor(WORKERS) as ex:
            list(ex.map(one, enumerate(batches)))
