"""BUILD_REPORT.md writer."""
import sqlite3
from collections import Counter

import download

EXCLUDED = [
    ("kaggle nandini1999/perfume-recommendation-dataset (2,191 rows)",
     "downloaded to data/raw/nandini_perfume/ but NOT merged: images are static.luckyscent.com, i.e. LuckyScent retail data, not Fragrantica; no ids/urls."),
    ("huggingface doevent/perfume (26k rows)",
     "downloaded to data/raw/hf_doevent_perfume/ but NOT merged: no Fragrantica ids/URLs, different taxonomy (family/subfamily, country-qualified notes) - not verifiably Fragrantica-derived."),
    ("kaggle hombrequemejorhuele/arab-perfume-note-pyramids-152-fragrantica (160 rows)",
     "downloaded to data/raw/arab_160/ but NOT merged: Spanish-translated notes/accords from fragrantica.es; these perfumes are already in Decant with English names."),
    ("kaggle fatimakadhem/perfumes", "byte-identical copy of olga_fra/fra_perfumes.csv (same md5) - not downloaded again."),
    ("github pn-david/fragrantica_data, MagdalenaRomaniecka/ScentSational-Fragrantica-LFS",
     "row-for-row copies of olga_fra/fra_cleaned.csv (identical content, verified) - not downloaded again."),
    ("kaggle tajvarhirad/perfume, qasimrajput/perfume-recomendation, kamilejaz/perfume, eBay/e-commerce sets",
     "not Fragrantica data (aroma molecules / synthetic user survey / eBay listings)."),
    ("huggingface FragDBnet/fragrance-database",
     "only a 10-row CC-BY-NC sample is public (the full data is paywalled at fragdb.net); skipped."),
    ("codeberg decant/pages perfumes.db.gz + perfumes_cold.db.gz",
     "vote-filtered subset of the Kaggle dump that is already loaded; skipped as redundant."),
    ("rdemarqui/perfume_recommender *.pickle",
     "pickles are never loaded (untrusted-code risk); the same data is in perfume_database.xlsx."),
    ("kaggle sefasoysal/scentai..., rumaxpie/*fragrantica corpus, HF flossomniferus/fragrantica_corpus",
     "review/chat text corpora, no perfume catalogue."),
]


def write_report(perfumes, recs, src_stats, dd, contrib, note_names, db_path, out_path, seconds):
    meta = {s[0]: s for s in download.SOURCES}
    con = sqlite3.connect(db_path)

    def q(sql):
        return con.execute(sql).fetchall()

    def cnt(sql):
        return q(sql)[0][0]

    n_p = cnt("select count(*) from perfumes")
    n_n = cnt("select count(*) from notes")
    n_pn = cnt("select count(*) from perfume_notes")
    with_pyr = cnt("select count(distinct perfume_id) from perfume_notes where layer in ('top','middle','base')")
    all3 = cnt("""select count(*) from (select perfume_id from perfume_notes where layer in ('top','middle','base')
                group by perfume_id having count(distinct layer)=3)""")
    gen_only = cnt("""select count(distinct perfume_id) from perfume_notes where layer='general' and perfume_id not in
                    (select perfume_id from perfume_notes where layer in ('top','middle','base'))""")
    any_notes = cnt("select count(distinct perfume_id) from perfume_notes")
    with_fid = cnt("select count(*) from perfumes where fragrantica_id is not null")

    def pct(x):
        return f"{100.0 * x / n_p:.1f}%"

    contrib_by_file = Counter()
    for (f, _rid) in contrib:
        contrib_by_file[f] += 1

    L = []
    L.append("# Scent Atlas - master dataset build report\n")
    L.append(f"Built by `pipeline/build_master.py` in {seconds:.0f}s from the sources below. All raw data is treated as "
             "untrusted data (parsed only; nothing downloaded was executed or unpickled).\n")
    L.append("## Result\n")
    L.append(f"- **Unique perfumes: {n_p:,}**  (input records: {dd['records_in']:,}; records folded into another: "
             f"{dd['records_in'] - n_p:,})")
    L.append(f"- Notes: {n_n:,}   perfume_notes rows: {n_pn:,}")
    L.append(f"- With Fragrantica id: {with_fid:,} ({pct(with_fid)})")
    L.append(f"- With a top/middle/base pyramid: {with_pyr:,} ({pct(with_pyr)}); all three layers: {all3:,} ({pct(all3)}); "
             f"flat 'general' list only: {gen_only:,} ({pct(gen_only)}); no notes at all: {n_p - any_notes:,} "
             f"({pct(n_p - any_notes)})")
    for col, label in [("year", "year"), ("gender", "gender"), ("country", "country"), ("rating", "rating"),
                       ("accords", "accords (non-empty)"), ("perfumers", "perfumers (non-empty)")]:
        if col in ("accords", "perfumers"):
            v = cnt(f"select count(*) from perfumes where {col} is not null and {col}!='[]'")
        else:
            v = cnt(f"select count(*) from perfumes where {col} is not null")
        L.append(f"- With {label}: {v:,} ({pct(v)})")
    L.append("")
    L.append("## Dedup / merge statistics\n")
    L.append("| step | count |\n|---|---|")
    labels = [
        ("records_in", "input records across all sources"),
        ("distinct_fragrantica_ids", "distinct Fragrantica ids seen"),
        ("records_merged_by_fid", "records merged because they share a Fragrantica id"),
        ("stale_id_groups_merged_by_key", "id-groups only known to low-priority sources merged into a Decant/aStyxxx perfume by brand+name(+year) (old/duplicate Fragrantica ids)"),
        ("idless_merged_by_key", "id-less records merged by normalised brand+name(+year)"),
        ("idless_merged_by_fuzzy", "id-less records merged by rapidfuzz tie-break (token_sort_ratio >= 94, same brand, unique best)"),
        ("idless_merged_among_idless", "id-less records merged with other id-less records"),
        ("idless_ambiguous_dropped", "id-less records dropped because several existing perfumes matched equally"),
        ("idless_unmatched_dropped", "id-less records from enrich-only sources (imerghichi) that matched no known perfume: not added (poor names/brands, no ids)"),
        ("idless_new_perfumes", "new perfumes created from id-less records (no Fragrantica id)"),
        ("country_filled_from_brand", "perfumes whose country was filled from the brand's known country"),
    ]
    for k, lab in labels:
        L.append(f"| {lab} | {dd.get(k, 0):,} |")
    L.append("")
    L.append("## Sources merged\n")
    L.append("| source key (file) | where from | license | rows read | rows w/ fragrantica id | rows w/ pyramid | rows contributing a winning field |\n|---|---|---|---|---|---|---|")
    for fkey, st in src_stats.items():
        k = fkey.split(":")[0]
        m = meta.get(k)
        if m and m[1] == "url":
            where = m[2]
        elif m:
            where = f"https://www.kaggle.com/datasets/{m[2]}"
        else:
            where = ""
        if k == "decant_kaggle":
            where += " (author: https://codeberg.org/decant , https://decant.codeberg.page)"
        lic = m[3] if m else ""
        L.append(f"| {fkey} | {where} | {lic} | {st['rows']:,} | {st['with_fid']:,} | {st['with_pyramid']:,} | {contrib_by_file.get(fkey, 0):,} |")
    L.append("\n'Rows contributing' = source records that supplied at least one field chosen for the final perfume "
             "(name/brand, notes, accords, rating, year, country, url, perfumers).\n")
    L.append("## Inspected but not merged\n")
    for a, b in EXCLUDED:
        L.append(f"- **{a}**: {b}")
    L.append("")
    L.append("## Merge rules actually applied\n")
    L.append("- Identity: Fragrantica id (trailing number of the URL / `id` column / image file name `o.<id>.jpg`). Fallback key = unicode-folded, lower-cased, punctuation-stripped brand (aliases collapsed, e.g. Christian Dior = Dior) + name (gender suffix `for women/men` removed), plus year and gender when both sides have them.")
    L.append("- Notes pyramid: taken from the single source record with the most complete pyramid (most of top/middle/base filled; ties -> source priority decant > aStyxxx > wilsonanthony > sabitahmad > olga > rdemarqui > imerghichi). Layers are never mixed between sources. No pyramid anywhere -> flat list stored as layer `general`.")
    L.append("- Rating: record with the largest rating_count, together with its rating. Accords: the list with strengths and the most entries (Decant has real 0-100 strengths; name-only sources get a synthetic descending strength 1.0, 0.9, ...). Perfumers: union.")
    L.append("- Notes are slugged to lowercase ascii/hyphen; only casing/whitespace/encoding variants collapse, Fragrantica's distinct names (e.g. orange-blossom vs neroli, calabrian-bergamot vs bergamot) stay distinct. Mojibake fixed with ftfy.")
    L.append("- `perfumes.id` = the Fragrantica id when known (stable across rebuilds), else 9,000,000+n for the few perfumes without one. `image_url` = fimgs.net 375x500 URL built from the Fragrantica id.")
    L.append("- `country` is a brand-level attribute (only olga_fra/fra_cleaned has it); it was propagated to every perfume of that normalised brand.")
    L.append("")
    L.append("## Top 30 notes\n")
    L.append("| # | note | slug | family | perfumes |\n|---|---|---|---|---|")
    for i, (name, slug, fam, c) in enumerate(
            q("select name,slug,family,perfume_count from notes order by perfume_count desc limit 30"), 1):
        L.append(f"| {i} | {name} | {slug} | {fam} | {c:,} |")
    L.append("\n## Note families\n")
    L.append("| family | notes | perfume-note links |\n|---|---|---|")
    for fam, c, s in q("select family,count(*),sum(perfume_count) from notes group by family order by 3 desc"):
        L.append(f"| {fam} | {c:,} | {s:,} |")
    L.append("")
    L.append("## Known gaps\n")
    L.append(f"- {n_p - any_notes:,} perfumes have no notes in any source; {gen_only:,} only a flat list (Fragrantica itself shows no pyramid for them).")
    L.append("- Data freshness: the Decant snapshot (scraped_at ~ Sep 2026) is the base; the other sources are older and only fill gaps.")
    L.append("- Country is only known for brands present in olga fra_cleaned; the rest are NULL.")
    L.append("- Accord strengths for perfumes that exist only in name-only sources are synthetic.")
    L.append("- imerghichi_notes (no ids, brand names with dropped accents) is used only to attach/fill flat notes on already-known perfumes; unmatched rows are discarded rather than creating weak, possibly duplicate entries.")
    dup = cnt("select count(*) from (select 1 from perfumes group by lower(brand), lower(name), coalesce(year,0) having count(*)>1)")
    L.append(f"- {dup:,} (brand, name, year) combinations occur under more than one Fragrantica id. These are separate Fragrantica pages (the site itself has duplicate listings) and are deliberately NOT merged, since identity is the Fragrantica id.")
    L.append("- Ratings are on Fragrantica's 0-5 scale as given; no re-scaling.")
    L.append("- Data licenses are CC BY-NC-SA 4.0 (Decant / olga): personal, non-commercial use. fragrantica.com itself was never scraped.")
    out_path.write_text("\n".join(L) + "\n", encoding="utf-8")
