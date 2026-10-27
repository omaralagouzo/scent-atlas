"""Authentication helpers: validation, password hashing (argon2id), session tokens, rate limiting, client IP."""
from __future__ import annotations

import hashlib
import re
import unicodedata
import secrets
import threading
import time
from collections import deque

from argon2 import PasswordHasher
from argon2 import exceptions as argon_exc

# ---------------------------------------------------------------------------- validation
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$")
EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
MIN_PASSWORD, MAX_PASSWORD = 8, 128

# A small list of the most common passwords (>= 8 chars matter because of the length rule, shorter ones kept anyway).
COMMON_PASSWORDS = frozenset("""
password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword pass1234 pa55word
12345678 123456789 1234567890 123123123 11111111 00000000 87654321 12341234 1q2w3e4r 1q2w3e4r5t 1qaz2wsx
qwertyui qwerty123 qwerty12 qwertyuiop qwerty1234 qwer1234 asdfghjk asdfasdf asdf1234 zxcvbnm1 zaq12wsx
iloveyou iloveyou1 letmein1 letmein123 welcome1 welcome123 admin123 administrator changeme changeme1
football baseball basketball superman batman starwars dragon123 monkey123 sunshine princess trustno1
master123 shadow123 michael1 jennifer1 abc12345 abcd1234 abcdefgh a1b2c3d4 test1234 testtest guest123
internet computer minecraft pokemon1 whatever1 freedom1 mustang1 access14 charlie1 liverpool hunter123
secret123 login123 default1 mypassword my_password mypass123 qazwsxedc zxcvbnm123 passpass 1234qwer
fragrance perfume123 scentatlas scent-atlas perfumes fragrantica
""".split())


def valid_username(u: str) -> str | None:
    if not isinstance(u, str) or not USERNAME_RE.match(u):
        return "Username must be 3-32 characters: letters, digits, dot, dash or underscore, starting with a letter or digit."
    return None


def clean_name(first: str | None, last: str | None) -> tuple[str, str] | str:
    """(first, last) with whitespace collapsed, or a problem message. First name required, last name optional."""
    def tidy(x):
        return " ".join(str(x or "").split())
    f, l = tidy(first), tidy(last)
    if not f:
        return "Enter your first name."
    if len(f) > 40 or len(l) > 40:
        return "Names can be at most 40 characters."
    for part in (f, l):
        if any(unicodedata.category(ch)[0] == "C" for ch in part) or (part and not any(ch.isalpha() for ch in part)):
            return "Names need at least one letter and no special control characters."
    return f, l


def valid_email(e: str) -> str | None:
    if not isinstance(e, str) or len(e) > 254 or not EMAIL_RE.match(e) or len(e.split("@")[0]) > 64:
        return "Enter a valid email address."
    return None


def password_problem(pw: str, username: str = "", email: str = "") -> str | None:
    if not isinstance(pw, str) or len(pw) < MIN_PASSWORD:
        return f"Password must be at least {MIN_PASSWORD} characters."
    if len(pw) > MAX_PASSWORD:
        return f"Password must be at most {MAX_PASSWORD} characters."
    low = pw.lower()
    if low in COMMON_PASSWORDS or low.strip("0123456789") in ("", "password", "qwerty", "letmein", "welcome"):
        return "That password is too common. Pick something less guessable."
    if username and low == username.lower():
        return "Password must not be the same as your username."
    if email and low in (email.lower(), email.lower().split("@")[0]):
        return "Password must not be the same as your email."
    return None


# ---------------------------------------------------------------------------- hashing
# argon2id, OWASP "minimum" profile (19 MiB, t=2, p=1): keeps memory sane on a 512 MB instance.
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_hash_slots = threading.BoundedSemaphore(2)  # at most two hashes in flight -> <= ~40 MiB transient
_DUMMY_HASH = _hasher.hash("scent-atlas-dummy-password")


def hash_password(pw: str) -> str:
    with _hash_slots:
        return _hasher.hash(pw)


def verify_password(stored: str | None, pw: str) -> bool:
    """Constant-ish time: an unknown user is verified against a dummy hash so timing does not leak existence."""
    with _hash_slots:
        try:
            return _hasher.verify(stored or _DUMMY_HASH, pw) and stored is not None
        except (argon_exc.VerifyMismatchError, argon_exc.VerificationError, argon_exc.InvalidHashError):
            return False


def needs_rehash(stored: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored)
    except Exception:
        return False


# ---------------------------------------------------------------------------- session tokens
def new_token() -> str:
    return secrets.token_urlsafe(32)  # 256 bits


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------- rate limiting
class RateLimiter:
    """In-memory sliding-window limiter. ``hit(key)`` -> (allowed, retry_after_seconds)."""

    def __init__(self, limit: int, window: float = 60.0, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def hit(self, key: str):
        now = self.clock()
        with self._lock:
            dq = self._hits.get(key)
            if dq is None:
                if len(self._hits) > 20000:
                    self._prune(now)
                dq = self._hits[key] = deque()
            while dq and now - dq[0] >= self.window:
                dq.popleft()
            if len(dq) >= self.limit:
                return False, max(1, int(self.window - (now - dq[0])) + 1)
            dq.append(now)
            return True, 0

    def _prune(self, now):
        for k in [k for k, d in self._hits.items() if not d or now - d[-1] >= self.window]:
            del self._hits[k]

    def reset(self):
        with self._lock:
            self._hits.clear()


# ---------------------------------------------------------------------------- request helpers
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1", "testserver"}


def host_only(host: str) -> str:
    host = (host or "").strip().lower()
    if host.startswith("["):
        return host[: host.find("]") + 1] if "]" in host else host
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def client_ip(request, trust_proxy: bool, hops: int) -> str:
    """Real client address. Behind a trusted proxy chain, the entry `hops` from the right of X-Forwarded-For
    (the client cannot forge entries to the right of that point)."""
    peer = request.client.host if request.client else "unknown"
    if trust_proxy and hops > 0:
        xff = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(xff) >= hops:
            return xff[-hops]
        if xff:
            return xff[0]
    return peer
