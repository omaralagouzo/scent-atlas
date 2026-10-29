"""Scent Atlas - FastAPI server.

Local:   python server.py [--open]            ->  http://127.0.0.1:8765
Render:  uvicorn app.server:app --host 0.0.0.0 --port $PORT --workers 1 --no-server-header   (see DEPLOY.md)

All deployment knobs are environment variables (see config.Settings.from_env / DEPLOY.md).
"""
from __future__ import annotations

import os
import sys
import threading
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import admin  # noqa: E402
import demo_seed  # noqa: E402
import discovery  # noqa: E402
import discovery_api  # noqa: E402
import auth  # noqa: E402
import catalog as cat_mod  # noqa: E402
import config  # noqa: E402
import images  # noqa: E402
import layering  # noqa: E402
import palette  # noqa: E402
import query  # noqa: E402
import similarity as sim  # noqa: E402
import user_api  # noqa: E402
import userdb  # noqa: E402

ROOT = HERE.parent
DATA_DIR = ROOT / "data"

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https://fimgs.net https://upload.wikimedia.org; "
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; frame-ancestors 'none'"
)
# with GOOGLE_MAPS_API_KEY set: Google's allow-list for the Maps JavaScript API + Places (address search, pin map)
GOOGLE_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com blob:; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "img-src 'self' data: blob: https://fimgs.net https://upload.wikimedia.org https://*.googleapis.com https://*.gstatic.com "
    "*.google.com *.googleusercontent.com; "
    "connect-src 'self' https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:; "
    "font-src 'self' https://fonts.gstatic.com; frame-src *.google.com; worker-src blob:; object-src 'none'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)
DOCS_CSP = (  # only used for /api/docs when ENABLE_DOCS=1 (Swagger UI loads from a CDN)
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "frame-ancestors 'none'"
)
MAX_BODY = 256 * 1024


# --------------------------------------------------------------------------- catalog loading
def with_discoveries(path: Path, published: list[dict] | None, data_dir: Path) -> Path:
    """The catalogue database to load: `path` itself, or a copy of it with the published new releases added."""
    if not published:
        return path
    try:
        return discovery.merged_catalog(path, published, data_dir / "cache")
    except Exception as e:  # never let a bad candidate keep the site down
        print(f"[scent-atlas] could not add {len(published)} published discoveries ({e!r}); loading without them",
              file=sys.stderr)
        return path


def load_catalog(data_dir: Path, db_path: Path | None = None, settings: config.Settings | None = None,
                 published: list[dict] | None = None):
    settings = settings or config.Settings.from_env()
    mode = settings.image_mode
    if db_path is not None:
        return cat_mod.Catalog(with_discoveries(Path(db_path), published, data_dir), mode), Path(db_path), "custom"
    path, kind = config.pick_catalog_db(settings, data_dir)
    try:
        c = cat_mod.Catalog(with_discoveries(path, published, data_dir), mode)
        if kind in ("master", "deploy") and (c.n_perf == 0 or c.n_notes == 0):
            raise RuntimeError(f"{path.name} has no perfumes/notes yet")
        return c, path, kind
    except Exception as e:  # empty / half-written master.db etc.
        if kind not in ("master", "deploy"):
            raise
        print(f"[scent-atlas] could not use {path} ({e!r}); falling back to fixture", file=sys.stderr)
        fixture = HERE / "fixture.db"
        if not fixture.exists():
            import make_fixture
            make_fixture.build(fixture)
        return cat_mod.Catalog(fixture, mode), fixture, "fixture"


# --------------------------------------------------------------------------- models
class QueryNote(BaseModel):
    slug: str
    layer: str = "any"


class SimilarFilters(BaseModel):
    """Result filters for /api/similar. Same keys as the Combine URL (see query.py); all optional."""
    model_config = {"extra": "ignore"}
    brand: str | None = None
    gender: str | None = None
    year_min: int | None = None
    year_max: int | None = None
    year_unknown: bool | str | None = None
    name: str | None = None
    brands: str | None = None
    perfumers: str | None = None
    accords: str | None = None
    acc_any: bool | str | None = None
    acc_main: bool | str | None = None
    countries: str | None = None
    rating_min: float | None = None
    votes_min: int | None = None
    btags: str | None = None
    btags_not: str | None = None
    has_dupes: bool | str | None = None
    is_dupe: bool | str | None = None

    def as_params(self) -> dict:
        return {k: ("1" if v is True else v) for k, v in self.model_dump().items() if v not in (None, "", False)}


class SimilarBody(BaseModel):
    notes: list[QueryNote]
    exclude_ids: list[int] = Field(default_factory=list)
    filters: SimilarFilters = Field(default_factory=SimilarFilters)
    offset: int = 0
    limit: int = Field(30, ge=1, le=200)
    ff: bool = False                 # also return filter facets (counts over everybody sharing a note)


class SimilarFacetBody(BaseModel):
    notes: list[QueryNote]
    filters: SimilarFilters = Field(default_factory=SimilarFilters)
    facet: str
    fq: str = ""
    offset: int = Field(0, ge=0)
    limit: int = Field(12, ge=1, le=100)


class ResolveBody(BaseModel):
    names: list[str]


class NoCacheStatic(StaticFiles):
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


def admin_host_extra(path: str) -> bool:
    """Non-admin paths the admin host may serve: its page at /, the built assets, photos, images and the health check."""
    return path in ("/", "/index.html", "/api/status", "/next/theme.js", "/next/favicon.svg") or path.startswith(
        ("/next/assets/", "/api/avatars/", "/img/"))


def host_allowed(host_header: str, allowed: tuple) -> bool:
    host = (host_header or "").strip().lower()
    only = auth.host_only(host)
    for pat in allowed:
        if pat == "*" or pat in (host, only):
            return True
        if pat.startswith("*.") and only.endswith(pat[1:]):
            return True
    return False


# --------------------------------------------------------------------------- app factory
def create_app(db_path: str | Path | None = None, data_dir: str | Path | None = None,
               user_path: str | Path | None = None, fetch_images: bool | None = None,
               settings: config.Settings | None = None, users_db_url: str | None = None,
               image_mode: str | None = None) -> FastAPI:
    settings = (settings or config.Settings.from_env()).with_(image_mode=image_mode)
    data_dir = Path(data_dir) if data_dir else DATA_DIR
    user_path = Path(user_path) if user_path else data_dir / "user.json"
    discovery_files = data_dir / "discovery"
    store = userdb.UserStore(users_db_url or config.normalize_database_url(settings.database_url, data_dir / "users.db"))
    # published new releases (admin > New releases) join the catalogue here, so the store opens first
    cat, used_db, db_kind = load_catalog(data_dir, db_path, settings, published=discovery.published_rows(store))
    remote = settings.image_mode == "remote"
    if fetch_images is None:
        fetch_images = os.environ.get("SCENT_NO_FETCH") != "1"
    # remote mode: the browser loads images straight from fimgs.net / Wikimedia; nothing is proxied or written here
    fetcher = images.BottleFetcher(data_dir / "images" / "perfumes", enabled=bool(fetch_images) and not remote)

    rl = settings.rate_limit_per_min
    ctx = user_api.Ctx(
        store=store, cat=cat, settings=settings, user_path=user_path,
        limit_login_ip=auth.RateLimiter(rl), limit_login_acct=auth.RateLimiter(rl),
        limit_signup_ip=auth.RateLimiter(rl), limit_signup_acct=auth.RateLimiter(rl),
        limit_pw_acct=auth.RateLimiter(rl), import_lock=threading.Lock(),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # build the layering model (pool features, curated pairs: ~1 s, ~4 MB) off the request path
        threading.Thread(target=layering.model, args=(cat,), daemon=True, name="layering-warmup").start()
        if settings.seed_demo and settings.site_env == "development":
            # made-up members for the development environment; does nothing once any account exists
            threading.Thread(target=demo_seed.seed, args=(store, cat), daemon=True, name="demo-seed").start()
        if discovery_files is not None:
            # research results committed under data/discovery/ go into the review queue once each (never published)
            threading.Thread(target=discovery.import_files, args=(store, cat, discovery_files), daemon=True,
                             name="discovery-import").start()
        if os.environ.get("SCENT_OPEN") == "1":
            threading.Timer(0.8, lambda: webbrowser.open(f"http://{settings.host}:{settings.port}/")).start()
        yield
        store.dispose()

    app = FastAPI(title="Scent Atlas", lifespan=lifespan,
                  docs_url="/api/docs" if settings.enable_docs else None,
                  redoc_url=None, openapi_url="/api/openapi.json" if settings.enable_docs else None)
    app.state.cat = cat
    app.state.fetcher = fetcher
    app.state.data_dir = data_dir
    app.state.user_path = user_path
    app.state.settings = settings
    app.state.store = store
    app.state.ctx = ctx

    page_csp = GOOGLE_CSP if settings.google_maps_key else CSP

    @app.middleware("http")
    async def edge(request: Request, call_next):
        """Host allow-list, body cap, security headers, sliding session cookie."""
        path = request.url.path
        # the platform health check (/api/status) is exempt from the host list: it exposes only counts
        host = request.headers.get("host", "")
        on_admin_host = bool(settings.admin_host) and auth.host_only(host.lower()) == settings.admin_host
        admin_path = path.startswith(("/admin", "/api/admin"))
        if path != "/api/status" and not host_allowed(host, settings.allowed_hosts):
            resp = JSONResponse({"detail": "bad host"}, status_code=400)
        elif settings.admin_host and (admin_path != on_admin_host) and not (on_admin_host and admin_host_extra(path)):
            # with ADMIN_HOST set, the admin exists only there, and that host serves nothing but the admin
            resp = JSONResponse({"detail": "Not Found"}, status_code=404)
        elif (settings.canonical_host and request.method in ("GET", "HEAD") and path != "/api/status" and not on_admin_host
              and auth.host_only(host.lower()) != settings.canonical_host):
            # e.g. the old *.onrender.com address -> the custom domain (writes are left alone so open pages keep working)
            q = request.url.query
            resp = RedirectResponse(f"https://{settings.canonical_host}{path}{'?' + q if q else ''}", status_code=301)
        elif request.method in ("POST", "PUT", "PATCH") and int(request.headers.get("content-length") or 0) > MAX_BODY:
            resp = JSONResponse({"detail": "request too large"}, status_code=413)
        else:
            resp = await call_next(request)
            tok = getattr(request.state, "refresh_cookie", None)
            if tok:
                user_api.set_session_cookie(resp, request, settings, tok)
            elif getattr(request.state, "clear_cookie", False):
                user_api.clear_session_cookie(resp, request, settings)
        h = resp.headers
        h["Content-Security-Policy"] = DOCS_CSP if (settings.enable_docs and path.startswith("/api/")) else page_csp
        if admin_path or on_admin_host or settings.site_env != "production":
            h["X-Robots-Tag"] = "noindex, nofollow"
            h["Cache-Control"] = "no-store"
        h["X-Content-Type-Options"] = "nosniff"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["X-Frame-Options"] = "DENY"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self), payment=()"   # "near me" uses location
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        if user_api.is_https(request, settings):
            h["Strict-Transport-Security"] = "max-age=31536000"
        return resp

    # ---------------------------------------------------------------- helpers
    def get_idx(pid: int) -> int:
        i = cat.idx_of(pid)
        if i is None:
            raise HTTPException(404, "perfume not found")
        return i

    def parse_notes_param(s: str | None):
        out = []
        for part in (s or "").split(","):
            part = part.strip()
            if not part:
                continue
            slug, _, layer = part.partition("@")
            layer = layer.strip().lower()
            if layer in ("", "any", "all"):
                code = None
            elif layer in cat_mod.LAYER_ALIASES:
                code = cat_mod.LAYER_ALIASES[layer]
            else:
                raise HTTPException(400, f"bad layer {layer!r}")
            out.append((cat_mod.slugify(slug) if slug not in cat.note_index else slug, code))
        return out

    def layer_param(layer: str | None):
        if not layer or layer in ("any", "all"):
            return None
        if layer not in cat_mod.LAYER_ALIASES:
            raise HTTPException(400, f"bad layer {layer!r}")
        return cat_mod.LAYER_ALIASES[layer]

    def sim_response(res: sim.QueryResult, total_extra=None, accord_vec=None, source=None):
        results = []
        top = res.top_score or 1.0
        src_acc = {n.lower() for n in cat.accord_names(source)} if source is not None else set()
        for k, i in enumerate(res.idx.tolist()):
            d = cat.summary(i)
            d["score"] = round(float(res.score[k]), 4)
            d["relative"] = round(float(res.score[k]) / top, 4)
            d["explanation"] = sim.explain(cat, res.items, res.wq, i) if res.items else []
            d["pyramid"] = cat.pyramid_slim(i)
            if accord_vec is not None and source is not None:
                shared = [n for n in cat.accord_names(i) if n.lower() in src_acc]
                d["shared_accords"] = [{"name": n, "color": palette.accord_color(n)} for n in shared[:4]]
                d["accord_similarity"] = round(float(accord_vec[i]), 3)
            results.append(d)
        return {"total": res.total, "results": results}

    def query_echo(items):
        return [{**cat.note_obj(j), "layer": "any" if ql == sim.Q_ANY else sim.LAYER_NAMES[ql] if ql < 4 else "general",
                 "weight": round(float(cat.idf[j]), 3)} for j, ql in items]

    # ---------------------------------------------------------------- status (health check)
    @app.get("/api/status")
    def status():
        d = {"ok": True, "kind": db_kind, "perfumes": cat.n_perf, "notes": cat.n_notes,
             "note_rows": int(len(cat.pn_note)), "load_seconds": round(cat.load_seconds, 2),
             "brand_tags": bool(cat.tags_loaded), "dupe_links": int(len(cat.dl_target)),
             "image_mode": settings.image_mode, "users_db": store.eng.dialect.name, "env": settings.site_env}
        if db_kind != "deploy":
            d["db"] = str(used_db)  # local paths are fine to show locally, never on a public host
        return d

    if os.environ.get("DEBUG_CLIENT_IP") == "1":  # temporary: verify PROXY_HOPS after deploying, then unset
        @app.get("/api/whoami")
        def whoami(request: Request):
            return {"client_ip_used_for_rate_limits": auth.client_ip(request, settings.trust_proxy, settings.proxy_hops),
                    "x_forwarded_for": request.headers.get("x-forwarded-for"), "peer": request.client.host if request.client else None,
                    "x_forwarded_proto": request.headers.get("x-forwarded-proto"), "https": user_api.is_https(request, settings)}

    @app.get("/api/credits")
    def credits():
        return {"note_images": cat.note_credits(), "image_mode": settings.image_mode}

    # ---------------------------------------------------------------- accounts + per-user data
    app.include_router(user_api.make_router(ctx))
    app.include_router(admin.make_admin_router(ctx))
    discovery_api.add_public_routes(app, store, cat)
    admin.add_admin_pages(app, settings)

    # ---------------------------------------------------------------- query helpers
    def spec_of(params: dict, default_layer=None):
        try:
            return query.parse_spec(cat, params, default_layer)
        except query.QueryError as e:
            raise HTTPException(400, str(e))

    def filters_of(params: dict):
        try:
            return query.parse_filters(cat, params)[0]
        except query.QueryError as e:
            raise HTTPException(400, str(e))

    def check_sort(sort: str):
        if sort not in query.SORT_KEYS:
            raise HTTPException(400, f"sort must be one of {query.SORT_KEYS}")
        return sort

    def run_spec(spec, sort, page, per_page, facets=True, facet_limit=30, ff=False, ff_limit=10):
        try:
            return query.run(cat, spec, sort=check_sort(sort), page=page, per_page=per_page, facet_limit=facet_limit,
                             want_facets=bool(facets) and facet_limit > 0, filter_facets=ff, ff_limit=ff_limit)
        except query.QueryError as e:
            raise HTTPException(400, str(e))

    def facet_of(ev, facet, fq, offset, limit):
        try:
            if facet == "year":
                return query.facet_years(cat, ev.without("year"), ev.spec.flt)
            return query.facet_list(cat, facet, ev, limit, offset, fq)
        except query.QueryError as e:
            raise HTTPException(400, str(e))

    # ---------------------------------------------------------------- notes
    @app.get("/api/notes")
    def notes_list(q: str = "", family: str | None = None, limit: int = Query(60, ge=1, le=500),
                   offset: int = Query(0, ge=0), sort: str = "count"):
        return cat.list_notes(q, family, limit, offset, sort)

    @app.post("/api/notes/resolve")
    def notes_resolve(body: ResolveBody):
        return {"matches": cat.resolve_note_names(body.names[:200])}

    @app.get("/api/brands")
    def brands(q: str = "", limit: int = Query(20, ge=1, le=100)):
        return {"brands": cat.find_brands(q, limit)}

    @app.get("/api/brands/info")
    def brand_info(name: str = Query(..., min_length=1, max_length=120)):
        """Tags, origin country, parent company, notes + confidence and sources of one brand (case-insensitive name)."""
        d = cat.brand_info(name)
        if d is None:
            raise HTTPException(404, "brand not found")
        return d

    @app.get("/api/notes/{slug}/variants")
    def note_variants(slug: str):
        """Every note whose name contains this note's name as a whole word (what the 'include variants' toggle adds)."""
        j = cat.note_index.get(slug)
        if j is None:
            raise HTTPException(404, "note not found")
        ks = query.note_variants(cat, j)
        return {"slug": slug, "name": cat.note_name[j], "count": len(ks),
                "notes": [cat.note_obj(k) for k in sorted(ks, key=lambda k: (k != j, -int(cat.note_df[k])))]}

    @app.get("/api/notes/{slug}")
    def note_detail(request: Request, slug: str, layer: str | None = None, sort: str = "popularity",
                    page: int = Query(1, ge=1), per_page: int = Query(48, ge=1, le=200),
                    pairs: int = Query(24, ge=0, le=60), ff: int = 0):
        j = cat.note_index.get(slug)
        if j is None:
            raise HTTPException(404, "note not found")
        lc = layer_param(layer)
        params = {k: v for k, v in request.query_params.items() if k in query.FILTER_KEYS}
        params["include"] = slug + (f"@{query.LAYER_NAME[lc]}" if lc is not None else "")
        res = run_spec(spec_of(params), sort, page, per_page, facets=False, ff=bool(ff))
        layer_counts = {name: cat.layer_count(L, j) for name, L in (("top", 0), ("middle", 1), ("base", 2), ("general", 3))}
        return {
            "note": cat.note_obj(j, layer_counts=layer_counts, image_source=None),
            "pairs": cat.note_pairs(j, pairs) if pairs else [],
            "perfumes": res,
        }

    # ---------------------------------------------------------------- combination search
    @app.get("/api/search")
    def search(request: Request, mode: str = "all", layer: str | None = None, sort: str = "popularity",
               page: int = Query(1, ge=1), per_page: int = Query(48, ge=1, le=200),
               facets: int = 1, facet_limit: int = Query(30, ge=0, le=100), ff: int = 0, ff_limit: int = Query(10, ge=1, le=50)):
        """Simple form: include / exclude (slug[@layer], comma list) + mode all|any.
        Advanced form: q ("top:tea*,mint~middle:rose,lily~base:amber*") + x (excluded notes) + gen (0|1).
        Filters: name year_min year_max year_unknown brands perfumers accords acc_any acc_main gender countries
        rating_min votes_min must not  btags / btags_not (brand tags, `~` separated: niche designer dupe middle_eastern
        middle_eastern_original middle_eastern_dupe untagged)  has_dupes=1  is_dupe=1  (see query.py).
        sort also accepts `dupes`. ff=1 adds facet counts for the filter panel."""
        spec = spec_of(dict(request.query_params), layer_param(layer))
        return run_spec(spec, sort, page, per_page, facets, facet_limit, bool(ff), ff_limit)

    @app.get("/api/search/facet")
    def search_facet(request: Request, facet: str, fq: str = "", offset: int = Query(0, ge=0),
                     limit: int = Query(12, ge=1, le=100), layer: str | None = None):
        """One facet list (brand | perfumer | accord | gender | country | brand_tags | note | year) for the same query parameters as
        /api/search; `fq` filters the list by text so values beyond the top N can be found."""
        spec = spec_of(dict(request.query_params), layer_param(layer))
        return facet_of(query.evaluate(cat, spec), facet, fq, offset, limit)

    # ---------------------------------------------------------------- similarity
    def apply_extra(mask, extra):
        return extra if mask is None else (mask & extra)

    @app.post("/api/similar")
    def similar(body: SimilarBody):
        try:
            items, unknown = sim.query_items_from_notes(cat, [(n.slug, n.layer) for n in body.notes])
        except ValueError as e:
            raise HTTPException(400, str(e))
        flt = filters_of(body.filters.as_params())
        mask = query.filters_mask(cat, flt)
        extra = None
        if body.exclude_ids:
            extra = np.ones(cat.n_perf, dtype=bool)
            for pid in body.exclude_ids:
                i = cat.idx_of(pid)
                if i is not None:
                    extra[i] = False
            mask = apply_extra(mask, extra)
        res = sim.similar_by_notes(cat, items, mask, body.offset, body.limit)
        out = sim_response(res)
        out.update(query=query_echo(items), unknown=unknown, offset=body.offset, limit=body.limit)
        if body.ff:
            base = res.all_score > 1e-9
            if extra is not None:
                base = base & extra
            out["filter_facets"] = query.all_facets(cat, query.evaluate_base(cat, base, flt))
        return out

    @app.post("/api/similar/facet")
    def similar_facet(body: SimilarFacetBody):
        try:
            items, _ = sim.query_items_from_notes(cat, [(n.slug, n.layer) for n in body.notes])
        except ValueError as e:
            raise HTTPException(400, str(e))
        score, _wq = sim.raw_scores(cat, sim.dedupe_items(items))
        ev = query.evaluate_base(cat, score > 1e-9, filters_of(body.filters.as_params()))
        return facet_of(ev, body.facet, body.fq, body.offset, body.limit)

    def alt_mask(i: int):
        """'Only dupes / alternatives' for perfume i: perfumes linked to it (originals or dupes) plus, unless i itself
        comes from a dupe house, every perfume of a dupe-tagged house."""
        m = cat.linked_mask(i)
        if not (int(cat.p_btags[i]) & cat_mod.BTAG_BITS["dupe"]):
            m = m | ((cat.p_btags & cat_mod.BTAG_BITS["dupe"]) != 0)
        return m

    @app.get("/api/perfumes/{pid}/similar")
    def perfume_similar(request: Request, pid: int, limit: int = Query(30, ge=1, le=200), offset: int = Query(0, ge=0),
                        exclude_brand: bool = False, include_self: bool = False, ff: int = 0, only_dupes: bool = False):
        """Perfumes with similar notes. Filters as on /api/search; only_dupes=1 keeps the perfumes linked to this one
        (its originals / its dupes) and all dupe-house perfumes. Each result carries `dupe_link` when it is linked."""
        i = get_idx(pid)
        flt = filters_of(dict(request.query_params))
        mask = query.filters_mask(cat, flt)
        extra = None
        if exclude_brand:
            extra = cat.p_brand_idx != cat.p_brand_idx[i]
        if only_dupes:
            alt = alt_mask(i)
            extra = alt if extra is None else (extra & alt)
        if extra is not None:
            mask = apply_extra(mask, extra)
        res, acc = sim.similar_to_perfume(cat, i, mask, offset, limit, include_self=include_self)
        out = sim_response(res, accord_vec=acc, source=i)
        for r in out["results"]:
            rel = cat.link_relation(i, cat.idx_of(r["id"]))
            if rel:
                r["dupe_link"] = {"relation": rel[0], "confidence": rel[1], "basis": rel[2],
                                  "basis_label": cat_mod.BASIS_LABEL[rel[2]]}
        out.update(source=cat.detail(i), query=query_echo(res.items), offset=offset, limit=limit)
        if ff:
            base = res.all_score > 1e-9
            if extra is not None:
                base = base & extra
            out["filter_facets"] = query.all_facets(cat, query.evaluate_base(cat, base, flt))
        return out

    @app.get("/api/perfumes/{pid}/similar/facet")
    def perfume_similar_facet(request: Request, pid: int, facet: str, fq: str = "", offset: int = Query(0, ge=0),
                              limit: int = Query(12, ge=1, le=100), exclude_brand: bool = False, only_dupes: bool = False):
        i = get_idx(pid)
        res, _acc = sim.similar_to_perfume(cat, i, None, 0, 1)
        base = res.all_score > 1e-9
        if exclude_brand:
            base = base & (cat.p_brand_idx != cat.p_brand_idx[i])
        if only_dupes:
            base = base & alt_mask(i)
        ev = query.evaluate_base(cat, base, filters_of(dict(request.query_params)))
        return facet_of(ev, facet, fq, offset, limit)

    # ---------------------------------------------------------------- perfumes
    @app.get("/api/perfumes")
    def perfumes_find(q: str = "", limit: int = Query(20, ge=1, le=100)):
        return {"results": cat.find_perfumes(q, limit)}

    @app.get("/api/perfumes/{pid}")
    def perfume_detail(pid: int):
        """Perfume card data + brand_tags / brand_info, dupe_of[] (its originals), dupes[] (first 24 known dupes, best
        evidence first) with dupes_total / dupes_counts{high,medium,low} and dupe_status{researched,is_original,notes}."""
        return cat.detail(get_idx(pid))

    @app.get("/api/perfumes/{pid}/dupes")
    def perfume_dupes(pid: int, offset: int = Query(0, ge=0), limit: int = Query(24, ge=1, le=100)):
        """Known dupes / alternatives of an original, confidence first, then popularity (paged)."""
        return cat.dupes_of(get_idx(pid), limit, offset)

    @app.get("/api/perfumes/{pid}/compare/{other}")
    def perfume_compare(pid: int, other: int):
        """Side-by-side note comparison of two perfumes: both pyramids, the notes they share and our 'smells like'
        score of `other` against `pid` (see similarity.pair_score)."""
        i, j = get_idx(pid), get_idx(other)
        pa, pb = cat.pyramid(i), cat.pyramid(j)
        same = {L: sorted({n["slug"] for n in pa[L]} & {n["slug"] for n in pb[L]}) for L in pa}
        all_a = {n["slug"] for L in pa.values() for n in L}
        all_b = {n["slug"] for L in pb.values() for n in L}
        rel = cat.link_relation(i, j)
        link = ({"relation": rel[0], "confidence": rel[1], "basis": rel[2], "basis_label": cat_mod.BASIS_LABEL[rel[2]]}
                if rel else None)
        return {"a": {**cat.summary(i), "pyramid": pa}, "b": {**cat.summary(j), "pyramid": pb},
                "shared": sorted(all_a & all_b), "shared_same_layer": same,
                "only_a": len(all_a - all_b), "only_b": len(all_b - all_a), **sim.pair_score(cat, i, j), "link": link}

    # ---------------------------------------------------------------- images
    def svg(text: str, max_age: int = 3600):
        return Response(text, media_type="image/svg+xml", headers={"Cache-Control": f"public, max-age={max_age}"})

    @app.get("/img/perfume/{pid}")
    async def img_perfume(pid: int):
        if pid >= cat_mod.DISCOVERED_ID_BASE:   # a published new release: its image is stored with the candidate
            return RedirectResponse(f"/img/discovery/{pid - cat_mod.DISCOVERED_ID_BASE}.webp", status_code=302)
        i = get_idx(pid)
        acc = cat.accords_out(i, 1)
        tint = acc[0]["color"] if acc else palette.DEFAULT_ACCENT
        if remote:  # generated fallback only; the real photo is hotlinked by the browser
            return svg(images.bottle_svg(cat.brand(i), cat.name(i), tint, str(pid)), 86400)
        url = cat.raw_row(i).get("image_url")
        if not url and cat.fragrantica_id(i):  # SPEC: bottle photos follow this pattern
            url = f"https://fimgs.net/mdimg/perfume/375x500.{cat.fragrantica_id(i)}.jpg"
        path = await fetcher.get(pid, url)
        if path:
            data = path.read_bytes()
            return Response(data, media_type=images.sniff(data) or "image/jpeg",
                            headers={"Cache-Control": "public, max-age=604800"})
        age = 300 if (url and fetcher.enabled) else 3600
        return svg(images.bottle_svg(cat.brand(i), cat.name(i), tint, str(pid)), age)

    @app.get("/img/note/{slug}")
    def img_note(slug: str):
        j = cat.note_index.get(slug)
        if j is None:
            raise HTTPException(404, "note not found")
        rel = None if remote else cat.note_image_local[j]
        if rel:
            p = (data_dir / rel).resolve()
            if data_dir.resolve() in p.parents and p.is_file():
                return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})
        # short cache: a real image may be added later by pipeline/fetch_note_images.py
        return svg(images.note_svg(cat.note_name[j], cat.note_family[j]), 86400 if remote else 60)

    # ---------------------------------------------------------------- frontend (must be last)
    static_dir = HERE / "static"
    static_dir.mkdir(exist_ok=True)
    app_index = static_dir / "next" / "index.html"   # the React app (built from web/); the old UI is /classic.html

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def spa_index(request: Request):
        if settings.admin_host and auth.host_only(request.headers.get("host", "").lower()) == settings.admin_host:
            return admin.admin_page(settings)
        if not app_index.is_file():
            return FileResponse(static_dir / "classic.html", headers={"Cache-Control": "no-cache"})
        # link previews (WhatsApp, iMessage, ...) need absolute URLs: use the canonical domain when one is set,
        # otherwise the host this request came in on (the host list has already vetted it)
        host = settings.canonical_host or request.headers.get("host", "").strip().lower() or "localhost"
        scheme = "https" if (settings.canonical_host or user_api.is_https(request, settings)) else "http"
        html = app_index.read_text(encoding="utf-8").replace("__SITE__", f"{scheme}://{host}")
        return Response(html, media_type="text/html", headers={"Cache-Control": "no-cache"})

    @app.get("/robots.txt", include_in_schema=False)
    def robots():
        # the development site must never show up in search results
        body = "User-agent: *\nDisallow: /\n" if settings.site_env != "production" else "User-agent: *\nDisallow: /api/\n"
        return Response(body, media_type="text/plain")

    @app.get("/next", include_in_schema=False)
    @app.get("/next/", include_in_schema=False)
    def next_moved():
        # the preview address from before the switch; the #fragment survives the redirect in browsers
        return RedirectResponse("/", status_code=301)

    app.mount("/", NoCacheStatic(directory=static_dir, html=True), name="static")
    return app


app = create_app() if os.environ.get("SCENT_SKIP_DEFAULT_APP") != "1" else None

if __name__ == "__main__":
    import uvicorn

    s = config.Settings.from_env()
    if "--open" in sys.argv:
        os.environ["SCENT_OPEN"] = "1"
    print(f"Scent Atlas -> http://{s.host}:{s.port}/")
    uvicorn.run(app, host=s.host, port=s.port, log_level="warning", server_header=False)
