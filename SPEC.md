# Scent Atlas — shared spec

A personal, local fragrance explorer built on a merged, deduplicated master dataset made from the public Fragrantica-derived datasets.

## Layout

```
scent-atlas/
  SPEC.md                 this file (the contract between data and app)
  data/
    raw/<source>/         downloaded source files, untouched (untrusted data)
    master.db             THE master dataset (SQLite), schema below
    master_perfumes.csv   flat export of the same data (convenience)
    BUILD_REPORT.md       sources used, row counts, dedup stats, known gaps
    images/notes/         one image per note: <note_slug>.jpg|png|webp
    images/perfumes/      bottle image cache: <perfume_id>.jpg (filled lazily by the server)
  pipeline/               scripts that build master.db (re-runnable); make_deploy_db.py -> data/deploy/catalog.db(.gz)
  app/                    the web app (FastAPI + vanilla JS); memcheck.py = RSS/latency check; tests: test_*.py
  docs/                   LAYERING.md (how layering is scored, evaluation) + layering-research.md (sources)
  data/deploy/            catalog.db.gz - slim, deployable copy of master.db (the only data file committed to git)
  start.bat               double-click launcher (Windows)
  requirements.txt        pinned runtime dependencies;  DEPLOY.md / render.yaml: Render deployment
```

Accounts, favorites, personal status/ratings, saved searches and history are stored per user in `data/users.db`
(SQLite) locally, or in the Postgres given by `DATABASE_URL`. `IMAGE_MODE=remote` makes the API return hotlink URLs for
images instead of serving cached files. See DEPLOY.md for every environment variable.

## My Collection (app/collection.py, user_api.py)

The collection is every perfume the user marked `owned` (`perfume_status.status`). `perfume_status.rank_pos` (schema v2)
is the 1-based place on the user's leaderboard, NULL = not ranked yet; leaving `owned` clears it and closes the gap.

* `GET /api/me/collection` -> `items` (card summary + `my` + `rank` + `added_at`, ranked first), `order` (ranked ids),
  `profile` (archetype title/blurb, families, favourite accords and notes, signature notes, houses, brands, perfumers,
  era, community rating, gaps). Weights: rank (top 3 / top 10 count more) and the user's 1-5 rating.
* `POST /api/me/collection {perfume_id, rank?}` marks owned (optionally placed at `rank`);
  `PUT /api/me/collection/order {ids}` stores the whole ranked order (ids not owned are ignored, max 5000).
* The UI ranks new bottles with head-to-head questions (binary insertion, ~log2(n) answers) and drag / arrow reordering.

## Layering (app/layering.py, app/layer_api.py; method and evaluation: docs/LAYERING.md)

* `GET /api/layering/{pid}?offset&limit` -> `source` (+ `traits`: role base/top/either, style), `collection` (signed in:
  owned perfumes that clear the bar), `curated` (brand / perfumer / editor pairs with source), `community`, `catalog`
  (`total`, `items` with `pair` = verdict, score, tags, one specific reason, caution). With `offset > 0` only `catalog`.
* `GET /api/layering/{a}/with/{b}` -> both perfumes + `report` (verdict, `top` %, pros, cons, how_to, blend, shared
  notes, components) + `community` (votes, my_vote).
* `GET /api/me/collection/layering` -> recommendable pairs inside the user's collection; `GET /api/layering` -> top
  community combos (Wilson lower bound) + a showcase of curated pairs.
* `POST /api/layering/combos {a, b}` suggests a pair (starts with the author's thumbs up; an existing pair just gets the
  vote; 30 new combos / account / day); `POST /api/layering/combos/{id}/vote {vote: 1|-1|0}`.
* Tables (schema v2): `layer_combos(id, a_id < b_id unique, created_by, created_at, up, down)`,
  `layer_votes(user_id, combo_id, vote, created_at)`; counts are recomputed from the votes on every change.

## master.db schema (SQLite)

```sql
CREATE TABLE perfumes (
  id            INTEGER PRIMARY KEY,      -- our own stable id
  fragrantica_id INTEGER,                 -- numeric id from the Fragrantica URL (…-12345.html), NULL if unknown
  name          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  year          INTEGER,
  gender        TEXT,                     -- 'women' | 'men' | 'unisex' | NULL
  country       TEXT,
  rating        REAL,                     -- 0–5
  rating_count  INTEGER,
  url           TEXT,                     -- canonical Fragrantica URL if known
  image_url     TEXT,                     -- remote bottle image URL, e.g. https://fimgs.net/mdimg/perfume/375x500.<fragrantica_id>.jpg
  perfumers     TEXT,                     -- JSON array of strings
  accords       TEXT,                     -- JSON array of {"name": str, "strength": float 0–1}, strongest first
  sources       TEXT                      -- JSON array of source dataset keys this row was merged from
);

CREATE TABLE notes (
  id            INTEGER PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,     -- normalized key: lowercase ascii, words joined by '-', e.g. 'pink-pepper'
  name          TEXT NOT NULL,            -- display name, e.g. 'Pink Pepper'
  family        TEXT,                     -- optional grouping: citrus, fruity, floral, green, spicy, woody, resinous/amber, musky/animalic, gourmand, aquatic, herbal/aromatic, other
  perfume_count INTEGER NOT NULL DEFAULT 0,
  image_local   TEXT,                     -- path relative to data/, e.g. 'images/notes/pink-pepper.jpg', NULL if none
  image_source  TEXT                      -- where the image came from (attribution)
);

CREATE TABLE perfume_notes (
  perfume_id INTEGER NOT NULL REFERENCES perfumes(id),
  note_id    INTEGER NOT NULL REFERENCES notes(id),
  layer      TEXT NOT NULL CHECK (layer IN ('top','middle','base','general')),
  position   INTEGER,                     -- order within the layer, 0-based
  PRIMARY KEY (perfume_id, note_id, layer)
);
CREATE INDEX idx_pn_note ON perfume_notes(note_id);
CREATE INDEX idx_perfumes_brand ON perfumes(brand);
```

`layer = 'general'` is used when a perfume lists notes without a top/middle/base pyramid.

## Similarity model (app)

For a query set of notes Q (each with a layer, or 'any') against perfume P:

- Note weight = IDF: `w(n) = log(1 + N / df(n))` so rare notes (e.g. osmanthus) matter more than ubiquitous ones (musk).
- Same note, same layer → `1.0 * w(n)`
- Same note, different layer (or either side 'general'/'any') → `0.5 * w(n)`
- Adjacent layers (top↔middle, middle↔base) can get 0.6 and top↔base 0.4 — tunable constants in one place.
- Score = matched weight / sqrt(weight(Q) * weight(P)) (cosine-like, so huge note lists don't win by volume).
- Optional small accord-overlap bonus when the query is "like perfume X".
- Every result returns an explanation: which notes matched, in which layers.

## Combine search, filters and facets (app/query.py)

`GET /api/search` serves both query forms and all result filters; every parameter is also the URL-hash state of the
Combine page and the content of a saved search (flat dict of strings).

* **Simple** (legacy): `include` / `exclude` (`slug[@layer]`, comma list) + `mode=all|any` (+ optional `layer`).
* **Advanced**: `q` = clauses joined by `~`, each `layer:slug,slug` (layer `top|middle|base|any`); clauses are ANDed, notes
  inside a clause are ORed. `slug*` also matches every note whose name contains that word as a whole word (`tea*` → Tea,
  Green Tea, Tea Leaf …; `amber*` does not match Ambergris/Ambrette). `x` = excluded notes (same syntax), `gen=0|1`
  (default 1): perfumes whose notes are a flat list (layer `general`, ~28% of the catalogue) match a layered clause in any
  layer. `adv=1` marks the advanced mode even when `q` is empty.
* **Filters** (all modes, the note page and the pyramid / smells-like endpoints): `name`, `year_min`, `year_max`,
  `year_unknown=1`, `brands`, `perfumers`, `accords` (`~`-separated names; `\~` escapes a literal tilde), `acc_any=1`,
  `acc_main=1`, `gender` (comma list), `countries`, `rating_min`, `votes_min`, `must` / `not` (extra notes, `*` = variants).
* `sort`: `popularity` (votes, default) `rating` (vote-weighted) `year` `year_asc` `name` `brand` `matches`
  (number of matched query notes, then votes). Sorting uses unique composite keys, so paging is stable.
* `ff=1` adds `filter_facets` (years histogram 1900+, brands, perfumers, accords, genders, countries) computed with
  numpy bincounts over *the query AND every other filter* (a multi-select shows the alternatives you could switch to).
  `GET /api/search/facet?facet=brand|perfumer|accord|gender|country|note|year&fq=text&offset=&limit=` returns one facet
  list for the same query parameters (type-ahead beyond the top N). `GET /api/notes/{slug}/variants` lists what `*` expands to.
* The catalog adds, at load: a perfumer index (CSR perfume → perfumer ids + the flat entry → perfume array, from the
  `perfumers` JSON column that the deploy DB keeps), accord entry arrays (row / column / rank) and a `p_flat` flag.

## House types (brand tags) and dupe links

Written by the web-research tagging pipeline (`pipeline/tagging/`, see its README) and merged into `master.db` by
`pipeline/tagging/merge_tags.py` (validates, repairs, derives, idempotent). Tables: `brand_tags(brand PK, tags JSON, dupe_style,
origin_country, parent_company, confidence, inferred, notes, sources JSON)`, `perfume_dupes(perfume_id, target_id, confidence,
basis, sources JSON, rank)`, `perfume_dupe_status(perfume_id PK, is_original, notes)`. `make_deploy_db.py` copies them.

* Tags: `niche`, `designer`, `dupe` ("dupe house"), `middle_eastern`, and derived `middle_eastern_original` (ME and not dupe),
  `middle_eastern_dupe` (ME and dupe), plus `untagged`. The catalog keeps one uint8 bitmask per perfume (bits 1..64, 128 = inferred)
  and dupe links as forward / reverse CSR arrays (`dl_*`, `dr_*`; reverse sorted by confidence, then votes) - about 1 MB.
* Filters (every endpoint that takes filters, saved searches, URL hash): `btags` (`~`-separated, OR inside), `btags_not`,
  `has_dupes=1` (originals with a known dupe), `is_dupe=1`. Facets: `brand_tags` {items[name,label,count,selected], available}
  and `dupe_flags` in `filter_facets`; `/api/search/facet?facet=brand_tags`. Sort `dupes` = number of known dupes.
* `GET /api/perfumes/{id}` adds `brand_tags`, `brand_info`, `is_dupe`, `n_dupes`, `dupe_of[]`, `dupes[]` (first 24) with
  `dupes_total`, `dupes_counts{high,medium,low}`, `dupe_status`; link items are card summaries + `confidence`, `basis`
  (`web|community|name|brand_stated`), `basis_label`, `sources`. Also `GET /api/perfumes/{id}/dupes` (paged),
  `GET /api/perfumes/{a}/compare/{b}` (both pyramids, shared notes, similarity score), `GET /api/brands/info?name=`,
  `/api/perfumes/{id}/similar?only_dupes=1` (linked perfumes + dupe-house perfumes; results carry `dupe_link`).
* UI wording: "Inspired by" / "Alternative to"; the brand tag label is "Dupe house".

