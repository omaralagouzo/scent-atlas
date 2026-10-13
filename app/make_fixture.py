"""Build app/fixture.db: a small, realistic stand-in for data/master.db.

~60 well-known perfumes with plausible (approximate, hand-typed) pyramids.
Same schema as SPEC.md. Run:  python make_fixture.py [out_path]

image_url is left NULL on purpose: the fragrantica ids here are not real, and
showing the wrong bottle would be worse than the generated placeholder.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE / "fixture.db"

SCHEMA = """
CREATE TABLE perfumes (
  id INTEGER PRIMARY KEY, fragrantica_id INTEGER, name TEXT NOT NULL, brand TEXT NOT NULL,
  year INTEGER, gender TEXT, country TEXT, rating REAL, rating_count INTEGER, url TEXT,
  image_url TEXT, perfumers TEXT, accords TEXT, sources TEXT
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, family TEXT,
  perfume_count INTEGER NOT NULL DEFAULT 0, image_local TEXT, image_source TEXT
);
CREATE TABLE perfume_notes (
  perfume_id INTEGER NOT NULL REFERENCES perfumes(id),
  note_id INTEGER NOT NULL REFERENCES notes(id),
  layer TEXT NOT NULL CHECK (layer IN ('top','middle','base','general')),
  position INTEGER,
  PRIMARY KEY (perfume_id, note_id, layer)
);
CREATE INDEX idx_pn_note ON perfume_notes(note_id);
CREATE INDEX idx_perfumes_brand ON perfumes(brand);
"""

# name|brand|year|gender|country|rating|votes|perfumers|top:..|mid:..|base:..   (or  all:.. for general)
PERFUMES = """
Aventus|Creed|2010|men|France|4.28|24100|Olivier Creed, Erwin Creed|top:Pineapple,Bergamot,Black Currant,Apple|mid:Birch,Patchouli,Jasmine,Rose|base:Musk,Oakmoss,Ambergris,Vanilla
Sauvage|Dior|2015|men|France|4.05|31800|Francois Demachy|top:Bergamot,Pepper|mid:Sichuan Pepper,Lavender,Pink Pepper,Vetiver,Patchouli,Geranium,Elemi|base:Ambroxan,Cedar,Labdanum
Bleu de Chanel|Chanel|2010|men|France|4.18|19200|Jacques Polge|top:Grapefruit,Lemon,Mint,Pink Pepper|mid:Ginger,Nutmeg,Jasmine,Iso E Super|base:Incense,Vetiver,Cedar,Sandalwood,Patchouli,Labdanum,White Musk
Chanel No 5|Chanel|1921|women|France|4.12|17900|Ernest Beaux|top:Aldehydes,Ylang-Ylang,Neroli,Bergamot,Lemon|mid:Jasmine,Rose,Lily-of-the-Valley,Iris|base:Sandalwood,Vanilla,Vetiver,Amber,Cedar,Patchouli
Black Opium|Yves Saint Laurent|2014|women|France|4.02|20400|Nathalie Lorson, Marie Salamagne, Honorine Blanc, Olivier Cresp|top:Pear,Pink Pepper,Orange Blossom|mid:Coffee,Jasmine,Bitter Almond,Licorice|base:Vanilla,Patchouli,Cedar,Cashmere Wood
La Vie Est Belle|Lancome|2012|women|France|4.01|22300|Olivier Polge, Dominique Ropion, Anne Flipo|top:Black Currant,Pear|mid:Iris,Jasmine,Orange Blossom|base:Praline,Vanilla,Patchouli,Tonka Bean
Angel|Mugler|1992|women|France|4.05|15600|Olivier Cresp, Yves de Chiris|top:Bergamot,Black Currant,Melon,Coconut|mid:Honey,Peach,Blackberry,Rose|base:Patchouli,Chocolate,Caramel,Vanilla,Tonka Bean,Amber
Alien|Mugler|2005|women|France|4.07|12100|Dominique Ropion, Laurent Bruyere|top:Jasmine|mid:Cashmeran,Woody Notes|base:White Amber
J'adore|Dior|1999|women|France|4.10|18800|Calice Becker|top:Pear,Melon,Peach,Bergamot,Mandarin|mid:Jasmine,Lily-of-the-Valley,Tuberose,Plum,Rose,Orchid|base:Musk,Vanilla,Blackberry,Cedar
Coco Mademoiselle|Chanel|2001|women|France|4.15|21900|Jacques Polge|top:Orange,Bergamot,Mandarin,Grapefruit|mid:Jasmine,Rose,Ylang-Ylang,Mimosa|base:Patchouli,Vetiver,Vanilla,Tonka Bean,White Musk,Opoponax
Libre|Yves Saint Laurent|2019|women|France|4.17|9800|Anne Flipo, Carlos Benaim, Juliette Karagueuzoglou|top:Lavender,Mandarin,Bergamot,Black Currant|mid:Orange Blossom,Jasmine|base:Vanilla,Tonka Bean,Musk,Ambergris,Cedar
Good Girl|Carolina Herrera|2016|women|Spain|4.08|10400|Louise Turner, Quentin Bisch|top:Almond,Coffee,Bergamot,Lemon|mid:Tuberose,Jasmine,Orange Blossom,Iris,Rose|base:Tonka Bean,Cacao,Vanilla,Sandalwood,Patchouli
Flowerbomb|Viktor&Rolf|2005|women|Netherlands|4.12|11800|Carlos Benaim, Domitille Bertier, Olivier Polge|top:Bergamot,Tea|mid:Freesia,Jasmine,Orchid,Rose,Osmanthus|base:Patchouli,Musk
Light Blue|Dolce&Gabbana|2001|women|Italy|3.87|19700|Olivier Cresp|top:Lemon,Apple,Cedar,Bellflower|mid:Jasmine,White Rose,Bamboo|base:Cedar,Musk,Amber
Acqua di Gio|Giorgio Armani|1996|men|Italy|4.02|25600|Alberto Morillas, Annick Menardo|top:Lime,Lemon,Bergamot,Neroli,Orange,Green Tangerine|mid:Marine Notes,Jasmine,Rosemary,Peach,Freesia|base:White Musk,Cedar,Oakmoss,Amber,Patchouli
Terre d'Hermes|Hermes|2006|men|France|4.17|16300|Jean-Claude Ellena|top:Orange,Grapefruit|mid:Pepper,Geranium,Flint|base:Vetiver,Cedar,Patchouli,Benzoin
Tobacco Vanille|Tom Ford|2007|unisex|USA|4.34|10900|Harry Fremont|top:Tobacco,Ginger,Cinnamon|mid:Vanilla,Cacao,Tonka Bean|base:Dried Fruits,Woody Notes,Amber
Oud Wood|Tom Ford|2007|unisex|USA|4.20|9100|Richard Herpin, Antoine Maisondieu|top:Rosewood,Cardamom,Sichuan Pepper|mid:Oud,Sandalwood,Vetiver|base:Tonka Bean,Amber,Vanilla
Black Orchid|Tom Ford|2006|unisex|USA|4.06|11000|David Apel, Pierre Negrin|top:Truffle,Black Currant,Bergamot,Ylang-Ylang|mid:Black Orchid,Lotus,Spices|base:Patchouli,Vanilla,Sandalwood,Incense,Dark Chocolate
Lost Cherry|Tom Ford|2018|unisex|USA|4.27|10700|Louise Turner, Givaudan|top:Black Cherry,Bitter Almond,Cherry Liqueur|mid:Turkish Rose,Jasmine,Plum|base:Tonka Bean,Peru Balsam,Sandalwood,Cedar,Vetiver
Baccarat Rouge 540|Maison Francis Kurkdjian|2015|unisex|France|4.30|13500|Francis Kurkdjian|top:Jasmine,Saffron|mid:Amberwood,Ambergris|base:Fir Resin,Cedar
Silver Mountain Water|Creed|1995|unisex|France|4.12|7400|Olivier Creed|top:Bergamot,Mandarin,Black Currant,Green Tea|mid:Green Tea,Neroli|base:Musk,Sandalwood,Galbanum
Green Irish Tweed|Creed|1985|men|France|4.09|8200|Olivier Creed|top:Lemon Verbena,Iris|mid:Violet Leaf,Iris|base:Sandalwood,Ambergris
Un Jardin sur le Nil|Hermes|2005|unisex|France|3.95|7800|Jean-Claude Ellena|top:Grapefruit,Green Mango,Lotus|mid:Lotus,Peony,Calamus|base:Incense,Musk,Sandalwood
Fahrenheit|Dior|1988|men|France|4.10|9300|Jean-Louis Sieuzac, Michel Almairac|top:Lemon,Mandarin,Bergamot,Lavender,Nutmeg|mid:Violet Leaf,Honeysuckle,Cedar,Jasmine|base:Leather,Vetiver,Musk,Amber
Dior Homme Intense|Dior|2011|men|France|4.38|10200|Francois Demachy|top:Lavender|mid:Iris,Ambrette,Pear|base:Vetiver,Cedar,Vanilla,Leather
Prada L'Homme|Prada|2016|men|Italy|4.00|7600|Daniela Andrier|top:Neroli,Black Pepper,Cardamom|mid:Iris,Geranium,Violet|base:Patchouli,Amber,Cedar
Infusion d'Iris|Prada|2007|women|Italy|4.10|7200|Daniela Andrier|top:Orange Blossom,Mandarin,Galbanum,Bergamot|mid:Iris,Cedar,Neroli|base:Incense,Vetiver,Benzoin,Sandalwood
For Her|Narciso Rodriguez|2003|women|USA|4.00|13300|Francis Kurkdjian, Christine Nagel|top:Bergamot,Orange Blossom,Osmanthus|mid:Musk,Amber,Rose,Peach|base:Musk,Patchouli,Vetiver,Vanilla
English Pear & Freesia|Jo Malone London|2010|unisex|United Kingdom|3.95|6900|Christine Nagel|top:Pear,Melon|mid:Freesia,Rose|base:Amber,Patchouli,Musk,Rhubarb
Wood Sage & Sea Salt|Jo Malone London|2014|unisex|United Kingdom|4.00|6100|Christine Nagel|top:Ambrette,Grapefruit|mid:Sea Salt,Sage|base:Red Algae,Driftwood,Musk
Santal 33|Le Labo|2011|unisex|USA|4.02|8700|Frank Voelkl|top:Cardamom,Violet,Iris|mid:Papyrus,Cedar|base:Sandalwood,Leather,Amber,Musk
Another 13|Le Labo|2010|unisex|USA|3.98|8300|Nicolas Beaulieu|all:Ambroxan,Jasmine,Moss,Ambrette,Musk
Gypsy Water|Byredo|2008|unisex|Sweden|4.12|8900|Jerome Epinette|top:Bergamot,Lemon,Pepper,Juniper Berry|mid:Incense,Pine Needles,Iris|base:Amber,Vanilla,Sandalwood
Bal d'Afrique|Byredo|2009|unisex|Sweden|4.18|9200|Jerome Epinette|top:Bergamot,Lemon,Bigarade,Marigold,Cyclamen|mid:Violet,Jasmine,Neroli|base:Vetiver,Musk,Amber,Cedar,Black Amber
Mojave Ghost|Byredo|2014|unisex|Sweden|4.03|7800|Jerome Epinette|top:Ambrette,Sapodilla,Violet|mid:Sandalwood,Magnolia,Musk|base:Cedar,Crystal Musk,Amber
Philosykos|Diptyque|1996|unisex|France|4.05|7000|Olivia Giacobetti|top:Fig Leaf,Green Notes|mid:Fig,Coconut|base:Cedar,Woody Notes
Do Son|Diptyque|2005|women|France|4.05|5600|Olivia Giacobetti|top:Orange Blossom,Pink Pepper|mid:Tuberose,Jasmine,Iris|base:Musk,Benzoin
By the Fireplace|Maison Margiela|2015|unisex|France|4.25|13000|Maurice Roucel|top:Pink Pepper,Orange Blossom,Clove|mid:Chestnut,Guaiac Wood,Cashmeran|base:Vanilla,Peru Balsam,Benzoin,Smoke
Jazz Club|Maison Margiela|2013|men|France|4.18|10100|Alienor Massenet|top:Pink Pepper,Lemon,Neroli|mid:Rum,Clary Sage,Vetiver|base:Tobacco,Vanilla,Styrax
Lazy Sunday Morning|Maison Margiela|2012|women|France|4.04|9700|Aurelien Guichard|top:Pear,Lemon,Aldehydes|mid:Iris,Rose,Orange Blossom|base:White Musk,Ambrette,Patchouli
Bloom|Gucci|2017|women|Italy|3.90|6200|Alberto Morillas|top:Jasmine|mid:Tuberose,Rangoon Creeper|base:Orris,Musk
Legend|Montblanc|2011|men|Germany|3.85|7100|Olivier Cresp|top:Lavender,Pineapple,Bergamot,Lemon|mid:Oakmoss,Geranium,Rose|base:Sandalwood,Tonka Bean,Musk
1 Million|Rabanne|2008|men|France|3.90|18400|Christophe Raynaud, Michel Girard, Olivier Pescheux|top:Grapefruit,Mint,Blood Orange|mid:Cinnamon,Rose,Spices|base:Amber,Leather,Patchouli,Woody Notes
Invictus|Rabanne|2013|men|France|3.82|15200|Veronique Nyberg, Anne Flipo, Olivier Polge|top:Grapefruit,Marine Notes,Mandarin|mid:Bay Leaf,Jasmine|base:Guaiac Wood,Oakmoss,Patchouli,Ambergris
Eros|Versace|2012|men|Italy|4.02|17100|Aurelien Guichard|top:Mint,Green Apple,Lemon|mid:Tonka Bean,Ambroxan,Geranium|base:Vanilla,Vetiver,Oakmoss,Cedar
Si|Giorgio Armani|2013|women|Italy|4.00|12600|Christine Nagel, Juliette Karagueuzoglou|top:Black Currant,Mandarin,Bergamot|mid:Rose,Freesia|base:Vanilla,Patchouli,Amber,Musk,Woody Notes
Idole|Lancome|2019|women|France|3.95|4900|Shyamala Maisondieu, Adrien Bolo|top:Pear,Bergamot,Pink Pepper|mid:Jasmine,Rose|base:Vanilla,White Musk,Cedar
Daisy|Marc Jacobs|2007|women|USA|3.92|11500|Alberto Morillas|top:Strawberry,Violet Leaf,Grapefruit|mid:Jasmine,Gardenia,Violet|base:Musk,Vanilla,Woody Notes
Hypnotic Poison|Dior|1998|women|France|4.05|9900|Annick Menardo|top:Coconut,Plum,Apricot,Bitter Almond|mid:Jasmine,Tuberose,Rosewood|base:Vanilla,Sandalwood,Musk
Shalimar|Guerlain|1925|women|France|4.15|10400|Jacques Guerlain|top:Bergamot,Lemon,Mandarin|mid:Jasmine,Rose,Iris|base:Vanilla,Tonka Bean,Opoponax,Incense,Leather,Sandalwood
Mitsouko|Guerlain|1919|women|France|4.14|6200|Jacques Guerlain|top:Bergamot,Lemon,Orange|mid:Peach,Rose,Jasmine,Ylang-Ylang|base:Oakmoss,Cedar,Vetiver,Patchouli,Amber
Mon Guerlain|Guerlain|2017|women|France|4.05|6800|Thierry Wasser, Delphine Jelk|top:Lavender,Bergamot|mid:Jasmine,Iris|base:Vanilla,Sandalwood,Tonka Bean,Patchouli,Musk
Ambre Sultan|Serge Lutens|2000|unisex|France|4.22|4400|Christopher Sheldrake|top:Bergamot,Myrrh,Coriander|mid:Amber,Labdanum|base:Vanilla,Sandalwood,Patchouli,Benzoin
Interlude Man|Amouage|2012|men|Oman|4.30|6400|Pierre Negrin|top:Bergamot,Pepper,Oregano|mid:Frankincense,Amber,Opoponax|base:Oud,Leather,Patchouli,Sandalwood,Vanilla
Naxos|Xerjoff|2015|unisex|Italy|4.45|7500|Chris Maurice|top:Lavender,Bergamot,Lemon,Cinnamon|mid:Honey,Cashmeran,Jasmine|base:Tobacco,Vanilla,Tonka Bean,Leather
Layton|Parfums de Marly|2016|men|France|4.25|9600|Nicolas Beaulieu, Hamid Merati-Kashani|top:Apple,Lavender,Bergamot,Mandarin|mid:Geranium,Violet,Jasmine|base:Vanilla,Cardamom,Sandalwood,Pepper,Guaiac Wood,Patchouli
Delina|Parfums de Marly|2017|women|France|4.28|9100|Quentin Bisch|top:Lychee,Rhubarb,Bergamot,Nutmeg|mid:Turkish Rose,Peony,Vanilla,Musk|base:Cashmeran,Cedar,Sandalwood,Incense
Chloe Eau de Parfum|Chloe|2008|women|France|4.03|9000|Michel Almairac, Amandine Marie|top:Peony,Lychee,Freesia|mid:Rose,Magnolia,Lily-of-the-Valley|base:Cedar,Amber,Musk,Honey
Khamrah|Lattafa|2022|unisex|United Arab Emirates|4.33|8800|Unknown|top:Cinnamon,Nutmeg,Bergamot|mid:Date,Praline,Tuberose|base:Vanilla,Tonka Bean,Amberwood,Benzoin,Myrrh
Le Male|Jean Paul Gaultier|1995|men|France|4.05|20200|Francis Kurkdjian|top:Lavender,Mint,Bergamot,Cardamom|mid:Orange Blossom,Cinnamon,Cumin|base:Vanilla,Tonka Bean,Sandalwood,Amber,Cedar
Acqua di Gioia|Giorgio Armani|2010|women|Italy|3.78|5100|Alberto Morillas|top:Lemon,Mint,Mandarin|mid:Jasmine,Peony|base:Cedar,Musk
""".strip()

# ---- note -> family
FAMILIES = {
    "citrus": "Bergamot,Lemon,Orange,Mandarin,Grapefruit,Lime,Bigarade,Lemon Verbena,Green Tangerine,Blood Orange",
    "fruity": "Pear,Apple,Pineapple,Black Currant,Peach,Plum,Apricot,Melon,Lychee,Strawberry,Blackberry,Black Cherry,Cherry Liqueur,Green Apple,Fig,Green Mango,Dried Fruits,Coconut,Rhubarb,Date,Sapodilla",
    "floral": "Jasmine,Rose,Ylang-Ylang,Lily-of-the-Valley,Orange Blossom,Neroli,Tuberose,Orchid,Iris,Violet,Magnolia,Freesia,Peony,Gardenia,Osmanthus,Mimosa,Turkish Rose,White Rose,Black Orchid,Lotus,Marigold,Cyclamen,Bellflower,Rangoon Creeper,Orris,Honeysuckle",
    "green": "Violet Leaf,Fig Leaf,Green Tea,Galbanum,Green Notes,Bamboo,Pine Needles,Calamus,Tea",
    "herbal/aromatic": "Lavender,Mint,Sage,Clary Sage,Rosemary,Geranium,Oregano,Bay Leaf,Juniper Berry",
    "spicy": "Pink Pepper,Black Pepper,Pepper,Sichuan Pepper,Cardamom,Cinnamon,Nutmeg,Ginger,Clove,Saffron,Coriander,Cumin,Spices",
    "woody": "Cedar,Sandalwood,Vetiver,Patchouli,Oud,Guaiac Wood,Cashmeran,Cashmere Wood,Birch,Rosewood,Amberwood,Papyrus,Iso E Super,Oakmoss,Moss,Woody Notes,Driftwood,Fir Resin",
    "resinous/amber": "Amber,Black Amber,White Amber,Ambroxan,Incense,Frankincense,Myrrh,Benzoin,Labdanum,Opoponax,Peru Balsam,Styrax,Elemi",
    "musky/animalic": "Musk,White Musk,Crystal Musk,Ambrette,Ambergris",
    "gourmand": "Vanilla,Tonka Bean,Cacao,Dark Chocolate,Chocolate,Coffee,Praline,Caramel,Honey,Bitter Almond,Almond,Licorice,Rum,Chestnut,Truffle",
    "aquatic": "Marine Notes,Sea Salt,Red Algae",
    "other": "Tobacco,Leather,Smoke,Aldehydes,Flint",
}
NOTE_FAMILY = {n.strip(): fam for fam, ns in FAMILIES.items() for n in ns.split(",")}

# ---- note -> accord name (fallback: family accord)
FAMILY_ACCORD = {
    "citrus": "citrus", "fruity": "fruity", "floral": "floral", "green": "green", "herbal/aromatic": "aromatic",
    "spicy": "warm spicy", "woody": "woody", "resinous/amber": "balsamic", "musky/animalic": "musky",
    "gourmand": "sweet", "aquatic": "aquatic", "other": "earthy",
}
NOTE_ACCORD = {
    "Vanilla": "vanilla", "Oud": "oud", "Leather": "leather", "Tobacco": "tobacco", "Rose": "rose",
    "Turkish Rose": "rose", "White Rose": "rose", "Jasmine": "white floral", "Tuberose": "white floral",
    "Orange Blossom": "white floral", "Gardenia": "white floral", "Magnolia": "white floral", "Ylang-Ylang": "white floral",
    "Iris": "powdery", "Violet": "powdery", "Orris": "powdery", "Patchouli": "patchouli", "Amber": "amber",
    "Ambergris": "amber", "Ambroxan": "amber", "White Amber": "amber", "Black Amber": "amber",
    "Pink Pepper": "fresh spicy", "Pepper": "fresh spicy", "Black Pepper": "fresh spicy", "Sichuan Pepper": "fresh spicy",
    "Cardamom": "fresh spicy", "Coconut": "coconut", "Cacao": "cacao", "Dark Chocolate": "cacao", "Chocolate": "cacao",
    "Coffee": "coffee", "Bitter Almond": "almond", "Almond": "almond", "Honey": "honey", "Mint": "fresh",
    "Aldehydes": "aldehydic", "Smoke": "smoky", "Sea Salt": "salty", "Marine Notes": "aquatic",
    "Lavender": "lavender", "Peach": "fruity", "Lotus": "aquatic", "Incense": "balsamic",
    "Cedar": "woody", "Sandalwood": "woody", "Vetiver": "woody", "Tonka Bean": "sweet", "Praline": "sweet",
    "Caramel": "sweet", "Black Orchid": "white floral", "Oakmoss": "earthy", "Moss": "earthy", "Truffle": "earthy",
    "Date": "sweet", "Licorice": "sweet", "Rum": "boozy",
}
LAYER_W = {"top": 0.8, "middle": 1.0, "base": 1.1, "general": 1.0}


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse_line(line: str):
    parts = line.split("|")
    name, brand, year, gender, country, rating, votes, perfumers = parts[:8]
    layers: dict[str, list[str]] = {}
    for seg in parts[8:]:
        key, _, val = seg.partition(":")
        layer = {"top": "top", "mid": "middle", "base": "base", "all": "general"}[key]
        layers[layer] = [v.strip() for v in val.split(",") if v.strip()]
    return dict(name=name, brand=brand, year=int(year), gender=gender, country=country,
                rating=float(rating), votes=int(votes), perfumers=[p.strip() for p in perfumers.split(",")],
                layers=layers)


def make_accords(layers: dict[str, list[str]]):
    acc: dict[str, float] = {}
    for layer, notes in layers.items():
        for pos, n in enumerate(notes):
            name = NOTE_ACCORD.get(n) or FAMILY_ACCORD[NOTE_FAMILY.get(n, "other")]
            acc[name] = acc.get(name, 0.0) + LAYER_W[layer] * (1.0 - 0.04 * pos)
    if not acc:
        return []
    top = max(acc.values())
    ranked = sorted(acc.items(), key=lambda kv: -kv[1])[:6]
    out = [{"name": k, "strength": round(max(0.18, (v / top) ** 0.85), 2)} for k, v in ranked]
    return out


def build(out_path: Path = DEFAULT_OUT) -> Path:
    out_path = Path(out_path)
    if out_path.exists():
        out_path.unlink()
    perfumes = [parse_line(l) for l in PERFUMES.splitlines() if l.strip()]

    # collect notes
    note_names: dict[str, int] = {}
    for p in perfumes:
        for ns in p["layers"].values():
            for n in ns:
                if n not in NOTE_FAMILY:
                    raise SystemExit(f"note without family: {n!r}")
                note_names.setdefault(n, 0)
    con = sqlite3.connect(out_path)
    con.executescript(SCHEMA)
    note_id = {}
    for i, n in enumerate(sorted(note_names), start=1):
        note_id[n] = i
    counts: dict[str, set] = {n: set() for n in note_id}
    for pid, p in enumerate(perfumes, start=1):
        for ns in p["layers"].values():
            for n in ns:
                counts[n].add(pid)
    con.executemany(
        "INSERT INTO notes(id,slug,name,family,perfume_count,image_local,image_source) VALUES (?,?,?,?,?,NULL,NULL)",
        [(note_id[n], slugify(n), n, NOTE_FAMILY[n], len(counts[n])) for n in note_id],
    )
    for pid, p in enumerate(perfumes, start=1):
        con.execute(
            "INSERT INTO perfumes(id,fragrantica_id,name,brand,year,gender,country,rating,rating_count,url,image_url,perfumers,accords,sources)"
            " VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)",
            (pid, None, p["name"], p["brand"], p["year"], p["gender"], p["country"], p["rating"], p["votes"],
             json.dumps(p["perfumers"]), json.dumps(make_accords(p["layers"])), json.dumps(["fixture"])),
        )
        rows = []
        seen = set()
        for layer, ns in p["layers"].items():
            for pos, n in enumerate(ns):
                if (note_id[n], layer) in seen:
                    continue
                seen.add((note_id[n], layer))
                rows.append((pid, note_id[n], layer, pos))
        con.executemany("INSERT INTO perfume_notes VALUES (?,?,?,?)", rows)
    con.commit()
    n_pn = con.execute("SELECT COUNT(*) FROM perfume_notes").fetchone()[0]
    con.close()
    print(f"fixture: {len(perfumes)} perfumes, {len(note_id)} notes, {n_pn} perfume_notes -> {out_path}")
    return out_path


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
