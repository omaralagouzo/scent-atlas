"""Infer tags for the long-tail brands (those not web-tagged) from data signals only.

  python pipeline/tagging/infer_longtail.py [--out out/brand_tags_longtail.jsonl] [--min-voted 3]

* dupe: a small L2 logistic regression (numpy) trained on the 1,300 web-tagged brands (label = "dupe" in tags) with
  features derived from the community "reminds me of" votes (share of up-votes to famous brands / to known dupe
  houses, median up-votes relative to the perfume's own votes, how mega-popular the top targets are, concentration of
  target brands, ...), plus Arabic-name / oud / description signals.  The decision threshold is chosen from 5-fold
  cross-validated precision on the labelled brands (target >= 0.85, so >= 0.8 with margin); only brands with
  >= --min-voted voted perfumes can be tagged dupe.  Name-match share is NOT used as a rule: it has ~0% precision on the
  labelled brands (non-dupe houses reuse famous names all the time).
* middle_eastern: brand country (any perfume) in the README Middle-East list; or, when the country is unknown, a high
  me_score (Arabic-name share, oud notes, Arabic brand name).
* niche / designer are NEVER inferred (left empty).
Output rows: brand format with "inferred": true, confidence "low" (or "medium" when the signals are very strong), notes
start with "inferred from data signals".  Only brands with >= 1 inferred tag are written.  A calibration summary is
written to work/longtail_inference_report.md.
"""
import argparse
import glob
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OUT, WORK, load_perfumes

PREC_TARGET = 0.85
MEDIUM_P = 0.90          # model probability for "medium" (and >= 5 voted perfumes)
DESC_MIN = (0.2, 2)      # desc_phrase_share, n_desc_phrase
ME_SCORE_NO_COUNTRY = 0.6  # untestable on labels (no labelled brand lacks a country): kept conservative
ME_COUNTRIES = {"uae", "united arab emirates", "arabia saudi", "saudi arabia", "kuwait", "qatar", "oman", "bahrein",
                "bahrain", "jordan", "lebanon", "egypt", "iraq", "iran", "yemen", "syria", "palestine"}


# ----------------------------------------------------------------------------- features
def build_features(dupe_brands):
    P = pd.DataFrame(load_perfumes()).set_index("id")
    S = pd.read_csv(WORK / "brand_signals.csv").set_index("brand")
    R = pd.read_csv(WORK / "reminds.csv", usecols=["perfume_id", "target_id", "up", "down"])
    R = R[R.target_id.isin(P.index) & R.perfume_id.isin(P.index)]
    R = R.join(P[["brand", "rating_count", "year"]].add_prefix("s_"), on="perfume_id")
    R = R.join(P[["brand", "rating_count", "year"]].add_prefix("t_"), on="target_id")
    R = R[R.s_brand != R.t_brand]
    bv = P.groupby("brand").rating_count.sum()
    fam = set(bv[bv >= 20000].index)
    R["t_dupe"] = R.t_brand.isin(dupe_brands)
    R["t_fam"] = R.t_brand.isin(fam)
    tot_up = R.groupby("s_brand").up.sum()
    F = pd.DataFrame({"tot_up": tot_up})
    F["up_dupe_share"] = R[R.t_dupe].groupby("s_brand").up.sum().reindex(F.index).fillna(0) / F.tot_up.clip(lower=1)
    F["up_fam_share"] = R[R.t_fam].groupby("s_brand").up.sum().reindex(F.index).fillna(0) / F.tot_up.clip(lower=1)
    top = R.sort_values("up", ascending=False).groupby("perfume_id").head(1)
    top = top[top.up >= 5].copy()
    top["ratio"] = top.up / top.s_rating_count.clip(lower=1)
    top["lt"] = np.log10(top.t_rating_count.clip(lower=1))
    top["mega"] = (top.t_rating_count >= 10000).astype(float)
    top["older"] = (((top.t_year <= top.s_year + 1) | top.t_year.isna() | top.s_year.isna())).astype(float)
    top["bigger"] = (top.t_rating_count >= 2 * top.s_rating_count).astype(float)
    top["tdupe"] = top.t_dupe.astype(float)
    g = top.groupby("s_brand")
    F["n_top"] = g.size()
    F["top_ratio_med"] = g.ratio.median()
    F["top_tpop_med"] = g.lt.median()
    F["top_mega"] = g.mega.mean()
    F["top_older"] = g.older.mean()
    F["top_bigger"] = g.bigger.mean()
    F["top_dupe_t"] = g.tdupe.mean()
    F["top_tbrands"] = g.t_brand.nunique() / F.n_top
    F = F.join(S, how="outer")
    return F, S


def design(F):
    X = pd.DataFrame(index=F.index)
    X["lratio"] = np.log10(F.top_ratio_med.clip(0.01, 10).fillna(0.1))
    X["dupe_t"] = F.up_dupe_share.fillna(0)
    X["dupe_t_top"] = F.top_dupe_t.fillna(0)
    X["fam"] = F.up_fam_share.fillna(0)
    X["mega"] = F.top_mega.fillna(0)
    X["tpop"] = F.top_tpop_med.fillna(3)
    X["share_voted"] = F.dupe_remind_share_voted.fillna(0)
    X["older"] = F.top_older.fillna(1)
    X["bigger"] = F.top_bigger.fillna(0)
    X["conc"] = 1 - F.top_tbrands.fillna(1)
    X["n_top"] = np.log1p(F.n_top.fillna(0))
    X["n_perf"] = np.log1p(F.n_perfumes.fillna(1))
    X["arab"] = F.arabic_name_share.fillna(0)
    X["oud"] = F.oud_note_share.fillna(0)
    X["me"] = F.me_score.fillna(0)
    return X


def fit(X, y, l2=5.0, iters=60):
    mu, sd = X.mean(), X.std() + 1e-9
    Z = np.c_[np.ones(len(X)), ((X - mu) / sd).values]
    w = np.zeros(Z.shape[1])
    reg = np.diag(np.r_[0, np.ones(Z.shape[1] - 1)]) * l2 / len(y)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        g = Z.T @ (p - y) / len(y) + reg @ w
        H = (Z.T * (p * (1 - p))) @ Z / len(y) + reg + 1e-6 * np.eye(len(w))
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-7:
            break
    return mu, sd, w


def predict(m, X):
    mu, sd, w = m
    Z = np.c_[np.ones(len(X)), ((X - mu) / sd).values]
    return 1 / (1 + np.exp(-Z @ w))


def auc(y, s):
    o = np.argsort(s)
    r = np.empty(len(s))
    r[o] = np.arange(1, len(s) + 1)
    n1 = y.sum()
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * (len(y) - n1)))


def read_labels():
    lab = {}
    for fn in sorted(glob.glob(str(OUT / "brand_tags_[0-9]*.jsonl"))):
        with open(fn, encoding="utf8") as f:
            for line in f:
                if line.strip():
                    d = json.loads(line)
                    lab[d["brand"]] = d
    return lab


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT / "brand_tags_longtail.jsonl"))
    ap.add_argument("--min-voted", type=int, default=3)
    a = ap.parse_args()

    lab = read_labels()
    dupe_brands = {b for b, d in lab.items() if "dupe" in d["tags"]}
    F, S = build_features(dupe_brands)
    X = design(F)
    longtail = pd.read_csv(WORK / "brands_longtail.csv").brand.tolist()

    # ----- training / cross-validation on the web-tagged brands with enough voted perfumes
    L = F.index.isin(list(lab)) & (F.n_top.fillna(0) >= a.min_voted)
    XL, yL = X[L], np.array([("dupe" in lab[b]["tags"]) for b in X.index[L]], dtype=float)
    rank = S.votes_rank.reindex(XL.index).values
    rng = np.random.default_rng(0)
    idx = rng.permutation(len(XL))
    folds = np.array_split(idx, 5)
    oof = np.zeros(len(XL))
    for k in range(5):
        tr = np.concatenate([folds[j] for j in range(5) if j != k])
        oof[folds[k]] = predict(fit(XL.iloc[tr], yL[tr]), XL.iloc[folds[k]])
    ext = rank > 1000  # the 300 extra long-tail-like brands that were web-tagged (closest to the unlabeled long tail)
    lines = ["# Long-tail brand inference: calibration", "",
             f"Labelled brands with >= {a.min_voted} voted perfumes: {len(yL)} ({int(yL.sum())} dupe); "
             f"of which 'long-tail-like' (votes rank > 1000): {int(ext.sum())} ({int(yL[ext].sum())} dupe).",
             f"5-fold CV AUC: all {auc(yL, oof):.3f}; long-tail-like {auc(yL[ext], oof[ext]):.3f}", "",
             "| threshold | n pred | precision | recall | n pred (long-tail-like) | precision (long-tail-like) |",
             "|---|---|---|---|---|---|"]
    thr = None
    for t in [0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]:
        m = oof >= t
        pr = yL[m].mean() if m.sum() else float("nan")
        me = m & ext
        pre = yL[me].mean() if me.sum() else float("nan")
        lines.append(f"| {t} | {int(m.sum())} | {pr:.2f} | {yL[m].sum() / yL.sum():.2f} | {int(me.sum())} | {pre:.2f} |")
        if thr is None and m.sum() >= 20 and pr >= PREC_TARGET:
            thr = t
    thr = thr if thr is not None else 0.9
    model = fit(XL, yL)
    lines += ["", f"Chosen dupe threshold: p >= {thr} (first grid value with CV precision >= {PREC_TARGET}).",
              "Caveat: the labels are themselves incomplete (low-confidence 'no evidence' brands are labelled non-dupe), "
              "so measured precision is a lower bound; and long-tail-like precision is lower than overall because it is "
              "dominated by small houses with few voted perfumes.", ""]

    # rule baselines on the labelled set (why they are not used)
    yall = np.array([("dupe" in lab[b]["tags"]) for b in S.index if b in lab])
    SL = S.loc[[b for b in S.index if b in lab]]
    for name, m in [("share_voted>=0.8 & n_voted>=3", (SL.dupe_remind_share_voted >= 0.8) & (SL.n_voted_remind >= 3)),
                    ("name_match_share>=0.1 & n_perf>=3", (SL.name_match_share >= 0.1) & (SL.n_perfumes >= 3)),
                    ("desc_phrase_share>=0.2 & n_desc>=2", (SL.desc_phrase_share >= DESC_MIN[0]) & (SL.n_desc_phrase >= DESC_MIN[1]))]:
        m = m.values
        lines.append(f"- rule `{name}`: n={int(m.sum())}, precision {yall[m].mean() if m.sum() else float('nan'):.2f}, "
                     f"recall {yall[m].sum() / yall.sum():.2f}")
    lines.append("")

    # ME rules on labelled brands
    yme = np.array([("middle_eastern" in lab[b]["tags"]) for b in SL.index])
    me_c = (SL.me_country == 1).values
    me_s = ((SL.me_score >= ME_SCORE_NO_COUNTRY) & SL.country.isna()).values
    lines.append(f"- ME rule country in ME list: n={int(me_c.sum())}, precision {yme[me_c].mean():.2f}, "
                 f"recall {yme[me_c].sum() / yme.sum():.2f}")
    lines.append(f"- ME rule me_score>={ME_SCORE_NO_COUNTRY} & country unknown: n={int(me_s.sum())}, precision "
                 f"{(yme[me_s].mean() if me_s.sum() else float('nan')):.2f}")
    lines.append("")

    # ----- apply to the long tail
    lt = S.loc[longtail]
    Ft = F.loc[longtail]
    Xt = X.loc[longtail]
    p = predict(model, Xt)
    rows = []
    n_dupe = n_me = 0
    for i, b in enumerate(longtail):
        s = lt.loc[b]
        f = Ft.loc[b]
        tags, why, conf = [], [], "low"
        n_top = int(f.n_top) if not pd.isna(f.n_top) else 0
        is_dupe = False
        if n_top >= a.min_voted and p[i] >= thr:
            is_dupe = True
            why.append(f"{n_top} voted perfumes, dupe-model p={p[i]:.2f}, {f.up_fam_share:.0%} of reminds up-votes go to "
                       f"famous houses, {f.up_dupe_share:.0%} to known dupe houses, median reminds up/own votes "
                       f"{f.top_ratio_med:.2f}")
            if p[i] >= MEDIUM_P and n_top >= 5:
                conf = "medium"
        elif s.desc_phrase_share >= DESC_MIN[0] and s.n_desc_phrase >= DESC_MIN[1]:
            is_dupe = True
            why.append(f"{int(s.n_desc_phrase)} descriptions say inspired-by/alternative-to a famous brand")
        if is_dupe:
            tags.append("dupe")
            n_dupe += 1
        country = s.country if isinstance(s.country, str) and s.country else None
        me = False
        if s.me_country == 1:
            me = True
            why.append(f"country {country} is in the Middle East list")
            if conf == "low" and (s.arabic_name_share >= 0.2 or s.arabic_brand_name == 1) and not is_dupe:
                conf = "medium"
        elif country is None and s.me_score >= ME_SCORE_NO_COUNTRY:
            me = True
            why.append(f"country unknown but Arabic names/oud signals (me_score {s.me_score:.2f})")
        if me:
            tags.append("middle_eastern")
            n_me += 1
        if not tags:
            continue
        rows.append({"brand": b, "tags": tags, "dupe_style": None, "origin_country": country, "parent_company": None,
                     "confidence": conf, "notes": ("inferred from data signals: " + "; ".join(why))[:400],
                     "sources": [], "inferred": True})
    with open(a.out, "w", encoding="utf8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    lines += [f"## Long-tail result ({len(longtail)} brands)", f"- inferred dupe: {n_dupe}", f"- inferred middle_eastern: {n_me}",
              f"- brands written (>= 1 tag): {len(rows)}",
              f"- dupe by confidence: " + str({c: sum(1 for r in rows if 'dupe' in r['tags'] and r['confidence'] == c)
                                               for c in ('low', 'medium')})]
    (WORK / "longtail_inference_report.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
