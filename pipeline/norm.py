"""Normalisation helpers shared by the adapters and build_master.py."""
import ast
import json
import re
import unicodedata

from ftfy import fix_text
from unidecode import unidecode

# ---------------------------------------------------------------- text cleaning

_WS = re.compile(r"\s+")


def clean_text(s):
    """Fix mojibake/encoding junk, normalise unicode + whitespace. Returns '' for null-ish values."""
    if s is None:
        return ""
    if not isinstance(s, str):
        try:
            if s != s:  # NaN
                return ""
        except Exception:
            pass
        s = str(s)
    if not s.isascii():
        s = fix_text(s)
        s = unicodedata.normalize("NFC", s)
    s = s.replace(" ", " ").replace("​", "")
    s = _WS.sub(" ", s).strip()
    if s.lower() in ("nan", "none", "null", "n/a", "-"):
        return ""
    return s


def slugify(s):
    """lowercase ascii, words joined by '-'"""
    s = unidecode(clean_text(s)).lower()
    s = s.replace("&", " and ").replace("'", "").replace("`", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


# ---------------------------------------------------------------- brand / name keys

BRAND_ALIASES = {
    # normalised-key -> canonical key (all keys are tokens joined without spaces)
    "christiandior": "dior",
    "yvessaintlaurent": "ysl",
    "saintlaurent": "ysl",
    "yslbeaute": "ysl",
    "giorgioarmani": "armani",
    "armanibeauty": "armani",
    "dolcegabbana": "dolcegabbana",
    "maisonmartinmargiela": "maisonmargiela",
    "margiela": "maisonmargiela",
    "maisonmargielareplica": "maisonmargiela",
    "houseofcreed": "creed",
    "tomfordbeauty": "tomford",
    "estee": "esteelauder",
    "lauder": "esteelauder",
    "jeanpaulgaultier": "jeanpaulgaultier",
    "gaultier": "jeanpaulgaultier",
    "paccorabanne": "rabanne",
    "pacorabanne": "rabanne",
    "calvinklein": "calvinklein",
    "ck": "calvinklein",
    "hermes": "hermes",
    "lancome": "lancome",
    "mfk": "maisonfranciskurkdjian",
    "ysl": "ysl",
    "ralphlauren": "ralphlauren",
    "polo": "ralphlauren",
    "dg": "dolcegabbana",
    "cdg": "commedesgarcons",
    "commedesgarcons": "commedesgarcons",
    "penhaligon": "penhaligons",
    "guerlainparis": "guerlain",
    "chanelparis": "chanel",
    "lalique": "lalique",
    "carolinaherreranewyork": "carolinaherrera",
}

_STOP = {"the", "and", "of", "de", "by"}
_BRAND_SUFFIX = {"parfums", "parfum", "perfumes", "perfume", "fragrances", "fragrance", "paris", "parfumeur",
                 "parfumerie", "cosmetics", "beauty", "co", "inc", "ltd", "limited", "gmbh", "sa"}
_GENDER_TAIL = re.compile(r"\s+for\s+(women\s+and\s+men|men\s+and\s+women|women|men|unisex)\s*$", re.I)


def _tokens(s):
    s = unidecode(clean_text(s)).lower()
    s = s.replace("&", " ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return [t for t in s.split() if t]


def norm_brand(s):
    toks = [t for t in _tokens(s) if t not in _STOP]
    while len(toks) > 1 and toks[-1] in _BRAND_SUFFIX:
        toks.pop()
    k = "".join(toks)
    return BRAND_ALIASES.get(k, k)


def strip_gender_tail(s):
    return _GENDER_TAIL.sub("", s or "")


def norm_name(s, brand=None):
    s = strip_gender_tail(clean_text(s))
    toks = [t for t in _tokens(s) if t not in _STOP]
    k = "".join(toks)
    if brand:
        bk = "".join(t for t in _tokens(brand) if t not in _STOP)
        # drop a trailing brand name glued onto the title ("Sauvage Christian Dior")
        if bk and k.endswith(bk) and len(k) > len(bk) + 1:
            k = k[: -len(bk)]
    return k


def name_tokens_for_fuzzy(s):
    return " ".join(t for t in _tokens(strip_gender_tail(s)) if t not in _STOP)


# ---------------------------------------------------------------- misc parsing

def fid_from_url(url):
    if not isinstance(url, str):
        return None
    m = re.search(r"-(\d+)\.html", url)
    return int(m.group(1)) if m else None


def canon_url(url):
    if not isinstance(url, str) or "fragrantica" not in url:
        return None
    url = url.strip().replace("http://", "https://")
    url = re.sub(r"https://(www\.)?fragrantica\.[a-z.]+/", "https://www.fragrantica.com/", url)
    return url


def split_list(v):
    """Robustly split a notes/accords/perfumers cell: python-list string, JSON, '|' or ',' or ';' lists."""
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            out.extend(split_list(x) if not isinstance(x, str) else [x])
        return [clean_text(x) for x in out if clean_text(x)]
    if not isinstance(v, str):
        try:
            if v != v:
                return []
        except Exception:
            pass
        v = str(v)
    s = v.strip()
    if not s or s.lower() in ("nan", "none", "[]", "null"):
        return []
    if s[0] in "[(" and s[-1] in "])":
        for loader in (json.loads, ast.literal_eval):  # literal_eval is safe: literals only
            try:
                r = loader(s)
                if isinstance(r, (list, tuple)):
                    return split_list(list(r))
            except Exception:
                pass
        s = s.strip("[]()")
        s = s.replace("'", "").replace('"', "") if re.search(r"'\s*,\s*'", s) else s
    if "|" in s:
        parts = s.split("|")
    elif ";" in s:
        parts = s.split(";")
    else:
        parts = s.split(",")
    return [clean_text(p.strip(" '\"")) for p in parts if clean_text(p.strip(" '\""))]


def to_int(v):
    try:
        if v is None or v != v:
            return None
        if isinstance(v, str):
            v = v.replace(",", "").strip()
            if not v:
                return None
        return int(float(v))
    except Exception:
        return None


def to_float(v):
    try:
        if v is None or v != v:
            return None
        if isinstance(v, str):
            v = v.replace(",", ".").strip()
            if not v:
                return None
        return float(v)
    except Exception:
        return None


def norm_gender(v):
    s = clean_text(v).lower()
    if not s:
        return None
    if "women" in s and "men" in s.replace("women", ""):
        return "unisex"
    if s in ("women", "woman", "female", "f", "for women", "mujer", "women's") or s.startswith("female"):
        return "women"
    if s in ("men", "man", "male", "m", "for men", "hombre") or s.startswith("male"):
        return "men"
    if "unisex" in s or "both" in s:
        return "unisex"
    if "women" in s:
        return "women"
    if "men" in s:
        return "men"
    return None


def valid_year(y):
    y = to_int(y)
    return y if y and 1500 <= y <= 2035 else None


# ---------------------------------------------------------------- note slugs / synonyms

# Only pure spelling / plural / encoding variants. Fragrantica's distinct note names stay distinct.
NOTE_SLUG_MERGE = {
    # plural variants of the same note
    "clove": "cloves", "citrus": "citruses", "sicilian-citrus": "sicilian-citruses", "resin": "resins",
    "white-wood": "white-woods", "tropical-fruit": "tropical-fruits", "cereal": "cereals",
    "mung-beans": "mung-bean",
    # hyphenation / spacing variants
    "blackcurrant": "black-currant", "oak-moss": "oakmoss", "passion-fruit": "passionfruit",
    "dragonfruit": "dragon-fruit", "cashmir-wood": "cashmirwood", "sea-shells": "seashells",
    "ethyl-vanilin": "ethylvanillin", "panacotta": "panna-cotta",
    # plain misspellings present in the sources
    "sandalowood": "sandalwood", "vanila": "vanilla", "graperfuit": "grapefruit", "marshamallow": "marshmallow",
    "lillac": "lilac", "narciussus": "narcissus", "popocorn": "popcorn", "pitosporum": "pittosporum",
    "terpentine": "turpentine", "white-tabacco": "white-tobacco", "camelia": "camellia", "coton-candy": "cotton-candy",
    "gaiac-wood": "guaiac-wood", "gurjan-balsam": "gurjun-balsam", "mirabella-plum": "mirabelle-plum",
    "virginian-cedar": "virginia-cedar", "californian-orange": "california-orange",
}


def note_slug(name):
    s = slugify(name)
    return NOTE_SLUG_MERGE.get(s, s)


# ---------------------------------------------------------------- note families

FAMILIES = ["citrus", "fruity", "floral", "green", "spicy", "woody", "resinous/amber", "musky/animalic",
            "gourmand", "aquatic", "herbal/aromatic", "other"]

# exact-slug overrides (checked first)
FAMILY_EXACT = {
    "pimento": "spicy", "pimento-seeds": "spicy", "gourmand-accord": "gourmand", "nard": "herbal/aromatic",
    "nard-himalayan-jatamansi": "herbal/aromatic", "jatamansi-or-spikenard": "herbal/aromatic",
    "oriental-notes": "resinous/amber",
    "sweet-orange": "citrus", "sweet-pea": "floral", "litchi": "fruity", "grapes": "fruity", "myrhh": "resinous/amber",
    "palo-santo": "woody", "vetyver": "woody", "hiacynth": "floral", "tulip": "floral", "hawthorn": "floral",
    "fig-tree": "green", "olive-tree": "green", "hedione": "floral", "coumarin": "gourmand", "angelica": "herbal/aromatic",
    "cypriol": "woody", "nagarmotha": "woody", "cypriol-oil-or-nagarmotha": "woody", "costus": "woody",
    "calamus": "herbal/aromatic", "palmarosa": "herbal/aromatic", "shiso": "herbal/aromatic", "timur": "spicy",
    "cannabis": "green", "bubble-gum": "gourmand", "rose-water": "floral", "coconut-water": "gourmand",
    "litsea-cubeba": "citrus", "juniper-berries": "woody", "juniper-berry": "woody", "cupcake": "gourmand",
    "rice": "gourmand", "wheat": "gourmand", "sesame": "gourmand", "aloe-vera": "green", "laurels": "herbal/aromatic",
    "datura": "floral", "nectar": "gourmand", "liquor": "gourmand", "ambrofix": "musky/animalic",
    "orcanox": "musky/animalic", "ambrox-super": "musky/animalic", "ambrettolide": "musky/animalic",
    "hyrax": "musky/animalic", "ambrofix-tm": "musky/animalic", "orcanox-tm": "musky/animalic",
    "orange-blossom": "floral", "neroli": "floral", "bitter-orange": "citrus", "orange": "citrus",
    "lemon-verbena": "herbal/aromatic", "lemongrass": "herbal/aromatic", "citronella": "herbal/aromatic",
    "ginger": "spicy", "pink-pepper": "spicy", "black-pepper": "spicy", "pepper": "spicy", "cardamom": "spicy",
    "cinnamon": "spicy", "saffron": "spicy", "nutmeg": "spicy", "clove": "spicy", "cumin": "spicy",
    "coriander": "spicy", "caraway": "spicy", "turmeric": "spicy", "star-anise": "spicy", "anise": "spicy",
    "aldehydes": "other", "powdery-notes": "other", "powdery": "other", "smoke": "other", "tobacco": "other",
    "leather": "musky/animalic", "suede": "musky/animalic", "ambergris": "musky/animalic",
    "amber": "resinous/amber", "ambroxan": "musky/animalic", "ambrox": "musky/animalic",
    "cashmeran": "woody", "iso-e-super": "woody", "oud": "woody", "agarwood-oud": "woody",
    "patchouli": "woody", "vetiver": "woody", "oakmoss": "green", "moss": "green", "tree-moss": "green",
    "coconut": "gourmand", "tonka-bean": "gourmand", "vanilla": "gourmand", "coffee": "gourmand",
    "almond": "gourmand", "hazelnut": "gourmand", "pistachio": "gourmand", "walnut": "gourmand",
    "peanut": "gourmand", "chestnut": "gourmand", "rum": "gourmand", "whiskey": "gourmand",
    "cognac": "gourmand", "wine": "gourmand", "champagne": "gourmand", "tea": "herbal/aromatic",
    "green-tea": "green", "black-tea": "herbal/aromatic", "white-tea": "herbal/aromatic",
    "mate": "herbal/aromatic", "iris": "floral", "orris": "floral", "orris-root": "floral",
    "violet": "floral", "violet-leaf": "green", "galbanum": "green", "fig-leaf": "green",
    "fig": "fruity", "tomato-leaf": "green", "grass": "green", "cut-grass": "green", "green-notes": "green",
    "cucumber": "aquatic", "watermelon": "aquatic", "melon": "fruity", "sea-notes": "aquatic",
    "sea-buckthorn": "fruity", "salt": "aquatic", "sea-salt": "aquatic", "marine-notes": "aquatic", "ozonic-notes": "aquatic",
    "ozone": "aquatic", "calone": "aquatic", "rain": "aquatic", "water-notes": "aquatic", "seaweed": "aquatic",
    "musk": "musky/animalic", "white-musk": "musky/animalic", "musky-notes": "musky/animalic",
    "civet": "musky/animalic", "castoreum": "musky/animalic", "animalic-notes": "musky/animalic",
    "honey": "gourmand", "beeswax": "gourmand", "caramel": "gourmand", "chocolate": "gourmand",
    "cacao": "gourmand", "praline": "gourmand", "sugar": "gourmand", "cotton-candy": "gourmand",
    "cream": "gourmand", "milk": "gourmand", "butter": "gourmand", "marshmallow": "gourmand",
    "lavender": "herbal/aromatic", "mint": "herbal/aromatic", "peppermint": "herbal/aromatic",
    "basil": "herbal/aromatic", "sage": "herbal/aromatic", "clary-sage": "herbal/aromatic",
    "rosemary": "herbal/aromatic", "thyme": "herbal/aromatic", "artemisia": "herbal/aromatic",
    "wormwood": "herbal/aromatic", "tarragon": "herbal/aromatic", "oregano": "herbal/aromatic",
    "eucalyptus": "herbal/aromatic", "chamomile": "herbal/aromatic", "geranium": "floral",
    "rose": "floral", "jasmine": "floral", "tuberose": "floral", "ylang-ylang": "floral",
    "heliotrope": "floral", "incense": "resinous/amber", "myrrh": "resinous/amber",
    "frankincense": "resinous/amber", "olibanum": "resinous/amber", "benzoin": "resinous/amber",
    "labdanum": "resinous/amber", "elemi": "resinous/amber", "opoponax": "resinous/amber",
    "styrax": "resinous/amber", "tolu-balsam": "resinous/amber", "peru-balsam": "resinous/amber",
    "balsamic-notes": "resinous/amber", "resin": "resinous/amber", "copal": "resinous/amber",
    "pine": "woody", "pine-tree": "woody", "fir": "woody", "juniper": "woody", "cypress": "woody",
    "bamboo": "green", "rhubarb": "fruity", "coconut-milk": "gourmand", "pumpkin": "gourmand",
    "carrot": "other", "tomato": "green", "olive": "green", "pepper-tree": "spicy",
    "cassis": "fruity", "blackcurrant": "fruity", "black-currant": "fruity", "currant": "fruity",
    "sweet-notes": "gourmand", "sweets": "gourmand", "candy": "gourmand",
    "gunpowder": "other", "metallic-notes": "other", "metal": "other", "plastic": "other",
    "rubber": "other", "gasoline": "other", "tar": "woody", "birch-tar": "woody", "cade": "woody",
    "hay": "green", "straw": "green", "tobacco-leaf": "other", "tobacco-blossom": "floral",
    "mushroom": "other", "earthy-notes": "other", "earth": "other", "soil": "other", "clay": "other",
    "dust": "other", "paper": "other", "book": "other", "ink": "other", "cotton": "musky/animalic",
    "linen": "musky/animalic", "soap": "other", "wax": "other", "salt-crystal": "aquatic",
}

# token -> family, checked from the last token of the slug backwards
FAMILY_TOKEN = {}


def _reg(fam, words):
    for w in words.split():
        FAMILY_TOKEN.setdefault(w, fam)


_reg("citrus", "orange oranges bergamot lemon lime grapefruit mandarin tangerine yuzu citron citruses citrus clementine "
     "kumquat pomelo bigarade petitgrain cedrat satsuma bergamote limette zest")
_reg("fruity", "apple pear peach plum apricot cherry berry berries raspberry strawberry blueberry blackberry "
     "cranberry gooseberry pineapple mango banana melon grape lychee passionfruit papaya guava kiwi fruit fruits "
     "fruity quince nectarine pomegranate persimmon tamarind prune date dates raisin currant pitahaya "
     "mirabelle cloudberry lingonberry mulberry elderberry boysenberry jujube loquat durian tangelo "
     "watermelon coconut-water jabuticaba")
_reg("floral", "rose jasmine jasmin tuberose ylang gardenia orchid lily lilies peony magnolia freesia "
     "narcissus lilac hyacinth violet iris orris carnation mimosa osmanthus blossom blossoms flower flowers "
     "floral wisteria honeysuckle hibiscus cyclamen daffodil buttercup chrysanthemum camellia geranium "
     "cherry-blossom frangipani plumeria lotus jonquil lavandin tiare marigold sakura bouvardia "
     "heliotrope foxglove lavender-flower petals petal bellflower anthurium clover dahlia cosmos nasturtium "
     "poppy zinnia amaryllis oleander champaca champak neroli linden lime-blossom acacia broom genet "
     "peonies roses jasmines gladiolus snowdrop primrose waterlily valley")
_reg("green", "green grass leaf leaves foliage galbanum moss oakmoss fern ivy cucumber bamboo herb-green "
     "stems stem sap sprout vegetal tomato-leaf hay clover-green mossy greenery basil-green")
_reg("spicy", "pepper spice spices spicy cardamom cinnamon saffron nutmeg clove cloves cumin coriander ginger "
     "anise paprika chili chilli turmeric allspice cassia mace fenugreek curry wasabi horseradish "
     "peppercorn juniper-berry sichuan szechuan sansho")
_reg("woody", "wood woods woody cedar cedarwood sandalwood sandal vetiver patchouli oud agarwood aoud "
     "guaiac guaiacwood birch oak cypress pine fir teak rosewood ebony mahogany sequoia hinoki cashmeran "
     "driftwood bark timber walnut-wood palisander santal cade papyrus sawdust balsa wenge elm maple "
     "beech ash cashmere cashmere-wood amyris pencil")
_reg("resinous/amber", "amber ambery incense myrrh frankincense olibanum benzoin labdanum resin resins resinous "
     "elemi opoponax styrax balsam balsamic copal mastic galbanum-resin copaiba frankincens gum siam "
     "ladanum ciste cistus tolu peru dragon-blood palo-santo")
_reg("musky/animalic", "musk musky civet castoreum animalic ambergris leather suede skin hide fur "
     "animal cashmere-musk muscone ambrette hyraceum tonquin indole skatole")
_reg("gourmand", "vanilla tonka caramel chocolate cacao cocoa coffee honey sugar candy praline cream milk "
     "butter almond hazelnut pistachio walnut peanut chestnut rum whiskey whisky cognac brandy bourbon "
     "champagne wine cake cookie biscuit bread toffee marshmallow meringue custard pudding nougat "
     "marzipan licorice liquorice gingerbread cotton-candy vodka liqueur amaretto sweet sweets "
     "coconut waffle croissant cereal oat popcorn yogurt cheese jam syrup maple nut nuts dessert "
     "condensed espresso latte cappuccino mocha gelato icecream ice-cream sorbet macaron tiramisu "
     "caramelized dulce brownie fudge truffle pecan macadamia cashew pumpkin sake beer gin tequila "
     "absinthe vermouth cider mead kefir")
_reg("aquatic", "sea marine ocean water aquatic ozone ozonic calone salt salty rain seaweed algae watery "
     "wave waves coast beach dew river lake aqua oceanic seashore driftwood-sea mist iceberg ice snow "
     "glacier")
_reg("herbal/aromatic", "lavender mint peppermint spearmint basil sage rosemary thyme herb herbs herbal "
     "aromatic artemisia wormwood tarragon oregano eucalyptus chamomile tea mate verbena lemongrass "
     "citronella marjoram dill fennel parsley chervil hyssop absinthe-herb camphor tansy yarrow "
     "melissa catnip coriander-leaf cilantro bay laurel myrtle rue savory lovage borage "
     "immortelle helichrysum yerba tagetes davana")


# --- second pass: long-tail tokens found while reviewing the 'other' bucket
_reg("woody", "spruce conifer hemlock larch hiba thuja cabreuva sycamore willow poplar javanol kephalis "
     "norlimbanol timbersilk muhuhu hinoki gaiac cedrus tsuga")
_reg("floral", "pelargonium daisy elder boronia locust heather rhododendron snowdrops stephanotis pansy bluebell "
     "hortensia mignonette reseda azalea fuchsia jonquille dianthus gentiana jacaranda bougainvillea aglaia "
     "edelweiss forget dandelion goldenrod buddleia daphne calendula michelia mirabilis cananga liatris liatrix "
     "cereus lantana tulip strelitzia belladonna paradisone floralozone mahonia mahonial petalia")
_reg("herbal/aromatic", "celery mugwort vervain nettle valerian tulsi hops arnica santolina thistle nigella "
     "mistletoe prunella ravensara manuka myrica nootka galanga ginseng buchu")
_reg("gourmand", "macarons macaron creme brulee malt loukhoum chai butterscotch jelly molasses marmalade grenadine "
     "limoncello mojito bellini martini campari mezcal caipirinha cheesecake panettone pancake brioche toast "
     "flour candies kulfi madeleine pastries pastry frosting icing gummy punch daim propolis colada cola "
     "cantaloupe barley bran grains corn soybean pea yeast guarana")
_reg("fruity", "pitanga sapodilla soursop acerola cherimoya carambola avocado litchi grapes")
_reg("citrus", "calamansi chinotto limetta curacao pamplemousse")
_reg("musky/animalic", "cetalox ambrocenide ambrarome ambreine lorenox ambretone ambrostar muscenone galaxolide "
     "sylkolide habanolide exaltolide cosmone serenolide musc sweat hair wool silk velvet lipstick")
_reg("aquatic", "aquozone laminaria fog petrichor")

# stem substrings tried when no token matched (most specific first)
FAMILY_STEMS = [
    ("woody", ["sandalwood", "cedar", "rosewood", "wood"]),
    ("citrus", ["lemon", "orange", "mandarin", "grapefruit", "bergamot"]),
    ("floral", ["jasmin", "rose", "lily", "blossom", "flower", "orchid", "violet", "peon", "tuberose", "ylang",
                "narciss", "magnolia", "gardenia", "iris"]),
    ("fruity", ["berry", "apple", "peach", "plum", "cherry", "pear", "fruit", "mango", "melon"]),
    ("gourmand", ["vanill", "caramel", "chocolat", "coffee", "honey", "sugar", "cream", "milk", "cocoa", "nut"]),
    ("spicy", ["pepper", "spice", "cinnam", "cardam", "clove", "ginger"]),
    ("resinous/amber", ["amber", "incens", "resin", "myrrh", "balsam", "benzoin"]),
    ("musky/animalic", ["musk", "civet", "leather", "animal"]),
    ("aquatic", ["marine", "sea", "ocean", "water", "aqua"]),
    ("green", ["green", "grass", "leaf", "moss"]),
    ("herbal/aromatic", ["mint", "sage", "herb", "lavend", "tea"]),
]


def note_family(slug):
    if slug in FAMILY_EXACT:
        return FAMILY_EXACT[slug]
    toks = slug.split("-")
    # a 'notes'/'note' suffix is generic (e.g. 'woody-notes')
    toks2 = [t for t in toks if t not in ("notes", "note", "of", "the", "and", "oil", "essence", "absolute",
                                           "extract", "accord", "tincture", "concrete", "co2")] or toks
    for t in reversed(toks2):
        if t in FAMILY_TOKEN:
            return FAMILY_TOKEN[t]
    joined = "".join(toks2)
    for fam, stems in FAMILY_STEMS:
        for st in stems:
            if st in joined:
                return fam
    return "other"
