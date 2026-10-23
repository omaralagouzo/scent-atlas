# Fragrance Layering: research for a deterministic recommender (Scent Atlas)

Date of research: 2026-10-23. All claims are linked to their source. **How the sources were reached:** Vogue, Allure, Byrdie, Harper's Bazaar (US), Elle.com and Fragrantica article pages, plus most brand sites (jomalone.com, kayali, sephora.com), block the fetch tool. For those I used AOL/Yahoo syndicated copies of the same articles (ELLE, Cosmopolitan, Forbes, Real Simple, StyleCaster) or search-engine snippets of the original page. Each such case is labelled "(via snippet)" or "(syndicated)".

Reliability tiers used throughout:
- **T1**: named perfumer or brand-official guidance.
- **T2**: named editor or industry expert in a recognised publication.
- **T3**: community, retailer blog or anecdote.

---

## 1. Why layering works or fails: principles from perfumery

### 1.1 Volatility and timeline: pair "fresh" (top-heavy) with "deep" (base-heavy)
- A perfume is a timeline of materials evaporating at different rates. Fresh materials (citrus, aquatic, green, herbal; e.g. limonene, marine aldehydes) are bright and short-lived. Deep materials (ambers, woods, resins, musks; e.g. ambroxan, Iso E Super, oud) release slowly over hours. **Fresh + deep take turns**: the fresh one leads and the deep one emerges as the base. **Two fresh scents, or two deep scents, of similar weight "compete for the same moment" and can smell muddy.** A low-volatility base also slows the evaporation of the lighter material. (T1, perfumer Emmanuelle Moeglin's brand, Experimental Perfume Club: https://experimentalperfumeclub.com/blogs/journal/how-to-layer-fragrance-a-perfumers-guide)
- Master perfumer Christophe Laudamiel: "I can do a few spritz of a fresh one on top of several spritzes of a deep one." (T1, Real Simple, syndicated: https://www.aol.com/lifestyle/layer-fragrances-create-signature-scent-133000339.html)
- French ELLE guide: combine "a heavy, long-lasting scent with a light, airy one, such as a citrus cologne." (T2, translated on Bois de Jasmin: https://boisdejasmin.com/?p=196)
- Experimental Perfume Club test at home: one fresh scent plus one deep scent. Apply the deep one to pulse points, then the fresh one on top or on hair/clothing.

**Algorithm implication:** reward pairs where one perfume is top/fresh-dominant and the other is base/deep-dominant (a complementary heaviness profile). Penalise pairs that are both very heavy, and give no reward to pairs that are both very light.

### 1.2 Simple + complex beats complex + complex
- Perfumer David Seth Moltz (D.S. & Durga): "two very complex things generally will clash" (T1, Coveteur: https://coveteur.com/best-perfume-layering-combinations). Also: "More simple scents layer better than already large symphonic fumes… most perfumes are already combos of things perfumers love." (T1, Cosmopolitan, syndicated: https://www.aol.com/fragrance-layering-over-perfumetok-does-195000147.html)
- Experimental Perfume Club: complex multi-material formulas "tend to compete rather than combine", so "keep one side simple, ideally a single note or a near-mono composition." (T1, URL above)
- ISIPCA student and creator Emma (@perfumerism): "I like to layer something complex with something simple because… there's just less margin for error." (T2, Cosmopolitan, URL above)
- Superdrug fragrance expert Haydn Williams: rich, complex fragrances "can end up clashing, rather like discordant musical notes." (T2, Stylist: https://www.stylist.co.uk/beauty/fragrance-layering-tips/1047440)
- French ELLE: "Layer a complex composition with a much simpler one, e.g. rose with patchouli." (T2, https://boisdejasmin.com/?p=196)
- Jo Malone London's Global Head of Fragrance, Céline Roux, explains why the house's colognes layer well: "the more ingredients you have the less clarity you have." The house deliberately uses few ingredients (T1, via snippet of https://www.jomalone.com.hk/en-e-HK/our-stories/philosophy-of-scent-pairing). MioLook's summary of the Jo Malone method makes the same point: 3 to 5 dominant notes make the colognes layerable, while classic French perfumes with big pyramids are "self-sufficient" (T3, https://miolook.com/en/jo-malone-fragrance-layering).

**Algorithm implication:** compute a complexity score per perfume. Reward pairs where at least one side is simple. Penalise pairs where both are complex.

### 1.3 Bridge notes: a shared element ties the two together
- French ELLE: pair scents with a shared element, "such as green notes, a rose accord, or an oriental vanilla base." (T2, https://boisdejasmin.com/?p=196)
- Bridget Gillespie (Sand + Fog): "If both contain sandalwood, vanilla, musk or jasmine, for example, that shared note can help tie them together." (T2, Forbes, syndicated: https://shopping.yahoo.com/beauty/fragrance/articles/fragrance-wardrobe-redefining-perfume-layering-100000706.html)
- Experimental Perfume Club suggests **soft iris, clean musk and classic vanilla** as bridges when two scents share nothing (T1).
- Gustavo Romero (perfumer): pick "two scents that naturally complement each other, either through similar vibes or shared notes." (T2, Real Simple, syndicated, URL above)
- Glossier designed its four "You" flankers to layer because they "share the same warm, musky base note" (Ambrox). (T1, https://uk.glossier.com/pages/fragrance-layering)
- Nicole Eckels (Glasshouse Fragrances): "Start with scents that share a fragrance family or complementary notes." (T2, ELLE, syndicated: https://www.aol.com/perfume-layering-101-mix-match-191200529.html)
- Fragrantica's Miguel Matos picked Chanel Nº5 EDT with Jean Couturier Coriandre because both share a civet base (T2, via snippet: https://www.fragrantica.com/news/Bulletproof-Layerings-6-Perfect-Scent-Couples-7716.html)

**Algorithm implication:** shared notes weighted by rarity (IDF) and by tier. A shared base note matters more than a shared top note, because the base note persists and makes the seam disappear in the drydown.

### 1.4 Same family is safe; contrast is more creative
- Jo Malone CBE: "If unsure, I would recommend combining perfumes from the same family…". Most people gravitate to "woody, citrus or floral" (T1, Irish News/PA: https://www.irishnews.com/life/what-is-scent-layering-and-how-do-you-do-it-SMERLGQB4FI4FLIZ7IQ353LNLU). Jo Malone London stylist Andrea Martelli gives the same advice (T1, via snippet).
- Master perfumer David Adelon: "Layering within the same fragrance family creates seamless harmony… Contrasting notes introduce tension and creativity." (T1, Forbes, syndicated: https://shopping.yahoo.com/beauty/fragrance/articles/fragrance-layer-winter-scents-according-120000368.html)
- MioLook / Jo Malone method: "Combine opposites, such as fresh citrus with spicy wood, or floral with mineral." (T3)
- Space NK: either amplify a shared note (vanilla + vanilla) or use contrast ("adding citrus to a heavy amber"). (T2, https://www.spacenk.com/uk/inside-space/in-focus/fragrance-layering.html)
- Sephora beauty director Myiesha Sewell compares layering to cooking: add citrus to lighten a heavy scent, or something creamy like vanilla for depth. (T2, ELLE, syndicated, URL above)
- French ELLE: **citrus is the safest base** because it blends with floral, woody and ambery scents, and two different "scent worlds" keep the layer from being redundant. (T2, https://boisdejasmin.com/?p=339)

### 1.5 Intensity balance: one leads, the other supports. Two heavies make mud.
- Raquel Bouris (Who Is Elijah): "let one scent lead and the other support… when both are fighting for attention, the magic gets lost." (T2, Irish News/PA, URL above)
- The Jo Malone method explicitly advises against **Pomegranate Noir + Myrrh & Tonka**: two heavy, rich bases become overpowering. (T3, MioLook)
- Lookfantastic: start with two light fragrances. "Layering two complex ones, such as oud-based scents, can be overpowering." (T2, https://lookfantastic.com/blog/advice/how-to-layer-scents)
- Perfume Posse tested **Kayali Vanilla 28 + Invite Only Amber 23** ("Weird, scratchy, sweet thing. Headache-inducing") and **Musk 12 + Eden Juicy Apple** ("Simply too sweet without anything interesting to modify that"). This is the sweet + sweet failure mode. (T2, https://perfumeposse.com/2023/02/26/kayali-perfumes-discovery-layering-set/)
- Laudamiel: "When you get to three or more, you start making 'soups'." (T1, Real Simple, syndicated)

### 1.6 Known clash patterns
| Clash | Evidence |
|---|---|
| Oud + gourmand (both heavy) | PA expert roundup: "Avoid: oud with gourmand, since both are heavy and can overpower each other" (T2, Irish News). Moltz's view is softer: a sweet vanilla or creamy sandalwood can *temper* oud or incense (T1, Coveteur). Reconciliation: light vanilla + oud is OK, dense caramel/chocolate gourmand + oud is risky. |
| Aquatic/marine + amber/oriental/oud | Fragrantica forum consensus that "mixing very different families, like aquatics with orientals, is a common pitfall" (T3, via snippet: https://www.fragrantica.com/board/viewtopic.php?id=342548&p=2). "Aquatic + heavy oud usually fights" (T3, fragplace). |
| Aquatic + dense gourmand | Basenotes "aquatic gourmand" thread: "the gourmand aspect would kill the aquatic note" (T3, https://basenotes.com/threads/aquatic-gourmand.262164/post-1958311). |
| Marine/watery + dry sandalwood/leather (Santal 33 type) | "can smell metallic or like damp cardboard" (T3, WhatScent: https://whatscent.app/magazine/what-to-layer-with-santal-33) |
| Cumin-heavy + sandalwood | exaggerates the sour, "pickle-like" note (T3, WhatScent) |
| Two loud Ambroxan/woody-amber "beasts" (e.g. Dior Sauvage + Santal 33) | "its Ambroxan competes with Santal 33's woody materials" (T3, WhatScent) |
| Two heavy ambers/orientals | Pomegranate Noir + Myrrh & Tonka (T3 MioLook); Vanilla 28 + Invite Only (T2 Perfume Posse) |
| Two complex compositions | Moltz, EPC, Williams (above) |
| Sweet + sweet with nothing to cut it | Perfume Posse (above); Sephora community: a sweet scent amplified "so much it made me sneeze" (T3, https://community.sephora.com/t5/Fragrance-Fans/Olfactory-Overtures-The-Fragrance-Layering-Thread/m-p/7222136) |

### 1.7 Order and placement
- **Heavier or stronger first, lighter on top.** French ELLE: "spray the stronger perfume first" so the second joins its heart and base (T2, https://boisdejasmin.com/?p=339). Experimental Perfume Club: deep first on pulse points, fresh on top or on hair/clothing (T1). MarieAnna Ferdinand (Le Monde Gourmand): "start with the warmer or richer scent first… let it dry down" (T2, Irish News). Mona Kattan: start with musks and ouds, then florals and botanicals, finish with citrus or spice (T2, Glamour SA: https://glamour.co.za/beauty/perfume-layering-101-all-the-dos-and-the-donts-from-the-queen-of-layering-mona-kattan-plus-the-best-combos-to-consider-723ac493-e823-495e-ad1a-6173f8e08961). Maison Margiela: "Apply the more powerful scent first, let it settle for a few minutes, then layer the lighter one". Also: one on pulse points, the other on clothing (T1, https://www.maisonmargiela-fragrances.eu/en_GB/layering-replica-memories/layering-replica-memories.html).
- Counterpoint: Jo Malone London says order doesn't matter *for its own colognes* (T1, via snippet), because they are all light.
- Ratio: the deep one usually gets more sprays (Laudamiel). The Jo Malone method uses 2 sprays of base to 1 of top (T3, MioLook).
- **UI implication:** order is deterministic. Show "Apply first" for the heavier perfume (higher base weight) and "Then" for the lighter one, optionally "on clothing".

### 1.8 Dissent: layering is not universally endorsed
Francis Kurkdjian: "It's my job to create a perfume… your perfumes are not good enough to stand by themselves" (T1, W Magazine: https://www.wmagazine.com/story/francis-kurkdjian-perfumer-interview). Bois de Jasmin also frames the "purist vs experimentalist" schools (https://boisdejasmin.com/?p=339). **Implication:** be conservative and only show pairs above a confidence threshold. "No recommendation" is a valid output.

### 1.9 The Michael Edwards wheel as a prior
The wheel has 4 families and 14 subfamilies, in circular order: Floral, Soft Floral, Floral Amber, Soft Amber, Amber, Woody Amber, Woods, Mossy Woods, Dry Woods, Aromatic, Citrus, Water, Green, Fruity. In 2010, Aromatic was moved between Dry Woods and Citrus to match smell-perception studies (https://en.wikipedia.org/wiki/Fragrance_wheel). Neighbouring subfamilies share characteristics (https://fragplace.com/en/blog/understand-fragrance-families-to-enhance-your-collection.md). **I found no primary Edwards source that prescribes layering rules**, so use the wheel only as a weak prior: neighbours mean "harmony", opposite means "contrast". Do not treat opposite as a clash: citrus + amber sit far apart on the wheel and are among the most-recommended pairs.

---

## 2. Accord/family-level pairings

### 2.1 Classic pairings, with sources
| Pair | Score | Evidence |
|---|---|---|
| Rose + oud | +2 | Called "obvious" by Fragrantica's Miguel Matos (Tea Rose + Dahn Oud Al Shams, T2 via snippet). Moltz: Rose Atlantic + Radio Bombay gives a "gulab attar" (T1, Coveteur). Jo Malone officially pairs Myrrh & Tonka with Velvet Rose & Oud (T1 via retailer copy). Atomic Rose + Oud for Greatness (T3, Lexor Miami). |
| Rose + patchouli | +2 | French ELLE gives it as the archetypal simple + complex layer (T2). Listed as a classic by a perfumer in the PA roundup (T2 via snippet). |
| Citrus + woods | +2 | PA roundup "citrus with woods" (T2). Demi Rawling: citrus complements light woody, so Molecule 01 + Light Blue (T2, Harper's Bazaar Arabia via snippet). French ELLE: citrus is the safest base (T2). |
| Citrus + amber/oriental | +2 | Space NK "adding citrus to a heavy amber" (T2). Ellena: Opium + Orange Sanguine / Orange Cannelle (T1, BdJ). Sewell: citrus lightens a heavy scent (T2). |
| Vanilla + citrus | +2 | Moltz: "Vanilla with tangerine" (T1, Cosmopolitan). Leila Zagwolsky: citrus over vanilla or coconut is "uplifting" (T2, Yahoo). |
| Vanilla + woods / incense | +2 | Nicole Mancini (DSM-Firmenich perfumer): a vanilla gourmand with a floral or woody fragrance "can enhance depth without overwhelming the sweetness" (T1, WhoWhatWear via snippet). Adelon: Spiritueuse Double Vanille + Tam Dao (T1). Zagwolsky: woody/amber under vanilla (T2). |
| Vanilla + floral | +1 | Mancini (T1). Kayali Yum Pistachio Gelato + Déjà Vu White Flower (T1 brand). |
| Cedar + vetiver | +2 | Moltz: "Cedar with Vetyver" (T1). Keta Burke-Williams: vetiver "grounds everything" (T2, Coveteur). |
| Amber + pepper/spice | +2 | Adelon: Ambre Sultan + a black-pepper scent (T1). Margiela's "spicy gourmand" Jazz Club + Afternoon Delight (T1). |
| Amber + oud / leather (autumn) | +1 | PA roundup (T2). Keep heaviness in check. |
| Amber + woods | +1 | Lookfantastic (T2). |
| Musk + almost anything | +1 | PA roundup "musks with almost anything" (T2). Glossier's shared-musk system (T1). EPC names clean musk as a universal bridge (T1). |
| Iris + musk | +2 | EPC: soft iris and clean musk as bridges (T1). Margiela Lazy Sunday Morning (iris and white musk) is the partner in two official combos (T1). |
| Oud/incense tempered by vanilla or sandalwood | +1 | Moltz (T1, Coveteur). Conflicts with the PA "avoid oud + gourmand" (T2). Resolve by density: light vanilla +1, dense gourmand −1. |
| Lavender/aromatic + vanilla/tonka | +2 | The fougère/oriental structure. Jo Malone's Myrrh & Tonka is itself lavender + myrrh + tonka. PA roundup: a vanilla/oud base topped with lavender or jasmine (T2). |
| Patchouli + florals | +1 | Keta Burke-Williams' signature: Diptyque Tempo + Glossier You (T2, Coveteur). |
| Salt/mineral + citrus or woods | +1 | Kyle Ferguson: salt makes a scent "fresh and mineral" (T2, Coveteur). Jo Malone pairs Wood Sage & Sea Salt with Grapefruit or English Oak & Hazelnut (T3 retailer). Lime Basil & Mandarin + Wood Sage & Sea Salt (T3). |
| Fruit + green/herbal | +1 | Blackberry & Bay structure. Jo Malone pairs Lime Basil & Mandarin with Blackberry & Bay (T1 via snippet). |
| Fruity + woody | +1 | Jo Malone official Blackberry & Bay + English Oak & Hazelnut, "fruity and woody" (T1 via snippet). |
| Fruity + floral | +1 | Peony & Blush Suede + English Pear & Freesia/Sweet Pea (T1). |
| Pear/fruit + mineral/salt | +1 | Wood Sage & Sea Salt + English Pear & Freesia (T1, sold as a duo by Sephora). |
| Tea + citrus | +1 | Jo Malone Earl Grey & Cucumber + Grapefruit (T3, reader comment on mywomenstuff.com). Bergamot is the classic Earl Grey bridge. |
| Fig + sandalwood/woods | +1 | Philosykos + Tam Dao (T3, reader comment, BdJ). Santal 33 + Philosykos (T3, WhatScent). |
| Coffee/tobacco/rum + vanilla | +2 | Margiela Jazz Club (rum, tobacco) + Afternoon Delight (vanilla madeleine) is official (T1). Tobacco + vanilla is also the internal structure of many classics. No separate layering source is needed: it is a well-documented accord, e.g. Tobacco Vanille, described as linear tobacco plus sweetness (Parfumo review, T3). |
| Coconut/solar + amber/vanilla | +1 | Ambre et Vanille + Still Life in Rio "turns into an extremely rich suntan lotion" (T2, Fragrantica via snippet). Margiela's "Coastal Campfire": Beach Walk (coconut, solar) + By the Fireplace (T1). |
| Smoky + crisp, soft + sharp | +1 | PA roundup (T2): the general contrast principle. |

### 2.2 Clashing or risky pairings
| Pair | Score | Evidence |
|---|---|---|
| Aquatic/marine + heavy amber/oriental/oud | −2 | Fragrantica forum pitfall, fragplace (T3). Volatility mismatch with no bridge. |
| Aquatic/marine + dense gourmand (caramel, chocolate, praline) | −2 | Basenotes thread (T3). Watery-metallic materials read as "off" against sugar. |
| Oud + dense gourmand | −1 | PA roundup (T2), softened by Moltz (T1). |
| Two heavy ambers/orientals/gourmands | −1 (−2 if both complex) | MioLook / Jo Malone (T3), Perfume Posse (T2), Lookfantastic (T2). |
| Two loud Ambroxan/woody-amber "beasts" | −1 | WhatScent (T3). Also redundant. |
| Marine/ozonic + dry leather/sandalwood (Santal 33 type) | −1 | WhatScent (T3). |
| Cumin/sweaty spice + sandalwood | −1 | WhatScent (T3). |
| Multiple strong animalics (civet + castoreum + oud-barnyard) | −1 | **Inferred** (no direct source). Note the Nº5 + Coriandre shared civet works, but there the civet is subtle. Use only when both animalic accords are ≥ 0.6. |
| Green/bitter galbanum + heavy sweet gourmand | −1 | **Inferred** from the "fresh citrus + dense gourmand can clash" claim (T3, fragplace); weak. |

### 2.3 Family compatibility matrix
Score scale: +2 classic, +1 good, 0 neutral/unknown, −1 risky, −2 clash. The matrix is symmetric, so only the upper triangle is shown. The diagonal ("same family") means the same *dominant* family, i.e. the amplify mode (see §5.6).

| | citrus | fruity | floral | green | spicy | woody | resin/amber | musky/anim. | gourmand | aquatic | herbal/arom. | other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **citrus** | 0 | +1 | +1 | 0 | +1 | **+2** | **+2** | +1 | +1 | +1 | +1 | 0 |
| **fruity** | | 0 | +1 | +1 | +1 | +1 | +1 | 0 | 0 | 0 | 0 | 0 |
| **floral** | | | +1 | +1 | +1 | **+2** | +1 | **+2** | +1 | 0 | 0 | 0 |
| **green** | | | | 0 | 0 | +1 | +1 | +1 | −1 | 0 | +1 | 0 |
| **spicy** | | | | | 0 | **+2** | **+2** | +1 | +1 | −1 | +1 | 0 |
| **woody** | | | | | | +1 | **+2** | **+2** | **+2** | +1 | +1 | 0 |
| **resin/amber** | | | | | | | −1 | +1 | +1 | **−2** | +1 | 0 |
| **musky/anim.** | | | | | | | | 0 | +1 | +1 | +1 | 0 |
| **gourmand** | | | | | | | | | 0 | **−2** | +1 | 0 |
| **aquatic** | | | | | | | | | | 0 | +1 | 0 |
| **herbal/arom.** | | | | | | | | | | | 0 | 0 |
| **other** | | | | | | | | | | | | 0 |

Justification for the non-zero cells:
- **citrus–fruity +1**: both are fresh-fruity. Grapefruit is an official Jo Malone combiner for English Pear & Sweet Pea (T1). Not +2, because both are volatile (EPC: two fresh scents compete).
- **citrus–floral +1**: PA roundup "floral with citrus" (T2). Emma Gonsalves: "Florals and citrus notes provide a fresh, light scent" (T2, StyleCaster/Yahoo). Ellena: Diorissimo + Cool Water Woman; Anaïs Anaïs + Acqua di Giò (T1).
- **citrus–spicy +1**: MioLook "fresh citrus with spicy wood" (T3). Opium + Orange Cannelle (Ellena, T1).
- **citrus–woody +2 / citrus–amber +2**: see §2.1. These are the most repeated recommendations across all tiers.
- **citrus–musky +1**: musks go with anything (T2). Molecule 01 + citrus lengthens longevity (T3, Parfumo forum).
- **citrus–gourmand +1**: vanilla + citrus is endorsed (T1/T2). Dense gourmands are the exception, handled at accord level (caramel/chocolate + citrus = 0).
- **citrus–aquatic +1**: Lime Basil & Mandarin + Wood Sage & Sea Salt "coastal" (T3). Salt + citrus (T2, Coveteur). Only +1, because both are volatile.
- **citrus–herbal +1**: "herbs with citrus" is a classic per a perfumer in the PA roundup (T2 via snippet). The cologne structure.
- **citrus–green 0**: compatible but both fleeting (EPC).
- **fruity–floral +1**: fruity-floral is the most common modern structure. Peony & Blush Suede + English Pear & Sweet Pea (T1).
- **fruity–green +1**: Blackberry & Bay structure. Lime Basil & Mandarin + Blackberry & Bay (T1 via snippet).
- **fruity–spicy +1**: Pomegranate Noir structure (pomegranate + pink pepper). Pomegranate Noir + Lime Basil & Mandarin (T3).
- **fruity–woody +1**: Blackberry & Bay + English Oak & Hazelnut (T1).
- **fruity–amber +1**: BR540 + Nectarine Blossom & Honey (T3, fragplace). Kayali Vanilla 28 + Lovefest Burning Cherry (T1).
- **fruity–musky 0 / fruity–gourmand 0**: Kayali officially recommends Vanilla 28 + Eden Juicy Apple (T1). Perfume Posse found Musk 12 + Eden "simply too sweet" (T2). Net 0, and let the sweetness penalty decide.
- **floral–floral +1**: "Two rose-based fragrances, or a rose-based fragrance with a jasmine one" (T2, Lookfantastic). Ellena: Joy + Ombre Rose; Arpège + Diorissimo (T1).
- **floral–green +1**: Ellena: Nº5 + Après l'Ondée. ELLE: Eau de Campagne + Rose Ikebana (reader comment). Star Magnolia + Wood Sage & Sea Salt "green airy contrast" (T3).
- **floral–spicy +1**: L'Air du Temps + Caron Poivre (Ellena, T1). "spicy notes with florals" (T3).
- **floral–woody +2**: "floral + woody combos often work" (T3, Sephora community). Moltz rose + wood (T1). Mancini floral or woody + vanilla (T1). Ysatis/Womanity + Féminité du Bois (T1/T2).
- **floral–amber +1**: Floral Amber is a wheel neighbour. Opium + Fleurs d'Oranger (Ellena, T1). BR540 (amber-floral) pairings.
- **floral–musky +2**: Glossier You Fleur over the musky You base (T1). Missing Person (white musk + jasmine) + Vanilla Skin (T1). Mûre et Musc + White Musk (T2). White Musk Body Cream under JHAG (T2, ELLE).
- **floral–gourmand +1**: Mancini (T1). Kayali Pistachio Gelato + Déjà Vu White Flower (T1).
- **green–woody +1**: wheel adjacency via aromatic/mossy woods. Sisley Eau de Campagne pairings (T2).
- **green–amber +1**: fresh vs deep contrast (EPC). Weak direct evidence.
- **green–musky +1**: musks go with anything (T2).
- **green–gourmand −1**: inferred, weak (see §2.2).
- **green–herbal +1**: both aromatic-fresh. Cucumber/basil colognes.
- **spicy–woody +2**: "woody with spicy oriental" (T2, PA). Santal 33 (cardamom + woods) + Ombré Leather (T3). Cuir de Russie + Féminité du Bois (T2).
- **spicy–amber +2**: Adelon amber + pepper (T1). Lumière d'Épices + Orange Sanguine (T3).
- **spicy–musky +1**: Parfum Sacré + Narciso Rodriguez Essence ("musk softens the spices", T3 BdJ).
- **spicy–gourmand +1**: Margiela "Spicy Gourmand" official (T1).
- **spicy–aquatic −1**: inferred, a warm-spice vs watery-metallic conflict. The same mechanism as aquatic + oriental (T3).
- **spicy–herbal +1**: aromatic fougères and fresh spices (cardamom, pepper) co-occur constantly.
- **woody–woody +1**: Moltz "Cedar with Vetyver" (T1). Ourside "Of Our Own" (vetiver) + "Moon Dust" (cedar) (T2, Coveteur).
- **woody–amber +2**: Lookfantastic (T2). Zagwolsky (T2). The Woody Amber subfamily exists for this reason.
- **woody–musky +2**: Iso E Super/ambroxan "enhancers" layer over anything (Stylist, Cosmopolitan). Molecule 01 + Light Blue (T2).
- **woody–gourmand +2**: Mancini (T1). Spiritueuse Double Vanille + Tam Dao (T1).
- **woody–aquatic +1**: sea salt + woods (Wood Sage & Sea Salt + English Oak & Hazelnut, T3). Downgraded for dry sandalwood + marine (§2.2).
- **woody–herbal +1**: Aromatic sits between Dry Woods and Citrus on the 2010 wheel.
- **amber–amber −1**: two heavies (§1.5).
- **amber–musky +1**: musk softens amber. BR540 boosts weaker scents (T3, Parfumo).
- **amber–gourmand +1**: amber + vanilla is classic (Vanilla 28 is itself amber-vanilla), but heaviness often fails (Vanilla 28 + Invite Only). The heaviness penalty applies separately.
- **amber–aquatic −2 / gourmand–aquatic −2**: §2.2.
- **amber–herbal +1**: lavender + resins/tonka (Myrrh & Tonka). "vanilla, resins and bergamot" listed as classic (T2 via snippet).
- **musky–gourmand +1**: Vanilla 28 + Musk 12 (Mona Kattan, T2). Missing Person + Vanilla Skin (T1).
- **musky–aquatic +1, musky–herbal +1**: musk is a universal bridge (T1/T2).
- **gourmand–herbal +1**: lavender + vanilla. Skylar Vanilla Sky + Libre Intense (lavender) (T2, Daily Vanity).
- **aquatic–herbal +1**: fresh-aromatic aquatics (Light Blue pour Homme / Acqua di Giò style). Weak direct evidence.

### 2.4 Accord-level overrides (more specific than family)
Apply these when **both** perfumes carry the accord at ≥ 0.5. They override the family cell.

- **+2:** rose↔oud, rose↔patchouli, iris↔musky, lavender↔vanilla, coffee↔vanilla, tobacco↔vanilla, rum↔vanilla, citrus↔woody, citrus↔amber, vanilla↔citrus, vanilla↔woody, cedar/woody↔vetiver (note level), amber↔warm spicy.
- **+1:** salty/mineral↔citrus, salty↔woody, fruity↔green, tea (note)↔citrus, fig (note)↔woody/coconut (note)↔amber/vanilla, leather↔iris/violet/powdery (Cuir de Russie + Féminité du Bois; Cuir d'Ange + Iris Ukiyoé, T3), oud↔amber, oud↔vanilla (light), white floral↔musky, patchouli↔floral, soft spicy↔woody, honey↔floral (Nectarine Blossom & Honey pairing with Velvet Rose & Oud, T1).
- **−2:** aquatic/marine/ozonic↔caramel/chocolate/honey/sweet (if sweet ≥ 0.7), aquatic/marine↔oud/amber/balsamic.
- **−1:** oud↔caramel/chocolate, animalic↔animalic, metallic↔gourmand (inferred), marine↔leather.

---

## 3. Curated perfume-to-perfume combos
The full list is in `app/layering_curated.json` (69 pairs). Names are ASCII-folded (e.g. "Deja Vu", "Apres l'Ondee"), so match on accent-folded, lowercased brand+name, and treat "Maison Margiela" = Fragrantica's "Maison Martin Margiela", "Thierry Mugler" = "Mugler". Source mix:
- **Brand-official (T1):** Maison Margiela (4 named combos), Kayali/Mona Kattan (8), Jo Malone London (11), Sol de Janeiro (3), Phlur (1), Glossier (3).
- **Perfumer-recommended (T1):** David Seth Moltz (2), David Adelon (3), November Nichols (1), Jean-Claude Ellena via French ELLE (8).
- **Editor/expert (T2):** Coveteur, ELLE/Sephora's beauty director, Harper's Bazaar Arabia, Fragrantica's Miguel Matos, Daily Vanity, French ELLE 2003.

Caveats:
- The Ellena and French ELLE lists date from the 1990s to 2003. Several are vintage or discontinued (Caron Poivre, Shiseido Féminité du Bois is now Serge Lutens). They are useful as perfumer-grade structure examples, but give them a lower "show to users" priority.
- Brand-official intra-brand pairs (Jo Malone, Kayali, Margiela, Glossier) are the most defensible, but they are self-promotional.
- I could not verify a published source for several pairs that are often claimed online, so they are **excluded**: Santal 33 + Another 13 (only a Reddit anecdote), Jazz Club + By the Fireplace (no source; both warm), Cloud + Lazy Sunday Morning (unverifiable), Tobacco Vanille + Oud Wood (none), Molecule 01 + Santal 33 (none), BR540 + Vanilla 28 (none). Adelon's "Ambre Sultan + Ermenegildo Zegna Poivre Noir" is also excluded: I could not confirm the Zegna perfume exists.

**Curated negative examples (use as test cases that must score low):**
| A | B | Why | Source |
|---|---|---|---|
| Jo Malone Pomegranate Noir | Jo Malone Myrrh & Tonka | two heavy rich bases become overpowering | https://miolook.com/en/jo-malone-fragrance-layering |
| Kayali Vanilla 28 | Kayali Invite Only Amber 23 | sweet + sweet amber-vanilla: "scratchy… headache-inducing" | https://perfumeposse.com/2023/02/26/kayali-perfumes-discovery-layering-set/ |
| Kayali Musk 12 | Kayali Eden Juicy Apple 01 | "Simply too sweet without anything interesting to modify that" | same |
| Le Labo Santal 33 | Dior Sauvage (full dose) | competing Ambroxan/woody materials | https://whatscent.app/magazine/what-to-layer-with-santal-33 (T3) |
| Le Labo Santal 33 | a Santal 33 dupe | "near-twins only make the same scent louder" | same (T3) |

---

## 4. Layering-friendly archetypes and how to detect them

### 4.1 Archetypes the sources name
1. **Skin-scent / enhancer bases** built on one or two aroma-chemicals: Escentric Molecules Molecule 01 (pure Iso E Super, https://escentric.com/pages/about-escentric-molecules), Juliette Has a Gun Not a Perfume (Cetalox/Ambroxan, which "can play wingman to boost the performance of another fragrance", Space NK copy via snippet), Le Labo Another 13 (ambroxan, Iso E Super; "folks love layering this one", InsideHook: https://www.insidehook.com/grooming/best-le-labo-fragrances), Glossier You (Ambrox base), D.S. & Durga I Don't Know What (sold as an "enhancer"). Haydn Williams says enhancers "add a 'third dimension' and a sparkle to other fragrances, without overpowering them" (Stylist). Cosmopolitan lists I Don't Know What, Glossier You and Not a Perfume as skin-scent bases. Space NK: use a skin scent "like a makeup primer". CaFleurBon's Mark Behnke: single-molecule scents "are not really meant to be worn by themselves", and they saturate the nose after a few hours (https://cafleurebon.com/cafleurebon-modern-masterpieces-escentric-molecules-molecule-01-chemistry-in-a-bottle/).
2. **Musk bases**: Kayali Musk 12, Phlur Missing Person, The Body Shop White Musk (ELLE's "Bobo" combo), Initio Musk Therapy (StyleCaster: a "base/grounding" layer).
3. **Linear vanilla bases**: Kayali Vanilla 28, Phlur Vanilla Skin, Guerlain Spiritueuse Double Vanille. These are the most frequent "base" in editorial combos.
4. **Few-note colognes and soliflores**: Jo Malone London colognes (3 to 5 dominant notes; designed for "Fragrance Combining"), Replica (memory-themed, few notes), Sol de Janeiro mists, Kayali, Ellis Brooklyn and other mists (Space NK and Daily Vanity often use body mists as the top layer).
5. **Citrus colognes as the universal topper**: French ELLE "citrus is the safest base". Hermès Eau d'Orange Verte, Atelier Orange Sanguine and Eau de Cédrat appear repeatedly in Ellena's and ELLE's lists. Sephora's Sewell says D&G Light Blue "brightens any fragrance it's layered with".
6. **Complex "symphonic" perfumes** (Shalimar, Nº5, Mitsouko, Opium, Angel, BR540) are the *complex side*. They should be paired with one of 1 to 5, never with each other. Ellena's own list follows this rule: Shalimar + Pour un Homme (a lavender-vanilla fougère), Angel + L'Eau d'Issey (a light aquatic floral, chosen as contrast).

### 4.2 Detection heuristics with your fields
Let `notes` = the union of top, middle, base and general notes, and `A` = the accord vector (0 to 1).

- **Molecule/enhancer flag (strong):** notes contain any of {iso e super, ambroxan, ambrox, ambroxide, cetalox, ambrofix, cashmeran, javanol, ambrettolide, habanolide, helvetolide, galaxolide, white musk, clean musk, skin musk, ambrette} **and** `len(notes) ≤ 6`. Also a name/brand regex: `Escentric Molecules`, `^Molecule \d`, `Not a Perfume`, `Another 13`, `I Don't Know What`, `Glossier You`, `\bskin\b`, `\bmusk\b|\bmusc\b` in the name, `Clean Reserve Skin`, `Phlur Missing Person`. Iso E Super's tendency to saturate the nose argues for a *base* role, not a topper.
- **Linear/simple:**
  - `n_notes ≤ 6` (or general-list length ≤ 5), or
  - accord entropy low: `max(A) ≥ 0.9` and the second-highest accord ≤ 0.6, or fewer than 4 accords ≥ 0.4, or
  - no pyramid (flat "general" list) with ≤ 7 notes. Many linear scents are listed flat.
- **Complex:** `n_notes ≥ 14`, or ≥ 7 accords ≥ 0.4, or high accord entropy (Shannon entropy of normalised A > 2.3 bits). Classics (year < 1990) with full pyramids and aldehydic/chypre/animalic accords skew complex.
- **Opening provider (good topper):** `fresh_score = Σ A[a] for a ∈ {citrus, aquatic, marine, ozonic, fresh, green, aromatic, herbal, fresh spicy, aldehydic, fruity, tropical}` is high **and** heaviness (below) is low. With a pyramid: the top tier holds ≥ 40% of notes and the base is light (no heavy base notes, or ≤ 2 base notes).
- **Drydown provider (good base):** heaviness high. Base tier holds vanilla, tonka, amber, benzoin, labdanum, oud, sandalwood, patchouli, musk, leather or incense.
- **Heaviness H ∈ [0,1]:** `H = Σ A[a]·w[a] / Σ A[a]` with
  - `w = 1.0` for {amber, balsamic, vanilla, oud, leather, tobacco, animalic, smoky, caramel, chocolate, honey, rum, whiskey, coffee, patchouli, warm spicy, sweet, cinnamon, earthy, almond, cherry, coconut}
  - `w = 0.5` for {woody, powdery, musky, iris, rose, tuberose, white floral, yellow floral, floral, soft spicy, lactonic, mossy, violet, conifer}
  - `w = 0.0` for {citrus, fresh, aquatic, marine, ozonic, green, aromatic, herbal, fresh spicy, aldehydic, metallic, salty, mineral, lavender, camphor, fruity, tropical}
  - Tune with your accord list. "sweet" is heavy for layering purposes because the sweet + sweet failure is the main documented failure.
- **Sweetness S** = max or weighted mean of {sweet, vanilla, caramel, honey, chocolate, almond, cherry, coconut, fruity×0.5, rum×0.5}.
- **Flat-list perfumes (28%):** derive a pseudo-pyramid from a note-volatility lexicon. Top: citrus peels, aldehydes, herbs, light fruits, pepper. Middle: florals, spices, tea. Base: woods, resins, musks, vanilla/tonka, amber, leather, oud, moss. Compute H from both accords and the lexicon, and mark `tier_confidence = low` so bridge tier weights fall back to a flat weight.

---

## 5. Proposed scoring algorithm

### 5.1 Candidate pool (anti-junk) — hard filters on B (and on A for the "From" side display)
- `vote_count ≥ 300` (or top ~10–15k perfumes by votes; tune for ~8–15k candidates), `rating ≥ 3.6/5` (Fragrantica scale; adjust), name/brand non-empty, has ≥ 4 notes **or** ≥ 4 accords with strength ≥ 0.2 (enough data to reason about).
- Exclude: "body lotion/shower gel/candle/hair mist/deodorant" product types if present in name, test/tester/sample duplicates; very obscure brands (brand total votes < X).
- Prefer in-production: optional demotion for year < 1985 unless votes are very high (vintage pairs from Ellena can stay curated).

### 5.2 Hard exclusions (pair-level)
1. **Same scent**: same brand AND normalized name equal after stripping concentration/flanker tokens {eau de parfum, eau de toilette, edp, edt, parfum, extrait, intense, elixir, le parfum, absolu, cologne intense, body mist, hair mist, perfume oil, 20xx}. (Glossier You + You Fleur stays allowed: different names.)
2. **Near-duplicate**: `cos(A_vec(a), A_vec(b)) ≥ 0.93` AND `jaccard(notes) ≥ 0.55` → not a layering recommendation (WhatScent: near twins "only make the same scent louder"; EPC: same-weight scents compete). Optionally show in a separate "Amplify" rail (see 5.6), never as "layers well".
3. **Hard clash**: any −2 accord override fires with both strengths ≥ 0.6 (aquatic/marine/ozonic × dense gourmand or amber/oud/balsamic).
4. **Mud rule**: `H_a ≥ 0.75 AND H_b ≥ 0.75 AND (complex_a OR complex_b)` → exclude; if both heavy but both simple → allowed with a penalty (e.g. Kayali Vanilla 28 + Lovefest is brand-official, both fairly heavy-simple).
5. **Sweet overload**: `S_a ≥ 0.8 AND S_b ≥ 0.8 AND fresh_a < 0.3 AND fresh_b < 0.3` → exclude unless a ≥+2 accord override exists (pistachio-vanilla type duos are legitimately brand-recommended, so keep this one soft: big penalty rather than exclude if you'd rather not lose Kayali-type pairs).
6. **Complex × complex**: `complex_a AND complex_b` → exclude (Moltz/EPC/Williams).

### 5.3 Score components (all in [0,1] unless noted)
Let `a` = query perfume, `b` = candidate.

1. **Bridge (B_bridge)**: shared notes weighted by IDF and tier:
   `bridge = Σ_{n ∈ notes_a ∩ notes_b} idf(n) · t(tier_a(n), tier_b(n))` where `idf(n) = log(N / df(n))` normalized to [0,1] by dividing by the max idf among shared; `t = 1.0` base∩base, 0.8 base∩mid, 0.6 mid∩mid, 0.4 involving top, 0.6 if either is flat-list. Cap: `bridge = min(1, bridge / 2.0)`. Down-weight ubiquitous notes (musk, bergamot, sandalwood, vanilla) via idf but whitelist the documented bridges (iris, musk, vanilla, sandalwood, jasmine, rose — EPC + Sand+Fog) with a floor idf of 0.5 so they still count. Also an accord bridge: `Σ_a min(A_a, B_a)` over accords where both ≥ 0.5, normalized.
2. **Family/accord compatibility (B_compat ∈ [−1, 1])**: `Σ_{i,j} fa_i · fb_j · M[i][j] / 2` where `fa`, `fb` are normalized family distributions (from your note families) and M is the §2.3 matrix; then add accord overrides from §2.4: for each override pair (x,y) with `A_a[x]·A_b[y] ≥ 0.25` (or symmetric), add `0.25·score·min(A_a[x], A_b[y])`; clip to [−1, 1].
3. **Structural complementarity (B_struct)**: 
   - weight contrast: `wc = |H_a − H_b|` (best when one is a drydown provider, the other an opening provider); give a hump: `wc_score = 1 − |(H_a − H_b) − sign·0.45| / 0.45` clipped, or simply `min(1, |H_a − H_b| / 0.45)`.
   - fresh/deep role: `role = max(open_a·drydown_b, open_b·drydown_a)`.
   - `B_struct = 0.5·wc_score + 0.5·role`.
4. **Simplicity (B_simple)**: `1.0` if one side simple and other complex; `0.8` if both simple; `0.3` if one medium + one complex; `0` if both complex (already excluded). Bonus `+0.2` if either is an enhancer/skin-scent base (§4.2), capped at 1.
5. **Similarity sweet spot (B_sim)**: `s = cos(A_vec)`; `B_sim = exp(−((s − 0.55)/0.25)^2)` — peaks for related-but-different pairs (shares a bridge yet differs in structure), low for near-duplicates and for totally unrelated pairs.
6. **Popularity prior (B_pop)**: `log10(votes_b) / log10(max_votes)` × rating_norm. Small weight; only a tiebreaker.
7. **Curated boost**: if (a,b) is in curated_pairs → `+0.35` and label "Editor's pick" with source link; if a≠b but same brand line as a curated pair, no boost.

**Penalties**
- `P_heavy = max(0, min(H_a, H_b) − 0.6) · 1.5` (two heavies)
- `P_sweet = max(0, min(S_a, S_b) − 0.65) · 1.5`
- `P_fresh_fresh = max(0, 0.25 − max(H_a, H_b)) · 1.0` (two very light — fleeting, little to gain; mild)
- `P_animalic = 0.3` if both animalic ≥ 0.6
- `P_loud_woody_amber = 0.25` if both have Ambroxan/Iso E-dominant woody-amber profile (woody ≥ 0.7 & amber ≥ 0.5 & notes contain ambroxan/ambergris/iso e super) — redundant & competing.

**Final**
```
score = 0.22·B_bridge + 0.22·norm(B_compat) + 0.20·B_struct + 0.14·B_simple
      + 0.12·B_sim + 0.04·B_pop + curated_boost
      − (P_heavy + P_sweet + P_fresh_fresh + P_animalic + P_loud_woody_amber)
```
with `norm(x) = (x + 1)/2`. Show only `score ≥ τ` (start τ ≈ 0.55; calibrate so that ≥ 80% of curated positives are in top-20 for their partner and ≤ 5% of curated negatives pass). Return at most 8–12, and it's fine to return 0–3.

**Diversity**: after ranking, apply MMR (λ≈0.7) on candidates' accord vectors so the list isn't 10 near-identical vanillas; also cap 2 per brand (except the query's own brand line, which may get 3 since many brands design intra-line layering — Jo Malone, Kayali, Replica, Glossier, Sol de Janeiro).

### 5.4 Order of application (deterministic)
`first = argmax(H)`; if |H_a − H_b| < 0.1, first = the one with higher base-note share. Copy: "Apply **{first}** first on pulse points, let it settle a minute, then **{second}** on top (or on clothing for a lighter effect)." — Margiela/EPC/ELLE. Ratio hint: if H difference ≥ 0.3 → "2 sprays : 1 spray" (heavier gets more, per Laudamiel) (there is no sillage data, so don't try to adjust for projection).

### 5.5 Human-readable "why this works" — rule → template
Generate 1–3 chips from the largest positive contributors, plus one optional caution chip.
| Trigger | Chip text |
|---|---|
| top bridge note n (base tier) | "Bridge note: {n} runs through both drydowns" |
| top bridge note n (other tier) | "Shared note: {n} ties them together" |
| accord override +2 (x,y) | "Classic pairing: {x} + {y}" (e.g. "Classic pairing: rose + oud") |
| role: a opening, b drydown | "{b}'s {base accord} base anchors {a}'s {top accord} opening" |
| contrast fresh/sweet | "Contrast: {fresh accord} cuts {sweet accord}" |
| simple+complex | "{simple} is linear/single-note, so it won't fight {complex}'s structure" |
| enhancer | "{b} is a skin-scent enhancer ({molecule}) — it amplifies rather than competes" |
| same family, bridge | "Same family ({family}), different facets — a seamless blend" |
| curated | "Editor's pick — recommended by {source name}" (link) |
| caution: both fairly heavy | "Go light: both are rich — 1 spray each" |
| caution: both sweet | "Sweet on sweet — use sparingly" |
Pick the dominant accord names from the top-2 accords of each perfume for the slots.

### 5.6 Near-duplicates: what sources say
- **In favour of "same-ish"**: Space NK — pair a fragrance with another sharing the same note to *amplify* (vanilla + vanilla) (T2); Sol de Janeiro FAQ — base + another from the same family for depth/longevity (T1); Jo Malone CBE & JML stylists — same family if unsure (T1); Glossier designed shared-base flankers (T1); Emma (@perfumerism) — start with similar notes (rose + rose products) (T2).
- **Against twins**: WhatScent — near-twins/dupes only make the same scent louder (T3); EPC — same-weight scents compete (T1); Kurkdjian — skeptical of layering at all (T1).
- **Resolution**: "same family / shared bridge" ≠ "duplicate". Recommend *related but different* (cosine ~0.35–0.8, enforced via B_sim hump and the near-dup exclusion). Optionally expose a separate, clearly labelled **"Amplify"** mode for very similar pairs (e.g., a perfume with its own body mist, or two vanillas), never mixed into "Layers well with".

### 5.7 Practical implementation notes
- Precompute per perfume: H, S, fresh, open/drydown, complexity, enhancer flag, normalized family vector, accord vector (fixed order), note set with tiers, idf per note. Store candidate pool as dense arrays; scoring 1 query × 15k candidates is a few ms vectorized.
- For accords missing in some perfumes, treat as 0; if a perfume has < 3 accords, rely more on note families (raise B_compat weight, drop B_sim).
- Gender: don't hard-filter (layering is unisex in sources); optional soft preference matching the query's gender tag.
- Validation set: curated_pairs.json positives + §3 negatives. Unit-test that: Molecule 01 ↔ Light Blue ranks high; Pomegranate Noir ↔ Myrrh & Tonka excluded/low; Vanilla 28 ↔ Invite Only low; Margiela Beach Walk ↔ By the Fireplace high; any aquatic (e.g., Acqua di Giò Profondo) ↔ dense caramel gourmand (e.g., Angel) excluded.

---

## Source list (main)
- Experimental Perfume Club — https://experimentalperfumeclub.com/blogs/journal/how-to-layer-fragrance-a-perfumers-guide
- Coveteur (Moltz, Burke-Williams, Ferguson) — https://coveteur.com/best-perfume-layering-combinations
- Cosmopolitan via AOL (Moltz, @perfumerism) — https://www.aol.com/fragrance-layering-over-perfumetok-does-195000147.html
- ELLE via AOL (Sewell/Sephora, Eckels, Moltz) — https://www.aol.com/perfume-layering-101-mix-match-191200529.html
- Real Simple via AOL (Laudamiel, Romero) — https://www.aol.com/lifestyle/layer-fragrances-create-signature-scent-133000339.html
- Forbes via Yahoo (Adelon, Nichols) — https://shopping.yahoo.com/beauty/fragrance/articles/fragrance-layer-winter-scents-according-120000368.html
- Forbes via Yahoo (Gillespie, Jelk) — https://shopping.yahoo.com/beauty/fragrance/articles/fragrance-wardrobe-redefining-perfume-layering-100000706.html
- Yahoo (Zagwolsky) — https://www.yahoo.com/lifestyle/layer-perfumes-best-scents-pair-123333646.html
- StyleCaster via Yahoo (Gonsalves) — https://www.yahoo.com/lifestyle/fragrance-layering-tips-blend-perfumes-192322894.html
- Irish News / PA (Jo Malone CBE, Bouris, Ferdinand) — https://www.irishnews.com/life/what-is-scent-layering-and-how-do-you-do-it-SMERLGQB4FI4FLIZ7IQ353LNLU
- Stylist (Haydn Williams) — https://www.stylist.co.uk/beauty/fragrance-layering-tips/1047440
- Space NK — https://www.spacenk.com/uk/inside-space/in-focus/fragrance-layering.html
- Lookfantastic — https://lookfantastic.com/blog/advice/how-to-layer-scents
- Bois de Jasmin / French ELLE + Ellena — https://boisdejasmin.com/?p=339 and https://boisdejasmin.com/?p=196
- Maison Margiela layering — https://www.maisonmargiela-fragrances.eu/en_GB/layering-replica-memories/layering-replica-memories.html
- Glossier — https://uk.glossier.com/pages/fragrance-layering
- Sol de Janeiro — https://soldejaneiro.com/pages/scent-directory ; https://soldejaneiro.com/products/cheiroso-layering-play
- Perfume Posse (Kayali tests) — https://perfumeposse.com/2023/02/26/kayali-perfumes-discovery-layering-set/
- Glamour SA (Mona Kattan) — https://glamour.co.za/beauty/perfume-layering-101-all-the-dos-and-the-donts-from-the-queen-of-layering-mona-kattan-plus-the-best-combos-to-consider-723ac493-e823-495e-ad1a-6173f8e08961
- MioLook (Jo Malone method) — https://miolook.com/en/jo-malone-fragrance-layering
- W Magazine (Kurkdjian) — https://www.wmagazine.com/story/francis-kurkdjian-perfumer-interview
- WhatScent (T3, use cautiously) — https://whatscent.app/magazine/what-to-layer-with-santal-33
- Fragrance wheel — https://en.wikipedia.org/wiki/Fragrance_wheel
