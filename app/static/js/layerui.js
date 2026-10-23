// Layering UI building blocks shared by the Layering page, My Collection and the perfume drawer.
import { h, svgIcon, toast, plural } from './util.js';
import { api, session } from './api.js';
import { bottleImg, miniAccords } from './components.js';
import { requireAuth } from './auth.js';
import { go } from './router.js';

export const pairHref = (a, b) => `#/layering/${a}/${b}`;

export function verdictBadge(v, label, { big = false } = {}) {
  return h('span', { class: `verdict v-${v}${big ? ' big' : ''}` }, h('i', { 'aria-hidden': 'true' }), label);
}

/** One partner of an anchor perfume: bottle, verdict, the best reasons, a caution, and a link to the full pair page. */
export function partnerCard(anchorId, p, { compact = false } = {}) {
  const pr = p.pair || {};
  const tags = (pr.tags || []).slice(0, compact ? 2 : 3);
  const el = h('a', { class: `pcard${compact ? ' compact' : ''}`, href: pairHref(anchorId, p.id), 'aria-label': `${p.name} by ${p.brand}: ${pr.verdict_label || ''}` },
    h('span', { class: 'pcard-img' }, bottleImg(p, '')),
    h('span', { class: 'pcard-body' },
      h('span', { class: 'pcard-top' }, verdictBadge(pr.verdict, pr.verdict_label), pr.curated ? h('span', { class: 'src-chip', title: `Recommended in ${pr.curated.source}` }, 'Recommended by name') : null),
      h('b', { class: 'pcard-name' }, p.name),
      h('span', { class: 'pcard-brand' }, p.brand),
      miniAccords(p.accords),
      tags.length ? h('span', { class: 'why-tags' }, tags.map((t) => h('span', { class: 'why-tag' }, t))) : null,
      !compact && pr.specific ? h('p', { class: 'pcard-specific' }, pr.specific) : null,
      !compact && pr.caution ? h('p', { class: 'pcard-caution' }, h('b', null, `${pr.caution.title}: `), pr.caution.text) : null,
      h('span', { class: 'pcard-more' }, 'Why it works & how to wear it', svgIcon('arrow', 14))));
  return el;
}

/** A pair of two perfumes (collection ideas, community, curated showcase). */
export function pairRow(a, b, { verdict = null, label = null, why = null, note = null, source = null, extra = null } = {}) {
  return h('article', { class: 'prow' },
    h('a', { class: 'prow-link', href: pairHref(a.id, b.id), 'aria-label': `${a.name} with ${b.name}` },
      h('span', { class: 'prow-bottles' }, h('span', { class: 'prow-img' }, bottleImg(a, '')), h('span', { class: 'prow-plus', 'aria-hidden': 'true' }, '+'), h('span', { class: 'prow-img' }, bottleImg(b, ''))),
      h('span', { class: 'prow-text' },
        h('b', null, a.name, h('span', { class: 'muted' }, ' + '), b.name),
        h('small', { class: 'muted' }, `${a.brand}${a.brand === b.brand ? '' : ' · ' + b.brand}`),
        verdict ? verdictBadge(verdict, label) : null,
        why ? h('span', { class: 'prow-why' }, why) : null,
        note ? h('span', { class: 'prow-why' }, note) : null)),
    source ? h('small', { class: 'prow-src muted' }, 'Source: ', source) : null,
    extra);
}

/** Thumbs up / down for a community combo. combo may be null (nobody vouched yet): voting then creates it. */
export function votePanel(aId, bId, combo, onChange) {
  const wrap = h('div', { class: 'votes', role: 'group', 'aria-label': 'Community vote' });
  let cur = combo;
  async function cast(v) {
    if (!session.user && !(await requireAuth('Sign in to vote on layering combos.'))) return;
    const next = cur && cur.my_vote === v ? 0 : v;
    try {
      let r;
      if (!cur) {
        r = await api.post('/api/layering/combos', { a: aId, b: bId });
        if (next === -1) r = await api.post(`/api/layering/combos/${r.id}/vote`, { vote: -1 });
      } else {
        r = await api.post(`/api/layering/combos/${cur.id}/vote`, { vote: next });
      }
      cur = r;
      draw();
      if (onChange) onChange(r);
    } catch (e) { toast(e.detail || 'Could not save your vote.'); }
  }
  function draw() {
    const mv = cur ? cur.my_vote : 0;
    wrap.replaceChildren(
      h('button', { class: `vote-btn up${mv === 1 ? ' on' : ''}`, type: 'button', 'aria-pressed': String(mv === 1), title: 'This combo works', onclick: () => cast(1) },
        svgIcon('thumb', 17), h('span', null, cur ? String(cur.up) : '0'), h('span', { class: 'sr-only' }, ' thumbs up')),
      h('button', { class: `vote-btn down${mv === -1 ? ' on' : ''}`, type: 'button', 'aria-pressed': String(mv === -1), title: 'Does not work for me', onclick: () => cast(-1) },
        svgIcon('thumb', 17), h('span', null, cur ? String(cur.down) : '0'), h('span', { class: 'sr-only' }, ' thumbs down')));
  }
  draw();
  return wrap;
}

/** Community combo row for one anchor perfume (partner + votes + our verdict). */
export function communityRow(anchorId, c) {
  const p = c.partner || c.b;
  return h('article', { class: 'crow' },
    h('a', { class: 'crow-link', href: pairHref(anchorId, p.id) },
      h('span', { class: 'crow-img' }, bottleImg(p, '')),
      h('span', { class: 'crow-text' }, h('b', null, p.name), h('small', { class: 'muted' }, p.brand),
        h('small', { class: 'crow-ours' }, 'Our read: ', h('span', { class: `v-text v-${c.ours.verdict}` }, c.ours.verdict_label)))),
    votePanel(anchorId, p.id, c));
}

/** "Layering ideas" tab of My Collection: the best pairs inside the user's own shelf. */
export function layeringIdeas({ items }) {
  const wrap = h('div', { class: 'ideas' }, h('div', { class: 'skeleton sk-hero' }));
  if (items.length < 2) {
    wrap.replaceChildren(h('div', { class: 'empty coll-empty' },
      h('div', { class: 'coll-empty-art', 'aria-hidden': 'true' }, svgIcon('layers', 40)),
      h('h2', null, 'Add at least two fragrances'),
      h('p', null, 'Layering ideas compare every bottle on your shelf with every other one and keep only the pairs that clear our bar.')));
    return wrap;
  }
  api.get('/api/me/collection/layering').then((r) => {
    const kids = [h('p', { class: 'lede small-lede' }, `We checked all ${plural(r.owned * (r.owned - 1) / 2, 'pair')} on your shelf against what perfumers say makes layering work. `,
      r.pairs.length ? `${plural(r.pairs.length, 'pair')} made the cut.` : 'None cleared the bar, and we would rather say so than pad the list.')];
    if (r.pairs.length) {
      kids.push(h('div', { class: 'prow-list' }, r.pairs.map((x) => pairRow(x.a, x.b, {
        verdict: x.pair.verdict, label: x.pair.verdict_label,
        why: x.pair.why.slice(0, 2).map((w) => w.title).join(' · '),
      }))));
    }
    const lonely = items.filter((it) => !r.partners[String(it.id)]);
    kids.push(h('section', { class: 'ideas-each' },
      h('h3', { class: 'tier-title' }, h('span', null, 'Find partners for a bottle'), h('small', null, 'across the whole catalogue')),
      h('div', { class: 'chip-row' }, items.map((it) => h('a', { class: `bottle-chip${r.partners[String(it.id)] ? '' : ' none'}`, href: `#/layering/${it.id}`, title: r.partners[String(it.id)] ? `${plural(r.partners[String(it.id)], 'partner')} on your shelf` : 'No partner on your shelf yet' },
        h('span', { class: 'bottle-chip-img' }, bottleImg(it, '')), it.name))),
      lonely.length && r.pairs.length ? h('p', { class: 'muted small' }, `${plural(lonely.length, 'bottle')} without a partner on your shelf (dimmed): open one to see matches from the whole catalogue.`) : null));
    wrap.replaceChildren(...kids);
  }).catch(() => wrap.replaceChildren(h('p', { class: 'list-msg' }, 'Could not load layering ideas.')));
  return wrap;
}

/** Small "how we decide" explainer, shared by the layering home and pair pages. */
export function principles({ short = false } = {}) {
  const items = [
    ['Fresh over deep', 'One scent carries the opening, the other the drydown. Two of the same weight compete.'],
    ['Simple + complex', 'A linear, few-note scent layers cleanly; two complex compositions usually clash.'],
    ['A shared thread', 'A bridge note in both (especially in the base) makes the seam disappear.'],
    ['Not too much of one thing', 'Two heavyweights or sweet on sweet turn muddy; aquatic with dense gourmand or oud clashes.'],
    ['Not the same scent twice', 'Near-twins and dupes only make one perfume louder, so we leave them out.'],
  ];
  return h('section', { class: 'principles' },
    h('h2', { class: 'sec-title' }, 'How we decide'),
    h('div', { class: 'principle-grid' }, (short ? items.slice(0, 3) : items).map(([t, d], k) => h('div', { class: 'principle' }, h('span', { class: 'principle-n' }, String(k + 1)), h('b', null, t), h('p', null, d)))),
    h('p', { class: 'muted small' }, 'Built from perfumer and brand guidance (Experimental Perfume Club, D.S. & Durga, Jo Malone, Maison Margiela, Jean-Claude Ellena via ELLE) and checked against 64 pairs they recommend by name. It reads notes and accords, not your skin: treat matches as strong leads and test before committing.'));
}

export function goPair(a, b) { go(`/layering/${a}/${b}`); }
