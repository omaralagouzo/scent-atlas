// View 2: note-combination search.  Simple = one tray of notes (all / any); Advanced = AND of OR-conditions with layers.
// Results can be filtered (sidebar with facet counts), sorted, saved and deep-linked (everything lives in the URL hash).
import { h, svgIcon, debounce, plural, csv, noteImg, toast } from '../util.js';
import { api, cacheNotes, resolveSlugs, history } from '../api.js';
import { noteChip, noteSearch, segmented, perfumeCard, infinite, dropZone } from '../components.js';
import { savedBar } from '../saved.js';
import { sync } from '../router.js';
import { createFilters, pillsBar, readFilters, filterParams, hydrateFilters } from '../filters.js';
import { advancedBuilder, newAdv, encodeAdv, readAdv, hydrateAdv, advSentence } from '../adv.js';

const PER = 36;
const CYCLE = [null, 'top', 'middle', 'base'];
export const SORT_OPTIONS = [['', 'Most reviewed'], ['rating', 'Top rated'], ['year', 'Newest first'], ['year_asc', 'Oldest first'],
  ['name', 'Name A – Z'], ['brand', 'Brand A – Z'], ['matches', 'Most notes matched']];

export function mountCombine(root, { params }) {
  // state ------------------------------------------------------------
  let mode = params.get('adv') === '1' || params.has('q') ? 'adv' : 'simple';
  let include = [];   // simple mode: {slug,name,image,layer}
  let exclude = [];
  let matchMode = params.get('mode') === 'any' ? 'any' : 'all';
  let adv = newAdv();
  let sort = SORT_OPTIONS.some(([v]) => v && v === params.get('sort')) ? params.get('sort') : '';
  const f = readFilters(params);
  let suggestions = [];
  let dead = false;

  const parse = (s) => csv(s).map((t) => { const [slug, layer] = t.split('@'); return { slug, layer: layer && layer !== 'any' ? layer : null }; });

  // ui: query panel ----------------------------------------------------
  const tray = h('div', { class: 'tray', 'aria-label': 'Selected notes' });
  const trayEmpty = h('p', { class: 'tray-hint' }, 'Add a note to start — or drag one here.');
  const exTray = h('div', { class: 'tray tray-ex', 'aria-label': 'Excluded notes' });
  const matchSeg = segmented([{ value: 'all', label: 'Match all', title: 'Perfumes must contain every note' }, { value: 'any', label: 'Match any', title: 'Perfumes with at least one of the notes' }], matchMode, (v) => { matchMode = v; changed(); }, 'Match mode');
  const search = noteSearch({
    placeholder: 'Add a note… (Shift+Enter to exclude)', allowExclude: true, label: 'Add a note to the search',
    skip: () => new Set([...include, ...exclude].map((n) => n.slug)),
    onPick: (n, { exclude: ex }) => addSimple(n, ex),
  });
  const clearBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { include = []; exclude = []; adv = newAdv(); builder.rebuild(); changed(); } }, 'Clear query');
  const modeSeg = segmented([
    { value: 'simple', label: 'Simple', title: 'One tray of notes: match all or any' },
    { value: 'adv', label: 'Advanced', title: 'AND / OR conditions per layer, e.g. (top: tea OR mint) AND (base: amber)' },
  ], mode, (v) => switchMode(v), 'Query mode');
  const saved = savedBar('combine', {
    getState: () => paramsOut(), hasNotes: () => hasQuery(),
    suggest: () => (mode === 'adv' ? adv.clauses.flatMap((c) => c.notes) : include).map((n) => n.name).slice(0, 4).join(' + '),
  });
  const recordHistory = debounce(() => { if (hasQuery()) history.record({ kind: 'combine', state: paramsOut() }); }, 2500);

  const builder = advancedBuilder({ adv, onChange: () => changed({ keepBuilder: true }) });
  const simpleBox = h('div', { class: 'simple-box' },
    h('div', { class: 'tray-top' }, h('label', { class: 'tray-label' }, 'Your notes'), matchSeg),
    tray, h('div', { class: 'tray-add' }, search.el),
    h('div', { class: 'tray-ex-wrap' }, h('label', { class: 'tray-label' }, 'Without'), exTray));
  const advBox = h('div', { class: 'adv-box' }, builder.el);
  const sugg = h('div', { class: 'chips sugg' });
  const suggTitle = h('h2', { class: 'sec-title' }, 'Start with a popular note');
  const count = h('span', { class: 'result-count', 'aria-live': 'polite' });
  const summary = h('p', { class: 'query-sentence' });
  const sentenceBox = h('p', { class: 'query-sentence summary-line', 'aria-live': 'polite' });
  const grid = h('div', { class: 'grid grid-cards' });
  const sortSel = h('select', { class: 'select', 'aria-label': 'Sort results', onchange: (e) => { sort = e.target.value; changed(); } },
    SORT_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === sort }, l)));

  // filters ------------------------------------------------------------
  const fetchFacet = (name, { fq = '', offset = 0, limit = 12 } = {}) =>
    api.get('/api/search/facet', { ...paramsOut(), facet: name, fq, offset, limit });
  const panel = createFilters({ f, features: { notes: true, perfumers: true }, fetchFacet, onChange: () => changed({ fromPanel: true }) });
  const pills = pillsBar(f, () => { panel.redraw(); changed({ fromPanel: true }); });

  root.append(h('section', { class: 'view' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Combination search'),
      h('h1', null, 'Find the notes together'),
      h('p', { class: 'lede' }, 'Build a tray of notes and see every perfume that carries them. Pin a note to a layer, exclude what you cannot stand — or switch to Advanced for AND / OR conditions per layer.')),
    h('div', { class: 'tray-panel' },
      h('div', { class: 'tray-top tray-head' }, modeSeg, clearBtn, saved),
      simpleBox, advBox, sentenceBox),
    h('section', { class: 'suggest' }, suggTitle, sugg),
    h('div', { class: 'rlayout' },
      panel.scrim, panel.el,
      h('div', { class: 'rmain' },
        h('div', { class: 'toolbar results-bar' }, panel.openBtn, count, sortSel),
        pills.el, summary, grid))));

  dropZone(simpleBox, (d) => addSimple(d, false));
  dropZone(exTray, (d) => addSimple(d, true));

  // behaviour --------------------------------------------------------
  const hasQuery = () => (mode === 'adv' ? adv.clauses.some((c) => c.notes.length) : include.length > 0);

  function addSimple(n, ex) {
    const slug = n.slug;
    include = include.filter((x) => x.slug !== slug);
    exclude = exclude.filter((x) => x.slug !== slug);
    const entry = { slug, name: n.name, image: n.image || noteImg(slug), layer: null, color: n.color };
    (ex ? exclude : include).push(entry);
    changed();
  }
  function addSuggestion(n, ex) {
    if (mode === 'adv') {
      if (ex) { if (!adv.exclude.some((x) => x.slug === n.slug)) adv.exclude.push({ slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color, variants: false }); builder.rebuild(); changed({ keepBuilder: true }); } else builder.addAsRow(n);
    } else addSimple(n, ex);
  }
  function cycle(n) {
    const i = CYCLE.indexOf(n.layer);
    n.layer = CYCLE[(i + 1) % CYCLE.length];
    changed();
  }

  function switchMode(v) {
    if (v === mode) return;
    if (v === 'adv') {
      const a = newAdv();
      if (matchMode === 'any') {
        const layers = new Set(include.map((n) => n.layer || 'any'));
        if (include.length) a.clauses = [{ layer: layers.size === 1 ? [...layers][0] : 'any', notes: include.map((n) => ({ ...n, variants: false })) }];
        if (layers.size > 1) toast('Notes pinned to different layers were put in one “any layer” condition.');
      } else a.clauses = include.map((n) => ({ layer: n.layer || 'any', notes: [{ ...n, variants: false }] }));
      a.exclude = exclude.map((n) => ({ ...n, variants: false }));
      a.gen = !include.some((n) => n.layer);   // keeps the result set identical to the simple query
      Object.assign(adv, a);
      mode = 'adv';
      builder.rebuild();
    } else {
      const cl = adv.clauses.filter((c) => c.notes.length);
      const anyVar = cl.some((c) => c.notes.some((n) => n.variants)) || adv.exclude.some((n) => n.variants);
      const allSingle = cl.every((c) => c.notes.length === 1);
      if (anyVar || (!allSingle && cl.length > 1)) {
        toast('Simple mode cannot express this query (several OR groups or “similar notes”). Staying in Advanced.', 5200);
        modeSeg.set('adv');
        return;
      }
      if (allSingle) { matchMode = 'all'; include = cl.map((c) => ({ ...c.notes[0], layer: c.layer === 'any' ? null : c.layer })); }
      else { matchMode = 'any'; include = cl[0].notes.map((n) => ({ ...n, layer: cl[0].layer === 'any' ? null : cl[0].layer })); }
      exclude = adv.exclude.map((n) => ({ ...n, layer: null }));
      matchSeg.set(matchMode);
      mode = 'simple';
    }
    changed({ keepBuilder: true });
  }

  const paramsOut = () => ({
    ...(mode === 'adv' ? encodeAdv(adv) : {
      include: include.map((n) => n.slug + (n.layer ? '@' + n.layer : '')).join(','),
      exclude: exclude.map((n) => n.slug + (n.layer ? '@' + n.layer : '')).join(','),
      mode: matchMode === 'any' ? 'any' : '',
    }),
    ...filterParams(f), sort,
  });

  function drawQuery() {
    simpleBox.hidden = mode !== 'simple';
    advBox.hidden = mode !== 'adv';
    modeSeg.set(mode);
    if (mode === 'simple') {
      tray.replaceChildren(...(include.length ? include.map((n) => noteChip(n, {
        layer: { value: n.layer, onCycle: () => cycle(n) }, onRemove: () => { include = include.filter((x) => x !== n); changed(); }, from: 'in',
      })) : [trayEmpty]));
      exTray.replaceChildren(...(exclude.length ? exclude.map((n) => noteChip(n, {
        kind: 'exclude', onRemove: () => { exclude = exclude.filter((x) => x !== n); changed(); }, from: 'ex',
      })) : [h('span', { class: 'tray-hint' }, 'Nothing excluded')]));
      matchSeg.hidden = include.length < 2;
    }
    clearBtn.hidden = !hasQuery() && !exclude.length && !adv.exclude.length;
    const s = sentence();
    sentenceBox.textContent = s;
    sentenceBox.hidden = !s || mode === 'simple';
    summary.textContent = s;
    summary.hidden = !s || mode === 'adv';
  }
  function drawSuggestions() {
    suggTitle.textContent = hasQuery() ? 'Add another note' : 'Start with a popular note';
    sugg.replaceChildren(...suggestions.slice(0, 28).map((n) => noteChip(n, {
      count: n.count, onClick: () => addSuggestion(n, false),
      title: hasQuery() ? `${n.count} of these ${mode === 'simple' && matchMode === 'any' ? 'perfumes also have it' : 'would remain'}${mode === 'adv' ? ' — adds a new AND condition' : ''}` : `${n.count} perfumes`,
      onAdd: hasQuery() ? () => addSuggestion(n, true) : null, addTitle: `Exclude ${n.name}`, draggable: true,
    })));
    // the "add" button on suggestions is an exclude shortcut; restyle it
    sugg.querySelectorAll('.chip-act').forEach((b) => { b.replaceChildren(svgIcon('minus', 14)); });
  }
  function sentence() {
    const extra = { must: f.must, not: f.not };
    if (mode === 'adv') {
      const s = advSentence(adv, extra);
      return s || 'Add a condition to start — e.g. “Top has tea or mint”.';
    }
    if (!include.length) return 'Showing the whole catalogue.';
    const bits = include.map((n) => n.name + (n.layer ? ` (${n.layer === 'middle' ? 'heart' : n.layer})` : ''));
    let s = bits.join(matchMode === 'all' ? ' + ' : ' or ');
    if (f.must.length) s += `, also ${f.must.map((n) => n.name).join(', ')}`;
    const out = [...exclude, ...f.not];
    if (out.length) s += `, without ${out.map((n) => n.name).join(', ')}`;
    return s;
  }

  const list = infinite(grid, async (page) => {
    const p = { ...paramsOut(), page, per_page: PER, facets: page === 1 ? 1 : 0, facet_limit: 30, ff: page === 1 ? 1 : 0 };
    const r = await api.get('/api/search', p);
    if (dead) return { items: [], hasMore: false };
    cacheNotes(r.facets);
    if (page === 1) {
      suggestions = r.facets || [];
      drawSuggestions();
      count.textContent = plural(r.total, 'perfume');
      panel.update(r.filter_facets, r.total);
    }
    return { items: r.results, hasMore: page < r.pages };
  }, (p) => perfumeCard(p, { extra: null }), {
    empty: 'No perfume matches. Loosen a condition, switch “Match all” to “any”, or clear some filters.',
  });

  function changed(opts = {}) {
    drawQuery();
    if (!opts.keepBuilder && mode === 'adv') { /* builder keeps its own DOM */ }
    sync('/combine', paramsOut(), { push: true });
    list.reset();
    recordHistory();
    panel.update(null, null);
    pills.draw();
  }

  // initial hydrate from URL
  (async () => {
    await hydrateFilters(f);
    if (mode === 'adv') {
      const a = await hydrateAdv(readAdv(params));
      Object.assign(adv, a);
      builder.rebuild();
    } else {
      const inc = parse(params.get('include')), exc = parse(params.get('exclude'));
      const notes = await resolveSlugs([...inc, ...exc].map((x) => x.slug));
      const by = Object.fromEntries(notes.map((n) => [n.slug, n]));
      include = inc.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], layer: ['top', 'middle', 'base'].includes(x.layer) ? x.layer : (x.layer === 'heart' ? 'middle' : null) }));
      exclude = exc.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], layer: null }));
    }
    if (dead) return;
    panel.redraw();
    pills.draw();
    drawQuery();
    list.reset();
    recordHistory();
  })();
  drawQuery();

  return () => { dead = true; recordHistory.cancel(); list.destroy(); panel.destroy(); };
}
