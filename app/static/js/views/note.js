// View 1b: a single note's page.
import { h, plural, layerLabel, noteImg } from '../util.js';
import { api, cacheNotes } from '../api.js';
import { noteImgEl, heart, noteChip, perfumeCard, infinite, segmented } from '../components.js';
import { sync, go } from '../router.js';
import { createFilters, pillsBar, readFilters, filterParams, hydrateFilters } from '../filters.js';

const PER = 36;

export function mountNote(root, { args, params }) {
  const slug = args.slug;
  let layer = params.get('layer') || '';
  let sort = params.get('sort') || 'popularity';
  const f = readFilters(params);
  let panel = null, pills = null;
  const section = h('section', { class: 'view' }, h('div', { class: 'skeleton sk-hero' }));
  root.append(section);
  let list = null, dead = false;

  (async () => {
    let first;
    try {
      await hydrateFilters(f);
      first = await api.get(`/api/notes/${encodeURIComponent(slug)}`, { layer, sort, per_page: PER, page: 1, ff: 1, ...filterParams(f) });
    } catch (e) {
      section.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Note not found'), h('p', null, `There is no note called “${slug}”.`), h('a', { class: 'btn', href: '#/notes' }, 'Back to the library')));
      return;
    }
    if (dead) return;
    const n = first.note;
    cacheNotes([n, ...first.pairs]);
    const lc = n.layer_counts;

    const gridEl = h('div', { class: 'grid grid-cards' });
    const count = h('span', { class: 'result-count', 'aria-live': 'polite' }, plural(first.perfumes.total, 'perfume'));
    const layerSeg = segmented([
      { value: '', label: `All`, title: `${n.count} perfumes` },
      { value: 'top', label: `Top · ${lc.top}`, cls: 'L-top' },
      { value: 'middle', label: `Heart · ${lc.middle}`, cls: 'L-middle' },
      { value: 'base', label: `Base · ${lc.base}`, cls: 'L-base' },
    ], layer, (v) => { layer = v; reload(); }, 'Show perfumes where this is a… note');
    const sortSel = h('select', { class: 'select', 'aria-label': 'Sort perfumes', onchange: (e) => { sort = e.target.value; reload(); } },
      [['popularity', 'Most reviewed'], ['rating', 'Top rated'], ['year', 'Newest first'], ['year_asc', 'Oldest first'], ['name', 'Name A – Z'], ['brand', 'Brand A – Z']]
        .map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));
    const inc = () => slug + (layer ? `@${layer}` : '');
    panel = createFilters({
      f, features: { notes: true, perfumers: true },
      fetchFacet: (name, { fq = '', offset = 0, limit = 12 } = {}) => api.get('/api/search/facet', { include: inc(), ...filterParams(f), facet: name, fq, offset, limit }),
      onChange: () => reload(),
    });
    pills = pillsBar(f, () => { panel.redraw(); reload(); });

    const pairs = first.pairs.length
      ? h('section', { class: 'pairs' },
        h('h2', { class: 'sec-title' }, 'Pairs well with'),
        h('p', { class: 'muted small' }, `Notes that most often appear alongside ${n.name}. Click to explore it, or + to search the two together.`),
        h('div', { class: 'chips' }, first.pairs.map((p) => noteChip(p, {
          count: p.cooccur, title: `${p.cooccur} perfumes contain both (${Math.round(p.share * 100)}% of ${n.name})`,
          onClick: () => go(`/note/${p.slug}`),
          onAdd: () => go('/combine', { include: `${n.slug},${p.slug}` }), addTitle: `Search ${n.name} + ${p.name}`,
        }))))
      : null;

    section.replaceChildren(
      h('div', { class: 'note-hero', style: { '--fam': n.color } },
        h('div', { class: 'note-hero-bg' }, noteImgEl(n, '')),
        h('div', { class: 'note-hero-inner' },
          h('div', { class: 'note-hero-img' }, noteImgEl(n, n.name)),
          h('div', { class: 'note-hero-text' },
            h('a', { class: 'crumb', href: '#/notes' }, '← Note library'),
            h('p', { class: 'eyebrow' }, h('i', { class: 'dot' }), n.family),
            h('h1', null, n.name),
            h('p', { class: 'lede' }, `Found in ${plural(n.count, 'perfume')}`),
            h('div', { class: 'layer-stats' },
              [['top', lc.top], ['middle', lc.middle], ['base', lc.base]].map(([k, v]) =>
                h('span', { class: `lstat L-${k}` }, h('i', { class: 'dot' }), h('b', null, v), layerLabel(k))),
              lc.general ? h('span', { class: 'lstat L-general' }, h('i', { class: 'dot' }), h('b', null, lc.general), 'unlayered') : null),
            h('div', { class: 'hero-actions' },
              h('a', { class: 'btn btn-primary', href: `#/combine?include=${encodeURIComponent(n.slug)}` }, 'Combine with other notes'),
              h('a', { class: 'btn', href: `#/pyramid?any=${encodeURIComponent(n.slug)}` }, 'Build a pyramid'),
              heart('note', n.slug, 'Favorite this note')))),
      ),
      pairs,
      h('section', { class: 'note-perfumes' },
        h('div', { class: 'toolbar' }, h('h2', { class: 'sec-title inline' }, `Perfumes with ${n.name}`), layerSeg, sortSel, panel.openBtn, count),
        h('div', { class: 'rlayout' }, panel.scrim, panel.el, h('div', { class: 'rmain' }, pills.el, gridEl))));
    panel.redraw();

    let firstPage = first;
    list = infinite(gridEl, async (page) => {
      let r;
      if (page === 1 && firstPage) { r = firstPage; firstPage = null; }
      else {
        const x = await api.get(`/api/notes/${encodeURIComponent(slug)}`, { layer, sort, per_page: PER, page, pairs: 0, ff: page === 1 ? 1 : 0, ...filterParams(f) });
        r = x;
      }
      const ps = r.perfumes;
      count.textContent = plural(ps.total, 'perfume');
      if (page === 1) panel.update(ps.filter_facets, ps.total);
      return { items: ps.results, hasMore: page < ps.pages };
    }, (p) => perfumeCard(p), { empty: 'No perfumes with this note in that layer.' });
    function reload() {
      sync(`/note/${slug}`, { layer, sort: sort === 'popularity' ? '' : sort, ...filterParams(f) }, { push: true });
      firstPage = null;
      pills.draw();
      panel.update(null, null);
      list.reset();
    }
    list.reset();
  })();

  return () => { dead = true; if (list) list.destroy(); if (panel) panel.destroy(); };
}
