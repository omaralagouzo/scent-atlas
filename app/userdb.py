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
    sa.Column("first_name", sa.String(40)),                    # shown on profiles; accounts from before v4 get the
    sa.Column("last_name", sa.String(40)),                     # placeholder "User Name" until they set their own
    sa.Column("avatar_at", sa.BigInteger),                     # profile photo version (unix time), NULL = none
)

# Profile photos: one small re-encoded WebP per user (about 20-60 KB), served from /api/avatars/<id>.webp
avatars = sa.Table(
    "avatars", metadata,
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("data", sa.LargeBinary, nullable=False),
    sa.Column("mime", sa.String(20), nullable=False),
    sa.Column("updated_at", sa.BigInteger, nullable=False),
)

# In-app notifications (friend requests, accepted requests, reminders). Read by polling; capped per user.
notifications = sa.Table(
    "notifications", metadata,
    sa.Column("id", BigInt, primary_key=True, autoincrement=True),
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("kind", sa.String(24), nullable=False),            # friend_request | friend_accept | name_reminder
    sa.Column("actor_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE")),
    sa.Column("ref", sa.String(120)),                            # e.g. a perfume id, for future kinds
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("read_at", sa.BigInteger),
    sa.Index("ix_notifications_user_id_id", "user_id", "id"),
)

# Public reviews: one per user and perfume (rating required, text and longevity / sillage optional)
reviews = sa.Table(
    "reviews", metadata,
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("perfume_id", sa.Integer, primary_key=True),
    sa.Column("rating", sa.SmallInteger, nullable=False),        # 1..5
    sa.Column("longevity", sa.SmallInteger),                     # 1..5 | NULL
    sa.Column("sillage", sa.SmallInteger),                       # 1..5 | NULL
    sa.Column("body", sa.Text),
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("updated_at", sa.BigInteger, nullable=False),
    sa.Index("ix_reviews_perfume", "perfume_id", "updated_at"),
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
    sa.Column("rank_pos", sa.Integer),                          # 1-based place on the owner's leaderboard (owned only), NULL = unranked
)

# community layering combos: one row per unordered perfume pair (a_id < b_id), votes counted from layer_votes
layer_combos = sa.Table(
    "layer_combos", metadata,
    sa.Column("id", BigInt, primary_key=True, autoincrement=True),
    sa.Column("a_id", sa.Integer, nullable=False),
    sa.Column("b_id", sa.Integer, nullable=False),
    sa.Column("created_by", BigInt, sa.ForeignKey("users.id", ondelete="SET NULL")),
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("up", sa.Integer, nullable=False, default=0),
    sa.Column("down", sa.Integer, nullable=False, default=0),
    sa.UniqueConstraint("a_id", "b_id", name="uq_layer_combo_pair"),
    sa.Index("ix_layer_combos_b", "b_id"),
)

layer_votes = sa.Table(
    "layer_votes", metadata,
    sa.Column("user_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("combo_id", BigInt, sa.ForeignKey("layer_combos.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("vote", sa.SmallInteger, nullable=False),          # +1 | -1
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Index("ix_layer_votes_combo", "combo_id"),
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

# Friends: one row per pair. A pending request goes requester -> addressee; accepting flips status to accepted.
friendships = sa.Table(
    "friendships", metadata,
    sa.Column("requester_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("addressee_id", BigInt, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("status", sa.String(10), nullable=False),          # pending | accepted
    sa.Column("created_at", sa.BigInteger, nullable=False),
    sa.Column("updated_at", sa.BigInteger, nullable=False),
    sa.Index("ix_friendships_addressee", "addressee_id"),
)

schema_migrations = sa.Table(
    "schema_migrations", metadata,
    sa.Column("version", sa.Integer, primary_key=True),
    sa.Column("applied_at", sa.BigInteger, nullable=False),
)

SCHEMA_VERSION = 4  # bump + add a step in _MIGRATIONS when the schema changes
HISTORY_CAP = 200
SAVED_CAP = 100
COLLECTION_CAP = 5000   # longest leaderboard accepted in one order update
STATUSES = ("owned", "tried", "wishlist")
PLACEHOLDER_NAME = ("User", "Name")   # what accounts from before names existed are called until they change it
NOTIFY_CAP = 200                      # newest notifications kept per user


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


def _migrate_v2(conn):
    """Collection leaderboard (perfume_status.rank_pos) + community layering combos / votes.
    A database created after this change already has both from v1's create_all."""
    cols = {c["name"] for c in sa.inspect(conn).get_columns("perfume_status")}
    if "rank_pos" not in cols:
        conn.execute(sa.text("ALTER TABLE perfume_status ADD COLUMN rank_pos INTEGER"))
    metadata.create_all(conn, tables=[layer_combos, layer_votes])


def _migrate_v3(conn):
    """Friends (friend requests and friendships)."""
    metadata.create_all(conn, tables=[friendships])


def _migrate_v4(conn):
    """Names and profile photos on users, plus avatars, notifications and reviews.
    Existing accounts are called "User Name" until they set their own (they are reminded once at sign-in)."""
    cols = {c["name"] for c in sa.inspect(conn).get_columns("users")}
    for col, typ in (("first_name", "VARCHAR(40)"), ("last_name", "VARCHAR(40)"), ("avatar_at", "BIGINT")):
        if col not in cols:
            conn.execute(sa.text(f"ALTER TABLE users ADD COLUMN {col} {typ}"))
    conn.execute(users.update().where(users.c.first_name.is_(None)).values(first_name=PLACEHOLDER_NAME[0]))
    conn.execute(users.update().where(users.c.last_name.is_(None)).values(last_name=PLACEHOLDER_NAME[1]))
    metadata.create_all(conn, tables=[avatars, notifications, reviews])


_MIGRATIONS = {1: _migrate_v1, 2: _migrate_v2, 3: _migrate_v3, 4: _migrate_v4}


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

    def create_user(self, username: str, email: str, password_hash: str,
                    first_name: str | None = None, last_name: str | None = None):
        """Returns the user row dict; raises ValueError('username'|'email') when taken (case-insensitive)."""
        now = _now()
        try:
            with self.eng.begin() as c:
                r = c.execute(users.insert().values(
                    username=username, username_lower=username.lower(), email=email, email_lower=email.lower(),
                    password_hash=password_hash, created_at=now, last_login_at=now,
                    first_name=first_name or PLACEHOLDER_NAME[0], last_name=last_name or PLACEHOLDER_NAME[1]))
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

    def user_by_username(self, username: str):
        with self.eng.connect() as c:
            r = c.execute(sa.select(users).where(users.c.username_lower == username.strip().lower())).mappings().first()
        return dict(r) if r else None

    PERSON_COLS = (users.c.id, users.c.username, users.c.first_name, users.c.last_name, users.c.avatar_at, users.c.created_at)

    def search_users(self, q: str, limit: int = 10, exclude: int | None = None):
        """Usernames starting with q first, then usernames or names containing it. Never matches on email."""
        return self.people(q, limit, 0, exclude)[0] if q.strip() else []

    def people(self, q: str = "", limit: int = 30, offset: int = 0, exclude: int | None = None):
        """The member directory: (rows, total). With q, matches username, first name, last name or the full name
        (usernames starting with q first); without, everyone by name. Rows carry `owned` (collection size)."""
        qn = " ".join(q.strip().lower().split())
        full = sa.func.lower(sa.func.coalesce(users.c.first_name, "") + " " + sa.func.coalesce(users.c.last_name, ""))
        conds = []
        if exclude is not None:
            conds.append(users.c.id != exclude)
        order = []
        if qn:
            like = qn.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            conds.append(sa.or_(users.c.username_lower.like(f"%{like}%", escape="\\"), full.like(f"%{like}%", escape="\\")))
            order += [sa.case((users.c.username_lower.like(f"{like}%", escape="\\"), 0),
                              (full.like(f"{like}%", escape="\\"), 1), else_=2), sa.func.length(users.c.username)]
        placeholder = sa.and_(users.c.first_name == PLACEHOLDER_NAME[0], users.c.last_name == PLACEHOLDER_NAME[1])
        order += [sa.case((placeholder, 1), else_=0), full, users.c.username_lower]
        owned = (sa.select(sa.func.count()).select_from(perfume_status)
                 .where(perfume_status.c.user_id == users.c.id, perfume_status.c.status == "owned").scalar_subquery())
        where = sa.and_(*conds) if conds else sa.true()
        with self.eng.connect() as c:
            total = int(c.execute(sa.select(sa.func.count()).select_from(users).where(where)).scalar() or 0)
            rows = c.execute(sa.select(*self.PERSON_COLS, owned.label("owned")).where(where)
                             .order_by(*order).limit(limit).offset(offset)).mappings().all()
        return [dict(r) for r in rows], total

    def set_name(self, uid: int, first_name: str, last_name: str):
        with self.eng.begin() as c:
            c.execute(users.update().where(users.c.id == uid).values(first_name=first_name, last_name=last_name))
        return self.get_user(uid)

    # ------------------------------------------------------------------ profile photos
    def set_avatar(self, uid: int, data: bytes, mime: str) -> int:
        now = _now()
        with self.eng.begin() as c:
            stmt = self._insert(avatars).values(user_id=uid, data=data, mime=mime, updated_at=now)
            c.execute(stmt.on_conflict_do_update(index_elements=["user_id"], set_={
                "data": stmt.excluded.data, "mime": stmt.excluded.mime, "updated_at": stmt.excluded.updated_at}))
            c.execute(users.update().where(users.c.id == uid).values(avatar_at=now))
        return now

    def get_avatar(self, uid: int):
        with self.eng.connect() as c:
            r = c.execute(sa.select(avatars.c.data, avatars.c.mime, avatars.c.updated_at).where(avatars.c.user_id == uid)).mappings().first()
        return dict(r) if r else None

    def delete_avatar(self, uid: int):
        with self.eng.begin() as c:
            c.execute(avatars.delete().where(avatars.c.user_id == uid))
            c.execute(users.update().where(users.c.id == uid).values(avatar_at=None))

    # ------------------------------------------------------------------ notifications
    def notify(self, uid: int, kind: str, actor_id: int | None = None, ref: str | None = None):
        """Add a notification (an unread one of the same kind / actor / ref is replaced, so repeats never pile up)."""
        with self.eng.begin() as c:
            same = sa.and_(notifications.c.user_id == uid, notifications.c.kind == kind, notifications.c.read_at.is_(None),
                           notifications.c.actor_id.is_(None) if actor_id is None else notifications.c.actor_id == actor_id,
                           notifications.c.ref.is_(None) if ref is None else notifications.c.ref == ref)
            c.execute(notifications.delete().where(same))
            c.execute(notifications.insert().values(user_id=uid, kind=kind, actor_id=actor_id, ref=ref, created_at=_now()))
            keep = (sa.select(notifications.c.id).where(notifications.c.user_id == uid)
                    .order_by(notifications.c.id.desc()).limit(NOTIFY_CAP).subquery())
            c.execute(notifications.delete().where(notifications.c.user_id == uid,
                                                   notifications.c.id.not_in(sa.select(keep.c.id))))

    def unnotify(self, uid: int, kind: str, actor_id: int | None = None):
        """Withdraw notifications (e.g. a friend request that was cancelled before it was answered)."""
        with self.eng.begin() as c:
            q = notifications.delete().where(notifications.c.user_id == uid, notifications.c.kind == kind)
            if actor_id is not None:
                q = q.where(notifications.c.actor_id == actor_id)
            c.execute(q)

    def mark_read_from(self, uid: int, kind: str, actor_id: int):
        with self.eng.begin() as c:
            c.execute(notifications.update().where(notifications.c.user_id == uid, notifications.c.kind == kind,
                                                   notifications.c.actor_id == actor_id, notifications.c.read_at.is_(None))
                      .values(read_at=_now()))

    def has_notification(self, uid: int, kind: str) -> bool:
        with self.eng.connect() as c:
            return c.execute(sa.select(notifications.c.id).where(notifications.c.user_id == uid, notifications.c.kind == kind).limit(1)).first() is not None

    def list_notifications(self, uid: int, limit: int = 30):
        a = users.alias("actor")
        with self.eng.connect() as c:
            rows = c.execute(sa.select(notifications.c.id, notifications.c.kind, notifications.c.ref, notifications.c.created_at,
                                       notifications.c.read_at, a.c.id.label("actor_id"), a.c.username.label("actor_username"),
                                       a.c.first_name.label("actor_first_name"), a.c.last_name.label("actor_last_name"),
                                       a.c.avatar_at.label("actor_avatar_at"))
                             .select_from(notifications.outerjoin(a, a.c.id == notifications.c.actor_id))
                             .where(notifications.c.user_id == uid).order_by(notifications.c.id.desc()).limit(limit)).mappings().all()
        return [dict(r) for r in rows]

    def unread_count(self, uid: int) -> int:
        with self.eng.connect() as c:
            return int(c.execute(sa.select(sa.func.count()).select_from(notifications).where(
                notifications.c.user_id == uid, notifications.c.read_at.is_(None))).scalar() or 0)

    def mark_read(self, uid: int, ids: list[int] | None = None) -> int:
        """Mark the given notifications (or all of them) read; returns how many changed."""
        q = notifications.update().where(notifications.c.user_id == uid, notifications.c.read_at.is_(None))
        if ids is not None:
            q = q.where(notifications.c.id.in_(ids))
        with self.eng.begin() as c:
            return c.execute(q.values(read_at=_now())).rowcount

    # ------------------------------------------------------------------ reviews
    def get_review(self, uid: int, pid: int):
        with self.eng.connect() as c:
            r = c.execute(sa.select(reviews).where(reviews.c.user_id == uid, reviews.c.perfume_id == pid)).mappings().first()
        return dict(r) if r else None

    def put_review(self, uid: int, pid: int, rating: int, longevity: int | None, sillage: int | None, body: str | None):
        now = _now()
        with self.eng.begin() as c:
            stmt = self._insert(reviews).values(user_id=uid, perfume_id=pid, rating=rating, longevity=longevity,
                                                sillage=sillage, body=body, created_at=now, updated_at=now)
            c.execute(stmt.on_conflict_do_update(index_elements=["user_id", "perfume_id"], set_={
                k: getattr(stmt.excluded, k) for k in ("rating", "longevity", "sillage", "body", "updated_at")}))
        return self.get_review(uid, pid)

    def review_count(self, uid: int) -> int:
        with self.eng.connect() as c:
            return int(c.execute(sa.select(sa.func.count()).select_from(reviews).where(reviews.c.user_id == uid)).scalar() or 0)

    def delete_review(self, uid: int, pid: int) -> bool:
        with self.eng.begin() as c:
            return bool(c.execute(reviews.delete().where(reviews.c.user_id == uid, reviews.c.perfume_id == pid)).rowcount)

    def reviews_for(self, pid: int, limit: int = 50, offset: int = 0, first: list[int] | None = None):
        """Reviews of a perfume with their authors, newest first (users in `first`, e.g. friends, before everyone else)."""
        order = [sa.case((reviews.c.user_id.in_(first), 0), else_=1)] if first else []
        with self.eng.connect() as c:
            rows = c.execute(sa.select(reviews, users.c.username, users.c.first_name, users.c.last_name, users.c.avatar_at)
                             .select_from(reviews.join(users, users.c.id == reviews.c.user_id))
                             .where(reviews.c.perfume_id == pid)
                             .order_by(*order, reviews.c.updated_at.desc(), reviews.c.user_id).limit(limit).offset(offset)).mappings().all()
        return [dict(r) for r in rows]

    def review_stats(self, pid: int) -> dict:
        with self.eng.connect() as c:
            dist = dict(c.execute(sa.select(reviews.c.rating, sa.func.count()).where(reviews.c.perfume_id == pid)
                                  .group_by(reviews.c.rating)).all())
            lon, sil, written = c.execute(sa.select(sa.func.avg(reviews.c.longevity), sa.func.avg(reviews.c.sillage),
                                                    sa.func.count(reviews.c.body)).where(reviews.c.perfume_id == pid)).one()
        n = sum(dist.values())
        return {"count": n, "written": int(written or 0),
                "average": round(sum(k * v for k, v in dist.items()) / n, 2) if n else None,
                "distribution": [int(dist.get(k, 0)) for k in (1, 2, 3, 4, 5)],
                "longevity": round(float(lon), 2) if lon is not None else None,
                "sillage": round(float(sil), 2) if sil is not None else None}

    def status_counts(self, pid: int) -> dict:
        """How many members own / tried / wish for a perfume."""
        with self.eng.connect() as c:
            rows = dict(c.execute(sa.select(perfume_status.c.status, sa.func.count()).where(
                perfume_status.c.perfume_id == pid, perfume_status.c.status.isnot(None)).group_by(perfume_status.c.status)).all())
        return {s: int(rows.get(s, 0)) for s in STATUSES}

    def statuses_of(self, pid: int, uids: list[int]) -> dict[int, str]:
        """{user id: status} of these users for one perfume (friends who own / want / tried it)."""
        if not uids:
            return {}
        with self.eng.connect() as c:
            return dict(c.execute(sa.select(perfume_status.c.user_id, perfume_status.c.status).where(
                perfume_status.c.perfume_id == pid, perfume_status.c.user_id.in_(uids), perfume_status.c.status.isnot(None))).all())

    def people_by_id(self, uids: list[int]) -> dict[int, dict]:
        if not uids:
            return {}
        with self.eng.connect() as c:
            return {r["id"]: dict(r) for r in c.execute(sa.select(*self.PERSON_COLS).where(users.c.id.in_(uids))).mappings()}

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
            voted = [int(r[0]) for r in c.execute(sa.select(layer_votes.c.combo_id).where(layer_votes.c.user_id == uid))]
            c.execute(layer_votes.delete().where(layer_votes.c.user_id == uid))
            self._recount(c, voted)
            c.execute(layer_combos.update().where(layer_combos.c.created_by == uid).values(created_by=None))
            for t in (sessions, favorites, perfume_status, saved_searches, history, avatars, reviews, notifications):
                c.execute(t.delete().where(t.c.user_id == uid))
            c.execute(notifications.delete().where(notifications.c.actor_id == uid))
            c.execute(friendships.delete().where(sa.or_(friendships.c.requester_id == uid, friendships.c.addressee_id == uid)))
            c.execute(users.delete().where(users.c.id == uid))

    # ------------------------------------------------------------------ friends
    def _friend_row(self, c, a: int, b: int):
        return c.execute(sa.select(friendships).where(sa.or_(
            sa.and_(friendships.c.requester_id == a, friendships.c.addressee_id == b),
            sa.and_(friendships.c.requester_id == b, friendships.c.addressee_id == a)))).mappings().first()

    def relation(self, me: int, other: int) -> str:
        """self | friends | outgoing (I asked) | incoming (they asked) | none"""
        if me == other:
            return "self"
        with self.eng.connect() as c:
            r = self._friend_row(c, me, other)
        if not r:
            return "none"
        if r["status"] == "accepted":
            return "friends"
        return "outgoing" if r["requester_id"] == me else "incoming"

    def request_friend(self, me: int, other: int) -> str:
        """Send a request, or accept theirs if they already asked. Returns the new relation."""
        now = _now()
        with self.eng.begin() as c:
            r = self._friend_row(c, me, other)
            if not r:
                c.execute(friendships.insert().values(requester_id=me, addressee_id=other, status="pending",
                                                      created_at=now, updated_at=now))
                return "outgoing"
            if r["status"] == "accepted":
                return "friends"
            if r["requester_id"] == other:
                c.execute(friendships.update().where(sa.and_(friendships.c.requester_id == other,
                                                             friendships.c.addressee_id == me)).values(status="accepted", updated_at=now))
                return "friends"
            return "outgoing"

    def remove_friend(self, me: int, other: int) -> None:
        """Unfriend, cancel my request or decline theirs."""
        with self.eng.begin() as c:
            c.execute(friendships.delete().where(sa.or_(
                sa.and_(friendships.c.requester_id == me, friendships.c.addressee_id == other),
                sa.and_(friendships.c.requester_id == other, friendships.c.addressee_id == me))))

    def pending_outgoing(self, me: int) -> int:
        with self.eng.connect() as c:
            return int(c.execute(sa.select(sa.func.count()).select_from(friendships).where(sa.and_(
                friendships.c.requester_id == me, friendships.c.status == "pending"))).scalar() or 0)

    def list_friends(self, me: int) -> dict:
        """{friends, incoming, outgoing}: lists of person rows (id, username, names, avatar_at) + since, newest first."""
        out = {"friends": [], "incoming": [], "outgoing": []}
        with self.eng.connect() as c:
            rows = c.execute(sa.select(friendships).where(sa.or_(
                friendships.c.requester_id == me, friendships.c.addressee_id == me))
                .order_by(friendships.c.updated_at.desc())).mappings().all()
            ids = {r["addressee_id"] if r["requester_id"] == me else r["requester_id"] for r in rows}
            people = {p["id"]: dict(p) for p in c.execute(sa.select(*self.PERSON_COLS).where(users.c.id.in_(ids))).mappings()} if ids else {}
        for r in rows:
            other = r["addressee_id"] if r["requester_id"] == me else r["requester_id"]
            if other not in people:
                continue
            kind = "friends" if r["status"] == "accepted" else ("outgoing" if r["requester_id"] == me else "incoming")
            out[kind].append({**people[other], "since": r["updated_at"]})
        return out

    def friend_ids(self, uid: int) -> list[int]:
        with self.eng.connect() as c:
            rows = c.execute(sa.select(friendships.c.requester_id, friendships.c.addressee_id).where(sa.and_(
                friendships.c.status == "accepted",
                sa.or_(friendships.c.requester_id == uid, friendships.c.addressee_id == uid)))).all()
        return [b if a == uid else a for a, b in rows]

    def friend_count(self, uid: int) -> int:
        with self.eng.connect() as c:
            return int(c.execute(sa.select(sa.func.count()).select_from(friendships).where(sa.and_(
                friendships.c.status == "accepted",
                sa.or_(friendships.c.requester_id == uid, friendships.c.addressee_id == uid)))).scalar() or 0)

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
            old_rank = cur["rank_pos"] if cur else None
            row["rank_pos"] = old_rank if row["status"] == "owned" else None   # only owned perfumes are ranked
            stmt = self._insert(perfume_status).values(user_id=uid, perfume_id=pid, updated_at=_now(), **row)
            c.execute(stmt.on_conflict_do_update(
                index_elements=["user_id", "perfume_id"],
                set_={k: stmt.excluded[k] for k in ("status", "rating", "note", "updated_at", "rank_pos")}))
            if old_rank is not None and row["rank_pos"] is None:
                self._close_rank_gap(c, uid, old_rank)
        return {"status": row["status"], "rating": row["rating"], "note": row["note"]}

    @staticmethod
    def _close_rank_gap(c, uid: int, removed: int):
        c.execute(perfume_status.update().where(sa.and_(
            perfume_status.c.user_id == uid, perfume_status.c.rank_pos > removed)).values(
            rank_pos=perfume_status.c.rank_pos - 1))

    # ------------------------------------------------------------------ collection leaderboard
    def set_collection_order(self, uid: int, ids: list[int]) -> list[int]:
        """The ranked part of the collection, best first. Ids that are not owned are ignored; owned perfumes left out
        become unranked. Returns the stored order."""
        with self.eng.begin() as c:
            owned = {int(r[0]) for r in c.execute(sa.select(perfume_status.c.perfume_id).where(sa.and_(
                perfume_status.c.user_id == uid, perfume_status.c.status == "owned")))}
            order, seen = [], set()
            for pid in ids:
                if pid in owned and pid not in seen:
                    seen.add(pid)
                    order.append(pid)
            c.execute(perfume_status.update().where(sa.and_(
                perfume_status.c.user_id == uid, perfume_status.c.rank_pos.isnot(None))).values(rank_pos=None))
            if order:
                stmt = (perfume_status.update().where(sa.and_(
                    perfume_status.c.user_id == uid, perfume_status.c.perfume_id == sa.bindparam("pid")))
                    .values(rank_pos=sa.bindparam("pos")))
                c.execute(stmt, [{"pid": pid, "pos": k + 1} for k, pid in enumerate(order)])
        return order

    def collection_order(self, uid: int) -> list[int]:
        with self.eng.connect() as c:
            return [int(r[0]) for r in c.execute(sa.select(perfume_status.c.perfume_id).where(sa.and_(
                perfume_status.c.user_id == uid, perfume_status.c.status == "owned",
                perfume_status.c.rank_pos.isnot(None))).order_by(perfume_status.c.rank_pos))]

    # ------------------------------------------------------------------ community layering combos
    @staticmethod
    def _pair(a: int, b: int) -> tuple[int, int]:
        return (a, b) if a < b else (b, a)

    def find_combo(self, a: int, b: int):
        a, b = self._pair(a, b)
        with self.eng.connect() as c:
            r = c.execute(self._combo_select().where(sa.and_(
                layer_combos.c.a_id == a, layer_combos.c.b_id == b))).mappings().first()
        return dict(r) if r else None

    def get_combo(self, cid: int):
        with self.eng.connect() as c:
            r = c.execute(self._combo_select().where(layer_combos.c.id == cid)).mappings().first()
        return dict(r) if r else None

    def combos_created_since(self, uid: int, since: int) -> int:
        with self.eng.connect() as c:
            return int(c.execute(sa.select(sa.func.count()).select_from(layer_combos).where(sa.and_(
                layer_combos.c.created_by == uid, layer_combos.c.created_at >= since))).scalar() or 0)

    def create_combo(self, uid: int, a: int, b: int) -> tuple[dict, bool]:
        """(combo, created). An existing pair is returned as is; a new one starts with its author's thumbs up."""
        a, b = self._pair(a, b)
        try:
            with self.eng.begin() as c:
                r = c.execute(layer_combos.insert().values(a_id=a, b_id=b, created_by=uid, created_at=_now(), up=0, down=0))
                cid = int(r.inserted_primary_key[0])
        except IntegrityError:
            return self.find_combo(a, b), False
        self.vote_combo(uid, cid, 1)
        return self.get_combo(cid), True

    def vote_combo(self, uid: int, cid: int, vote: int):
        """vote: +1, -1, or 0 (take the vote back). Counts are recomputed from layer_votes, so they never drift."""
        with self.eng.begin() as c:
            where = sa.and_(layer_votes.c.user_id == uid, layer_votes.c.combo_id == cid)
            if vote == 0:
                c.execute(layer_votes.delete().where(where))
            else:
                stmt = self._insert(layer_votes).values(user_id=uid, combo_id=cid, vote=vote, created_at=_now())
                c.execute(stmt.on_conflict_do_update(index_elements=["user_id", "combo_id"],
                                                     set_={"vote": stmt.excluded.vote, "created_at": stmt.excluded.created_at}))
            self._recount(c, [cid])
        return self.get_combo(cid)

    @staticmethod
    def _recount(c, cids):
        for cid in cids:
            def n(v):
                return sa.select(sa.func.count()).select_from(layer_votes).where(sa.and_(
                    layer_votes.c.combo_id == cid, layer_votes.c.vote == v)).scalar_subquery()
            c.execute(layer_combos.update().where(layer_combos.c.id == cid).values(up=n(1), down=n(-1)))

    @staticmethod
    def _combo_select():
        """Combo rows plus the author's username as `by` (None once the author deleted their account)."""
        return sa.select(layer_combos, users.c.username.label("by")).select_from(
            layer_combos.outerjoin(users, users.c.id == layer_combos.c.created_by))

    def combos_for(self, pid: int, limit: int = 200):
        with self.eng.connect() as c:
            rows = c.execute(self._combo_select().where(sa.or_(layer_combos.c.a_id == pid, layer_combos.c.b_id == pid))
                             .order_by((layer_combos.c.up - layer_combos.c.down).desc(), layer_combos.c.id).limit(limit)).mappings().all()
        return [dict(r) for r in rows]

    def top_combos(self, limit: int = 60, min_up: int = 1):
        with self.eng.connect() as c:
            rows = c.execute(self._combo_select().where(layer_combos.c.up >= min_up)
                             .order_by((layer_combos.c.up - layer_combos.c.down).desc(), layer_combos.c.up.desc(), layer_combos.c.id)
                             .limit(limit)).mappings().all()
        return [dict(r) for r in rows]

    def user_votes(self, uid: int, cids: list[int]) -> dict[int, int]:
        if not cids:
            return {}
        with self.eng.connect() as c:
            return {int(r[0]): int(r[1]) for r in c.execute(sa.select(layer_votes.c.combo_id, layer_votes.c.vote).where(sa.and_(
                layer_votes.c.user_id == uid, layer_votes.c.combo_id.in_(list(cids)))))}

    def delete_combo(self, cid: int) -> bool:
        with self.eng.begin() as c:
            c.execute(layer_votes.delete().where(layer_votes.c.combo_id == cid))
            return c.execute(layer_combos.delete().where(layer_combos.c.id == cid)).rowcount > 0

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
