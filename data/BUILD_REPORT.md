# Scent Atlas - master dataset build report

Built by `pipeline/build_master.py` in 94s from the sources below. All raw data is treated as untrusted data (parsed only; nothing downloaded was executed or unpickled).

## Result

- **Unique perfumes: 140,297**  (input records: 359,418; records folded into another: 219,121)
- Notes: 2,592   perfume_notes rows: 1,172,976
- With Fragrantica id: 140,297 (100.0%)
- With a top/middle/base pyramid: 99,055 (70.6%); all three layers: 98,393 (70.1%); flat 'general' list only: 38,676 (27.6%); no notes at all: 2,566 (1.8%)
- With year: 115,080 (82.0%)
- With gender: 140,248 (100.0%)
- With country: 68,938 (49.1%)
- With rating: 121,534 (86.6%)
- With accords (non-empty): 137,582 (98.1%)
- With perfumers (non-empty): 53,042 (37.8%)

## Dedup / merge statistics

| step | count |
|---|---|
| input records across all sources | 359,418 |
| distinct Fragrantica ids seen | 140,336 |
| records merged because they share a Fragrantica id | 187,807 |
| id-groups only known to low-priority sources merged into a Decant/aStyxxx perfume by brand+name(+year) (old/duplicate Fragrantica ids) | 39 |
| id-less records merged by normalised brand+name(+year) | 28,779 |
| id-less records merged by rapidfuzz tie-break (token_sort_ratio >= 94, same brand, unique best) | 6 |
| id-less records merged with other id-less records | 0 |
| id-less records dropped because several existing perfumes matched equally | 590 |
| id-less records from enrich-only sources (imerghichi) that matched no known perfume: not added (poor names/brands, no ids) | 1,900 |
| new perfumes created from id-less records (no Fragrantica id) | 0 |
| perfumes whose country was filled from the brand's known country | 44,876 |

## Sources merged

| source key (file) | where from | license | rows read | rows w/ fragrantica id | rows w/ pyramid | rows contributing a winning field |
|---|---|---|---|---|---|---|
| decant_kaggle | https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes (author: https://codeberg.org/decant , https://decant.codeberg.page) | CC BY-NC-SA 4.0 | 140,228 | 140,228 | 99,031 | 140,228 |
| gh_astyxxx | https://raw.githubusercontent.com/aStyxxx/dataset_Fragrantica_perfumes/HEAD/perfumes_actual.csv | not stated | 33,113 | 33,113 | 26,312 | 0 |
| wilsonanthony_fra | https://www.kaggle.com/datasets/wilsonanthony/fragrantica-perfumes | Unknown | 2,800 | 2,800 | 1,966 | 194 |
| sabitahmad_fra | https://www.kaggle.com/datasets/sabitahmad/fragrantica-all-perfume-database | Apache 2.0 | 19,910 | 19,910 | 0 | 0 |
| olga_fra:fra_perfumes.csv | https://www.kaggle.com/datasets/olgagmiufana1/fragrantica-com-fragrance-dataset | CC BY-NC-SA 4.0 | 70,103 | 70,103 | 45,096 | 3,161 |
| olga_fra:fra_cleaned.csv | https://www.kaggle.com/datasets/olgagmiufana1/fragrantica-com-fragrance-dataset | CC BY-NC-SA 4.0 | 24,063 | 24,063 | 24,063 | 24,062 |
| gh_rdemarqui | https://raw.githubusercontent.com/rdemarqui/perfume_recommender/HEAD/database/perfume_database.xlsx | not stated | 37,926 | 37,926 | 0 | 152 |
| imerghichi_notes | https://www.kaggle.com/datasets/imerghichi/notes-perfumes | Unknown | 31,275 | 0 | 0 | 9 |

'Rows contributing' = source records that supplied at least one field chosen for the final perfume (name/brand, notes, accords, rating, year, country, url, perfumers).

## Inspected but not merged

- **kaggle nandini1999/perfume-recommendation-dataset (2,191 rows)**: downloaded to data/raw/nandini_perfume/ but NOT merged: images are static.luckyscent.com, i.e. LuckyScent retail data, not Fragrantica; no ids/urls.
- **huggingface doevent/perfume (26k rows)**: downloaded to data/raw/hf_doevent_perfume/ but NOT merged: no Fragrantica ids/URLs, different taxonomy (family/subfamily, country-qualified notes) - not verifiably Fragrantica-derived.
- **kaggle hombrequemejorhuele/arab-perfume-note-pyramids-152-fragrantica (160 rows)**: downloaded to data/raw/arab_160/ but NOT merged: Spanish-translated notes/accords from fragrantica.es; these perfumes are already in Decant with English names.
- **kaggle fatimakadhem/perfumes**: byte-identical copy of olga_fra/fra_perfumes.csv (same md5) - not downloaded again.
- **github pn-david/fragrantica_data, MagdalenaRomaniecka/ScentSational-Fragrantica-LFS**: row-for-row copies of olga_fra/fra_cleaned.csv (identical content, verified) - not downloaded again.
- **kaggle tajvarhirad/perfume, qasimrajput/perfume-recomendation, kamilejaz/perfume, eBay/e-commerce sets**: not Fragrantica data (aroma molecules / synthetic user survey / eBay listings).
- **huggingface FragDBnet/fragrance-database**: only a 10-row CC-BY-NC sample is public (the full data is paywalled at fragdb.net); skipped.
- **codeberg decant/pages perfumes.db.gz + perfumes_cold.db.gz**: vote-filtered subset of the Kaggle dump that is already loaded; skipped as redundant.
- **rdemarqui/perfume_recommender *.pickle**: pickles are never loaded (untrusted-code risk); the same data is in perfume_database.xlsx.
- **kaggle sefasoysal/scentai..., rumaxpie/*fragrantica corpus, HF flossomniferus/fragrantica_corpus**: review/chat text corpora, no perfume catalogue.

## Merge rules actually applied

- Identity: Fragrantica id (trailing number of the URL / `id` column / image file name `o.<id>.jpg`). Fallback key = unicode-folded, lower-cased, punctuation-stripped brand (aliases collapsed, e.g. Christian Dior = Dior) + name (gender suffix `for women/men` removed), plus year and gender when both sides have them.
- Notes pyramid: taken from the single source record with the most complete pyramid (most of top/middle/base filled; ties -> source priority decant > aStyxxx > wilsonanthony > sabitahmad > olga > rdemarqui > imerghichi). Layers are never mixed between sources. No pyramid anywhere -> flat list stored as layer `general`.
- Rating: record with the largest rating_count, together with its rating. Accords: the list with strengths and the most entries (Decant has real 0-100 strengths; name-only sources get a synthetic descending strength 1.0, 0.9, ...). Perfumers: union.
- Notes are slugged to lowercase ascii/hyphen; only casing/whitespace/encoding variants collapse, Fragrantica's distinct names (e.g. orange-blossom vs neroli, calabrian-bergamot vs bergamot) stay distinct. Mojibake fixed with ftfy.
- `perfumes.id` = the Fragrantica id when known (stable across rebuilds), else 9,000,000+n for the few perfumes without one. `image_url` = fimgs.net 375x500 URL built from the Fragrantica id.
- `country` is a brand-level attribute (only olga_fra/fra_cleaned has it); it was propagated to every perfume of that normalised brand.

## Top 30 notes

| # | note | slug | family | perfumes |
|---|---|---|---|---|
| 1 | Musk | musk | musky/animalic | 52,432 |
| 2 | Vanilla | vanilla | gourmand | 39,190 |
| 3 | Amber | amber | resinous/amber | 39,141 |
| 4 | Bergamot | bergamot | citrus | 38,773 |
| 5 | Sandalwood | sandalwood | woody | 37,052 |
| 6 | Jasmine | jasmine | floral | 35,730 |
| 7 | Patchouli | patchouli | woody | 34,464 |
| 8 | Rose | rose | floral | 29,399 |
| 9 | Cedar | cedar | woody | 23,241 |
| 10 | Vetiver | vetiver | woody | 18,797 |
| 11 | Lemon | lemon | citrus | 15,545 |
| 12 | Tonka Bean | tonka-bean | gourmand | 15,289 |
| 13 | Lavender | lavender | herbal/aromatic | 13,845 |
| 14 | Orange Blossom | orange-blossom | floral | 12,365 |
| 15 | Mandarin Orange | mandarin-orange | citrus | 12,019 |
| 16 | Leather | leather | musky/animalic | 11,332 |
| 17 | Cardamom | cardamom | spicy | 11,314 |
| 18 | Pink Pepper | pink-pepper | spicy | 11,258 |
| 19 | Lily-of-the-Valley | lily-of-the-valley | floral | 11,045 |
| 20 | Violet | violet | floral | 10,465 |
| 21 | Grapefruit | grapefruit | citrus | 10,393 |
| 22 | Oakmoss | oakmoss | green | 10,244 |
| 23 | Iris | iris | floral | 9,978 |
| 24 | Saffron | saffron | spicy | 9,125 |
| 25 | Ylang-Ylang | ylang-ylang | floral | 9,018 |
| 26 | White Musk | white-musk | musky/animalic | 8,999 |
| 27 | Geranium | geranium | floral | 8,927 |
| 28 | Woody Notes | woody-notes | woody | 8,878 |
| 29 | Orange | orange | citrus | 8,744 |
| 30 | Cinnamon | cinnamon | spicy | 8,659 |

## Note families

| family | notes | perfume-note links |
|---|---|---|
| floral | 483 | 242,954 |
| woody | 217 | 194,801 |
| citrus | 95 | 122,842 |
| gourmand | 328 | 122,380 |
| musky/animalic | 68 | 94,437 |
| spicy | 89 | 87,429 |
| fruity | 219 | 87,093 |
| resinous/amber | 64 | 84,316 |
| herbal/aromatic | 127 | 53,647 |
| green | 131 | 38,618 |
| other | 725 | 24,191 |
| aquatic | 46 | 13,407 |

## Known gaps

- 2,566 perfumes have no notes in any source; 38,676 only a flat list (Fragrantica itself shows no pyramid for them).
- Data freshness: the Decant snapshot (scraped_at ~ Sep 2026) is the base; the other sources are older and only fill gaps.
- Country is only known for brands present in olga fra_cleaned; the rest are NULL.
- Accord strengths for perfumes that exist only in name-only sources are synthetic.
- imerghichi_notes (no ids, brand names with dropped accents) is used only to attach/fill flat notes on already-known perfumes; unmatched rows are discarded rather than creating weak, possibly duplicate entries.
- 742 (brand, name, year) combinations occur under more than one Fragrantica id. These are separate Fragrantica pages (the site itself has duplicate listings) and are deliberately NOT merged, since identity is the Fragrantica id.
- Ratings are on Fragrantica's 0-5 scale as given; no re-scaling.
- Data licenses are CC BY-NC-SA 4.0 (Decant / olga): personal, non-commercial use. fragrantica.com itself was never scraped.
