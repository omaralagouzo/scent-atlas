// View 3: build-a-pyramid -> ranked similar perfumes with per-note explanations.
import { h, svgIcon, debounce, plural, csv, noteImg, toast } from '../util.js';
import { api, cacheNotes, resolveSlugs, history } from '../api.js';
import { noteChip, noteSearch, perfumeCard, resultRow, legend, infinite, dropZone } from '../components.js';
import { savedBar } from '../saved.js';
import { sync } from '../router.js';
import { createFilters, pillsBar, readFilters, filterParams, filterBody, hydrateFilters } from '../filters.js';

const PER = 30;
const TIERS = [
  { key: 'top', label: 'Top', hint: 'First impression · 5–30 min', api: 'top' },
  { key: 'middle', label: 'Heart', hint: 'The body · 30 min – 3 h', api: 'middle' },
  { key: 'base', label: 'Base', hint: 'The drydown · hours', api: 'base' },
  { key: 'any', label: 'Anywhere', hint: 'In any layer', api: 'any' },
];
const NEXT = { top: 'middle', middle: 'base', base: 'any', any: 'top' };

const EXAMPLES = [
  { name: 'Fresh citrus', top: 'bergamot,lemon,mint', middle: 'lavender,geranium', base: 'cedar,vetiver,white-musk' },
  { name: 'Gourmand', top: 'bergamot,pear', middle: 'jasmine,rose', base: 'vanilla,tonka-bean,patchouli' },
  { name: 'Smoky oud', top: 'cardamom,pink-pepper', middle: 'oud,incense', base: 'leather,amber,sandalwood' },
  { name: 'White floral', top: 'orange-blossom,mandarin', middle: 'jasmine,tuberose', base: 'musk,sandalwood' },
];

export function mountPyramid(root, { params }) {
  const state = { top: [], middle: [], base: [], any: [] };
  const f = readFilters(params);

  // ---------------------------------------------------------------- DOM
  const tierEls = {};
  const pyr = h('div', { class: 'builder-pyr' });
  for (const t of TIERS) {
    const notes = h('div', { class: 'tier-notes' });
    const search = noteSearch({
      placeholder: `Add ${t.key === 'any' ? 'a note' : t.label.toLowerCase() + ' note'}…`, compactMode: true, label: `Add a ${t.label} note`,
      skip: () => new Set(allSlugs()), onPick: (n) => addNote(t.key, n),
    });
    const count = h('small', null, '0');
    const el = h('section', { class: `tier L-${t.key} editable tier-${t.key}`, 'aria-label': `${t.label} notes` },
      h('header', null, h('span', { class: 'tier-dot' }), h('h4', null, t.label), h('span', { class: 'tier-hint' }, t.hint), count),
      notes, search.el);
    dropZone(el, (d) => moveNote(d, t.key));
    tierEls[t.key] = { el, notes, count, search };
    pyr.append(el);
  }

  const paste = h('textarea', { class: 'textarea', rows: '5', placeholder: 'Top notes: bergamot, pear\nHeart notes: jasmine, rose\nBase notes: vanilla, musk\n\n…or just a comma-separated list.', 'aria-label': 'Paste a list of notes' });
  const pasteBtn = h('button', { class: 'btn', type: 'button', onclick: () => importPaste() }, 'Add to pyramid');
  const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { for (const k in state) state[k] = []; changed(); } }, 'Clear pyramid');
  const saved = savedBar('pyramid', {
    getState: () => paramsOut(), hasNotes: () => allSlugs().length > 0,
    suggest: () => Object.values(state).flat().map((n) => n.name).slice(0, 4).join(', '),
  });
  const recordHistory = debounce(() => { if (allSlugs().length) history.record({ kind: 'pyramid', state: paramsOut() }); }, 2500);
  const examples = h('div', { class: 'examples' }, h('span', { class: 'muted small' }, 'Try:'), EXAMPLES.map((ex) =>
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => loadExample(ex) }, ex.name)));
  const count = h('span', { class: 'result-count', 'aria-live': 'polite' });
  const results = h('div', { class: 'results' });
  const fetchFacet = (name, { fq = '', offset = 0, limit = 12 } = {}) => api.post('/api/similar/facet', { notes: queryNotes(), filters: filterBody(f), facet: name, fq, offset, limit });
  const panel = createFilters({ f, features: { notes: false, perfumers: true }, fetchFacet, onChange: () => changed() });
  const pills = pillsBar(f, () => { panel.redraw(); changed(); });
  const resultsHead = h('div', { class: 'results-head' }, h('h2', { class: 'sec-title inline' }, 'Closest matches'), count, panel.openBtn, legend());
  const resultsLayout = h('div', { class: 'rlayout' }, panel.scrim, panel.el, h('div', { class: 'rmain' }, pills.el, results));
  const emptyState = h('div', { class: 'empty-hint' }, h('p', null, 'Drop some notes into the pyramid and the closest perfumes appear here — ranked by how well each note, and the layer it sits in, lines up.'));

  root.append(h('section', { class: 'view' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Build a pyramid'),
      h('h1', null, 'Compose a scent'),
      h('p', { class: 'lede' }, 'Place notes in the top, heart and base. Rare notes weigh more than ubiquitous ones; a note in the right layer counts fully, in a neighbouring layer a little less.')),
    h('div', { class: 'builder' },
      pyr,
      h('aside', { class: 'builder-side' },
        h('h3', { class: 'sec-title' }, 'Paste a list'),
        paste, h('div', { class: 'row' }, pasteBtn, clearBtn),
        h('div', { class: 'row save-row' }, saved),
        examples)),
    resultsHead, emptyState, resultsLayout));

  // ---------------------------------------------------------------- state ops
  const allSlugs = () => Object.values(state).flat().map((n) => n.slug);
  function addNote(tier, n) {
    for (const k in state) state[k] = state[k].filter((x) => x.slug !== n.slug);
    state[tier].push({ slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color });
    changed();
  }
  function moveNote(d, tier) {
    const found = Object.values(state).flat().find((x) => x.slug === d.slug);
    addNote(tier, found || { slug: d.slug, name: d.name });
  }
  function drawTiers() {
    for (const t of TIERS) {
      const { notes, count: c } = tierEls[t.key];
      c.textContent = state[t.key].length;
      notes.replaceChildren(...state[t.key].map((n) => noteChip(n, {
        from: t.key, onRemove: () => { state[t.key] = state[t.key].filter((x) => x !== n); changed(); },
        extra: [h('button', { class: 'chip-act', type: 'button', title: `Move to ${NEXT[t.key] === 'any' ? 'anywhere' : NEXT[t.key]}`, 'aria-label': `Move ${n.name} to next layer`, onclick: (e) => { e.stopPropagation(); addNote(NEXT[t.key], n); } }, svgIcon('swap', 14))],
      })));
    }
    const any = allSlugs().length > 0;
    emptyState.hidden = any;
    resultsHead.hidden = !any;
    resultsLayout.hidden = !any;
    clearBtn.hidden = !any;
  }
  const paramsOut = () => ({
    top: state.top.map((n) => n.slug).join(','), middle: state.middle.map((n) => n.slug).join(','),
    base: state.base.map((n) => n.slug).join(','), any: state.any.map((n) => n.slug).join(','),
    ...filterParams(f),
  });
  const run = debounce(() => list.reset(), 220);
  function changed() {
    drawTiers();
    sync('/pyramid', paramsOut(), { push: true });
    pills.draw();
    panel.update(null, null);
    if (allSlugs().length) { run(); recordHistory(); } else { run.cancel(); recordHistory.cancel(); results.replaceChildren(); count.textContent = ''; }
  }

  async function loadExample(ex) {
    for (const t of TIERS) state[t.key] = [];
    for (const t of ['top', 'middle', 'base']) {
      const notes = await resolveSlugs(csv(ex[t]));
      state[t] = notes.map((n) => ({ ...n }));
    }
    changed();
  }

  // ---------------------------------------------------------------- paste parsing
  const HEAD = { top: 'top', head: 'top', opening: 'top', heart: 'middle', middle: 'middle', mid: 'middle', base: 'base', drydown: 'base', 'dry down': 'base' };
  function parsePaste(text) {
    const out = [];
    const parts = text.split(/\b(top|head|opening|heart|middle|mid|base|dry ?down)\b\s*(?:notes?)?\s*[:\-–]?/i);
    let tier = 'any';
    parts.forEach((chunk, i) => {
      if (i % 2 === 1) { tier = HEAD[chunk.toLowerCase().replace(/\s+/, ' ')] || HEAD[chunk.toLowerCase().replace(/\s+/g, '')] || 'any'; return; }
      chunk.split(/[,;\n|•·]+|\s+and\s+/i).map((s) => s.replace(/^[\s\-–*•.]+|[\s.]+$/g, '')).filter(Boolean)
        .forEach((name) => out.push({ tier, name }));
    });
    return out;
  }
  async function importPaste() {
    const items = parsePaste(paste.value);
    if (!items.length) { toast('Nothing to import — type or paste some notes first.'); return; }
    let r;
    try { r = await api.post('/api/notes/resolve', { names: items.map((i) => i.name) }); } catch (e) { toast('Could not reach the server.'); return; }
    const bad = [];
    r.matches.forEach((m, i) => {
      if (!m.slug) { bad.push(items[i].name); return; }
      const n = { slug: m.slug, name: m.name, image: m.image || noteImg(m.slug) };
      for (const k in state) state[k] = state[k].filter((x) => x.slug !== n.slug);
      state[items[i].tier].push(n);
    });
    paste.value = '';
    changed();
    toast(bad.length ? `Added ${items.length - bad.length}. Not found: ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? '…' : ''}` : `Added ${items.length} notes.`, bad.length ? 5500 : 2600);
  }

  // ---------------------------------------------------------------- results
  function queryNotes() {
    const notes = [];
    for (const t of TIERS) for (const n of state[t.key]) notes.push({ slug: n.slug, layer: t.api });
    return notes;
  }
  const list = infinite(results, async (page) => {
    const notes = queryNotes();
    if (!notes.length) return { items: [], hasMore: false };
    const offset = (page - 1) * PER;
    const r = await api.post('/api/similar', { notes, filters: filterBody(f), offset, limit: PER, ff: page === 1 });
    if (page === 1) {
      count.textContent = `${plural(r.total, 'perfume')} share at least one note`;
      panel.update(r.filter_facets, r.total);
    }
    return { items: r.results.map((x, i) => ({ ...x, _rank: offset + i + 1 })), hasMore: offset + PER < r.total };
  }, (it) => resultRow(it, it._rank), { empty: 'No perfume shares any of these notes.' });

  // ---------------------------------------------------------------- hydrate from URL
  (async () => {
    await hydrateFilters(f);
    panel.redraw();
    pills.draw();
    for (const t of TIERS) {
      const notes = await resolveSlugs(csv(params.get(t.key)));
      state[t.key] = notes.map((n) => ({ ...n }));
    }
    drawTiers();
    if (allSlugs().length) { list.reset(); recordHistory(); }
  })();
  drawTiers();
  return () => { run.cancel(); recordHistory.cancel(); list.destroy(); panel.destroy(); };
}
