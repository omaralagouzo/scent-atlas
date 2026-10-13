"""Remote (hotlinked) image URLs for deploy mode.

Fragrantica note thumbnails:  notes.image_source holds the source URL
(``fimgs.net/mdimg/sastojci/o.<id>.jpg`` or ``t.<id>.jpg``); the thumbnail form is ``t.<id>.jpg``.
Wikipedia/Commons images:     notes.image_source is "<article url> File:<name> | <licence> | <author>".
Bottles:                      https://fimgs.net/mdimg/perfume/375x500.<fragrantica_id>.jpg

No image bytes ever touch this server or its disk in remote mode: the browser loads them directly.
"""
from __future__ import annotations

import hashlib
import re
from urllib.parse import quote

BOTTLE_URL = "https://fimgs.net/mdimg/perfume/375x500.{fid}.jpg"
NOTE_THUMB_URL = "https://fimgs.net/mdimg/sastojci/t.{id}.jpg"
WIKI_THUMB_WIDTH = 330  # one of Wikimedia's standard thumbnail steps

_FIMGS_NOTE = re.compile(r"fimgs\.net/mdimg/sastojci/[a-z]\.(\d+)\.(?:jpg|png|webp)", re.I)
_WIKI_FILE = re.compile(r"File:([^|]+?)\s*(?:\||$)")


def bottle_url(fragrantica_id) -> str | None:
    try:
        fid = int(fragrantica_id)
    except (TypeError, ValueError):
        return None
    return BOTTLE_URL.format(fid=fid) if fid > 0 else None


def wikimedia_thumb(filename: str, width: int = WIKI_THUMB_WIDTH) -> str:
    name = filename.strip().replace(" ", "_")
    md5 = hashlib.md5(name.encode("utf-8")).hexdigest()
    q = quote(name, safe="()_-.,!~*'")
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{md5[0]}/{md5[:2]}/{q}/{width}px-{q}"


def note_remote_url(image_source: str | None) -> str | None:
    """Derive the remote thumbnail URL for a note from its ``image_source`` text (None if unknown)."""
    if not image_source:
        return None
    m = _FIMGS_NOTE.search(image_source)
    if m:
        return NOTE_THUMB_URL.format(id=int(m.group(1)))
    if "wikipedia.org" in image_source or "wikimedia.org" in image_source:
        m = _WIKI_FILE.search(image_source)
        if m:
            return wikimedia_thumb(m.group(1))
    return None


def note_credit(image_source: str | None) -> str | None:
    """Human-readable credit for the non-Fragrantica (Wikipedia) note images, else None."""
    if not image_source or _FIMGS_NOTE.search(image_source):
        return None
    m = re.match(r"(\S+)\s+File:([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+)$", image_source.strip())
    if not m:
        return None
    page, fname, licence, author = m.groups()
    return f"{fname.strip()} - {author.strip()} - {licence.strip()} - {page}"
