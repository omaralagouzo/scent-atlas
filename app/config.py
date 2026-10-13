"""Environment-driven settings + catalog database resolution (incl. the gzip deploy artifact)."""
from __future__ import annotations

import gzip
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = ROOT / "data"


def _bool(v, default=False) -> bool:
    if v is None or v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _int(v, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def normalize_database_url(url: str | None, sqlite_path: Path | None = None) -> str:
    """DATABASE_URL -> SQLAlchemy URL.  postgres:// and postgresql:// both become postgresql+psycopg:// (psycopg 3)."""
    if not url:
        p = sqlite_path or (DATA_DIR / "users.db")
        return "sqlite:///" + str(p).replace("\\", "/")
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    allowed_hosts: tuple = ("127.0.0.1", "localhost")
    image_mode: str = "local"                # local | remote
    database_url: str | None = None          # users DB; None -> data/users.db (SQLite)
    catalog_db: str | None = None            # explicit catalog SQLite file (also: legacy SCENT_DB)
    catalog_db_gz: str | None = None         # gzip artifact, decompressed on startup when the .db is missing
    work_dir: str | None = None              # where the decompressed catalog goes (default: system temp)
    trust_proxy: bool = False                # honour X-Forwarded-Proto / -For (set on Render)
    proxy_hops: int = 1                      # how many trusted proxies append to X-Forwarded-For
    cookie_secure: str = "auto"              # auto | 1 | 0
    session_days: int = 30
    rate_limit_per_min: int = 10
    enable_docs: bool = False
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls, env=None) -> "Settings":
        e = os.environ if env is None else env
        hosts = tuple(h.strip().lower() for h in (e.get("ALLOWED_HOSTS") or "127.0.0.1,localhost").split(",") if h.strip())
        mode = (e.get("IMAGE_MODE") or "local").strip().lower()
        on_render = _bool(e.get("RENDER"))
        return cls(
            host=e.get("SCENT_HOST", "127.0.0.1"),
            port=_int(e.get("PORT"), 8765),
            allowed_hosts=hosts or ("127.0.0.1", "localhost"),
            image_mode=mode if mode in ("local", "remote") else "local",
            database_url=(e.get("DATABASE_URL") or None),
            catalog_db=(e.get("CATALOG_DB") or e.get("SCENT_DB") or None),
            catalog_db_gz=(e.get("CATALOG_DB_GZ") or None),
            work_dir=(e.get("SCENT_WORK_DIR") or None),
            trust_proxy=_bool(e.get("TRUST_PROXY"), on_render),
            proxy_hops=max(0, _int(e.get("PROXY_HOPS"), 1)),
            cookie_secure=(e.get("COOKIE_SECURE") or "auto").strip().lower(),
            session_days=max(1, _int(e.get("SESSION_DAYS"), 30)),
            rate_limit_per_min=max(1, _int(e.get("RATE_LIMIT_PER_MIN"), 10)),
            enable_docs=_bool(e.get("ENABLE_DOCS")),
        )

    def with_(self, **kw) -> "Settings":
        return replace(self, **{k: v for k, v in kw.items() if v is not None})


# --------------------------------------------------------------------------- catalog db selection
def decompress_catalog(gz_path: Path, target: Path) -> Path:
    """Stream-decompress gz_path -> target atomically (no big buffers; ~150 MB on disk)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + f".{os.getpid()}.tmp")
    try:
        with gzip.open(gz_path, "rb") as src, open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        with open(tmp, "rb") as f:
            if f.read(15) != b"SQLite format 3":
                raise RuntimeError(f"{gz_path} did not decompress to a SQLite database")
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()
    return target


def ensure_catalog_from_gz(gz: Path, work_dir: str | None) -> Path:
    base = Path(work_dir) if work_dir else Path(tempfile.gettempdir()) / "scent-atlas"
    target = base / "catalog.db"
    stale = target.exists() and target.stat().st_mtime + 1 < gz.stat().st_mtime
    if not target.exists() or target.stat().st_size == 0 or stale:
        print(f"[scent-atlas] decompressing {gz.name} -> {target}", file=sys.stderr)
        decompress_catalog(gz, target)
    return target


def pick_catalog_db(settings: Settings, data_dir: Path) -> tuple[Path, str]:
    """Returns (path, kind) where kind is custom | deploy | master | fixture."""
    if settings.catalog_db:
        return Path(settings.catalog_db), "custom"
    gz = Path(settings.catalog_db_gz) if settings.catalog_db_gz else None
    if gz and gz.is_file():
        return ensure_catalog_from_gz(gz, settings.work_dir), "deploy"
    master = data_dir / "master.db"
    if master.exists() and master.stat().st_size > 0:
        return master, "master"
    repo_gz = data_dir / "deploy" / "catalog.db.gz"
    if repo_gz.is_file():  # fresh clone without master.db
        return ensure_catalog_from_gz(repo_gz, settings.work_dir), "deploy"
    fixture = HERE / "fixture.db"
    if not fixture.exists():
        import make_fixture
        make_fixture.build(fixture)
    return fixture, "fixture"
