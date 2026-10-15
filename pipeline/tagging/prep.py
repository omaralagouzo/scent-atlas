"""Prepare inputs for brand tagging. Re-runnable:  python pipeline/tagging/prep.py
Outputs (pipeline/tagging/work/): reminds.csv, brand_signals.csv, brands_batch_1..8.json, brands_longtail.csv
"""
import csv
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (DB, FAMOUS_BRAND_VOTES, OUT, WORK, build_famous_names, load_perfumes, load_raw,
                     name_matches, norm)

N_BATCHES = 8
TOP_BRANDS = 1000
MAX_EXTRA = 300
MIN_UP = 5  # min up-votes for the top reminds_me_of target to count

ME_COUNTRIES = {"uae", "united arab emirates", "arabia saudi", "saudi arabia", "kuwait", "qatar", "oman", "bahrein",
                "bahrain", "jordan", "lebanon", "egypt", "iraq", "iran", "yemen", "syria", "palestine"}
# kept separate: not counted as Middle East, flagged as 'adjacent' (Israel is in the DB; it is not Arab/GCC)
ADJACENT_COUNTRIES = {"turkey", "pakistan", "israel"}

ARABIC_TOKENS = set("""
al el oud oudh aoud attar ittar itr bakhoor bukhoor bakhur sultan sultana amir ameer emir emirates sheikh shaikh
sheikha malik malika khalij khaleeji layali layl habibi hayati khamrah asad fakhar raed yara haya qamar shams
zafaran zaafaran mukhallat dehn dahn dhahab dhahabi arabian arabic arab makkah mecca madina medina dubai
riyadh rimal sahra noor nour nur jawad ameerat fursan shaghaf majd mahabba mahaba hareem harem
sharqi ghaliya ghali rayhan reem rasha nasaem nasim waha tawaf kaaba hajar hijaz najd
abdul abdullah mumtaz mukhtar zahra zahrat zain zayn jamal dirham dinar ramadan eid
""".split())
OUD_NOTE = re.compile(r"(^|-)oud(-|$)|agarwood|aoud")
DUPE_PHRASES = re.compile(
    r"inspired by|inspiration (?:from|of)|\bdupe\b|\bclone\b|alternative to|version of|impression of|"
    r"our take on|similar to|smells like|if you love|equivalent|replica|compared to|reminiscent of", re.I)


def pct(x):
    return round(x, 4)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    perfumes = load_perfumes()
    pid = {p["id"]: p for p in perfumes}
    print(f"perfumes: {len(perfumes)}")

    brand_votes = Counter()
    for p in perfumes:
        brand_votes[p["brand"]] += p["rating_count"]
    famous_brands = {b for b, v in brand_votes.items() if v >= FAMOUS_BRAND_VOTES}
    print(f"brands: {len(brand_votes)}, famous (>= {FAMOUS_BRAND_VOTES} votes): {len(famous_brands)}")

    # oud note flag
    con = sqlite3.connect(DB)
    oud_ids = {i for i, s in con.execute("select id,slug from notes") if OUD_NOTE.search(s)}
    has_oud = {perf for perf, note in con.execute("select perfume_id,note_id from perfume_notes") if note in oud_ids}
    con.close()

    # raw pass: reminds + description
    fam_brand_norm = {norm(b): b for b in famous_brands if len(norm(b)) >= 3}
    own_norm = {}

    def desc_signal(desc, brand):
        for m in DUPE_PHRASES.finditer(desc):
            toks = norm(desc[m.end():m.end() + 70]).split()
            for n in (1, 2, 3):
                for k in range(len(toks) - n + 1):
                    fb = fam_brand_norm.get(" ".join(toks[k:k + n]))
                    if fb and fb != brand:
                        return True
        return False

    desc_hit = {}
    top_target = {}  # perfume id -> (target_id, up, down): best net>0 target by up-votes
    n_rows = 0
    with open(WORK / "reminds.csv", "w", newline="", encoding="utf8") as f:
        w = csv.writer(f)
        w.writerow(["perfume_id", "target_id", "target_slug", "up", "down", "target_in_db"])
        for i, desc, rem in load_raw():
            if desc is not None:
                desc_hit[i] = desc_signal(desc, pid[i]["brand"]) if i in pid else False
            best = None
            for r in rem:
                t, up, dn = r.get("id"), r.get("up_votes") or 0, r.get("down_votes") or 0
                w.writerow([i, t, r.get("slug", ""), up, dn, int(t in pid)])
                n_rows += 1
                if t in pid and up - dn > 0 and (best is None or up > best[1]):
                    best = (t, up, dn)
            if best:
                top_target[i] = best
    print(f"reminds rows: {n_rows}")

    fam = build_famous_names(perfumes, brand_votes)
    print(f"famous perfume names indexed: {len(fam)}")

    B = defaultdict(list)
    for p in perfumes:
        B[p["brand"]].append(p)

    rows = []
    for brand, ps in B.items():
        votes = brand_votes[brand]
        wsum = sum(max(p["rating_count"], 1) for p in ps)
        country = Counter(p["country"] for p in ps if p["country"]).most_common(1)
        country = country[0][0] if country else None
        top5 = [p["name"] for p in sorted(ps, key=lambda p: -p["rating_count"])[:5]]
        years = [p["year"] for p in ps if p["year"]]
        yr = f"{min(years)}-{max(years)}" if years else ""
        w_dupe = n_dupe = n_voted = w_voted = 0
        top_targets = Counter()
        for p in ps:
            t = top_target.get(p["id"])
            if not t or t[1] < MIN_UP:
                continue
            n_voted += 1
            wt = max(p["rating_count"], 1)
            w_voted += wt
            tp = pid[t[0]]
            tb = tp["brand"]
            # target must be a different famous brand, clearly better known than the source, and not newer
            older_ok = not (tp["year"] and p["year"] and tp["year"] > p["year"] + 1)
            if tb != brand and tb in famous_brands and tp["rating_count"] >= 2 * p["rating_count"] and older_ok:
                w_dupe += wt
                n_dupe += 1
                top_targets[tb] += 1
        n_name = 0
        ex = []
        for p in ps:
            m = name_matches(p["name"], brand, fam)
            if m:
                n_name += 1
                if len(ex) < 3:
                    ex.append(f"{p['name']}~{m[0][0]}({m[0][1]})")
        n = len(ps)
        n_desc = sum(1 for p in ps if desc_hit.get(p["id"]))
        n_arab = sum(1 for p in ps if ARABIC_TOKENS & set(norm(p["name"]).split()))
        n_oud = sum(1 for p in ps if p["id"] in has_oud)
        brand_toks = set(norm(brand).split())
        cl = (country or "").lower()
        rs_all = w_dupe / wsum
        rs_voted = w_dupe / w_voted if w_voted else 0.0
        name_share = n_name / n
        desc_share = n_desc / n
        me_country = cl in ME_COUNTRIES
        adj_country = cl in ADJACENT_COUNTRIES
        arab_share = n_arab / n
        oud_share = n_oud / n
        arab_brand = bool(ARABIC_TOKENS & brand_toks)
        dupe_score = min(1.0, 0.6 * max(rs_all, rs_voted * min(1, n_voted / 5)) + 0.25 * name_share
                         + 0.15 * min(1, desc_share * 3))
        me_score = min(1.0, (0.6 if me_country else 0.25 if adj_country else 0) + 0.3 * arab_share
                       + 0.2 * oud_share + (0.2 if arab_brand else 0))
        rows.append(dict(
            brand=brand, n_perfumes=n, total_votes=votes, country=country or "", top5="; ".join(top5), years=yr,
            n_voted_remind=n_voted, n_dupe_remind=n_dupe, dupe_remind_share=pct(rs_all),
            dupe_remind_share_voted=pct(rs_voted),
            top_target_brands="; ".join(f"{b}:{c}" for b, c in top_targets.most_common(3)),
            n_name_match=n_name, name_match_share=pct(name_share), name_match_examples=" | ".join(ex),
            n_desc_phrase=n_desc, desc_phrase_share=pct(desc_share),
            me_country=int(me_country), adjacent_country=int(adj_country), arabic_name_share=pct(arab_share),
            oud_note_share=pct(oud_share), arabic_brand_name=int(arab_brand),
            dupe_score=pct(dupe_score), me_score=pct(me_score), is_famous=int(brand in famous_brands)))
    rows.sort(key=lambda r: -r["total_votes"])
    for i, r in enumerate(rows, 1):
        r["votes_rank"] = i

    cols = list(rows[0].keys())
    with open(WORK / "brand_signals.csv", "w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    top = rows[:TOP_BRANDS]
    rest = rows[TOP_BRANDS:]

    def strong(r):
        dupe = r["n_perfumes"] >= 3 and (r["dupe_remind_share"] >= 0.4 or
                                         (r["dupe_remind_share_voted"] >= 0.4 and r["n_voted_remind"] >= 3))
        return dupe or r["me_country"]
    extra = [r for r in rest if strong(r)][:MAX_EXTRA]  # rest is already vote-ranked
    selected = sorted(top + extra, key=lambda r: -r["total_votes"])

    def item(r):
        return {"brand": r["brand"], "n_perfumes": r["n_perfumes"], "total_votes": r["total_votes"],
                "country": r["country"] or None, "top5": r["top5"].split("; ") if r["top5"] else [],
                "years": r["years"],
                "signals": {
                    "dupe_score": r["dupe_score"], "dupe_remind_share": r["dupe_remind_share"],
                    "dupe_remind_share_voted": r["dupe_remind_share_voted"], "n_voted_remind": r["n_voted_remind"],
                    "top_target_brands": r["top_target_brands"], "name_match_share": r["name_match_share"],
                    "name_match_examples": r["name_match_examples"], "desc_phrase_share": r["desc_phrase_share"],
                    "me_country": bool(r["me_country"]), "adjacent_country": bool(r["adjacent_country"]),
                    "arabic_name_share": r["arabic_name_share"], "oud_note_share": r["oud_note_share"],
                    "arabic_brand_name": bool(r["arabic_brand_name"]), "me_score": r["me_score"]}}

    batches = [[] for _ in range(N_BATCHES)]
    for i, r in enumerate(selected):  # round-robin by votes rank
        batches[i % N_BATCHES].append(item(r))
    for k, b in enumerate(batches, 1):
        with open(WORK / f"brands_batch_{k}.json", "w", encoding="utf8") as f:
            json.dump(b, f, ensure_ascii=False, indent=1)
    sel_set = {r["brand"] for r in selected}
    long_rows = [r for r in rows if r["brand"] not in sel_set]
    with open(WORK / "brands_longtail.csv", "w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(long_rows)

    print(f"selected brands: {len(selected)} (top {len(top)} + extra {len(extra)}); long tail: {len(long_rows)}")
    print("batch sizes:", [len(b) for b in batches])
    print("brand votes covered by selection: %.1f%%"
          % (100 * sum(r['total_votes'] for r in selected) / sum(brand_votes.values())))


if __name__ == "__main__":
    main()
