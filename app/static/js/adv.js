// Advanced note query builder for the Combine page:  (layer: a OR b) AND (layer: c OR d) ... AND NOT (e OR f)
//
// State:  { clauses: [{ layer: 'any'|'top'|'middle'|'base', notes: [{slug,name,image,color,variants,vcount}] }],
//           exclude: [note], gen: bool }
// URL:    adv=1  q=top:tea*,mint~middle:rose,lily~base:amber*  x=oud*,vetiver  gen=0
//         (`*` after a slug = also every note whose name contains that word; `~` separates conditions)
import { h, svgIcon, noteImg, compact } from './util.js';
import { api, resolveSlugs } from './api.js';
import { noteChip, noteSearch, segmented, dropZone, noteImgEl } from './components.js';

export const LAYER_OPTS = [
  { value: 'any', label: 'Any layer', title: 'The note can be in any layer' },
  { value: 'top', label: 'Top', cls: 'L-top' },
  { value: 'middle', label: 'Heart', cls: 'L-middle' },
  { value: 'base', label: 'Base', cls: 'L-base' },
];
const WORD = { top: 'Top', middle: 'Heart', base: 'Base', any: 'Any layer' };

export const newAdv = () => ({ clauses: [], exclude: [], gen: true });

// ------------------------------------------------------------------ URL codec
export function encodeAdv(a) {
  const tok = (n) => n.slug + (n.variants ? '*' : '');
  const q = a.clauses.filter((c) => c.notes.length).map((c) => `${c.layer}:${c.notes.map(tok).join(',')}`).join('~');
  return { adv: '1', q, x: a.exclude.map(tok).join(','), gen: a.gen ? '' : '0' };
}

/** Parse the URL params into { clauses:[{layer,tokens}], exclude:[token], gen } (names resolved by hydrateAdv). */
export function readAdv(params) {
  const tokens = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => ({ slug: t.replace(/\*+$/, ''), variants: t.endsWith('*') }));
  const clauses = (params.get('q') || '').split('~').map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const i = seg.indexOf(':');
    let layer = 'any', rest = seg;
    if (i >= 0) {
      const l = seg.slice(0, i).trim().toLowerCase();
      layer = l === 'heart' || l === 'mid' ? 'middle' : (['top', 'middle', 'base'].includes(l) ? l : 'any');
      rest = seg.slice(i + 1);
    }
    return { layer, tokens: tokens(rest) };
  });
  return { clauses, exclude: tokens(params.get('x')), gen: params.get('gen') !== '0' };
}

export async function hydrateAdv(raw) {
  const slugs = [...raw.clauses.flatMap((c) => c.tokens), ...raw.exclude].map((t) => t.slug);
  const notes = await resolveSlugs(slugs);
  const by = Object.fromEntries(notes.map((n) => [n.slug, n]));
  const mk = (t) => (by[t.slug] ? { ...by[t.slug], variants: t.variants } : null);
  return {
    clauses: raw.clauses.map((c) => ({ layer: c.layer, notes: c.tokens.map(mk).filter(Boolean) })),
    exclude: raw.exclude.map(mk).filter(Boolean),
    gen: raw.gen,
  };
}

// ------------------------------------------------------------------ sentence
const joinOr = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);
const nm = (n) => n.name.toLowerCase() + (n.variants ? '-ish' : '');
export function advSentence(a, extra = {}) {
  const bits = a.clauses.filter((c) => c.notes.length).map((c) => `${WORD[c.layer]} has ${joinOr(c.notes.map(nm))}`);
  if (extra.must && extra.must.length) bits.push(`also has ${extra.must.map(nm).join(' and ')}`);
  const out = [...a.exclude, ...(extra.not || [])];
  if (out.length) bits.push(`without ${joinOr(out.map(nm))}`);
  return bits.length ? bits.join(' · ') : '';
}

// ------------------------------------------------------------------ variants (notes sharing the word)
const vCache = new Map();
export function getVariants(slug) {
  if (!vCache.has(slug)) vCache.set(slug, api.get(`/api/notes/${encodeURIComponent(slug)}/variants`).catch((e) => { vCache.delete(slug); throw e; }));
  return vCache.get(slug);
}

let popEl = null;
function closePop() {
  if (popEl) { popEl.remove(); popEl = null; }
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onPopKey, true);
}
const onDocClick = (e) => { if (popEl && !popEl.contains(e.target)) closePop(); };
const onPopKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
function showVariantPop(anchor, n) {
  closePop();
  const box = h('div', { class: 'varpop', role: 'dialog', 'aria-label': `Notes matching “${n.name}”` }, h('p', { class: 'muted small' }, 'Loading…'));
  document.body.append(box);
  popEl = box;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    box.style.top = `${Math.min(r.bottom + 8, window.innerHeight - box.offsetHeight - 10)}px`;
    box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 10))}px`;
  };
  place();
  setTimeout(() => { document.addEventListener('click', onDocClick, true); document.addEventListener('keydown', onPopKey, true); }, 0);
  getVariants(n.slug).then((r) => {
    if (popEl !== box) return;
    box.replaceChildren(
      h('p', { class: 'varpop-title' }, `${r.count} note${r.count === 1 ? '' : 's'} contain “${n.name.toLowerCase()}”`),
      h('ul', null, r.notes.map((x) => h('li', null, noteImgEl(x, '', 'varpop-img'), h('span', null, x.name), h('small', null, compact(x.count))))));
    place();
  }).catch(() => { box.replaceChildren(h('p', { class: 'muted small' }, 'Could not load the list.')); });
}

// ------------------------------------------------------------------ builder UI
/**
 * advancedBuilder({ adv, onChange, onNotes }) -> { el, rebuild, addClause(note), focusLast }
 *   adv       state object (mutated in place)
 *   onChange  () => void
 */
export function advancedBuilder({ adv, onChange }) {
  const rowsEl = h('div', { class: 'arows' });
  const exEl = h('div', { class: 'arow arow-ex' });
  const genCb = h('input', { type: 'checkbox', checked: adv.gen });
  const gen = h('label', { class: 'check gen-toggle', title: 'About a quarter of perfumes list their notes as one flat list instead of top / heart / base. When this is on they match a layered condition in any layer, so they are not silently dropped.' },
    genCb, h('span', null, 'Include perfumes without a pyramid (match their notes in any layer)'));
  genCb.addEventListener('change', () => { adv.gen = genCb.checked; onChange(); });
  const addBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { adv.clauses.push({ layer: 'any', notes: [] }); rebuild(); focusRow(adv.clauses.length - 1); } },
    svgIcon('plus', 14), 'Add condition (AND)');
  const el = h('div', { class: 'adv' }, rowsEl, h('div', { class: 'adv-actions' }, addBtn, gen), exEl);
  let rowApis = [];

  function variantToggle(n, redrawChips) {
    return {
      on: !!n.variants, count: n.vcount,
      onToggle: () => {
        n.variants = !n.variants;
        if (n.variants && n.vcount == null) {
          getVariants(n.slug).then((r) => { n.vcount = r.count; redrawChips(); }).catch(() => { n.vcount = 1; redrawChips(); });
        }
        redrawChips();
        onChange();
      },
    };
  }

  function chipsFor(list, kind, redrawChips, afterRemove) {
    return list.map((n, i) => {
      if (n.variants && n.vcount == null) getVariants(n.slug).then((r) => { n.vcount = r.count; redrawChips(); }).catch(() => {});
      const chip = noteChip(n, {
        kind, draggable: false, onRemove: () => { list.splice(list.indexOf(n), 1); afterRemove(); },
        onClick: n.variants ? (e) => showVariantPop(e.currentTarget, n) : null,
        title: n.variants ? 'Show the notes this includes' : null,
        variant: variantToggle(n, redrawChips),
      });
      return [i > 0 ? h('span', { class: 'or-sep' }, kind === 'exclude' ? 'or' : 'or') : null, chip];
    });
  }

  function makeRow(clause, idx) {
    const chips = h('div', { class: 'arow-chips' });
    const empty = h('span', { class: 'tray-hint' }, 'Pick one or more notes — any one of them is enough');
    const search = noteSearch({
      placeholder: clause.notes.length ? 'or…' : 'Add a note…', compactMode: true, label: `Add a note to condition ${idx + 1}`,
      skip: () => new Set(clause.notes.map((n) => n.slug)), onPick: (n) => addNote(n),
    });
    const layer = segmented(LAYER_OPTS, clause.layer, (v) => { clause.layer = v; onChange(); }, 'Layer');
    layer.classList.add('seg-sm');
    const rm = h('button', { class: 'icon-btn arow-x', type: 'button', 'aria-label': `Remove condition ${idx + 1}`, title: 'Remove this condition', onclick: () => { adv.clauses.splice(adv.clauses.indexOf(clause), 1); rebuild(); onChange(); } }, svgIcon('close', 15));
    const row = h('div', { class: 'arow' },
      h('span', { class: `arow-tag${idx ? ' and' : ''}` }, idx ? 'AND' : 'WHERE'),
      layer, chips, search.el, rm);
    function addNote(n) {
      if (!clause.notes.some((x) => x.slug === n.slug)) clause.notes.push({ slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color, variants: false });
      drawChips();
      onChange();
    }
    function drawChips() {
      const kids = clause.notes.length ? chipsFor(clause.notes, null, drawChips, () => { drawChips(); onChange(); }) : [empty];
      chips.replaceChildren(...kids.flat().filter(Boolean));
      search.input.placeholder = clause.notes.length ? 'or…' : 'Add a note…';
      row.classList.toggle('arow-empty', !clause.notes.length);
    }
    drawChips();
    dropZone(row, (d) => addNote({ slug: d.slug, name: d.name }));
    return { row, search, addNote };
  }

  function drawExclude() {
    const chips = h('div', { class: 'arow-chips' });
    const search = noteSearch({
      placeholder: 'Add a note to leave out…', compactMode: true, label: 'Add a note to exclude',
      skip: () => new Set(adv.exclude.map((n) => n.slug)),
      onPick: (n) => { if (!adv.exclude.some((x) => x.slug === n.slug)) adv.exclude.push({ slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color, variants: false }); draw(); onChange(); },
    });
    const draw = () => {
      const kids = adv.exclude.length ? chipsFor(adv.exclude, 'exclude', draw, () => { draw(); onChange(); }) : [h('span', { class: 'tray-hint' }, 'Nothing excluded — these notes may not appear anywhere')];
      chips.replaceChildren(...kids.flat().filter(Boolean));
    };
    draw();
    exEl.replaceChildren(h('span', { class: 'arow-tag not' }, 'WITHOUT'), chips, search.el);
    dropZone(exEl, (d) => { if (!adv.exclude.some((x) => x.slug === d.slug)) { adv.exclude.push({ slug: d.slug, name: d.name, image: noteImg(d.slug), variants: false }); draw(); onChange(); } });
  }

  function rebuild() {
    closePop();
    if (!adv.clauses.length) adv.clauses.push({ layer: 'any', notes: [] });
    rowApis = adv.clauses.map(makeRow);
    rowsEl.replaceChildren(...rowApis.map((r) => r.row));
    genCb.checked = adv.gen;
    drawExclude();
  }
  function focusRow(i) { const r = rowApis[i]; if (r) r.search.input.focus(); }

  dropZone(rowsEl, (d) => {  // dropping on the gap between rows starts a new condition
    adv.clauses.push({ layer: 'any', notes: [{ slug: d.slug, name: d.name, image: noteImg(d.slug), variants: false }] });
    rebuild(); onChange();
  });
  rebuild();
  return {
    el, rebuild, focusLast: () => focusRow(rowApis.length - 1),
    /** add a note as a NEW AND row (used by the suggestion chips) */
    addAsRow(n) {
      const empty = adv.clauses.find((c) => !c.notes.length);
      const note = { slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color, variants: false };
      if (empty) empty.notes.push(note); else adv.clauses.push({ layer: 'any', notes: [note] });
      rebuild(); onChange();
    },
  };
}
