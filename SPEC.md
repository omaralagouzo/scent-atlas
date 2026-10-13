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
  app/                    the web app (FastAPI + vanilla JS); memcheck.py = RSS/latency check; tests: test_api.py, test_accounts.py
  data/deploy/            catalog.db.gz - slim, deployable copy of master.db (the only data file committed to git)
  start.bat               double-click launcher (Windows)
  requirements.txt        pinned runtime dependencies;  DEPLOY.md / render.yaml: Render deployment
```

Accounts, favorites, personal status/ratings, saved searches and history are stored per user in `data/users.db`
(SQLite) locally, or in the Postgres given by `DATABASE_URL`. `IMAGE_MODE=remote` makes the API return hotlink URLs for
images instead of serving cached files. See DEPLOY.md for every environment variable.

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
