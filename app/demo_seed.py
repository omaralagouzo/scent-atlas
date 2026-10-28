"""Realistic made-up data for the development environment (SEED_DEMO=1): members with names and photos, shelves,
rankings, wishlists, hearts, reviews, friendships, notifications and page views - the same shape as production,
with no real person in it. Runs once, on an empty user database, in the background after start-up.

Every demo account's password is DEMO_PASSWORD. Never enable this in production (it refuses to run when the
database already has accounts, so it can never touch real data).
"""
from __future__ import annotations

import io
import logging
import random
import time

from PIL import Image, ImageDraw

import auth
import avatar

log = logging.getLogger("scent-atlas.seed")
DEMO_PASSWORD = "scent-atlas-demo"

FIRST = ["Omar", "Karim", "Lina", "Sara", "Yousef", "Maya", "Hana", "Ali", "Nour", "Rami", "Dina", "Tariq", "Layla",
         "Zain", "Mona", "Faris", "Rania", "Adam", "Salma", "Hadi", "Jana", "Khalid", "Reem", "Sami", "Aya", "Nadim",
         "Farah", "Yara", "Bilal", "Leen", "Majed", "Hiba", "Ziad", "Tala", "Fadi", "Noor", "Malik", "Ruba", "Jad", "Amal"]
LAST = ["Haddad", "Khoury", "Mansour", "Saleh", "Nasser", "Farouk", "Aziz", "Rahman", "Hassan", "Darwish", "Sabbagh",
        "Kassem", "Odeh", "Barakat", "Hamdan", "Shami", "Qasim", "Jaber", "Toma", "Halabi"]
FAMOUS = ["Sauvage Dior", "Bleu de Chanel", "Aventus Creed", "Santal 33", "Baccarat Rouge 540", "Tobacco Vanille",
          "Black Opium", "Lost Cherry", "Light Blue Dolce", "Oud Wood", "Erba Pura", "Libre Yves", "Y Eau de Parfum",
          "La Nuit de L'Homme", "Acqua di Gio Profumo", "Terre d'Hermes", "Grand Soir", "Spicebomb", "Le Male Elixir",
          "Khamrah", "Hawas", "Club de Nuit Intense", "Layton", "Naxos", "Interlude Man", "Wanted by Night", "Eros Versace",
          "The One Dolce", "Stronger With You", "Allure Homme Sport", "Good Girl Carolina", "Delina Parfums de Marly",
          "Angels' Share", "Ombre Leather", "Mon Paris", "Si Armani", "Cloud Ariana", "Asad Lattafa", "Amber Oud Al Haramain",
          "Fakhar Lattafa", "Shaghaf Oud", "Oud Mood", "Hacivat", "Reflection Man", "Velvet Desert Oud"]
REVIEWS = ["Lasts all day on me and the compliments never stop.", "Gorgeous opening, but it fades to a skin scent by lunch.",
           "A little too sweet for the office; perfect on evenings out.", "My signature. Clean, fresh and effortless.",
           "Nice, but I expected more for the price.", "Projection is huge: two sprays is plenty.",
           "Smells like a warm bakery with a smoky edge.", "Great for the summer heat here.", "Bought a decant first; now a full bottle.",
           None, None]
TZS = ["Asia/Dubai"] * 6 + ["Asia/Riyadh", "Africa/Cairo", "Europe/London", "America/Toronto", "Asia/Amman"]
PATHS = ["/notes", "/like", "/layering", "/combine", "/pyramid", "/people", "/friends", "/collection", "/about", "/note/rose",
         "/note/oud", "/note/vanilla", "/note/amber", "/note/bergamot"]
UA = [("phone", "Safari"), ("phone", "Chrome"), ("phone", "Instagram app"), ("desktop", "Chrome"), ("desktop", "Safari"), ("tablet", "Safari")]


def _photo(rng: random.Random) -> bytes:
    """An abstract portrait-like avatar (head and shoulders on a colour), processed like a real upload."""
    hue = rng.randrange(360)
    import colorsys
    def col(l, s=0.45):
        r, g, b = colorsys.hls_to_rgb(hue / 360, l, s)
        return int(r * 255), int(g * 255), int(b * 255)
    im = Image.new("RGB", (600, 600), col(0.42))
    d = ImageDraw.Draw(im)
    d.ellipse((190, 120, 410, 340), fill=col(0.72, 0.35))
    d.ellipse((90, 380, 510, 800), fill=col(0.72, 0.35))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return avatar.process(buf.getvalue())


def seed(store, cat, members: int = 40, rng_seed: int = 7) -> bool:
    """Fill an empty user database with demo data. Returns False (and does nothing) if any account exists."""
    if store.count_users():
        return False
    t0 = time.time()
    rng = random.Random(rng_seed)
    ids = []
    for q in FAMOUS:
        r = cat.find_perfumes(q, 1)
        if r and r[0]["id"] not in ids:
            ids.append(r[0]["id"])
    pw_hash = auth.hash_password(DEMO_PASSWORD)          # one hash for everyone: seeding stays fast
    now = int(time.time())
    users = []
    used = set()
    for k in range(members):
        first, last = FIRST[k % len(FIRST)], rng.choice(LAST)
        username = f"{first.lower()}{'' if k < len(FIRST) else k}"
        while username in used:
            username += str(rng.randrange(10))
        used.add(username)
        named = k % 9 != 8                                 # a few old-style accounts still called "User Name"
        u = store.create_user(username, f"{username}@demo.scentatlas.app", pw_hash,
                              first if named else None, last if named else None)
        if rng.random() < 0.6:
            store.set_avatar(u["id"], _photo(rng), "image/webp")
        users.append(u["id"])

    for n, uid in enumerate(users):
        size = [24, 14, 9, 6, 4][n] if n < 5 else rng.choice([0, 1, 2, 3, 5, 8, 12])
        mine = rng.sample(ids, min(size, len(ids)))
        for pid in mine:
            store.put_status(uid, pid, {"status": "owned"})
        if mine:
            store.set_collection_order(uid, mine[: max(1, len(mine) * 2 // 3)])
        rest = [p for p in ids if p not in mine]
        for pid in rng.sample(rest, min(len(rest), rng.randint(0, 4))):
            store.put_status(uid, pid, {"status": rng.choice(["wishlist", "wishlist", "tried"])})
        for pid in rng.sample(ids, rng.randint(0, 4)):
            store.set_favorite(uid, "perfume", str(pid), True)
        for pid in rng.sample(ids, rng.randint(0, 5)):
            store.put_review(uid, pid, rng.choice([3, 4, 4, 5, 5]), rng.choice([None, 2, 3, 4, 5]),
                             rng.choice([None, 2, 3, 4, 5]), rng.choice(REVIEWS))

    # friendships: the first few demo members know each other; a couple of open requests make the bell ring
    for a in range(6):
        for b in range(a + 1, 6):
            if rng.random() < 0.7:
                store.request_friend(users[a], users[b])
                store.request_friend(users[b], users[a])
    for a, b in ((7, 0), (8, 0), (9, 1)):
        store.request_friend(users[a], users[b])
        store.notify(users[b], "friend_request", users[a])
    for _ in range(60):
        a, b = rng.sample(users, 2)
        store.request_friend(a, b)
        store.request_friend(b, a)

    # about a month of page views, so the admin dashboard has something to show
    for day in range(30, -1, -1):
        for _ in range(rng.randint(5, 14) + (30 - day) // 3):
            uid = rng.choice(users) if rng.random() < 0.55 else None
            visitor = f"demo{uid:06d}x" if uid else f"anon{rng.randint(1, 80):06d}"
            dev, br = rng.choice(UA)
            t = now - day * 86400 - rng.randint(0, 80000 if day else 7200)
            ref = rng.choice([None] * 5 + ["instagram.com", "whatsapp.com", "google.com"])
            for k in range(rng.randint(1, 6)):
                path = rng.choice(PATHS + [f"/perfume/{rng.choice(ids)}" for _ in range(4)])
                store.add_view({"ts": t + k * rng.randint(15, 120), "visitor": visitor, "session": visitor[:10] + str(day),
                                "user_id": uid, "path": path, "ref_host": ref if k == 0 else None,
                                "device": dev, "browser": br, "tz": rng.choice(TZS)})
    log.warning("demo data seeded: %d members, %d perfumes, %.1fs", len(users), len(ids), time.time() - t0)
    return True
