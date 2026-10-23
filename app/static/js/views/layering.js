// Layering: what to wear with a fragrance. Home (#/layering), one perfume (#/layering/:id), a pair (#/layering/:id/:other).
import { h, svgIcon, toast, plural } from '../util.js';
import { api, session, cacheNotes } from '../api.js';
import { bottleImg, miniAccords, accordBars, perfumePicker, statusButton, heart, noteChip } from '../components.js';
import { openDialog } from '../dialog.js';
import { requireAuth, openAuthModal } from '../auth.js';
import { go, openPerfume } from '../router.js';
import { brandLink } from '../brandtags.js';
import { verdictBadge, partnerCard, pairRow, communityRow, votePanel, principles } from '../layerui.js';

const PER = 12;

export function mountLayering(root, { args }) {
  const id = args.id ? Number(args.id) : null;
  const other = args.other ? Number(args.other) : null;
  const view = h('section', { class: 'view layering' });
  root.append(view);
  const state = { dead: false };
  if (id && other) mountPair(view, id, other, state);
  else if (id) mountOne(view, id, state);
  else mountHome(view, state);
  return () => { state.dead = true; };
}

const head = (eyebrow, title, lede) => h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, svgIcon('layers', 14), eyebrow), h('h1', null, title), lede ? h('p', { class: 'lede' }, lede) : null);
const section = (title, sub, ...kids) => h('section', { class: 'lsec' }, h('div', { class: 'lsec-head' }, h('h2', { class: 'sec-title' }, title), sub ? h('p', { class: 'muted small' }, sub) : null), ...kids);

// ---------------------------------------------------------------- home
function mountHome(view, state) {
  view.append(
    head('Layering', 'Wear two at once', 'Pick a fragrance and we will find what it layers with: from your own shelf, from what brands and perfumers recommend by name, from the community, and from the whole catalogue. Only pairs that clear our bar are suggested.'),
    perfumePicker({ placeholder: 'Pick a fragrance to layer…', onPick: (p) => go(`/layering/${p.id}`), autofocus: true }));
  const body = h('div', { class: 'lbody' }, h('div', { class: 'skeleton sk-hero' }));
  view.append(body);
  (async () => {
    const [home, mine] = await Promise.all([
      api.get('/api/layering').catch(() => null),
      session.user ? api.get('/api/me/collection/layering').catch(() => null) : Promise.resolve(null),
    ]);
    if (state.dead) return;
    const kids = [];
    if (mine && mine.pairs.length) {
      kids.push(section('From your shelf', `The best pairs among the ${plural(mine.owned, 'fragrance')} you own.`,
        h('div', { class: 'prow-list' }, mine.pairs.slice(0, 6).map((x) => pairRow(x.a, x.b, { verdict: x.pair.verdict, label: x.pair.verdict_label, why: x.pair.why.slice(0, 2).map((w) => w.title).join(' · ') }))),
        mine.pairs.length > 6 ? h('a', { class: 'btn btn-ghost', href: '#/collection?tab=layering' }, `All ${mine.pairs.length} pairs`, svgIcon('arrow', 14)) : null));
    } else if (!session.user) {
      kids.push(h('div', { class: 'callout' }, h('b', null, 'Layer what you already own. '),
        'Add your fragrances to My Collection and we will pair them up for you.',
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openAuthModal({ mode: 'signup' }) }, 'Create a free account')));
    }
    if (home && home.community.length) {
      kids.push(section('Community favourites', 'Combos people vouch for, ranked by thumbs up (with a confidence correction, so 3 of 3 does not beat 40 of 45).',
        h('div', { class: 'prow-list' }, home.community.slice(0, 10).map((c) => pairRow(c.a, c.b, { verdict: c.ours.verdict, label: `Our read: ${c.ours.verdict_label}`, extra: votePanel(c.a.id, c.b.id, c) })))));
    }
    if (home && home.curated.length) {
      kids.push(section('Recommended by brands & perfumers', `${home.curated_total} pairs named in brand guides, perfumer interviews and magazines, each with its source.`,
        h('div', { class: 'prow-list' }, home.curated.map((x) => pairRow(x.a, x.b, { note: x.note,
          source: h('a', { href: x.source_url, target: '_blank', rel: 'noopener noreferrer' }, x.source) })))));
    }
    kids.push(principles());
    body.replaceChildren(...kids);
  })();
}

// ---------------------------------------------------------------- one perfume
function mountOne(view, id, state) {
  const hero = h('div', { class: 'lhero' }, h('div', { class: 'skeleton sk-hero' }));
  const body = h('div', { class: 'lbody' });
  view.append(h('a', { class: 'crumb', href: '#/layering' }, '← Layering'), hero, body);
  let offset = 0;
  (async () => {
    let r;
    try { r = await api.get(`/api/layering/${id}`, { limit: PER }); } catch (e) {
      if (!state.dead) hero.replaceChildren(h('p', { class: 'list-msg' }, e.status === 404 ? 'That fragrance is not in the catalogue.' : 'Could not load layering ideas.'));
      return;
    }
    if (state.dead) return;
    const s = r.source;
    hero.replaceChildren(h('div', { class: 'lhero-card' },
      h('div', { class: 'lhero-img', style: { '--tint': (s.accords[0] && s.accords[0].color) || 'var(--accent)' } }, bottleImg(s, `${s.name} bottle`)),
      h('div', { class: 'lhero-text' },
        h('p', { class: 'eyebrow' }, 'Layering with'),
        h('h1', null, s.name),
        h('p', { class: 'muted' }, brandLink(s.brand), s.year ? ` · ${s.year}` : ''),
        h('div', { class: 'trait-row' },
          h('span', { class: `trait t-${s.traits.role}`, title: 'Heavier, base-rich scents go on first; lighter ones on top' }, s.traits.role_label),
          h('span', { class: `trait t-${s.traits.style}` }, s.traits.style_label)),
        s.accords.length ? accordBars(s.accords.slice(0, 4)) : null,
        h('div', { class: 'hero-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPerfume(s.id) }, 'Full details'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => suggest(s) }, svgIcon('plus', 15), 'Suggest a combo'),
          statusButton(s.id), heart('perfume', s.id, 'Add to favorites'))),
      h('div', { class: 'lhero-pick' }, h('small', { class: 'muted' }, 'Layer something else'), perfumePicker({ placeholder: 'Another fragrance…', onPick: (p) => go(`/layering/${p.id}`) }))));

    const kids = [];
    // your shelf
    if (r.collection) {
      const c = r.collection;
      kids.push(section('From your collection', c.owned ? `Checked against the ${plural(c.owned, 'other fragrance')} you own.` : null,
        c.items.length ? h('div', { class: 'pcard-grid' }, c.items.map((p) => partnerCard(s.id, p)))
          : h('p', { class: 'empty-note' }, c.owned
            ? `None of your fragrances is a strong partner for ${s.name}. We only suggest pairs that clear our bar; the catalogue picks below are the place to look.`
            : h('span', null, 'Add the fragrances you own to ', h('a', { href: '#/collection' }, 'My Collection'), ' and we will tell you which of them layer with this one.'))));
    } else {
      kids.push(h('div', { class: 'callout' }, h('b', null, 'What do you already own? '), `Sign in and add your shelf: we will tell you which of your fragrances layer with ${s.name}.`,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openAuthModal({ mode: 'login' }) }, 'Sign in')));
    }
    if (r.curated.length) {
      kids.push(section('Recommended by name', 'Pairs a brand, perfumer or editor recommends, with the source.',
        h('div', { class: 'prow-list' }, r.curated.map((p) => pairRow(s, p, { verdict: p.pair.verdict, label: `Our read: ${p.pair.verdict_label}`, note: p.pair.note,
          source: h('a', { href: p.pair.source_url, target: '_blank', rel: 'noopener noreferrer' }, p.pair.source) })))));
    }
    const comm = h('div', { class: 'crow-list' });
    const drawComm = (list) => comm.replaceChildren(...(list.length ? list.map((c) => communityRow(s.id, c))
      : [h('p', { class: 'empty-note' }, `No community combos for ${s.name} yet. Tried one that works? Suggest it, and vote on the ones others share.`)]));
    drawComm(r.community);
    kids.push(section('Community combos', null, comm, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => suggest(s) }, svgIcon('plus', 15), 'Suggest a combo')));
    // the catalogue
    const grid = h('div', { class: 'pcard-grid' }, r.catalog.items.map((p) => partnerCard(s.id, p)));
    const more = h('button', { class: 'btn btn-ghost show-more', type: 'button', hidden: r.catalog.total <= PER, onclick: async () => {
      more.disabled = true;
      try {
        offset += PER;
        const n = await api.get(`/api/layering/${id}`, { limit: PER, offset });
        grid.append(...n.catalog.items.map((p) => partnerCard(s.id, p)));
        more.hidden = offset + PER >= n.catalog.total || offset + PER >= 96;
      } catch (e) { toast('Could not load more.'); }
      more.disabled = false;
    } }, 'Show more', svgIcon('chevron', 15));
    kids.push(section('Best matches across the catalogue', r.catalog.total
      ? `Well-known, well-rated fragrances that clear our bar, best first (at most two per house).`
      : null,
    r.catalog.total ? grid : h('p', { class: 'empty-note' }, `Nothing in the catalogue clears our bar for ${s.name}. Some perfumes are best worn alone, and many perfumers would say that is the point.`), more));
    kids.push(principles({ short: true }));
    body.replaceChildren(...kids);

    async function suggest(src) {
      if (!session.user && !(await requireAuth('Sign in to suggest layering combos.'))) return;
      const box = h('div', { class: 'stack' }, h('p', { class: 'muted' }, `What do you layer with ${src.name}? It starts with your thumbs up; others can vote.`));
      const dlg = openDialog({ title: 'Suggest a combo', content: box, className: 'suggest-modal' });
      box.append(perfumePicker({ placeholder: 'Search the other fragrance…', autofocus: true, skip: () => new Set([src.id]), onPick: async (p) => {
        try {
          await api.post('/api/layering/combos', { a: src.id, b: p.id });
          dlg.close(true);
          toast(`Thanks! ${src.name} + ${p.name} is up for votes.`);
          const fresh = await api.get(`/api/layering/${id}`, { limit: 1 });
          if (!state.dead) drawComm(fresh.community);
        } catch (e) { toast(e.detail || 'Could not save it.'); }
      } }));
    }
  })();
}

// ---------------------------------------------------------------- a pair
function mountPair(view, a, b, state) {
  view.append(h('a', { class: 'crumb', href: `#/layering/${a}` }, '← All partners'));
  const body = h('div', { class: 'pair-page' }, h('div', { class: 'skeleton sk-hero' }));
  view.append(body);
  (async () => {
    let r;
    try { r = await api.get(`/api/layering/${a}/with/${b}`); } catch (e) {
      if (!state.dead) body.replaceChildren(h('p', { class: 'list-msg' }, e.status === 404 ? 'One of these fragrances is not in the catalogue.' : 'Could not load this pair.'));
      return;
    }
    if (state.dead) return;
    const { report: rep } = r;
    const first = rep.how_to.first === r.a.id ? r.a : r.b;
    const second = first === r.a ? r.b : r.a;
    const side = (p, order) => h('a', { class: 'pair-side', href: '#', onclick: (e) => { e.preventDefault(); openPerfume(p.id); } },
      h('span', { class: 'pair-order' }, order === 1 ? '1 · apply first' : '2 · then on top'),
      h('span', { class: 'pair-img' }, bottleImg(p, `${p.name} bottle`)),
      h('b', { class: 'pair-name' }, p.name), h('span', { class: 'muted small' }, p.brand),
      h('span', { class: `trait t-${p.traits.role}` }, p.traits.role_label), miniAccords(p.accords));
    const blend = h('div', { class: 'blend' },
      h('div', { class: 'fam-strip big', role: 'img', 'aria-label': 'The blend: ' + rep.blend.map((x) => `${x.label} ${Math.round(x.share * 100)}%`).join(', ') },
        rep.blend.map((x) => h('span', { style: { flexGrow: String(x.share), background: facetColor(x.facet) }, title: `${x.label} ${Math.round(x.share * 100)}%` }, x.share > 0.1 ? x.label : ''))));
    const rows = (list, cls) => h('ul', { class: `reason-list ${cls}` }, list.map((x) => h('li', null, h('b', null, x.title), h('p', null, x.text,
      x.url ? h('span', null, ' ', h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, `(${x.source})`)) : null))));
    const comm = h('div', { class: 'pair-vote' },
      h('div', null, h('b', null, 'Does it work for you?'), h('p', { class: 'muted small' }, r.community ? `${plural(r.community.up + r.community.down, 'vote')} so far.` : 'Nobody has voted yet: be the first.')),
      votePanel(r.a.id, r.b.id, r.community));
    body.replaceChildren(
      h('div', { class: 'pair-hero' },
        h('div', { class: 'pair-sides' }, side(first, 1), h('span', { class: 'pair-plus', 'aria-hidden': 'true' }, '+'), side(second, 2)),
        h('div', { class: 'pair-verdict' },
          verdictBadge(rep.verdict, rep.verdict_label, { big: true }),
          rep.top != null ? h('p', { class: 'muted small' }, rep.recommended ? `Scores in the top ${rep.top}% of all pairings we can make.` : `Scores in the top ${rep.top}% of pairings, below our bar for a recommendation.`) : null,
          rep.curated ? h('p', { class: 'curated-note' }, svgIcon('check', 14), 'Recommended by name: ', rep.curated.note, ' ', h('a', { href: rep.curated.source_url, target: '_blank', rel: 'noopener noreferrer' }, `(${rep.curated.source})`)) : null)),
      h('div', { class: 'pair-grid' },
        h('section', { class: 'pair-card' }, h('h2', { class: 'sec-title' }, rep.pros.length ? 'Why it works' : 'What works'), rep.pros.length ? rows(rep.pros, 'pros') : h('p', { class: 'muted' }, 'Nothing in particular ties these two together.'),
          rep.cons.length ? h('h3', { class: 'sub-title' }, 'Watch out') : null, rep.cons.length ? rows(rep.cons, 'cons') : null),
        h('section', { class: 'pair-card' }, h('h2', { class: 'sec-title' }, 'How to wear it'),
          h('ol', { class: 'steps' }, rep.how_to.steps.map((t) => h('li', null, t))),
          h('p', { class: 'ratio' }, h('b', null, 'Ratio: '), rep.how_to.ratio),
          h('p', { class: 'muted small' }, rep.how_to.tip),
          h('h3', { class: 'sub-title' }, 'The blend'), blend,
          rep.shared_notes.length ? h('h3', { class: 'sub-title' }, 'Notes they share') : null,
          rep.shared_notes.length ? h('div', { class: 'chips' }, rep.shared_notes.map((n) => noteChip(n, { onClick: () => go(`/note/${n.slug}`), draggable: false }))) : null)),
      comm,
      h('div', { class: 'hero-actions' },
        h('a', { class: 'btn', href: `#/layering/${r.a.id}` }, `More for ${r.a.name}`),
        h('a', { class: 'btn', href: `#/layering/${r.b.id}` }, `More for ${r.b.name}`)));
    cacheNotes(rep.shared_notes);
  })();
}

const FACET_COLORS = {
  citrus: '#f4e04d', fresh: '#7fd0d9', aquatic: '#4aa3d6', green: '#5aa645', aromatic: '#4f9d6b', fspice: '#d9822b', wspice: '#b8452c',
  floral: '#e98bb4', wfloral: '#f1d3df', rose: '#d6476b', powdery: '#b7a4d6', fruity: '#f0643c', gourmand: '#d9467f', vanilla: '#f0d9a0',
  amber: '#c27a2c', boozy: '#a8553a', woody: '#8b5a2b', oud: '#4a2c1a', smoky: '#6b3e26', animalic: '#7d5a4a', musky: '#d9c9d6',
};
const facetColor = (f) => FACET_COLORS[f] || '#8a8f98';
