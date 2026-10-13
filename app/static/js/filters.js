// Result filters + facets: shared by Combine, the note page and the Pyramid / Smells-like results.
//
// State lives in a plain object `f` (see newFilters) and round-trips through flat URL params (readFilters /
// filterParams). The panel draws facet counts that the server computes over the CURRENT result set; a
// multi-select shows the alternatives you could switch to (its own filter is left out of its counts).
import { h, svgIcon, debounce, compact, clamp } from './util.js';
import { api, cacheNotes, resolveSlugs } from './api.js';
import { noteChip, noteSearch } from './components.js';

// ------------------------------------------------------------------ state <-> URL
export const encList = (a) => a.map((x) => String(x).replace(/\\/g, '\\\\').replace(/~/g, '\\~')).join('~');
export function decList(s) {
  const out = [];
  let cur = '', esc = false;
  for (const ch of s || '') {
    if (esc) { cur += ch; esc = false; } else if (ch === '\\') esc = true;
    else if (ch === '~') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export const newFilters = () => ({
  name: '', year_min: '', year_max: '', year_unknown: false,
  brands: [], perfumers: [], accords: [], acc_any: false, acc_main: false, genders: [], countries: [],
  rating_min: '', votes_min: '', must: [], not: [], brandText: '',
});

const noteTokens = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean)
  .map((t) => ({ slug: t.replace(/\*+$/, ''), variants: t.endsWith('*') }));

export function readFilters(params) {
  const g = (k) => params.get(k) || '';
  return {
    name: g('name'), year_min: g('year_min'), year_max: g('year_max'), year_unknown: g('year_unknown') === '1',
    brands: decList(g('brands')), perfumers: decList(g('perfumers')), accords: decList(g('accords')),
    acc_any: g('acc_any') === '1', acc_main: g('acc_main') === '1',
    genders: g('gender').split(',').map((x) => x.trim()).filter(Boolean), countries: decList(g('countries')),
    rating_min: g('rating_min'), votes_min: g('votes_min'),
    must: noteTokens(g('must')), not: noteTokens(g('not')), brandText: g('brand'),
  };
}

export const noteList = (arr) => arr.map((n) => n.slug + (n.variants ? '*' : '')).join(',');

/** Flat URL params for the filters (empty strings are dropped by the router / api helpers). */
export function filterParams(f) {
  return {
    name: f.name.trim(), year_min: f.year_min, year_max: f.year_max,
    year_unknown: f.year_unknown && (f.year_min || f.year_max) ? '1' : '',
    brands: encList(f.brands), perfumers: encList(f.perfumers),
    accords: encList(f.accords), acc_any: f.accords.length > 1 && f.acc_any ? '1' : '', acc_main: f.accords.length && f.acc_main ? '1' : '',
    gender: f.genders.join(','), countries: encList(f.countries),
    rating_min: f.rating_min, votes_min: f.votes_min, must: noteList(f.must), not: noteList(f.not), brand: f.brandText,
  };
}

/** Fill in names / images of the must / must-not notes after reading them from the URL. */
export async function hydrateFilters(f) {
  const all = [...f.must, ...f.not];
  if (!all.length) return;
  const notes = await resolveSlugs(all.map((x) => x.slug));
  const by = Object.fromEntries(notes.map((n) => [n.slug, n]));
  f.must = f.must.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], variants: x.variants }));
  f.not = f.not.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], variants: x.variants }));
}

export function filterCount(f) {
  return [f.name.trim(), f.year_min || f.year_max, f.brands.length, f.perfumers.length, f.accords.length, f.genders.length,
    f.countries.length, f.rating_min, f.votes_min, f.must.length, f.not.length, f.brandText].filter(Boolean).length;
}

/** Same as filterParams but without empty values (for JSON request bodies). */
export const filterBody = (f) => Object.fromEntries(Object.entries(filterParams(f)).filter(([, v]) => v !== '' && v != null));

export function clearFilters(f) { Object.assign(f, newFilters()); }

// ------------------------------------------------------------------ active filter pills
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const VOTES = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export function describeFilters(f) {
  const out = [];
  const one = (key, label, remove) => out.push({ key, label, remove });
  if (f.name.trim()) one('name', `Name: “${f.name.trim()}”`, () => { f.name = ''; });
  if (f.year_min || f.year_max) {
    const a = f.year_min || '…', b = f.year_max || '…';
    one('year', `Year ${a === b ? a : `${a}–${b}`}${f.year_unknown ? ' + unknown' : ''}`, () => { f.year_min = ''; f.year_max = ''; f.year_unknown = false; });
  }
  f.brands.forEach((b) => one('brand:' + b, b, () => { f.brands = f.brands.filter((x) => x !== b); }));
  if (f.brandText) one('brandText', `Brand contains “${f.brandText}”`, () => { f.brandText = ''; });
  f.perfumers.forEach((b) => one('pf:' + b, `Perfumer: ${b}`, () => { f.perfumers = f.perfumers.filter((x) => x !== b); }));
  f.accords.forEach((b) => one('acc:' + b, `${cap(b)}${f.acc_main ? ' (main)' : ''}`, () => { f.accords = f.accords.filter((x) => x !== b); }));
  f.genders.forEach((b) => one('g:' + b, cap(b), () => { f.genders = f.genders.filter((x) => x !== b); }));
  f.countries.forEach((b) => one('c:' + b, b, () => { f.countries = f.countries.filter((x) => x !== b); }));
  if (f.rating_min) one('rating', `Rating ≥ ${f.rating_min}`, () => { f.rating_min = ''; });
  if (f.votes_min) one('votes', `≥ ${compact(Number(f.votes_min))} votes`, () => { f.votes_min = ''; });
  f.must.forEach((n) => one('must:' + n.slug, `Also ${n.name}${n.variants ? '-ish' : ''}`, () => { f.must = f.must.filter((x) => x.slug !== n.slug); }));
  f.not.forEach((n) => one('not:' + n.slug, `No ${n.name}${n.variants ? '-ish' : ''}`, () => { f.not = f.not.filter((x) => x.slug !== n.slug); }));
  return out;
}

/** The row of removable pills above the results. */
export function pillsBar(f, onChange) {
  const el = h('div', { class: 'pills', 'aria-label': 'Active filters' });
  const draw = () => {
    const items = describeFilters(f);
    el.hidden = !items.length;
    el.replaceChildren(
      ...items.map((p) => h('span', { class: 'pill' }, p.label,
        h('button', { type: 'button', class: 'pill-x', 'aria-label': `Remove filter ${p.label}`, onclick: () => { p.remove(); onChange(); } }, svgIcon('close', 12)))),
      items.length > 1 ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { clearFilters(f); onChange(); } }, 'Clear all') : null);
  };
  draw();
  return { el, draw };
}

// ------------------------------------------------------------------ the panel
/**
 * createFilters({ f, features, fetchFacet, onChange })
 *   f          filter state object (mutated in place)
 *   features   { notes: bool, perfumers: bool }  (sections to show beyond the basics)
 *   fetchFacet (name, {fq, offset, limit}) -> Promise<{items,total,...}>   (beyond the top N / typeahead)
 *   onChange   () => void   called after every edit (the view re-queries and calls panel.update with new facets)
 * returns { el, openBtn, update(facets, total), redraw() }
 */
export function createFilters({ f, features = {}, fetchFacet, onChange }) {
  const sections = [];
  let facets = null, total = null;
  const fire = () => { onChange(); };
  const fireSoon = debounce(fire, 280);

  const wrap = h('aside', { class: 'fpanel', 'aria-label': 'Filter results' });
  const closeBtn = h('button', { class: 'icon-btn fpanel-close', type: 'button', 'aria-label': 'Close filters', onclick: () => setOpen(false) }, svgIcon('close', 18));
  const showBtn = h('button', { class: 'btn btn-primary fpanel-show', type: 'button', onclick: () => setOpen(false) }, 'Show results');
  const clearBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { clearFilters(f); fire(); redraw(); } }, 'Clear all');
  const body = h('div', { class: 'fpanel-body' });
  wrap.append(h('header', { class: 'fpanel-head' }, h('h2', null, 'Filters'), clearBtn, closeBtn), body, h('footer', { class: 'fpanel-foot' }, showBtn));
  const openBtn = h('button', { class: 'btn fpanel-open', type: 'button', 'aria-expanded': 'false', onclick: () => setOpen(true) }, svgIcon('filter', 16), 'Filters', h('span', { class: 'badge', hidden: true }));
  const scrim = h('div', { class: 'fpanel-scrim', onclick: () => setOpen(false) });

  function setOpen(on) {
    wrap.classList.toggle('open', on);
    scrim.classList.toggle('open', on);
    openBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    document.body.classList.toggle('no-scroll', on && window.matchMedia('(max-width: 1000px)').matches);
    if (on) closeBtn.focus();
  }
  const onKey = (e) => { if (e.key === 'Escape' && wrap.classList.contains('open')) { e.stopPropagation(); setOpen(false); openBtn.focus(); } };
  document.addEventListener('keydown', onKey, true);

  // ---- section scaffolding
  function section(id, title, { open = false, count = () => 0, hint = '' } = {}) {
    const badge = h('span', { class: 'badge', hidden: true });
    const det = h('details', { class: 'fsec', open: open || count() > 0 }, h('summary', null, h('span', null, title), badge), hint ? h('p', { class: 'fsec-hint' }, hint) : null);
    const inner = h('div', { class: 'fsec-body' });
    det.append(inner);
    const s = { id, det, inner, badge, count, update: () => {} };
    s.refreshBadge = () => { const n = count(); badge.textContent = n; badge.hidden = !n; };
    sections.push(s);
    body.append(det);
    return s;
  }

  // ---- text search in results
  const nameIn = h('input', { class: 'input', type: 'search', placeholder: 'Search results by perfume or brand…', 'aria-label': 'Search within results', value: f.name, autocomplete: 'off' });
  nameIn.addEventListener('input', () => { f.name = nameIn.value; fireSoon(); });
  body.append(h('div', { class: 'fsearch' }, svgIcon('search', 15), nameIn));

  // ---- release year
  const yr = section('year', 'Release year', { open: true, count: () => (f.year_min || f.year_max ? 1 : 0) });
  {
    const bars = h('div', { class: 'hist', 'aria-hidden': 'true' });
    const lo = h('input', { type: 'range', class: 'range-lo', min: '1900', max: '2027', step: '1', value: '1900', 'aria-label': 'Earliest release year' });
    const hi = h('input', { type: 'range', class: 'range-hi', min: '1900', max: '2027', step: '1', value: '2027', 'aria-label': 'Latest release year' });
    const track = h('div', { class: 'dual' }, lo, hi);
    const fromIn = h('input', { class: 'input num', type: 'number', min: '1500', max: '2100', placeholder: 'from', 'aria-label': 'From year' });
    const toIn = h('input', { class: 'input num', type: 'number', min: '1500', max: '2100', placeholder: 'to', 'aria-label': 'To year' });
    const unk = h('input', { type: 'checkbox' });
    const unkLabel = h('label', { class: 'check' }, unk, h('span', null, 'Include unknown year'));
    const before = h('p', { class: 'fsec-hint', hidden: true });
    let hist = null, LO = 1900, HI = 2027;
    const shade = () => {
      const a = f.year_min ? Number(f.year_min) : -1, b = f.year_max ? Number(f.year_max) : 9999;
      [...bars.children].forEach((bar) => {
        const y0 = Number(bar.dataset.y);
        bar.classList.toggle('out', y0 + 1 < a || y0 > b);
      });
    };
    const drawHist = () => {
      if (!hist) return;
      LO = hist.lo; HI = hist.hi;
      for (const r of [lo, hi]) { r.min = String(LO); r.max = String(HI); }
      const step = 2, buckets = [];
      for (let i = 0; i < hist.counts.length; i += step) buckets.push({ y: LO + i, n: hist.counts.slice(i, i + step).reduce((s, x) => s + x, 0) });
      const mx = Math.max(1, ...buckets.map((x) => x.n));
      bars.replaceChildren(...buckets.map((bk) => {
        const bar = h('i', { dataset: { y: String(bk.y) }, title: `${bk.y}${step > 1 ? '–' + (bk.y + step - 1) : ''}: ${bk.n.toLocaleString()}` });
        bar.style.height = `${bk.n ? Math.max(6, Math.round((bk.n / mx) * 100)) : 2}%`;
        return bar;
      }));
      before.hidden = !hist.before;
      before.textContent = hist.before ? `${hist.before.toLocaleString()} released before ${LO}` : '';
      unkLabel.querySelector('span').textContent = `Include unknown year${hist.unknown ? ` (${hist.unknown.toLocaleString()})` : ''}`;
      shade();
    };
    const sync = () => {
      lo.value = f.year_min ? clamp(Number(f.year_min), LO, HI) : LO;
      hi.value = f.year_max ? clamp(Number(f.year_max), LO, HI) : HI;
      fromIn.value = f.year_min; toIn.value = f.year_max; unk.checked = f.year_unknown;
      unk.disabled = !(f.year_min || f.year_max);
      unkLabel.classList.toggle('dim', unk.disabled);
      shade();
    };
    const fromSlider = () => {
      let v = Number(lo.value);
      if (v > Number(hi.value)) { v = Number(hi.value); lo.value = v; }
      f.year_min = v <= LO ? '' : String(v); fromIn.value = f.year_min; shade();
    };
    const toSlider = () => {
      let v = Number(hi.value);
      if (v < Number(lo.value)) { v = Number(lo.value); hi.value = v; }
      f.year_max = v >= HI ? '' : String(v); toIn.value = f.year_max; shade();
    };
    lo.addEventListener('input', fromSlider); hi.addEventListener('input', toSlider);
    lo.addEventListener('change', () => { fire(); sync(); yr.refreshBadge(); }); hi.addEventListener('change', () => { fire(); sync(); yr.refreshBadge(); });
    fromIn.addEventListener('change', () => { f.year_min = fromIn.value.trim(); if (f.year_min && f.year_max && +f.year_min > +f.year_max) f.year_max = f.year_min; sync(); fire(); yr.refreshBadge(); });
    toIn.addEventListener('change', () => { f.year_max = toIn.value.trim(); if (f.year_min && f.year_max && +f.year_min > +f.year_max) f.year_min = f.year_max; sync(); fire(); yr.refreshBadge(); });
    unk.addEventListener('change', () => { f.year_unknown = unk.checked; fire(); });
    yr.inner.append(h('div', { class: 'yearbox' }, bars, track), h('div', { class: 'row year-inputs' }, fromIn, h('span', { class: 'muted' }, '–'), toIn), before, unkLabel);
    yr.update = (fx) => { if (fx && fx.years) { hist = fx.years; drawHist(); } sync(); };
    yr.redraw = sync;
    sync();
  }

  // ---- generic multi-select list with type-ahead
  function listSection(id, title, key, facetName, { open = false, hint = '', placeholder = 'Search…', label = (x) => x, dot = false, initial = 10, search = true, more = true } = {}) {
    const s = section(id, title, { open, count: () => f[key].length, hint });
    const q = h('input', { class: 'input small-in', type: 'search', placeholder, 'aria-label': `Search ${title.toLowerCase()}`, autocomplete: 'off' });
    const list = h('div', { class: 'flist', role: 'group', 'aria-label': title });
    const moreBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', hidden: true }, 'Show more');
    const note = h('p', { class: 'fsec-hint', hidden: true });
    let data = { items: [], total: 0 }, fq = '', seq = 0;
    if (search) s.inner.append(h('div', { class: 'fsearch' }, svgIcon('search', 14), q));
    s.inner.append(list);
    if (more) s.inner.append(moreBtn);
    s.inner.append(note);
    const toggle = (name, on) => {
      const cur = f[key];
      f[key] = on ? [...cur.filter((x) => x !== name), name] : cur.filter((x) => x !== name);
      s.refreshBadge();
      fire();
    };
    const row = (it) => {
      const cb = h('input', { type: 'checkbox', checked: f[key].includes(it.name), onchange: () => toggle(it.name, cb.checked) });
      const dotEl = dot && it.color ? h('i', { class: 'fdot' }) : null;
      if (dotEl) dotEl.style.background = it.color;
      return h('label', { class: `frow${it.count === 0 ? ' zero' : ''}` }, cb, dotEl, h('span', { class: 'frow-name' }, label(it.name)), h('span', { class: 'frow-count' }, compact(it.count)));
    };
    const draw = () => {
      list.replaceChildren(...data.items.map(row));
      if (!data.items.length) list.append(h('p', { class: 'fsec-hint' }, fq ? 'No match' : 'Nothing here for this selection'));
      const shown = data.items.filter((i) => i.count > 0).length;
      const remaining = Math.max(0, data.total - shown);
      moreBtn.hidden = !more || remaining <= 0;
      moreBtn.textContent = `Show more (${remaining.toLocaleString()})`;
      const cov = data.coverage;
      note.hidden = !(cov && id === 'perfumer');
      if (cov) note.textContent = `Perfumer credits exist for ${cov.all ? Math.round((cov.with / cov.all) * 100) : 0}% of these ${cov.all.toLocaleString()} perfumes; the rest are not listed here.`;
    };
    const load = async (offset = 0, append = false) => {
      const my = ++seq;
      try {
        const r = await fetchFacet(facetName, { fq, offset, limit: fq ? 20 : initial });
        if (my !== seq) return;
        if (append) { data.items = data.items.concat(r.items); data.total = r.total; } else data = { ...r };
        draw();
      } catch (e) { /* ignore */ }
    };
    q.addEventListener('input', debounce(() => { fq = q.value.trim(); if (!fq) { data = { ...(s.fromQuery || data) }; draw(); } else load(); }, 180));
    moreBtn.addEventListener('click', () => load(data.items.filter((i) => !i.selected).length, true));
    s.update = (fx, listKey) => {
      if (fx && fx[listKey]) { s.fromQuery = fx[listKey]; if (!fq) data = { ...fx[listKey] }; else load(); draw(); }
      s.refreshBadge();
    };
    s.listKey = null;
    return s;
  }

  const sBrand = listSection('brand', 'Brand', 'brands', 'brand', { open: true, placeholder: 'Find a brand…' });
  const sPerf = features.perfumers === false ? null
    : listSection('perfumer', 'Perfumer', 'perfumers', 'perfumer', { placeholder: 'Find a perfumer…', hint: 'Perfumer credits are known for only about 38% of perfumes.' });

  // ---- accords
  const sAcc = listSection('accord', 'Accords', 'accords', 'accord', { open: true, placeholder: 'Find an accord…', label: (x) => x, dot: true, initial: 12 });
  {
    const nm = 'accmode' + Math.random().toString(36).slice(2, 6);
    const rAll = h('input', { type: 'radio', name: nm, checked: !f.acc_any });
    const rAny = h('input', { type: 'radio', name: nm, checked: f.acc_any });
    const mainCb = h('input', { type: 'checkbox', checked: f.acc_main });
    const mode = h('div', { class: 'row acc-mode' },
      h('label', { class: 'check' }, rAll, 'All selected'), h('label', { class: 'check' }, rAny, 'Any of them'),
      h('label', { class: 'check' }, mainCb, 'Main accords only (top 3)'));
    rAll.addEventListener('change', () => { f.acc_any = false; fire(); });
    rAny.addEventListener('change', () => { f.acc_any = true; fire(); });
    mainCb.addEventListener('change', () => { f.acc_main = mainCb.checked; fire(); });
    sAcc.inner.prepend(mode);
    sAcc.modeEls = { rAll, rAny, mainCb, mode };
  }

  const sGender = listSection('gender', 'Gender', 'genders', 'gender', { open: true, label: (x) => cap(x), search: false, more: false });
  const sCountry = listSection('country', 'Brand country', 'countries', 'country', { placeholder: 'Find a country…', hint: 'Known for about half of the brands.', initial: 8 });

  // ---- rating / votes
  const sRate = section('rate', 'Rating & votes', { count: () => (f.rating_min ? 1 : 0) + (f.votes_min ? 1 : 0) });
  {
    const rVal = h('output', { class: 'range-val' });
    const rIn = h('input', { type: 'range', min: '0', max: '5', step: '0.1', 'aria-label': 'Minimum rating' });
    const vVal = h('output', { class: 'range-val' });
    const vIn = h('input', { type: 'range', min: '0', max: String(VOTES.length - 1), step: '1', 'aria-label': 'Minimum number of votes' });
    const sync = () => {
      rIn.value = f.rating_min || 0; rVal.textContent = f.rating_min ? `≥ ${Number(f.rating_min).toFixed(1)}` : 'Any';
      const vi = VOTES.indexOf(Number(f.votes_min || 0));
      vIn.value = vi < 0 ? 0 : vi; vVal.textContent = f.votes_min ? `≥ ${compact(Number(f.votes_min))}` : 'Any';
    };
    rIn.addEventListener('input', () => { const v = Number(rIn.value); f.rating_min = v > 0 ? String(v) : ''; rVal.textContent = v ? `≥ ${v.toFixed(1)}` : 'Any'; });
    rIn.addEventListener('change', () => { sRate.refreshBadge(); fire(); });
    vIn.addEventListener('input', () => { const v = VOTES[Number(vIn.value)]; f.votes_min = v ? String(v) : ''; vVal.textContent = v ? `≥ ${compact(v)}` : 'Any'; });
    vIn.addEventListener('change', () => { sRate.refreshBadge(); fire(); });
    sRate.inner.append(
      h('label', { class: 'rangeline' }, h('span', null, 'Minimum rating'), rVal, rIn),
      h('label', { class: 'rangeline' }, h('span', null, 'Minimum votes'), vVal, vIn),
      h('p', { class: 'fsec-hint' }, 'Votes are the number of ratings behind a score; low-vote perfumes have noisy ratings.'));
    sRate.redraw = sync;
    sync();
  }

  // ---- extra notes (must have / must not)
  let sNotes = null;
  if (features.notes) {
    sNotes = section('notes', 'More notes', { count: () => f.must.length + f.not.length, hint: 'Quick refinements on top of your main query. Pick from notes that occur in the current results.' });
    const mk = (title, key, kind) => {
      const chips = h('div', { class: 'chips' });
      const search = noteSearch({
        placeholder: title, compactMode: true, label: title,
        skip: () => new Set([...f.must, ...f.not].map((n) => n.slug)),
        source: async (qq) => {
          const r = await fetchFacet('note', { fq: qq, limit: 24 });
          return r.items;
        },
        onPick: (n) => { f[key] = [...f[key], { slug: n.slug, name: n.name, image: n.image, color: n.color, variants: false }]; cacheNotes([n]); sNotes.refreshBadge(); drawChips(); fire(); },
      });
      const drawChips = () => {
        chips.replaceChildren(...f[key].map((n) => noteChip(n, {
          kind, onRemove: () => { f[key] = f[key].filter((x) => x.slug !== n.slug); sNotes.refreshBadge(); drawChips(); fire(); },
          variant: { on: n.variants, count: null, title: n.variants ? 'Includes notes containing this word' : 'Also match notes containing this word', onToggle: () => { n.variants = !n.variants; drawChips(); fire(); } },
          draggable: false,
        })));
        chips.hidden = !f[key].length;
      };
      drawChips();
      return { el: h('div', { class: 'fnotes' }, h('label', { class: 'tray-label' }, title), search.el, chips), drawChips };
    };
    const must = mk('Must also have…', 'must', null);
    const not = mk('Must not have…', 'not', 'exclude');
    sNotes.inner.append(must.el, not.el);
    sNotes.redraw = () => { must.drawChips(); not.drawChips(); };
  }

  // ---- public
  function redraw() {
    nameIn.value = f.name;
    yr.redraw && yr.redraw();
    sAcc.modeEls.rAll.checked = !f.acc_any; sAcc.modeEls.rAny.checked = f.acc_any; sAcc.modeEls.mainCb.checked = f.acc_main;
    sAcc.modeEls.mode.hidden = false;
    sRate.redraw && sRate.redraw();
    sNotes && sNotes.redraw && sNotes.redraw();
    sections.forEach((s) => s.refreshBadge());
    if (facets) update(facets, total);
    badge();
  }
  function badge() {
    const n = filterCount(f);
    const b = openBtn.querySelector('.badge');
    b.textContent = n; b.hidden = !n;
    clearBtn.hidden = !n;
  }
  function update(fx, tot) {
    facets = fx; total = tot;
    if (fx) {
      yr.update(fx);
      sBrand.update(fx, 'brands');
      sPerf && sPerf.update(fx, 'perfumers');
      sAcc.update(fx, 'accords');
      sGender.update(fx, 'genders');
      sCountry.update(fx, 'countries');
      sAcc.modeEls.mode.hidden = false;
    }
    if (tot != null) showBtn.textContent = tot === 0 ? 'No results' : `Show ${tot.toLocaleString()} result${tot === 1 ? '' : 's'}`;
    sections.forEach((s) => s.refreshBadge());
    badge();
  }
  badge();
  return { el: wrap, scrim, openBtn, update, redraw, destroy: () => document.removeEventListener('keydown', onKey, true) };
}
