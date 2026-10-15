# Brand tagging pipeline

Goal: tag every brand in `data/master.db` as `niche` / `designer` / `dupe` / `middle_eastern`, then, for perfumes of
dupe brands, find which perfume each one is a dupe of.

## Files

| Path | What |
|---|---|
| `prep.py` | re-runnable; builds everything in `work/` (`python pipeline/tagging/prep.py`) |
| `work/reminds.csv` | all Fragrantica "reminds me of" votes: `perfume_id,target_id,target_slug,up,down,target_in_db` |
| `work/brand_signals.csv` | one row per brand with all signals (see below) |
| `work/brands_batch_1..8.json` | brands to judge (top 1000 by votes + up to 300 long-tail brands with strong dupe/ME signals), round-robin by vote rank so each batch is a mix |
| `work/brands_longtail.csv` | all remaining brands + signals, for later heuristic tagging |
| `out/brand_tags_<batch>.jsonl` | **web agents write here** (format below) |
| `dupe_candidates.py` | perfume-level candidate generator, run after brand tags exist |
| `work/perfume_candidates.jsonl`, `work/perfume_candidates_summary.json` | its output |

Batch item: `{brand, n_perfumes, total_votes, country, top5: [names], years, signals{...}}`.

## Signals (hints only; judge from web sources, not from the numbers)

- `dupe_remind_share` (also `_voted`): vote-weighted share of the brand's perfumes whose top community
  "reminds me of" target (net votes > 0, >= 5 up-votes) is a perfume of a DIFFERENT famous brand (>= 20,000 total votes),
  where the target is >= 2x more voted than the perfume and not newer. `_voted` = among perfumes that have such a vote.
  `n_voted_remind` = how many perfumes have one. `top_target_brands` = most common brands imitated.
- `name_match_share`, `name_match_examples`: perfumes whose name contains a famous (non-generic, >= 5 chars) perfume
  name of another brand, e.g. `Aventus Oil~aventus(Creed)`.
- `desc_phrase_share`: descriptions saying "inspired by / alternative to / version of / impression of / dupe / clone ..."
  followed by a famous brand name.
- `dupe_score` (0..1): blend of the three.
- `me_country` (UAE, Saudi/"Arabia saudi", Kuwait, Qatar, Oman, Bahrain/"Bahrein", Jordan, Lebanon, Egypt, Iraq, Iran, ...),
  `adjacent_country` (Turkey, Pakistan, Israel; NOT counted as Middle East), `arabic_name_share` (perfume names with Arabic
  words: al, oud, attar, bakhoor, sultan, amir ...), `oud_note_share`, `arabic_brand_name`, `me_score` (0..1).
- Caveat: `country` is only known for ~half of perfumes; empty means unknown.
- Famous brands naturally score low (their flankers are not clones); high-vote niche houses can score moderately.

## Output format (one JSON object per line, UTF-8)

File: `pipeline/tagging/out/brand_tags_<batch>.jsonl` (e.g. `brand_tags_3.jsonl`). One line per brand in the batch.

```json
{"brand": str, "tags": [subset of "niche","designer","dupe","middle_eastern"],
 "dupe_style": "open"|"unstated"|"partial"|null, "origin_country": str|null, "parent_company": str|null,
 "confidence": "high"|"medium"|"low", "notes": str, "sources": [urls]}
```

- `brand`: exact string from the batch / DB (case, accents, punctuation).
- `tags`: see definitions. `[]` is allowed.
- `dupe_style`: only when `dupe` is in tags: `open` = brand states openly that it makes inspired-by versions of named perfumes;
  `unstated` = does it without saying so publicly; `partial` = mix of originals and clones. `null` otherwise.
- `origin_country`: country where the brand is headquartered/founded (not where it is manufactured), e.g. "UAE", "France".
- `parent_company`: owner group if any (e.g. "Lattafa Group", "Puig", "LVMH"), else null.
- `notes`: <= 200 characters, the evidence for the decision.
- `sources`: urls actually used (brand site, Wikipedia, Fragrantica, reputable blogs/forums).

## Definitions (verbatim)

- **designer**: fashion/luxury/lifestyle houses and mainstream prestige brands whose fragrances are licensed or made as part of a broader brand (Dior, Chanel, YSL, Armani, Prada, Versace, Hugo Boss, Tom Ford, Carolina Herrera, Paco Rabanne, Calvin Klein, celebrity lines too).
- **niche**: perfume-first houses positioned as artisanal/luxury/independent with limited distribution (Creed, MFK, Amouage, Nishane, Xerjoff, Byredo, Le Labo, Parfums de Marly, Initio, Kilian). A brand can't be both designer and niche -- pick the dominant positioning.
- **dupe**: houses whose catalogue is mostly or substantially inspired by / clones of other perfumes, whether they state it openly (Dossier, Alt. Fragrances, Oakcha, Bujairami, Dua, Fragrance World, Maison Alhambra) or not publicly (Zara, many Lattafa/Armaf/Afnan releases). `partial` = mix of originals and clones (e.g. Lattafa, Armaf). A dupe brand is not also tagged designer/niche: dupe replaces designer/niche, including fast-fashion like Zara: tags `["dupe"]` only.
- **middle_eastern**: brand originates/headquartered in the Middle East / GCC / Levant (incl. Oman's Amouage). Derived later (do not write them): `middle_eastern_original` = middle_eastern and not dupe (dupe_style null); `middle_eastern_dupe` = middle_eastern and dupe.
- **untagged** is allowed (e.g. drugstore/mass-market brands with no clear category) -- use tags `[]` with a note.

`middle_eastern` is independent of the other tags: Lattafa = `["dupe","middle_eastern"]`, Amouage = `["niche","middle_eastern"]`.

## Next step

After `out/*.jsonl` exist: `python pipeline/tagging/dupe_candidates.py` -> `work/perfume_candidates.jsonl`
(per perfume of dupe brands: top-5 reminds-me-of targets from non-dupe brands, name matches, top-3 note-similarity matches
among niche/designer perfumes) and a summary of how many perfumes have votes >= 1000 / 200 / 50 / 10.

## Merge into master.db

`python pipeline/tagging/merge_tags.py` reads every `out/*.jsonl` (brand rows and perfume-dupe rows, any file names;
`*longtail*` files are lowest priority and `"inferred": true` rows never override researched ones), validates against master.db,
derives `middle_eastern_original` / `middle_eastern_dupe` and (re)creates `brand_tags`, `perfume_dupes`, `perfume_dupe_status`.
It prints coverage and what it dropped / repaired and writes `work/merge_report.json`. Then `python pipeline/make_deploy_db.py`.

