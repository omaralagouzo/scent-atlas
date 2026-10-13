// View 2: note-combination search with a note tray.
import { h, svgIcon, debounce, plural, csv, noteImg } from '../util.js';
import { api, cacheNotes, resolveSlugs, history } from '../api.js';
import { noteChip, noteSearch, segmented, perfumeCard, infinite, dropZone } from '../components.js';
import { savedBar } from '../saved.js';
import { sync } from '../router.js';

const PER = 36;
const CYCLE = [null, 'top', 'middle', 'base'];

export function mountCombine(root, { params }) {
  // state ------------------------------------------------------------
  let include = [];   // {slug,name,image,layer}
  let exclude = [];
  let mode = params.get('mode') === 'any' ? 'any' : 'all';
  let sort = params.get('sort') || '';
  const f = { gender: params.get('gender') || '', brand: params.get('brand') || '', year_min: params.get('year_min') || '', year_max: params.get('year_max') || '' };
  let facets = [];

  const parse = (s) => csv(s).map((t) => { const [slug, layer] = t.split('@'); return { slug, layer: layer && layer !== 'any' ? layer : null }; });

  // ui ---------------------------------------------------------------
  const tray = h('div', { class: 'tray', 'aria-label': 'Selected notes' });
  const trayEmpty = h('p', { class: 'tray-hint' }, 'Add a note to start — or drag one here.');
  const exTray = h('div', { class: 'tray tray-ex', 'aria-label': 'Excluded notes' });
  const modeSeg = segmented([{ value: 'all', label: 'Match all', title: 'Perfumes must contain every note' }, { value: 'any', label: 'Match any', title: 'Perfumes with at least one of the notes' }], mode, (v) => { mode = v; changed(); }, 'Match mode');
  const search = noteSearch({
    placeholder: 'Add a note… (Shift+Enter to exclude)', allowExclude: true, label: 'Add a note to the search',
    skip: () => new Set([...include, ...exclude].map((n) => n.slug)),
    onPick: (n, { exclude: ex }) => add(n, ex),
  });
  const clearBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { include = []; exclude = []; changed(); } }, 'Clear all');
  const saved = savedBar('combine', {
    getState: () => paramsOut(), hasNotes: () => include.length > 0,
    suggest: () => include.map((n) => n.name).slice(0, 4).join(' + '),
  });
  const recordHistory = debounce(() => { if (include.length) history.record({ kind: 'combine', state: paramsOut() }); }, 2500);
  const sugg = h('div', { class: 'chips sugg' });
  const suggTitle = h('h2', { class: 'sec-title' }, 'Start with a popular note');
  const count = h('span', { class: 'result-count', 'aria-live': 'polite' });
  const summary = h('p', { class: 'query-sentence' });
  const grid = h('div', { class: 'grid grid-cards' });

  const genderSel = h('select', { class: 'select', 'aria-label': 'Gender', onchange: (e) => { f.gender = e.target.value; changed(); } },
    [['', 'Any gender'], ['women', 'Women'], ['men', 'Men'], ['unisex', 'Unisex']].map(([v, l]) => h('option', { value: v, selected: v === f.gender }, l)));
  const sortSel = h('select', { class: 'select', 'aria-label': 'Sort', onchange: (e) => { sort = e.target.value; changed(); } },
    [['', 'Most reviewed'], ['rating', 'Top rated'], ['year', 'Newest first'], ['year_asc', 'Oldest first'], ['name', 'A – Z'], ['matches', 'Most notes matched']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));
  const yMin = h('input', { class: 'input num', type: 'number', min: '1700', max: '2100', placeholder: 'From year', value: f.year_min, 'aria-label': 'From year', onchange: (e) => { f.year_min = e.target.value; changed(); } });
  const yMax = h('input', { class: 'input num', type: 'number', min: '1700', max: '2100', placeholder: 'To year', value: f.year_max, 'aria-label': 'To year', onchange: (e) => { f.year_max = e.target.value; changed(); } });
  const brandList = h('datalist', { id: 'brand-list' });
  const brandIn = h('input', { class: 'input', type: 'text', list: 'brand-list', placeholder: 'Brand', value: f.brand, 'aria-label': 'Brand', autocomplete: 'off' });
  brandIn.addEventListener('input', debounce(async () => {
    try { const r = await api.get('/api/brands', { q: brandIn.value, limit: 12 }); brandList.replaceChildren(...r.brands.map((b) => h('option', { value: b.name }, `${b.count} perfumes`))); } catch (e) { /* ignore */ }
  }, 150));
  brandIn.addEventListener('change', () => { f.brand = brandIn.value.trim(); changed(); });

  root.append(h('section', { class: 'view' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Combination search'),
      h('h1', null, 'Find the notes together'),
      h('p', { class: 'lede' }, 'Build a tray of notes and see every perfume that carries them. Pin a note to a layer, or exclude what you cannot stand.')),
    h('div', { class: 'tray-panel' },
      h('div', { class: 'tray-top' }, h('label', { class: 'tray-label' }, 'Your notes'), modeSeg, clearBtn, saved),
      tray,
      h('div', { class: 'tray-add' }, search.el),
      h('div', { class: 'tray-ex-wrap' }, h('label', { class: 'tray-label' }, 'Without'), exTray)),
    h('details', { class: 'filters', open: !!(f.gender || f.brand || f.year_min || f.year_max) },
      h('summary', null, 'Filters & sorting'),
      h('div', { class: 'toolbar' }, genderSel, brandIn, brandList, yMin, yMax, sortSel)),
    h('section', { class: 'suggest' }, suggTitle, sugg),
    h('div', { class: 'toolbar results-bar' }, count, summary),
    grid));

  dropZone(tray.parentElement, (d) => add(d, false));
  dropZone(exTray, (d) => add(d, true));

  // behaviour --------------------------------------------------------
  function add(n, ex) {
    const slug = n.slug;
    include = include.filter((x) => x.slug !== slug);
    exclude = exclude.filter((x) => x.slug !== slug);
    const entry = { slug, name: n.name, image: n.image || noteImg(slug), layer: null, color: n.color };
    (ex ? exclude : include).push(entry);
    changed();
  }
  function cycle(n) {
    const i = CYCLE.indexOf(n.layer);
    n.layer = CYCLE[(i + 1) % CYCLE.length];
    changed();
  }
  const paramsOut = () => ({
    include: include.map((n) => n.slug + (n.layer ? '@' + n.layer : '')).join(','),
    exclude: exclude.map((n) => n.slug + (n.layer ? '@' + n.layer : '')).join(','),
    mode: mode === 'any' ? 'any' : '', sort, gender: f.gender, brand: f.brand, year_min: f.year_min, year_max: f.year_max,
  });

  function drawTray() {
    tray.replaceChildren(...(include.length ? include.map((n) => noteChip(n, {
      layer: { value: n.layer, onCycle: () => cycle(n) }, onRemove: () => { include = include.filter((x) => x !== n); changed(); }, from: 'in',
    })) : [trayEmpty]));
    exTray.replaceChildren(...(exclude.length ? exclude.map((n) => noteChip(n, {
      kind: 'exclude', onRemove: () => { exclude = exclude.filter((x) => x !== n); changed(); }, from: 'ex',
    })) : [h('span', { class: 'tray-hint' }, 'Nothing excluded')]));
    modeSeg.hidden = include.length < 2;
    clearBtn.hidden = !include.length && !exclude.length;
  }
  function drawSuggestions() {
    suggTitle.textContent = include.length ? 'Add another note' : 'Start with a popular note';
    sugg.replaceChildren(...facets.slice(0, 28).map((n) => noteChip(n, {
      count: n.count, onClick: () => add(n, false), title: include.length ? `${n.count} of these ${mode === 'all' ? 'would remain' : 'perfumes also have it'}` : `${n.count} perfumes`,
      onAdd: include.length ? () => add(n, true) : null, addTitle: `Exclude ${n.name}`, draggable: true,
    })));
    // the "add" button on suggestions is an exclude shortcut; restyle it
    sugg.querySelectorAll('.chip-act').forEach((b) => { b.replaceChildren(svgIcon('minus', 14)); });
  }
  function sentence() {
    if (!include.length) return 'Showing the whole catalogue.';
    const bits = include.map((n) => n.name + (n.layer ? ` (${n.layer === 'middle' ? 'heart' : n.layer})` : ''));
    const j = mode === 'all' ? ' + ' : ' or ';
    let s = bits.join(j);
    if (exclude.length) s += `, without ${exclude.map((n) => n.name).join(', ')}`;
    return s;
  }

  const list = infinite(grid, async (page, gen) => {
    const p = { ...paramsOut(), page, per_page: PER, facets: page === 1 ? 1 : 0, facet_limit: 30 };
    const r = await api.get('/api/search', p);
    cacheNotes(r.facets);
    if (page === 1) {
      facets = r.facets || [];
      drawSuggestions();
      count.textContent = plural(r.total, 'perfume');
      summary.textContent = sentence();
    }
    return { items: r.results, hasMore: page < r.pages };
  }, (p) => perfumeCard(p, { extra: null }), { empty: 'No perfume has that exact combination. Try “Match any”, or remove a note.' });

  function changed() {
    drawTray();
    sync('/combine', paramsOut());
    list.reset();
    recordHistory();
  }

  // initial hydrate from URL
  (async () => {
    const inc = parse(params.get('include')), exc = parse(params.get('exclude'));
    const notes = await resolveSlugs([...inc, ...exc].map((x) => x.slug));
    const by = Object.fromEntries(notes.map((n) => [n.slug, n]));
    include = inc.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], layer: ['top', 'middle', 'base'].includes(x.layer) ? x.layer : (x.layer === 'heart' ? 'middle' : null) }));
    exclude = exc.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], layer: null }));
    drawTray();
    list.reset();
    recordHistory();
  })();

  return () => { recordHistory.cancel(); list.destroy(); };
}
