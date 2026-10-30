# Deploying Scent Atlas to Render

Target: one **Render Starter web service** (Python, 512 MB RAM / 0.5 CPU, Frankfurt) plus one **Render Postgres 18**
(`basic-256mb`) for user data. `render.yaml` in the repo root documents the same setup (it is documentation; apply it
as a Blueprint or create the resources by hand).

The catalog (140k perfumes) is read-only and ships in the repo as `data/deploy/catalog.db.gz` (~19 MB). It is decompressed
into the instance's temp dir at startup (about 90 MB on the ephemeral disk) and loaded into compact numpy arrays:
**~150 MB RSS** for the whole server (measured with `python app/memcheck.py --serve`), peak ~250 MB during the 6-second load. Accounts, favorites, collection, saved
searches and history live in Postgres. The layering model (candidate pool + curated pairs, ~1 s) is built in a background
thread at startup and adds about 15 MB.

## Build command

```
pip install -r requirements.txt
```

Use Python 3.11+ (`PYTHON_VERSION=3.11.11`; `numpy 2.x` needs 3.11 or newer).

The front end (React + shadcn, see `docs/DESIGN.md`) lives in `web/` and is the site at `/` (the previous UI is
kept at `/classic.html`; the old `/next/` preview address redirects to `/`). Its build output `app/static/next/` is
committed, so Render needs no Node.js step. After changing anything in `web/`:

```
cd web && npm ci && npm run build      # typechecks, then writes app/static/next/
```

## Start command

```
uvicorn app.server:app --host 0.0.0.0 --port $PORT --workers 1 --no-server-header
```

Keep **one worker**: every worker would hold its own copy of the catalog (and the in-memory rate limiter).
`app.server:app` is created at import time from the environment; `uvicorn --factory app.server:create_app` works too.

Health check path: `/api/status` (exempt from the `ALLOWED_HOSTS` check, returns only counts).

## Environment variables

| variable | required | value / default | purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | Render Postgres *internal* connection string (`postgres://...` or `postgresql://...`; both are accepted) | user data. When unset the app uses SQLite `data/users.db` (local use). Tables are created and upgraded on startup (`schema_migrations`; v2 adds the leaderboard column and the layering combo / vote tables to an existing database in place); nothing to migrate by hand. |
| `CATALOG_DB_GZ` | yes | `/opt/render/project/src/data/deploy/catalog.db.gz` | gzip catalog; decompressed once if the `.db` is missing (to `SCENT_WORK_DIR`, default the system temp dir). If unset and `data/master.db` is absent, the repo's `data/deploy/catalog.db.gz` is used anyway. |
| `IMAGE_MODE` | yes | `remote` (default `local`) | `remote`: the API returns direct `fimgs.net` / Wikimedia URLs, the server never proxies or writes images; the frontend falls back to the generated SVG (`/img/...`) on `onerror`. |
| `ALLOWED_HOSTS` | yes | `scentatlas.app,www.scentatlas.app,scent-atlas.onrender.com` (default `127.0.0.1,localhost`) | Host-header allow list (ports ignored, `*.suffix` and `*` supported). Requests to other hosts get 400. |
| `CANONICAL_HOST` | optional | `scentatlas.app` | it (and its `www.`) is always allowed, even if missing from `ALLOWED_HOSTS`. When set, GET/HEAD page visits on any other allowed host (the `*.onrender.com` address) get a 301 to `https://<CANONICAL_HOST>/...`; writes and `/api/status` are left alone. Set it only once the custom domain resolves and has its certificate. |
| `TRUST_PROXY` | recommended | `true` (auto-`true` when `RENDER=true`, which Render sets) | honour `X-Forwarded-Proto` (Secure cookies / HSTS) and `X-Forwarded-For` (rate limits). |
| `PROXY_HOPS` | recommended | `1` | how many trusted proxies append to `X-Forwarded-For`; the client IP is taken that many entries from the right. Verify after the first deploy: set `DEBUG_CLIENT_IP=1`, open `/api/whoami` and check that `client_ip_used_for_rate_limits` is your IP (adjust `PROXY_HOPS`), then **unset `DEBUG_CLIENT_IP`**. |
| `ADMIN_PASSWORD` | optional | a long random string, **>= 16 characters** | enables the owner-only admin dashboard (analytics, accounts: reset a password, sign a user out everywhere, rename / change email, delete). Unset or shorter than 16 characters = admin fully off (the page says "Admin disabled", `/api/admin/*` return 404). It lives only in the environment: never in the repo, the front end or the database. There is no link to the admin anywhere in the site. |
| `ADMIN_TOTP_SECRET` | recommended with the admin | a base32 key (the admin's Security tab generates one in your browser) | two-factor: every admin sign-in then also needs the 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy...). A code works once. If the value cannot be read, the admin switches itself off rather than signing in without the code. |
| `ADMIN_HOST` | optional | `admin.scentatlas.app` | the admin then lives only on that host, at `/` (it answers 404 for the admin anywhere else, and serves nothing but the admin itself). It is added to the allowed hosts automatically and is never redirected to `CANONICAL_HOST`. Without it the admin is at `/admin` on the main site. |
| `SESSION_SECRET` | not used | - | sessions are random 256-bit tokens stored as SHA-256 hashes in the `sessions` table; there is no signing secret to manage. |
| `COOKIE_SECURE` | optional | `auto` | `auto` = Secure unless the host is localhost; `1`/`0` to force. |
| `SESSION_DAYS` | optional | `30` | sliding session lifetime. |
| `RATE_LIMIT_PER_MIN` | optional | `10` | login / sign-up attempts per minute, per IP and per account. |
| `SCENT_WORK_DIR` | optional | system temp dir | where the decompressed catalog goes. |
| `ENABLE_DOCS` | optional | unset | `1` serves `/api/docs` (Swagger). |
| `MALLOC_ARENA_MAX` | optional | `2` | keeps glibc's per-thread arenas (and RSS) small. |
| `PYTHON_VERSION` | yes | `3.11.11` | Render Python version. |
| `ANTHROPIC_API_KEY` | optional | a Claude API key (console.anthropic.com -> API keys) | lets the admin's **New releases** tab run web research itself (Claude Sonnet 5.5 / Haiku 5.5 with web search). Without it the tab still works for reviewing and publishing; only "Start a run" is off. Spend is per run (a budget you set on each run). |
| `RENDER_DEPLOY_HOOK_URL` | recommended | Render -> the service -> Settings -> **Deploy Hook** URL | approved new releases go live through a zero-downtime deploy. Without it the app restarts itself to load them (about half a minute offline). |

## Members, photos and notifications (no extra services)

* **Names** are stored on the account (`first_name`, `last_name`). Accounts created before names existed were called
  "User Name" by the v4 migration and are reminded once at their next sign-in.
* **Profile photos** are processed by the server with Pillow (centre-cropped, 512x512, re-encoded as WebP, which also
  strips camera metadata such as GPS) and stored in the `avatars` table in Postgres: about 20-60 KB each, so even a
  few thousand members stay well under 200 MB. Served from `/api/avatars/<id>.webp?v=<version>` with a one-year
  immutable cache. Object storage (e.g. Cloudflare R2) only becomes worthwhile for much larger media (review photos,
  thousands of members); nothing to set up today.
* **Notifications** (friend requests, accepted requests, the name reminder) are rows in the `notifications` table
  (the newest 200 per member are kept). The browser asks for the unread count once a minute while the tab is visible
  and whenever it regains focus; the list loads when the bell is opened. At hundreds to a few thousand members this is
  lighter than holding a live connection per visitor; the same table can feed Server-Sent Events later if instant
  delivery is ever needed.
* **Reviews** are public, one per member and perfume, in the `reviews` table.

## Development environment (dev.scentatlas.app)

A second, fully separate copy of the site for trying things before they reach real members:

| | production | development |
|---|---|---|
| Render service | `scent-atlas` (deploys `main`) | `scent-atlas-dev` (deploys `dev`) |
| database | `scent-atlas-db` (real members) | `scent-atlas-dev-db` (made-up demo data) |
| address | scentatlas.app | dev.scentatlas.app (or scent-atlas-dev.onrender.com) |
| `SITE_ENV` | unset (production) | `development`: "Development site" ribbon, noindex, robots.txt disallow-all |
| `SEED_DEMO` | unset | `1`: an EMPTY database is filled with 40 made-up members, shelves, reviews, listings, wanted requests, chats and a month of visits. Demo password: `scent-atlas-demo` |

The two never share data: the dev service has its own `DATABASE_URL`. Nothing in production is ever copied to dev.

**Flow:** work happens on feature branches -> pull request into `dev` -> it deploys to the dev site -> try it there ->
pull request `dev` -> `main` -> production deploys. Database changes are migrations that only *add* tables and
columns (see `schema_migrations` in `app/userdb.py`); they run on start-up, are tested against SQLite and Postgres,
and run on the dev database first, so by the time they reach production they have already upgraded a database once.
Never drop or rename a column in one step; Render keeps daily backups of the production database as a last resort.

**One-time setup (owner):**
1. Render -> `scent-atlas-dev-db` -> **Connect** -> copy the **Internal Database URL**.
2. Render -> `scent-atlas-dev` -> **Environment** -> add `DATABASE_URL` = that URL -> save (it redeploys and seeds itself).
3. Optional: Render -> `scent-atlas-dev` -> **Settings -> Custom Domains** -> add `dev.scentatlas.app`; Spaceship DNS ->
   `CNAME` `dev` -> `scent-atlas-dev.onrender.com`.
4. Render -> `scent-atlas-dev` -> **Settings -> Health Check Path** -> `/api/status`.

## Google Maps (address search and pins)

Address pickers (marketplace pickup, delivery address) use Google Places when `GOOGLE_MAPS_API_KEY` is set, and a free
OpenStreetMap search (Photon, via `/api/geo/search`) otherwise.

1. https://console.cloud.google.com -> create a project (e.g. "Scent Atlas") -> **Billing**: link a billing account
   (Google's monthly free usage covers a small site; set a budget alert).
2. **APIs & Services -> Library**: enable **Maps JavaScript API** and **Places API (New)**.
3. **APIs & Services -> Credentials -> Create credentials -> API key**. Edit it:
   - *Application restrictions*: **Websites**: `https://scentatlas.app/*`, `https://dev.scentatlas.app/*`,
     `https://scent-atlas-dev.onrender.com/*`
   - *API restrictions*: Maps JavaScript API and Places API (New) only.
4. Render -> the service -> **Environment** -> `GOOGLE_MAPS_API_KEY` = the key (dev first, production when the
   marketplace ships). This is a browser key: it is sent to the page, which is why the domain restriction matters.

## Analytics (first-party, no Google Analytics)

The site counts its own page views (`page_views` table; see `app/analytics.py` for exactly what is kept): page path
(never the query string), time, a random visitor id the browser keeps, the account if signed in, the referring site
on the first page of a visit, phone / tablet / desktop, browser family and the device's time zone (a rough location
without any IP lookup). IP addresses are never stored. Bots and link-preview fetchers are ignored. Rows older than
400 days are deleted automatically. Nothing to configure; the numbers appear on the admin dashboard.

## Admin dashboard on admin.scentatlas.app

1. Render -> the service -> **Environment**: set `ADMIN_PASSWORD` (16+ characters; a password manager's generator is
   ideal) and `ADMIN_HOST=admin.scentatlas.app`.
2. Render -> **Settings -> Custom Domains** -> add `admin.scentatlas.app`.
3. Spaceship -> DNS: add a `CNAME` record, host `admin`, value `scent-atlas.onrender.com`. Back in Render, **Verify**
   (the certificate follows automatically).
4. Open https://admin.scentatlas.app and sign in. Then open **Security -> Set up two-factor**, add the key it shows to
   your authenticator app, and set it on Render as `ADMIN_TOTP_SECRET`. From then on sign-in needs password + code.

Admin sessions are kept in memory, so every deploy or restart signs you out of the admin (by design).

## New releases (admin -> New releases)

The catalogue is a snapshot, so new launches are found by research and reviewed by you before they appear on the site.

- **Candidates** come from research runs. You can start a run from the admin, which needs `ANTHROPIC_API_KEY`. Each
  run covers one or more segments: release news, retailers' new arrivals, designer, luxury niche, Middle Eastern,
  celebrity and mass, and indie houses. Candidates also come from JSON files committed under `data/discovery/`, and
  each file is imported once at start-up.
- Every candidate carries a confidence score from 0 to 1 for each field (identity, release date, notes, perfumers,
  image, gender, concentration) and an overall score. It also lists its sources.
- **Complete** means it has a brand, name, release year, at least 3 notes, a fetched bottle image and a gender.
  **Incomplete** lists what is missing. "Complete the incomplete" runs research on exactly those gaps, and a later
  find of the same perfume merges into the candidate it matches.
- **Possible duplicates** are candidates that look like a perfume already in the catalogue. Clear the flag with
  "Not a duplicate".
- **Approve** a candidate and it is published: it joins the site's catalogue with an id from 10,000,000 up, and the
  image stored with it. The catalogue is loaded at start, so the app restarts once, 90 seconds after your last
  approval (approve a batch and they go live together; `DISCOVERY_RESTART_DELAY` changes the wait). With
  `RENDER_DEPLOY_HOOK_URL` set the restart is a zero-downtime deploy. Without it the app stops itself and Render
  starts it again, so the site is offline for about half a minute. Admin sign-ins survive restarts. Unpublish takes a
  perfume off the site the same way.
- **Costs** are shown per run, estimated at list prices. A segment with Sonnet 5.5 typically costs about $1-3.
  Completing a batch with Haiku 5.5 costs cents. Web searches are $10 per 1,000. A run stops at the budget you set.
- **Images** are downloaded from the URL the research found, but only from public addresses. They are re-encoded to
  WebP (at most 800 px, metadata removed). Check that you are happy to use a bottle image before publishing it:
  brand and retailer images belong to their owners.

## Custom domain (scentatlas.app, registered at Spaceship)

1. Render → the `scent-atlas` service → **Settings → Custom Domains** → add `scentatlas.app` (Render offers to add
   `www.scentatlas.app` too, redirecting to the apex). Render then shows the DNS records it expects.
2. Spaceship → the domain → **DNS / Advanced DNS**: delete the default parking records (any `A`, `AAAA` or `CNAME`
   on `@` and `www`), then add the records Render shows. At the time of writing:
   - `@` → `A` record `216.24.57.1` (or an `ALIAS`/`ANAME` to `scent-atlas.onrender.com` if offered)
   - `www` → `CNAME` `scent-atlas.onrender.com`
   - no `AAAA` records on `@` (Render answers IPv4).
3. Back in Render press **Verify**; the TLS certificate is issued automatically (`.app` is HTTPS-only, so the site
   works once the certificate is in place).
4. Environment: `ALLOWED_HOSTS=scentatlas.app,www.scentatlas.app,scent-atlas.onrender.com`, and once
   https://scentatlas.app loads, `CANONICAL_HOST=scentatlas.app` so the old address redirects. Sessions are per host,
   so people signed in on the old address sign in once more on the new one.

## Rebuilding the catalog artifact

After `pipeline/build_master.py` has produced `data/master.db`:

```
python pipeline/make_deploy_db.py        # -> data/deploy/catalog.db (+ .gz, deterministic, must be < 50 MB)
git add data/deploy/catalog.db.gz
```

After new tagging output: `python pipeline/tagging/merge_tags.py && python pipeline/make_deploy_db.py` (the merge writes the
brand-tag / dupe-link tables into `master.db`, the deploy build carries them; memory stays about 150 MB).

`data/deploy/catalog.db` is git-ignored; only the `.gz` is committed. The artifact keeps just what the app reads
(no `sources`, no image files; notes carry an `image_remote` hotlink URL and the Wikipedia credit lines).

## Security notes

* Passwords: argon2id (19 MiB, t=2, p=1), at most two hashes in flight; min length 8 and a common-password list.
* Sessions: HttpOnly, SameSite=Lax cookie (`Secure` off localhost), 30-day sliding expiry, only a SHA-256 of the token is stored.
* CSRF: every state-changing `/api/auth|me|favorites|layering` call needs `X-Requested-With: scent-atlas`, a JSON content type, and a
  same-origin `Origin` when one is sent.
* Rate limits are in memory (single worker): per IP and per account on login/sign-up/password changes.
* CSP: `default-src 'self'`, `img-src 'self' data: https://fimgs.net https://upload.wikimedia.org`, `frame-ancestors 'none'`,
  plus `nosniff`, `Referrer-Policy`, HSTS on HTTPS.
* No email is ever sent: there is no verification and no self-service password reset. Account recovery is done by the owner on
  `/admin` (set `ADMIN_PASSWORD`): reset the password there and tell the user.
* Admin: separate in-memory sessions (12 h, HttpOnly, SameSite=Strict, Secure off localhost; a restart signs the admin out),
  constant-time password check, 5 login attempts/min per IP and a global lockout after 20 failures/hour, failed attempts
  logged without the attempted password, same CSRF header/Origin checks as the user API, `noindex`. Stored password hashes
  are never returned by any endpoint.

## Attribution requirement (keep it when you deploy)

The catalogue is derived from public Fragrantica-based datasets released under **CC BY-NC-SA 4.0**
(Decant: <https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes> / <https://codeberg.org/decant>;
olgagmiufana1: <https://www.kaggle.com/datasets/olgagmiufana1/fragrantica-com-fragrance-dataset>; further sources are listed in
`data/BUILD_REPORT.md`). Therefore:

* the site must stay **non-commercial** (no ads, no paid tier) and credit those sources - the `#/about` page does
  this and every page's footer links to it ("About & credits"); do not remove either;
* the derived catalogue (`data/deploy/catalog.db.gz`) stays under **CC BY-NC-SA 4.0** (share-alike);
* bottle and note images are **(c) Fragrantica** and are only hotlinked, never stored or redistributed (no image files are in the
  repository); a few note photos are Wikimedia Commons images credited on `#/about` (`/api/credits`);
* the app is not affiliated with Fragrantica.
