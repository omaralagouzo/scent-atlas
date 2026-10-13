"""Colors shared by the API payloads and the generated SVG placeholders."""
from __future__ import annotations

import colorsys
import zlib

FAMILY_COLORS = {
    "citrus": "#f2c94c",
    "fruity": "#ef7b45",
    "floral": "#e57fa3",
    "green": "#6fb36f",
    "herbal/aromatic": "#5fa88b",
    "spicy": "#c4492f",
    "woody": "#9a6b3f",
    "resinous/amber": "#c98a3b",
    "musky/animalic": "#b59bb3",
    "gourmand": "#b36a3c",
    "aquatic": "#4fa8cf",
    "other": "#8a8f98",
}

ACCORD_COLORS = {
    "citrus": "#f4e04d", "fruity": "#f0643c", "sweet": "#d9467f", "floral": "#e98bb4",
    "white floral": "#f1d3df", "rose": "#d6476b", "woody": "#8b5a2b", "warm spicy": "#b8452c",
    "fresh spicy": "#d9822b", "aromatic": "#4f9d6b", "green": "#5aa645", "fresh": "#7fd0d9",
    "aquatic": "#4aa3d6", "vanilla": "#f0d9a0", "amber": "#c27a2c", "musky": "#d9c9d6",
    "powdery": "#e6c8d8", "leather": "#6b3e26", "tobacco": "#7a4f2a", "oud": "#4a2c1a",
    "earthy": "#6d5a3c", "balsamic": "#9a6a3a", "gourmand": "#a0522d", "coffee": "#5a3a2a",
    "almond": "#d7b48a", "smoky": "#6a6a72", "tropical": "#f7a83a", "yellow floral": "#f2d44c",
    "iris": "#b7a4d6", "lavender": "#9a86d1", "patchouli": "#6b5b3a", "mineral": "#9aa4ad",
    "salty": "#a7cfd6", "honey": "#e3a72f", "animalic": "#7d5a4a", "cherry": "#b0173a",
    "coconut": "#efe6d2", "sour": "#c6d94a", "aldehydic": "#dfe6ea", "cacao": "#5b3425",
    "boozy": "#a8553a", "metallic": "#aab4be", "ozonic": "#bfe3ee", "soapy": "#cfe9e4",
    "caramel": "#c68a3c", "chocolate": "#5b3425", "marine": "#4aa3d6", "terpenic": "#6fa67a",
    "herbal": "#5fa88b", "camphor": "#c9e3dc", "lactonic": "#f3e6d0", "rum": "#a8553a",
    "tea": "#9bb06a", "cinnamon": "#a8472a", "spicy": "#c4492f", "musk": "#d9c9d6",
}

DEFAULT_ACCENT = "#c9a96a"


def accord_color(name: str) -> str:
    key = (name or "").strip().lower()
    if key in ACCORD_COLORS:
        return ACCORD_COLORS[key]
    h = (zlib.crc32(key.encode("utf-8")) % 360) / 360.0
    r, g, b = colorsys.hls_to_rgb(h, 0.55, 0.45)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def family_color(family: str | None) -> str:
    return FAMILY_COLORS.get((family or "other").lower(), FAMILY_COLORS["other"])


def shade(hex_color: str, factor: float) -> str:
    """factor < 1 darkens, > 1 lightens (towards white)."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    if factor <= 1:
        r, g, b = (int(c * factor) for c in (r, g, b))
    else:
        t = factor - 1
        r, g, b = (int(c + (255 - c) * t) for c in (r, g, b))
    return "#%02x%02x%02x" % (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
