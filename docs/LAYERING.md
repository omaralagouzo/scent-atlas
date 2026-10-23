# Layering: how Scent Atlas decides what to wear together

Code: `app/layering.py` (model), `app/layer_api.py` (API), `app/static/js/views/layering.js` + `layerui.js` (UI).
Research with every source and its reliability tier: [`layering-research.md`](layering-research.md).
Brand / perfumer / editor pairs named in that research: `app/layering_curated.json` (69 pairs, 64 resolve in the catalog).

## What the research says (short version)

| Principle | Main sources | How the model uses it |
|---|---|---|
| One scent carries the opening, the other the drydown; two of the same weight compete | Experimental Perfume Club, Christophe Laudamiel, French ELLE | `structure` term (heaviness gap + one fresh / one deep), "fresh over deep" reason |
| Simple + complex layers; complex + complex clashes | David Seth Moltz (D.S. & Durga), Jo Malone London, Superdrug | `simplicity` term; complex x complex is excluded |
| A shared "bridge" note ties two scents, best in the base | Sand + Fog, Experimental Perfume Club, Glossier | `bridge` term: shared notes weighted by rarity and tier (base-base 1.0 ... top 0.4) |
| Same family is safe; a contrast is more creative | Jo Malone CBE, David Adelon, Space NK | `affinity`: earned by related accords *or* a well-matched contrast |
| Two heavyweights or sweet on sweet turn muddy | Jo Malone method, Perfume Posse tests, Lookfantastic | penalties; heavy + heavy with a complex one is excluded |
| Aquatic + dense gourmand / amber / oud clash | Fragrantica forums, Basenotes | hard exclusion when both accords are strong (>= 0.6) |
| Near-twins only make one perfume louder | WhatScent, Experimental Perfume Club | same scent in another edition, near-duplicates and known dupes are excluded |
| Heavier scent first, lighter on top or on clothing | Maison Margiela, Experimental Perfume Club, ELLE | "How to wear it": order, ratio, placement |
| Some perfumers reject layering altogether | Francis Kurkdjian | a high bar; "nothing clears the bar" is shown as an answer |

## The score

Per perfume (vectorised over a pool of ~13.5k well-known perfumes: >= 250 votes, rating >= 3.6):
accords pooled into 21 *facets*, heaviness / sweetness / freshness from per-accord weights, complexity
(>= 14 notes or >= 7 strong accords), simplicity (<= 6 notes, <= 3 strong accords or a skin-scent enhancer such as Iso E
Super / ambroxan / white musk).

```
score = 0.20 simplicity + 0.26 affinity + 0.18 popularity + 0.14 structure + 0.12 bridge + 0.10 harmony
        - 0.4 x penalties   + 0.35 if a brand, perfumer or editor recommends the pair by name
affinity = max(related accords (capped at cosine 0.8), well-matched contrast (structure x harmony))
harmony  = the facet pair table: +2 classic (citrus + woods, rose + oud, lavender + vanilla ...) ... -2 clash
```

Recommended only when `score >= 0.60` and no hard rule fires. The bar and the labels come from the measured
distribution of ~48k random pairs of pool perfumes that pass the hard rules:

| score | label | share of pairings that score at least this well |
|---|---|---|
| >= 0.74 | Exceptional pairing | ~1% |
| >= 0.67 | Great match | ~4% |
| >= 0.60 | Good match (recommended) | ~12% |
| >= 0.47 | Not much synergy | ~50% |
| below | Weak match | |
| hard rule | Not recommended | 23% of random pairs are excluded outright |

Brand / perfumer pairs are always shown in their own "Recommended by name" section with the source, and our own read
next to them, even when our score disagrees.

## How well does it work? (honest numbers)

Checked against the 64 named pairs (positives) and 1,500 random pairs of popular perfumes (`votes >= 2000`):

* The hard rules exclude **0 of 64** named pairs and **23%** of random pairs.
* The sourced *negative* examples all stay below the bar: Pomegranate Noir + Myrrh & Tonka (0.58), Kayali Vanilla 28
  + Invite Only Amber 23 (0.27), Musk 12 + Eden Juicy Apple (0.58), Santal 33 + Sauvage (0.55), an aquatic + Angel
  (excluded as a documented clash).
* Ranking the named pairs above random ones: the research-weighted score alone was close to chance (AUC 0.51). Fitting
  the weights reached ~0.57-0.60 on a held-out half; the strongest single signals were related accords (0.61),
  popularity (0.60), the penalties (0.58), simplicity (0.55) and bridge notes (0.54). The pair table barely ranks
  (0.51) and is mostly used to *explain*.
* The named pairs lean heavily on brands' own same-line duos (Kayali, Jo Malone, Sol de Janeiro, Margiela), which are
  "amplify" pairs and often sweet on sweet, exactly what independent testers warn about. A purely fitted model would
  have demoted textbook contrasts (Acqua di Parma Colonia + Tobacco Vanille 0.49, Lime Basil & Mandarin + Myrrh &
  Tonka 0.51). The final model credits both modes; those now score 0.64 and 0.71.

So: notes and accords explain a lot about *why* a pair can work, but they cannot reproduce taste. The UI says that, and
community votes (thumbs up / down, ranked by the Wilson lower bound) sit next to our read for every pair.

## Re-checking after changing the model

The calibration scripts used are small; the numbers above can be reproduced with the catalog loaded in Python:

```python
import catalog, layering as L
cat = catalog.Catalog("data/deploy/catalog.db", "remote")     # decompress catalog.db.gz first
m = L.model(cat)                                               # pool, curated pairs (m.curated_missing lists the misses)
L.pair_report(cat, L._resolve(cat, "Jo Malone London", "Pomegranate Noir"), L._resolve(cat, "Jo Malone London", "Myrrh & Tonka"))
```

`app/test_layering.py` pins the rules (clash, near-duplicate, complex x complex, curated bypass, application order,
sparse = dense statistics) on a purpose-built mini catalog. If you change weights or the pair table, re-measure the
score distribution and update `SHOW`, `VERDICTS` and `PERCENTILES` together.

## Ideas for later

* Feed community votes back into the score once there are enough of them (a per-pair prior).
* An "Amplify" mode for deliberately tonal pairs (vanilla + vanilla), clearly separated from "layers well with".
* Moderation of community combos on `/admin` (they are perfume-id pairs only, no free text, so abuse is limited to
  voting).
