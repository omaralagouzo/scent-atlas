// Shared UI building blocks.
import { h, svgIcon, debounce, compact, layerLabel, noteImg, LAYERS } from './util.js';
import { api, favs, mine, session, cacheNotes, STATUS_LABEL } from './api.js';
import { openPerfume } from './router.js';
import { requireAuth } from './auth.js';
import { brandLink, tagBadges, dupeBadges, linkBadge } from './brandtags.js';

// ---------------------------------------------------------------- images
// `src` may point straight at fimgs.net / Wikimedia (IMAGE_MODE=remote); if that fails to load we swap in
// `fallback` (the server's generated SVG) once, and only then mark the image as broken.
export function lazyImg(src, alt, cls = '', fallback = null) {
  const img = h('img', { src, alt: alt || '', loading: 'lazy', decoding: 'async', class: `lazy ${cls}`.trim(), draggable: 'false', referrerpolicy: 'no-referrer' });
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    if (fallback && !img.dataset.fallback && img.getAttribute('src') !== fallback) {
      img.dataset.fallback = '1';
      img.src = fallback;
      return;
    }
    img.classList.add('loaded', 'broken');
  });
  return img;
}
export const bottleImg = (p, alt, cls = '') => lazyImg(p.image, alt, cls, `/img/perfume/${p.id}`);
export const noteImgEl = (n, alt = '', cls = '') => lazyImg(n.image || noteImg(n.slug), alt, cls, noteImg(n.slug));

// ---------------------------------------------------------------- favourites heart
export function heart(type, id, label = 'Favorite') {
  const b = h('button', {
    class: 'heart', type: 'button', 'data-type': type, 'data-id': String(id),
    'aria-label': label, 'aria-pressed': favs.has(type, id) ? 'true' : 'false', title: label,
    onclick: (e) => { e.stopPropagation(); e.preventDefault(); favs.toggle(type, id); },
  }, svgIcon('heart', 18));
  return b;
}

// ---------------------------------------------------------------- status (owned / tried / wishlist)
export function statusButton(pid) {
  const b = h('button', {
    class: 'status-btn', type: 'button', 'data-pid': String(pid), 'aria-haspopup': 'menu',
    'aria-label': 'Mark as owned, tried or wishlist', title: 'Owned · Tried · Wishlist',
    onclick: async (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!session.user && !(await requireAuth('Sign in to track what you own, have tried, or want.'))) return;
      openStatusMenu(b, pid);
    },
  }, svgIcon('bookmark', 17));
  const s = mine.status(pid);
  if (s) b.dataset.status = s;
  return b;
}

let statusMenuEl = null;
function closeStatusMenu() {
  if (statusMenuEl) { statusMenuEl.remove(); statusMenuEl = null; }
  document.removeEventListener('click', closeStatusMenu, true);
  document.removeEventListener('keydown', onStatusKey, true);
  window.removeEventListener('scroll', closeStatusMenu, true);
}
function onStatusKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeStatusMenu(); } }
function openStatusMenu(anchor, pid) {
  closeStatusMenu();
  const cur = mine.status(pid);
  const opt = (value, label) => h('button', {
    class: 'menu-item', type: 'button', role: 'menuitemradio', 'aria-checked': String(cur === value),
    onclick: async (e) => {
      e.stopPropagation();
      closeStatusMenu();
      try { await mine.save(pid, { status: value }); } catch (err) { /* surfaced by the store */ }
    },
  }, h('span', { class: 'menu-check' }, cur === value ? svgIcon('check', 14) : null), label);
  const menu = h('div', { class: 'popmenu', role: 'menu', 'aria-label': 'Personal status' },
    opt('owned', 'Owned'), opt('tried', 'Tried'), opt('wishlist', 'Wishlist'),
    cur ? h('hr') : null, cur ? opt(null, 'Clear status') : null);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  statusMenuEl = menu;
  setTimeout(() => {
    document.addEventListener('click', closeStatusMenu, true);
    document.addEventListener('keydown', onStatusKey, true);
    window.addEventListener('scroll', closeStatusMenu, true);
  }, 0);
  const first = menu.querySelector('.menu-item');
  if (first) first.focus();
}

// ---------------------------------------------------------------- accords
export function miniAccords(accords) {
  if (!accords || !accords.length) return h('div', { class: 'mini-accords empty' });
  const total = accords.reduce((s, a) => s + a.strength, 0) || 1;
  return h('div', { class: 'mini-accords', 'aria-label': 'Main accords: ' + accords.map((a) => a.name).join(', '), title: accords.map((a) => `${a.name} ${Math.round(a.strength * 100)}%`).join(' · ') },
    accords.map((a) => h('span', { style: { flexGrow: String(a.strength / total), background: a.color } })));
}

export function accordBars(accords) {
  return h('div', { class: 'accord-bars' },
    accords.map((a) => h('div', { class: 'accord-row' },
      h('div', { class: 'accord-bar', style: { width: `${Math.max(14, Math.round(a.strength * 100))}%`, background: a.color } },
        h('span', { class: 'accord-name', style: { color: readableOn(a.color) } }, a.name)))));
}

function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1c1710' : '#fff';
}

export function ratingBadge(p) {
  if (!p.rating) return h('span', { class: 'rating none' }, 'unrated');
  return h('span', { class: 'rating', title: `${p.rating} / 5` },
    svgIcon('star', 13), h('b', null, p.rating.toFixed(2)),
    p.rating_count ? h('small', null, `(${compact(p.rating_count)})`) : null);
}

// ---------------------------------------------------------------- perfume card
export function perfumeCard(p, opts = {}) {
  const card = h('article', { class: 'card', tabindex: '0', role: 'link', 'aria-label': `${p.name} by ${p.brand}`, dataset: { id: p.id } },
    h('div', { class: 'card-img' }, bottleImg(p, `${p.name} bottle`), statusButton(p.id), heart('perfume', p.id)),
    h('div', { class: 'card-body' },
      h('h3', { class: 'card-name' }, p.name),
      h('div', { class: 'card-brand' }, brandLink(p.brand), tagBadges(p)),
      h('div', { class: 'card-meta' }, h('span', null, p.year || '—'), ratingBadge(p)),
      dupeBadges(p),
      miniAccords(p.accords),
      opts.extra || (p.matched_names && p.matched_names.length ? h('p', { class: 'card-matched', title: `Matched: ${p.matched_names.join(', ')}` }, p.matched_names.join(' · ')) : null)));
  const open = () => openPerfume(p.id);
  card.addEventListener('click', (e) => { if (!e.target.closest('.heart, .status-btn, .brand-link, .btags')) open(); });
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); }
  });
  return card;
}

// ---------------------------------------------------------------- notes
export function noteTile(n) {
  return h('a', { class: 'tile', href: `#/note/${encodeURIComponent(n.slug)}`, style: { '--fam': n.color } },
    h('div', { class: 'tile-img' }, noteImgEl(n, n.name)),
    h('div', { class: 'tile-body' }, h('span', { class: 'tile-name' }, n.name), h('span', { class: 'tile-count' }, `${compact(n.count)}`)));
}

export function dragNote(el, note, from = null) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/x-note', JSON.stringify({ slug: note.slug, name: note.name, from }));
    e.dataTransfer.effectAllowed = 'copyMove';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
}

export function dropZone(el, onDrop) {
  el.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('text/x-note')) { e.preventDefault(); el.classList.add('drop-over'); }
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-over'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-over');
    const raw = e.dataTransfer.getData('text/x-note');
    if (!raw) return;
    e.preventDefault();
    try { onDrop(JSON.parse(raw)); } catch (err) { /* ignore */ }
  });
}

/** Image chip for a note. opts: count, onClick, onRemove, layer ({value,onCycle}), kind ('exclude'), draggable */
export function noteChip(n, opts = {}) {
  const kids = [noteImgEl(n, '', 'chip-img'), h('span', { class: 'chip-name' }, n.name)];
  if (opts.count != null) kids.push(h('span', { class: 'chip-count' }, compact(opts.count)));
  const main = opts.onClick
    ? h('button', { class: 'chip-main', type: 'button', onclick: opts.onClick, title: opts.title || null }, kids)
    : h('span', { class: 'chip-main' }, kids);
  const chip = h('span', { class: `chip ${opts.kind || ''} ${opts.onClick ? 'clickable' : ''}`.trim(), style: n.color ? { '--fam': n.color } : null, dataset: { slug: n.slug } }, main);
  if (opts.layer) {
    chip.append(h('button', {
      class: `chip-layer L-${opts.layer.value || 'any'}`, type: 'button', title: 'Click to change which layer this note must be in',
      onclick: (e) => { e.stopPropagation(); opts.layer.onCycle(); },
    }, opts.layer.value ? layerLabel(opts.layer.value) : 'Any layer'));
  }
  if (opts.variant) {
    const v = opts.variant;
    chip.append(h('button', {
      class: `chip-var${v.on ? ' on' : ''}`, type: 'button', 'aria-pressed': v.on ? 'true' : 'false',
      title: v.title || (v.on ? 'Also matches every note containing this word (click to turn off)' : 'Also match every note containing this word'),
      onclick: (e) => { e.stopPropagation(); v.onToggle(e); },
    }, v.on ? `≈ ${v.count == null ? '…' : v.count}` : '≈'));
  }
  if (opts.onAdd) chip.append(h('button', { class: 'chip-act', type: 'button', title: opts.addTitle || 'Add', 'aria-label': opts.addTitle || 'Add', onclick: (e) => { e.stopPropagation(); opts.onAdd(); } }, svgIcon('plus', 14)));
  if (opts.extra) chip.append(...opts.extra);
  if (opts.onRemove) chip.append(h('button', { class: 'chip-act', type: 'button', title: 'Remove', 'aria-label': `Remove ${n.name}`, onclick: (e) => { e.stopPropagation(); opts.onRemove(); } }, svgIcon('close', 14)));
  if (opts.draggable !== false) dragNote(chip, n, opts.from || null);
  return chip;
}

// ---------------------------------------------------------------- note autocomplete
export function noteSearch({ placeholder = 'Add a note…', onPick, allowExclude = false, label = 'Search notes', skip = () => new Set(), compactMode = false, source = null }) {
  const id = 'ac' + Math.random().toString(36).slice(2, 8);
  const input = h('input', {
    class: 'input ac-input', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder, 'aria-label': label,
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': id, 'aria-autocomplete': 'list', 'data-search': '',
  });
  const list = h('ul', { class: 'ac-list', id, role: 'listbox', hidden: true });
  const wrap = h('div', { class: `ac ${compactMode ? 'compact' : ''}` }, h('span', { class: 'ac-ico' }, svgIcon('search', 16)), input, list);
  let items = [], active = -1, seq = 0;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const setActive = (i) => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    if (i >= 0 && list.children[i]) { list.children[i].scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', list.children[i].id); }
  };
  const pick = (n, exclude = false) => {
    onPick(n, { exclude });
    input.value = '';
    close();
    input.focus();
  };
  const render = () => {
    list.replaceChildren();
    if (!items.length) {
      list.append(h('li', { class: 'ac-empty' }, 'No matching notes'));
    }
    items.forEach((n, i) => {
      const li = h('li', { class: 'ac-item', role: 'option', id: `${id}-${i}`, 'aria-selected': 'false', style: { '--fam': n.color } },
        noteImgEl(n, '', 'ac-img'),
        h('span', { class: 'ac-name' }, n.name),
        h('span', { class: 'ac-fam' }, n.family),
        h('span', { class: 'ac-count' }, compact(n.count)),
        allowExclude ? h('button', { class: 'ac-excl', type: 'button', tabindex: '-1', title: 'Exclude this note', onmousedown: (e) => { e.preventDefault(); pick(n, true); } }, svgIcon('minus', 14)) : null);
      li.addEventListener('mousedown', (e) => { if (e.target.closest('.ac-excl')) return; e.preventDefault(); pick(n, false); });
      li.addEventListener('mousemove', () => { if (active !== i) setActive(i); });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(items.length ? 0 : -1);
  };
  const fetchNow = async () => {
    const my = ++seq;
    try {
      const r = source ? { notes: await source(input.value) } : await api.get('/api/notes', { q: input.value, limit: 24 });
      if (my !== seq) return;
      cacheNotes(r.notes);
      const sk = skip();
      items = r.notes.filter((n) => !sk.has(n.slug)).slice(0, 8);
      render();
    } catch (e) { /* ignore */ }
  };
  const fetchSoon = debounce(fetchNow, 110);
  input.addEventListener('input', fetchSoon);
  input.addEventListener('focus', () => { if (list.hidden) fetchNow(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) fetchNow(); else setActive((active + 1) % Math.max(items.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % Math.max(items.length, 1)); }
    else if (e.key === 'Enter') {
      if (!list.hidden && items[active]) { e.preventDefault(); pick(items[active], allowExclude && e.shiftKey); }
    } else if (e.key === 'Escape') { if (!list.hidden) { e.stopPropagation(); close(); } }
  });
  return { el: wrap, input };
}

// ---------------------------------------------------------------- perfume picker (search box + suggestion list)
/** opts: onPick(perfume), placeholder, label, clearOnPick (keep the box ready for the next one), skip(): Set of ids to hide */
export function perfumePicker({ onPick, placeholder = 'Search a perfume or brand — Aventus, Shalimar, Tom Ford…', label = 'Search for a perfume', clearOnPick = false, skip = () => new Set(), autofocus = false } = {}) {
  const input = h('input', { class: 'input big', type: 'search', placeholder, 'aria-label': label, autocomplete: 'off', 'data-search': '', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const list = h('ul', { class: 'pick-list', role: 'listbox', hidden: true });
  let items = [], active = -1, seq = 0;
  const setActive = (i) => { active = i; [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i))); if (list.children[i]) list.children[i].scrollIntoView({ block: 'nearest' }); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const choose = (p) => { if (clearOnPick) { input.value = ''; close(); input.focus(); } onPick(p); };
  const draw = () => {
    list.replaceChildren(...items.map((p, i) => {
      const li = h('li', { class: 'pick-item', role: 'option', 'aria-selected': 'false' },
        bottleImg(p, '', 'pick-img'),
        h('span', { class: 'pick-text' }, h('b', null, p.name), h('small', null, `${p.brand}${p.year ? ' · ' + p.year : ''}`)),
        h('span', { class: 'pick-rate' }, p.rating ? `★ ${p.rating.toFixed(2)}` : ''));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(p); });
      li.addEventListener('mousemove', () => setActive(i));
      return li;
    }));
    if (!items.length) list.replaceChildren(h('li', { class: 'ac-empty' }, 'No perfume found'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(items.length ? 0 : -1);
  };
  const fetchNow = async () => {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    const my = ++seq;
    try { const r = await api.get('/api/perfumes', { q, limit: 10 }); if (my !== seq) return; const sk = skip(); items = r.results.filter((p) => !sk.has(p.id)).slice(0, 8); draw(); } catch (e) { /* ignore */ }
  };
  input.addEventListener('input', debounce(fetchNow, 140));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) fetchNow(); else setActive((active + 1) % Math.max(items.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % Math.max(items.length, 1)); }
    else if (e.key === 'Enter' && !list.hidden && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); }
  });
  if (autofocus) setTimeout(() => input.focus(), 0);
  const el = h('div', { class: 'picker' }, h('span', { class: 'ac-ico' }, svgIcon('search', 18)), input, list);
  el.input = input;
  return el;
}

// ---------------------------------------------------------------- segmented control
export function segmented(options, value, onChange, label = '') {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const set = (v) => {
    value = v;
    [...el.children].forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === String(v) ? 'true' : 'false'));
  };
  options.forEach((o) => {
    el.append(h('button', {
      type: 'button', dataset: { value: String(o.value) }, class: o.cls || '', title: o.title || null,
      onclick: () => { if (value !== o.value) { set(o.value); onChange(o.value); } },
    }, o.label));
  });
  set(value);
  el.set = set;
  return el;
}

// ---------------------------------------------------------------- infinite list
export function infinite(container, fetchPage, render, { empty = 'Nothing to show.' } = {}) {
  const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
  let page = 0, done = false, loading = false, gen = 0;
  const msg = h('p', { class: 'list-msg' });
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '700px' });

  async function loadMore() {
    if (loading || done) return;
    loading = true;
    const g = gen;
    container.classList.add('loading');
    try {
      const { items, hasMore } = await fetchPage(page + 1, g);
      if (g !== gen) return;
      page++;
      items.forEach((it) => container.insertBefore(render(it), sentinel));
      done = !hasMore;
      msg.textContent = '';
      if (page === 1 && !items.length) msg.textContent = empty;
    } catch (e) {
      if (g !== gen || e.name === 'AbortError') return;
      msg.replaceChildren('Could not load. ', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { msg.textContent = ''; loading = false; loadMore(); } }, 'Retry'));
      done = true;
    } finally {
      if (g === gen) { loading = false; container.classList.remove('loading'); container.style.minHeight = ''; }
    }
    if (g === gen && !done) { io.unobserve(sentinel); io.observe(sentinel); }
  }
  function reset() {
    gen++;
    // keep the old height until the first page is back, so the page does not jump to the top while re-querying
    const h0 = container.offsetHeight;
    container.style.minHeight = h0 > 200 ? `${Math.min(h0, 1400)}px` : '';
    page = 0; done = false; loading = false;
    container.replaceChildren(sentinel);
    container.append(msg);
    msg.textContent = '';
    io.unobserve(sentinel);
    loadMore();
  }
  container.append(sentinel, msg);
  return { reset, destroy: () => { gen++; io.disconnect(); } };
}

// ---------------------------------------------------------------- pyramid diagram
/** A read-only three-tier pyramid. pyramid = {top:[note], middle:[...], base:[...], general:[...]} */
export function pyramidDiagram(pyr, { onNote } = {}) {
  const wrap = h('div', { class: 'pyramid' });
  const hasLayers = ['top', 'middle', 'base'].some((k) => (pyr[k] || []).length);
  const tier = (key, label, notes, cls) =>
    h('section', { class: `tier ${cls}`, 'aria-label': `${label} notes` },
      h('header', null, h('span', { class: 'tier-dot' }), h('h4', null, label), h('small', null, notes.length)),
      h('div', { class: 'tier-notes' }, notes.map((n) => noteCard(n, onNote))));
  if (hasLayers) {
    wrap.append(tier('top', 'Top', pyr.top || [], 'L-top'), tier('middle', 'Heart', pyr.middle || [], 'L-middle'), tier('base', 'Base', pyr.base || [], 'L-base'));
  }
  if ((pyr.general || []).length) wrap.append(tier('general', hasLayers ? 'Also listed' : 'Notes', pyr.general, 'L-general flat'));
  if (!wrap.children.length) wrap.append(h('p', { class: 'muted' }, 'No notes listed for this fragrance.'));
  return wrap;
}

function noteCard(n, onNote) {
  const a = h('a', { class: 'note-card', href: `#/note/${encodeURIComponent(n.slug)}`, style: { '--fam': n.color }, title: `${n.name} — ${n.count} perfumes` },
    noteImgEl(n, '', 'note-card-img'), h('span', null, n.name));
  if (onNote) a.addEventListener('click', onNote);
  return a;
}

// ---------------------------------------------------------------- similarity result row
export function resultRow(r, rank) {
  const matched = r.explanation.filter((e) => e.matched);
  const missing = r.explanation.filter((e) => !e.matched);
  const totalNotes = Object.values(r.pyramid || {}).reduce((s, a) => s + a.length, 0);
  const pct = Math.round(r.score * 100);
  const row = h('article', { class: 'result', tabindex: '0', role: 'link', 'aria-label': `${r.name} by ${r.brand}, ${pct}% match`, dataset: { id: r.id } },
    h('div', { class: 'result-rank' }, rank),
    h('div', { class: 'result-img' }, bottleImg(r, `${r.name} bottle`)),
    h('div', { class: 'result-main' },
      h('div', { class: 'result-head' },
        h('h3', null, r.name), h('span', { class: 'result-brand' }, brandLink(r.brand), r.year ? ` · ${r.year}` : ''), tagBadges(r), linkBadge(r.dupe_link) || (r.is_dupe || r.n_dupes ? dupeBadges(r) : null),
        statusButton(r.id), heart('perfume', r.id)),
      miniAccords(r.accords),
      h('div', { class: 'explain', 'aria-label': 'Why it matched' },
        matched.map(explainChip),
        missing.length ? h('span', { class: 'explain-missing', title: 'Query notes this perfume lacks' }, `missing: ${missing.map((m) => m.name).join(', ')}`) : null,
        totalNotes ? h('span', { class: 'explain-more' }, `${totalNotes} notes total`) : null)),
    h('div', { class: 'result-score', title: `Raw similarity ${r.score.toFixed(3)}` },
      h('div', { class: 'score-num' }, pct, h('small', null, '%')),
      h('div', { class: 'score-bar' }, h('span', { style: { width: `${Math.max(3, Math.round(r.relative * 100))}%` } })),
      r.shared_accords && r.shared_accords.length ? h('div', { class: 'shared-acc' }, r.shared_accords.slice(0, 3).map((a) => h('i', { style: { background: a.color }, title: `shared accord: ${a.name}` }))) : null));
  const open = () => openPerfume(r.id);
  row.addEventListener('click', (e) => { if (!e.target.closest('.heart, .status-btn, .brand-link, .btags')) open(); });
  row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); open(); } });
  return row;
}

function explainChip(e) {
  const same = e.kind === 'exact';
  const label = same
    ? `${e.name} · ${layerLabel(e.layer).toLowerCase()}`
    : `${e.name} · ${layerLabel(e.query_layer === 'any' ? 'any' : e.query_layer).toLowerCase()} → ${layerLabel(e.layer).toLowerCase()}`;
  const tip = same ? `Same layer: ${e.name} is a ${e.layer} note in both (${Math.round(e.contribution * 1000) / 10}% of score)`
    : e.kind === 'loose' ? `Loose match (${e.factor}×): layer unspecified on one side`
      : `Cross-layer match (${e.factor}×): you asked for ${e.query_layer}, it is a ${e.layer} note`;
  return h('span', { class: `echip ${e.kind} L-${e.layer}`, title: tip },
    h('i', { class: 'echip-dot' }), label);
}

export function legend() {
  return h('div', { class: 'legend', 'aria-label': 'Legend' },
    h('span', { class: 'echip exact L-middle' }, h('i', { class: 'echip-dot' }), 'same layer'),
    h('span', { class: 'echip adjacent L-middle' }, h('i', { class: 'echip-dot' }), 'other layer (dashed)'),
    h('span', { class: 'explain-missing' }, 'missing note'));
}

export { LAYERS };
