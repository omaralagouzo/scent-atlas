"""Image serving: cached bottle photos (fetched lazily) and generated SVG fallbacks."""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
import urllib.request
from html import escape
from pathlib import Path
from urllib.parse import urlparse

import palette

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
MAX_BYTES = 4_000_000
FETCH_TIMEOUT = 6.0
MAX_CONCURRENCY = 6
RETRY_AFTER = 600.0  # seconds before a failed remote image is tried again


def sniff(data: bytes):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _download(url: str) -> bytes:
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError("unsupported scheme")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
                                               "Referer": "https://www.fragrantica.com/"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or not sniff(data):
        raise ValueError("not an acceptable image")
    return data


class BottleFetcher:
    """Async, de-duplicated, concurrency-limited lazy cache of remote bottle images."""

    def __init__(self, cache_dir: Path, enabled: bool = True):
        self.dir = Path(cache_dir)
        self.enabled = enabled
        self._sem: asyncio.Semaphore | None = None
        self._inflight: dict[int, asyncio.Task] = {}
        self._failed: dict[int, float] = {}

    def path(self, pid: int) -> Path:
        return self.dir / f"{pid}.jpg"

    def cached(self, pid: int) -> Path | None:
        p = self.path(pid)
        return p if p.exists() and p.stat().st_size > 0 else None

    def recently_failed(self, pid: int) -> bool:
        t = self._failed.get(pid)
        return t is not None and time.time() - t < RETRY_AFTER

    async def _fetch(self, pid: int, url: str) -> Path | None:
        if self._sem is None:
            self._sem = asyncio.Semaphore(MAX_CONCURRENCY)
        try:
            async with self._sem:
                data = await asyncio.to_thread(_download, url)
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path(pid).with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, self.path(pid))
            self._failed.pop(pid, None)
            return self.path(pid)
        except Exception:
            self._failed[pid] = time.time()
            return None
        finally:
            self._inflight.pop(pid, None)

    async def get(self, pid: int, url: str | None) -> Path | None:
        c = self.cached(pid)
        if c:
            return c
        if not self.enabled or not url or self.recently_failed(pid):
            return None
        task = self._inflight.get(pid)
        if task is None:
            task = self._inflight[pid] = asyncio.create_task(self._fetch(pid, url))
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=FETCH_TIMEOUT + 2)
        except Exception:
            return None


# ------------------------------------------------------------------ generated SVGs
def bottle_svg(brand: str, name: str, tint: str, seed: str = "") -> str:
    initial = escape((brand or name or "?").strip()[:1].upper() or "?")
    light = palette.shade(tint, 1.45)
    dark = palette.shade(tint, 0.55)
    uid = hashlib.md5(f"{brand}{name}{seed}".encode()).hexdigest()[:6]
    shape = int(uid, 16) % 3  # three silhouettes so a wall of placeholders isn't monotone
    if shape == 0:
        body = '<rect x="78" y="150" width="144" height="190" rx="22"/>'
        shine = '<rect x="92" y="164" width="14" height="150" rx="7"/>'
        neck = '<rect x="128" y="122" width="44" height="32" rx="4"/>'
    elif shape == 1:
        body = '<path d="M96 150h108c16 0 28 12 28 28v132c0 16-12 30-28 30H96c-16 0-28-14-28-30V178c0-16 12-28 28-28z"/>'
        shine = '<rect x="84" y="170" width="12" height="130" rx="6"/>'
        neck = '<rect x="132" y="124" width="36" height="30" rx="4"/>'
    else:
        body = '<path d="M150 146c52 0 84 36 84 92 0 62-32 100-84 100s-84-38-84-100c0-56 32-92 84-92z"/>'
        shine = '<rect x="88" y="190" width="12" height="100" rx="6"/>'
        neck = '<rect x="132" y="122" width="36" height="30" rx="4"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" role="img" aria-label="{escape(name)}">
<defs>
<linearGradient id="g{uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{light}"/><stop offset="0.55" stop-color="{tint}"/><stop offset="1" stop-color="{dark}"/></linearGradient>
<radialGradient id="h{uid}" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="{tint}" stop-opacity="0.22"/><stop offset="1" stop-color="{tint}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="300" height="400" fill="url(#h{uid})"/>
<ellipse cx="150" cy="352" rx="92" ry="9" fill="#000" opacity="0.28"/>
<g fill="#d8c79a"><rect x="124" y="70" width="52" height="56" rx="6"/></g>
<g fill="#b9a574"><rect x="124" y="70" width="52" height="8" rx="4"/></g>
<g fill="url(#g{uid})" opacity="0.96">{neck}{body}</g>
<g fill="#fff" opacity="0.28">{shine}</g>
<circle cx="150" cy="248" r="34" fill="#fff" opacity="0.14"/>
<text x="150" y="263" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="46" font-weight="600" fill="#fff" opacity="0.92">{initial}</text>
</svg>'''


def note_svg(name: str, family: str | None) -> str:
    base = palette.family_color(family)
    light, dark = palette.shade(base, 1.25), palette.shade(base, 0.45)
    words = [w for w in name.replace("-", " ").split() if w]
    initials = "".join(w[0] for w in words[:2]).upper() or "?"
    uid = hashlib.md5(name.encode()).hexdigest()
    cx, cy = 40 + int(uid[0:2], 16) % 160, 40 + int(uid[2:4], 16) % 160
    r = 60 + int(uid[4:6], 16) % 70
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="{escape(name)}">
<defs><linearGradient id="n{uid[:6]}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{light}"/><stop offset="1" stop-color="{dark}"/></linearGradient></defs>
<rect width="240" height="240" fill="url(#n{uid[:6]})"/>
<circle cx="{cx}" cy="{cy}" r="{r}" fill="#fff" opacity="0.10"/>
<circle cx="{240 - cx}" cy="{240 - cy}" r="{r // 2 + 20}" fill="#000" opacity="0.10"/>
<circle cx="120" cy="120" r="64" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="1.5"/>
<text x="120" y="138" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="56" fill="#fff" fill-opacity="0.95" style="letter-spacing:2px">{escape(initials)}</text>
</svg>'''
