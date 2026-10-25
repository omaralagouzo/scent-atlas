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
| `CANONICAL_HOST` | optional | `scentatlas.app` | when set, GET/HEAD page visits on any other allowed host (the `*.onrender.com` address) get a 301 to `https://<CANONICAL_HOST>/...`; writes and `/api/status` are left alone. Set it only once the custom domain resolves and has its certificate. |
| `TRUST_PROXY` | recommended | `true` (auto-`true` when `RENDER=true`, which Render sets) | honour `X-Forwarded-Proto` (Secure cookies / HSTS) and `X-Forwarded-For` (rate limits). |
| `PROXY_HOPS` | recommended | `1` | how many trusted proxies append to `X-Forwarded-For`; the client IP is taken that many entries from the right. Verify after the first deploy: set `DEBUG_CLIENT_IP=1`, open `/api/whoami` and check that `client_ip_used_for_rate_limits` is your IP (adjust `PROXY_HOPS`), then **unset `DEBUG_CLIENT_IP`**. |
| `ADMIN_PASSWORD` | optional | a string of **>= 8 characters** | enables the owner-only `/admin` page (list accounts, reset a password, sign a user out everywhere, rename/change email, delete). Unset or shorter than 8 chars = admin fully disabled (`/admin` says so, `/api/admin/*` return 404). Set it as a secret (Render: *sync: false* / dashboard), never in the repo. There is no link to `/admin` in the UI; share the URL only with yourself. |
| `SESSION_SECRET` | not used | - | sessions are random 256-bit tokens stored as SHA-256 hashes in the `sessions` table; there is no signing secret to manage. |
| `COOKIE_SECURE` | optional | `auto` | `auto` = Secure unless the host is localhost; `1`/`0` to force. |
| `SESSION_DAYS` | optional | `30` | sliding session lifetime. |
| `RATE_LIMIT_PER_MIN` | optional | `10` | login / sign-up attempts per minute, per IP and per account. |
| `SCENT_WORK_DIR` | optional | system temp dir | where the decompressed catalog goes. |
| `ENABLE_DOCS` | optional | unset | `1` serves `/api/docs` (Swagger). |
| `MALLOC_ARENA_MAX` | optional | `2` | keeps glibc's per-thread arenas (and RSS) small. |
| `PYTHON_VERSION` | yes | `3.11.11` | Render Python version. |

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

* the site must stay **non-commercial** (no ads, no paid tier) and credit those sources - the footer and the
  `#/about` page do this; do not remove them;
* the derived catalogue (`data/deploy/catalog.db.gz`) stays under **CC BY-NC-SA 4.0** (share-alike);
* bottle and note images are **(c) Fragrantica** and are only hotlinked, never stored or redistributed (no image files are in the
  repository); a few note photos are Wikimedia Commons images credited on `#/about` (`/api/credits`);
* the app is not affiliated with Fragrantica.
