"""User data storage (SQLAlchemy Core): SQLite file locally, Postgres via DATABASE_URL on Render.

Timestamps are integer unix seconds so the same schema/queries work on both dialects.
Tables are created idempotently on startup; a ``schema_migrations`` table records applied versions.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError

metadata = sa.MetaData()

BigInt = sa.BigInteger().with_variant(sa.Integer, "sqlite")  # sqlite only autoincrements INTEGER PKs

users = sa.Table(
    "users", metadata,
    sa.Column("id", BigInt, primary_key=True, autoincrement=True),
    sa.Column("username", sa.String(32), nullable=False),
    sa.Column("username_lower", sa.String(32), nullable=False, unique=True),
    sa.Column("email", sa.String(254), nullable=False),
    sa.Column("email_lower", sa.String(254), nullable=False, unique=True),
    sa.Column("password_hash", sa.String(255), nullable=False),
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("last_login_at", sa.BigInteger),
)

sessions = sa.Table(
    "sessions", metadata,
    sa.Column("id", BigInt, primary_key=True, autoincrement=True),
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("last_seen_at", sa.BigInteger, nullable=False),
    sa.Column("expires_at", sa.BigInteger, nullable=False, index=True),
)

favorites = sa.Table(
    "favorites", metadata,
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("kind", sa.String(8), primary_key=True),          # perfume | note
    sa.Column("ref", sa.String(120), primary_key=True),         # perfume id or note slug
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("seq", BigInt, nullable=False, default=0),        # tie-breaker for same-second inserts
)

perfume_status = sa.Table(
    "perfume_status", metadata,
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("perfume_id", sa.Integer, primary_key=True),
    sa.Column("status", sa.String(10)),                         # owned | tried | wishlist | NULL
    sa.Column("rating", sa.SmallInteger),                       # 1..5 | NULL
    sa.Column("note", sa.Text),                                 # private, short
    sa.Column("updated_at", sa.BigInteger, nullable=False),
)

saved_searches = sa.Table(
    "saved_searches", metadata,
    sa.Column("id", BigInt, primary_key=True, autoincrement=True),
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    sa.Column("kind", sa.String(10), nullable=False),           # combine | pyramid
    sa.Column("name", sa.String(80), nullable=False),
    sa.Column("name_lower", sa.String(80), nullable=False),
    sa.Column("state", sa.Text, nullable=False),                # JSON object of view params
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("updated_at", sa.BigInteger, nullable=False),
    sa.UniqueConstraint("user_id", "kind", "name_lower", name="uq_saved_user_kind_name"),
)

history = sa.Table(
    "history", metadata,
    sa.Column("id", BigInt, primary_key=True, autoincrement=True),
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("kind", sa.String(10), nullable=False),           # view | like | pyramid | combine
    sa.Column("ref", sa.String(400), nullable=False),           # perfume id, or the canonical query string
    sa.Column("label", sa.String(240), nullable=False),
    sa.Column("state", sa.Text),                                # JSON, for pyramid/combine
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Index("ix_history_user_id_id", "user_id", "id"),
)

meta = sa.Table(
    "meta", metadata,
    sa.Column("key", sa.String(80), primary_key=True),
    sa.Column("value", sa.Text, nullable=False),
)

schema_migrations = sa.Table(
    "schema_migrations", metadata,
    sa.Column("version", sa.Integer, primary_key=True),
    sa.Column("applied_at", sa.BigInteger, nullable=False),
)

SCHEMA_VERSION = 1  # bump + add a step in _MIGRATIONS when the schema changes
HISTORY_CAP = 200
SAVED_CAP = 100
STATUSES = ("owned", "tried", "wishlist")


def _now() -> int:
    return int(time.time())


def make_engine(url: str) -> sa.Engine:
    if url.startswith("sqlite"):
        db_file = sa.engine.make_url(url).database
        if db_file and db_file != ":memory:":
            Path(db_file).parent.mkdir(parents=True, exist_ok=True)
        eng = sa.create_engine(url, connect_args={"check_same_thread": False, "timeout": 15}, pool_pre_ping=True)

        @event.listens_for(eng, "connect")
        def _pragmas(dbapi_con, _rec):  # noqa: ANN001
            cur = dbapi_con.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()
        return eng
    return sa.create_engine(url, pool_size=3, max_overflow=2, pool_pre_ping=True, pool_recycle=1800)


def _dialect_insert(eng: sa.Engine):
    if eng.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert


def _migrate_v1(conn):
    metadata.create_all(conn)  # CREATE TABLE IF NOT EXISTS semantics (checkfirst)


_MIGRATIONS = {1: _migrate_v1}


def init_schema(eng: sa.Engine) -> None:
    """Idempotent: safe to run on every start, and from several processes at once."""
    with eng.begin() as conn:
        if eng.dialect.name == "postgresql":
            conn.execute(sa.text("SELECT pg_advisory_xact_lock(72727401)"))
        metadata.create_all(conn, tables=[schema_migrations])
        done = {r[0] for r in conn.execute(sa.select(schema_migrations.c.version))}
        for v in sorted(_MIGRATIONS):
            if v not in done:
                _MIGRATIONS[v](conn)
                conn.execute(schema_migrations.insert().values(version=v, applied_at=_now()))


class UserStore:
    def __init__(self, url: str):
        self.url = url
        self.eng = make_engine(url)
        self._insert = _dialect_insert(self.eng)
        init_schema(self.eng)

    def dispose(self):
        self.eng.dispose()

    # ------------------------------------------------------------------ meta
    def get_meta(self, key: str):
        with self.eng.connect() as c:
            return c.execute(sa.select(meta.c.value).where(meta.c.key == key)).scalar()

    def set_meta(self, key: str, value: str):
        with self.eng.begin() as c:
            stmt = self._insert(meta).values(key=key, value=value)
            c.execute(stmt.on_conflict_do_update(index_elements=["key"], set_={"value": stmt.excluded.value}))

    # ------------------------------------------------------------------ users
    def count_users(self) -> int:
        with self.eng.connect() as c:
            return int(c.execute(sa.select(sa.func.count()).select_from(users)).scalar() or 0)

    def create_user(self, username: str, email: str, password_hash: str):
        """Returns the user row dict; raises ValueError('username'|'email') when taken (case-insensitive)."""
        now = _now()
        try:
            with self.eng.begin() as c:
                r = c.execute(users.insert().values(
                    username=username, username_lower=username.lower(), email=email, email_lower=email.lower(),
                    password_hash=password_hash, created_at=now, last_login_at=now))
                uid = int(r.inserted_primary_key[0])
        except IntegrityError:
            with self.eng.connect() as c:
                if c.execute(sa.select(users.c.id).where(users.c.username_lower == username.lower())).first():
                    raise ValueError("username")
            raise ValueError("email")
        return self.get_user(uid)

    def get_user(self, uid: int):
        with self.eng.connect() as c:
            r = c.execute(sa.select(users).where(users.c.id == uid)).mappings().first()
        return dict(r) if r else None

    def find_user(self, identifier: str):
        ident = identifier.strip().lower()
        col = users.c.email_lower if "@" in ident else users.c.username_lower
        with self.eng.connect() as c:
            r = c.execute(sa.select(users).where(col == ident)).mappings().first()
        return dict(r) if r else None

    def touch_login(self, uid: int):
        with self.eng.begin() as c:
            c.execute(users.update().where(users.c.id == uid).values(last_login_at=_now()))

    def set_password(self, uid: int, password_hash: str, keep_token_hash: str | None = None):
        """Change the hash and sign out every other session."""
        with self.eng.begin() as c:
            c.execute(users.update().where(users.c.id == uid).values(password_hash=password_hash))
            q = sessions.delete().where(sessions.c.user_id == uid)
            if keep_token_hash:
                q = q.where(sessions.c.token_hash != keep_token_hash)
            c.execute(q)

    def update_hash(self, uid: int, password_hash: str):
        with self.eng.begin() as c:
            c.execute(users.update().where(users.c.id == uid).values(password_hash=password_hash))

    # ---- admin helpers
    def list_users(self, q: str = "", limit: int = 500):
        now = _now()

        def cnt(t, *conds):
            return sa.select(sa.func.count()).select_from(t).where(t.c.user_id == users.c.id, *conds).scalar_subquery()

        query = sa.select(
            users.c.id, users.c.username, users.c.email, users.c.created_at, users.c.last_login_at,
            cnt(favorites).label("favorites"),
            cnt(perfume_status, perfume_status.c.status.isnot(None)).label("collection"),
            cnt(saved_searches).label("saved"),
            cnt(sessions, sessions.c.expires_at > now).label("sessions"),
        ).order_by(users.c.created_at.desc(), users.c.id.desc()).limit(limit)
        q = (q or "").strip().lower()
        if q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            query = query.where(sa.or_(users.c.username_lower.like(like, escape="\\"), users.c.email_lower.like(like, escape="\\")))
        with self.eng.connect() as c:
            return [dict(r) for r in c.execute(query).mappings()]

    def revoke_sessions(self, uid: int) -> int:
        with self.eng.begin() as c:
            return c.execute(sessions.delete().where(sessions.c.user_id == uid)).rowcount

    def update_user(self, uid: int, username: str | None = None, email: str | None = None):
        """Raises ValueError('username'|'email') if taken, LookupError if the user is gone."""
        vals = {}
        if username is not None:
            vals.update(username=username, username_lower=username.lower())
        if email is not None:
            vals.update(email=email, email_lower=email.lower())
        if not vals:
            return self.get_user(uid)
        try:
            with self.eng.begin() as c:
                if not c.execute(users.update().where(users.c.id == uid).values(**vals)).rowcount:
                    raise LookupError("user")
        except IntegrityError:
            with self.eng.connect() as c:
                if username is not None and c.execute(sa.select(users.c.id).where(
                        sa.and_(users.c.username_lower == username.lower(), users.c.id != uid))).first():
                    raise ValueError("username")
            raise ValueError("email")
        return self.get_user(uid)

    def delete_user(self, uid: int):
        with self.eng.begin() as c:  # explicit deletes: do not depend on FK cascades being enabled
            for t in (sessions, favorites, perfume_status, saved_searches, history):
                c.execute(t.delete().where(t.c.user_id == uid))
            c.execute(users.delete().where(users.c.id == uid))

    # ------------------------------------------------------------------ sessions
    def create_session(self, uid: int, token_hash: str, ttl: int):
        now = _now()
        with self.eng.begin() as c:
            c.execute(sessions.insert().values(user_id=uid, token_hash=token_hash, created_at=now, last_seen_at=now,
                                               expires_at=now + ttl))
            c.execute(sessions.delete().where(sessions.c.expires_at < now))  # opportunistic cleanup

    def session_user(self, token_hash: str, ttl: int, refresh_after: int = 3600):
        """Resolve a session -> (user dict, refreshed: bool) or (None, False). Sliding expiry."""
        now = _now()
        with self.eng.begin() as c:
            # the session columns are labelled: an unlabelled sessions.id would shadow users.id in the row mapping
            r = c.execute(
                sa.select(sessions.c.id.label("session_id"), sessions.c.expires_at.label("session_expires_at"), users)
                .select_from(sessions.join(users, users.c.id == sessions.c.user_id))
                .where(sessions.c.token_hash == token_hash)).mappings().first()
            if not r:
                return None, False
            if r["session_expires_at"] <= now:
                c.execute(sessions.delete().where(sessions.c.token_hash == token_hash))
                return None, False
            refreshed = False
            if now + ttl - r["session_expires_at"] > refresh_after:
                c.execute(sessions.update().where(sessions.c.id == r["session_id"]).values(expires_at=now + ttl, last_seen_at=now))
                refreshed = True
            user = {k: r[k] for k in users.c.keys()}
        return user, refreshed

    def delete_session(self, token_hash: str):
        with self.eng.begin() as c:
            c.execute(sessions.delete().where(sessions.c.token_hash == token_hash))

    def expire_session_for_test(self, token_hash: str, expires_at: int):
        with self.eng.begin() as c:
            c.execute(sessions.update().where(sessions.c.token_hash == token_hash).values(expires_at=expires_at))

    def session_expiry(self, token_hash: str):
        with self.eng.connect() as c:
            return c.execute(sa.select(sessions.c.expires_at).where(sessions.c.token_hash == token_hash)).scalar()

    # ------------------------------------------------------------------ favorites
    def list_favorites(self, uid: int):
        with self.eng.connect() as c:
            rows = c.execute(
                sa.select(favorites.c.kind, favorites.c.ref).where(favorites.c.user_id == uid)
                .order_by(favorites.c.created_at.desc(), favorites.c.seq.desc())).all()
        return {"perfumes": [int(r[1]) for r in rows if r[0] == "perfume"], "notes": [r[1] for r in rows if r[0] == "note"]}

    def set_favorite(self, uid: int, kind: str, ref: str, liked: bool, created_at: int | None = None):
        with self.eng.begin() as c:
            where = sa.and_(favorites.c.user_id == uid, favorites.c.kind == kind, favorites.c.ref == ref)
            if liked:
                seq = int(c.execute(sa.select(sa.func.coalesce(sa.func.max(favorites.c.seq), 0)).where(
                    favorites.c.user_id == uid)).scalar() or 0) + 1
                stmt = self._insert(favorites).values(user_id=uid, kind=kind, ref=ref,
                                                      created_at=created_at or _now(), seq=seq)
                c.execute(stmt.on_conflict_do_nothing(index_elements=["user_id", "kind", "ref"]))
            else:
                c.execute(favorites.delete().where(where))

    # ------------------------------------------------------------------ perfume status / rating / note
    def get_status(self, uid: int, pid: int):
        with self.eng.connect() as c:
            r = c.execute(sa.select(perfume_status).where(
                sa.and_(perfume_status.c.user_id == uid, perfume_status.c.perfume_id == pid))).mappings().first()
        return dict(r) if r else None

    def list_status(self, uid: int, status: str | None = None):
        q = sa.select(perfume_status).where(perfume_status.c.user_id == uid)
        if status:
            q = q.where(perfume_status.c.status == status)
        with self.eng.connect() as c:
            return [dict(r) for r in c.execute(q.order_by(perfume_status.c.updated_at.desc())).mappings()]

    def put_status(self, uid: int, pid: int, fields: dict):
        """fields: any of status / rating / note (only the given keys change). Empty row -> deleted."""
        with self.eng.begin() as c:
            cur = c.execute(sa.select(perfume_status).where(
                sa.and_(perfume_status.c.user_id == uid, perfume_status.c.perfume_id == pid))).mappings().first()
            row = {"status": None, "rating": None, "note": None}
            if cur:
                row.update({k: cur[k] for k in row})
            row.update(fields)
            if row["status"] is None and row["rating"] is None and not (row["note"] or "").strip():
                c.execute(perfume_status.delete().where(
                    sa.and_(perfume_status.c.user_id == uid, perfume_status.c.perfume_id == pid)))
                return None
            row["note"] = (row["note"] or "").strip() or None
            stmt = self._insert(perfume_status).values(user_id=uid, perfume_id=pid, updated_at=_now(), **row)
            c.execute(stmt.on_conflict_do_update(
                index_elements=["user_id", "perfume_id"],
                set_={k: stmt.excluded[k] for k in ("status", "rating", "note", "updated_at")}))
        return {"status": row["status"], "rating": row["rating"], "note": row["note"]}

    # ------------------------------------------------------------------ saved searches
    def list_saved(self, uid: int, kind: str | None = None):
        q = sa.select(saved_searches).where(saved_searches.c.user_id == uid)
        if kind:
            q = q.where(saved_searches.c.kind == kind)
        with self.eng.connect() as c:
            rows = c.execute(q.order_by(saved_searches.c.updated_at.desc(), saved_searches.c.id.desc())).mappings().all()
        return [{**dict(r), "state": json.loads(r["state"])} for r in rows]

    def save_search(self, uid: int, kind: str, name: str, state: dict):
        """Create or overwrite (same name, case-insensitive). Raises OverflowError when over the cap."""
        now = _now()
        with self.eng.begin() as c:
            exists = c.execute(sa.select(saved_searches.c.id).where(sa.and_(
                saved_searches.c.user_id == uid, saved_searches.c.kind == kind,
                saved_searches.c.name_lower == name.lower()))).scalar()
            if exists:
                c.execute(saved_searches.update().where(saved_searches.c.id == exists).values(
                    name=name, state=json.dumps(state), updated_at=now))
                return int(exists)
            n = c.execute(sa.select(sa.func.count()).select_from(saved_searches).where(
                saved_searches.c.user_id == uid)).scalar()
            if n >= SAVED_CAP:
                raise OverflowError("too many saved searches")
            r = c.execute(saved_searches.insert().values(
                user_id=uid, kind=kind, name=name, name_lower=name.lower(), state=json.dumps(state),
                created_at=now, updated_at=now))
            return int(r.inserted_primary_key[0])

    def rename_saved(self, uid: int, sid: int, name: str) -> bool:
        try:
            with self.eng.begin() as c:
                r = c.execute(saved_searches.update().where(sa.and_(
                    saved_searches.c.id == sid, saved_searches.c.user_id == uid)).values(
                    name=name, name_lower=name.lower(), updated_at=_now()))
                return r.rowcount > 0
        except IntegrityError:
            raise ValueError("name taken")

    def delete_saved(self, uid: int, sid: int) -> bool:
        with self.eng.begin() as c:
            r = c.execute(saved_searches.delete().where(sa.and_(
                saved_searches.c.id == sid, saved_searches.c.user_id == uid)))
            return r.rowcount > 0

    # ------------------------------------------------------------------ history
    def add_history(self, uid: int, kind: str, ref: str, label: str, state: dict | None):
        """Append; an identical (kind, ref) as the previous entry only refreshes its timestamp. Cap per user."""
        now = _now()
        with self.eng.begin() as c:
            last = c.execute(sa.select(history.c.id, history.c.kind, history.c.ref).where(history.c.user_id == uid)
                             .order_by(history.c.id.desc()).limit(1)).first()
            if last and last[1] == kind and last[2] == ref:
                c.execute(history.update().where(history.c.id == last[0]).values(created_at=now, label=label))
                return int(last[0])
            r = c.execute(history.insert().values(
                user_id=uid, kind=kind, ref=ref, label=label, created_at=now,
                state=json.dumps(state) if state is not None else None))
            hid = int(r.inserted_primary_key[0])
            cutoff = c.execute(sa.select(history.c.id).where(history.c.user_id == uid)
                               .order_by(history.c.id.desc()).offset(HISTORY_CAP - 1).limit(1)).scalar()
            if cutoff is not None:
                c.execute(history.delete().where(sa.and_(history.c.user_id == uid, history.c.id < cutoff)))
        return hid

    def list_history(self, uid: int, kind: str | None = None, limit: int = HISTORY_CAP):
        q = sa.select(history).where(history.c.user_id == uid)
        if kind:
            q = q.where(history.c.kind == kind)
        with self.eng.connect() as c:
            rows = c.execute(q.order_by(history.c.id.desc()).limit(limit)).mappings().all()
        return [{**dict(r), "state": json.loads(r["state"]) if r["state"] else None} for r in rows]

    def clear_history(self, uid: int):
        with self.eng.begin() as c:
            c.execute(history.delete().where(history.c.user_id == uid))

    def delete_history(self, uid: int, hid: int) -> bool:
        with self.eng.begin() as c:
            r = c.execute(history.delete().where(sa.and_(history.c.id == hid, history.c.user_id == uid)))
            return r.rowcount > 0

    # ------------------------------------------------------------------ legacy import
    def import_favorites(self, uid: int, perfumes: list[int], notes: list[str]):
        now = _now()
        # oldest first so the first entry of the old list ends up newest (matches data/user.json order)
        for pid in reversed(perfumes):
            self.set_favorite(uid, "perfume", str(pid), True, now)
        for slug in reversed(notes):
            self.set_favorite(uid, "note", slug, True, now)
