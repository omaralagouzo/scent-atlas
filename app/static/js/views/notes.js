// View 1a: the note library (grid wall of note tiles, family filter, type-ahead).
import { h, svgIcon, debounce, plural } from '../util.js';
import { api, cacheNotes } from '../api.js';
import { noteTile, infinite, segmented } from '../components.js';
import { sync } from '../router.js';

const PAGE = 72;

export function mountNotes(root, { params }) {
  let q = params.get('q') || '';
  let family = params.get('family') || '';
  let sort = params.get('sort') || 'count';
  let families = [];

  const total = h('span', { class: 'result-count', 'aria-live': 'polite' });
  const input = h('input', { class: 'input big', type: 'search', placeholder: 'Search notes — bergamot, oud, tuberose…', value: q, 'aria-label': 'Search notes', autocomplete: 'off', 'data-search': '' });
  const chips = h('div', { class: 'fam-chips', role: 'group', 'aria-label': 'Filter by family' });
  const grid = h('div', { class: 'grid grid-notes' });
  const sortSeg = segmented([{ value: 'count', label: 'Most used' }, { value: 'name', label: 'A – Z' }], sort, (v) => { sort = v; reload(); }, 'Sort notes');

  root.append(
    h('section', { class: 'view' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'The raw materials'),
        h('h1', null, 'Note Library'),
        h('p', { class: 'lede' }, 'Every ingredient in the atlas. Pick one to see the perfumes that carry it and the notes it keeps company with.')),
      h('div', { class: 'toolbar' },
        h('div', { class: 'search-wrap' }, svgIcon('search', 18), input),
        sortSeg, total),
      chips, grid));

  function drawChips() {
    const all = families.reduce((s, f) => s + f.count, 0);
    chips.replaceChildren(
      famChip('', 'All', all, null),
      ...families.map((f) => famChip(f.name, f.name, f.count, f.color)));
  }
  function famChip(value, label, count, color) {
    return h('button', {
      class: 'fam-chip', type: 'button', 'aria-pressed': String(family === value), style: color ? { '--fam': color } : null,
      onclick: () => { family = value; reload(); },
    }, color ? h('i', { class: 'dot' }) : null, label, h('small', null, count));
  }

  const list = infinite(grid, async (page) => {
    const r = await api.get('/api/notes', { q, family, sort, limit: PAGE, offset: (page - 1) * PAGE });
    cacheNotes(r.notes);
    if (page === 1) {
      families = r.families;
      drawChips();
      total.textContent = plural(r.total, 'note');
    }
    return { items: r.notes, hasMore: page * PAGE < r.total };
  }, noteTile, { empty: 'No notes match that search.' });

  function reload() {
    sync('/notes', { q, family, sort: sort === 'count' ? '' : sort });
    drawChips();
    list.reset();
  }
  input.addEventListener('input', debounce(() => { q = input.value.trim(); reload(); }, 160));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = grid.querySelector('.tile'); if (first) first.click(); }
  });
  list.reset();
  return () => list.destroy();
}
