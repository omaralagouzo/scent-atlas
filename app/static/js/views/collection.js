// My Collection: the perfumes you own as an endless personal leaderboard (podium, top 5, top 10, the rest),
// head-to-head ranking, drag-to-reorder, and the scent profile computed from it.
import { h, svgIcon, toast, plural } from '../util.js';
import { api, session, mine } from '../api.js';
import { bottleImg, miniAccords, accordBars, noteImgEl, segmented, perfumePicker } from '../components.js';
import { openDialog } from '../dialog.js';
import { openAuthModal } from '../auth.js';
import { go, sync, openPerfume } from '../router.js';
import { brandLink } from '../brandtags.js';
import { layeringIdeas } from '../layerui.js';

const TABS = [{ value: 'board', label: 'Leaderboard' }, { value: 'profile', label: 'Scent profile' }, { value: 'layering', label: 'Layering ideas' }];
const SHOW = [{ value: '3', label: 'Top 3' }, { value: '5', label: 'Top 5' }, { value: '10', label: 'Top 10' }, { value: 'all', label: 'All' }];
const TIERS = [[3, 5, 'Rounding out the top 5'], [5, 10, 'Top 10'], [10, Infinity, 'The rest of the shelf']];

function stars(n) {
  return n ? h('span', { class: 'my-stars', title: `My rating: ${n} / 5`, 'aria-label': `My rating ${n} of 5` }, '★'.repeat(n) + '☆'.repeat(5 - n)) : null;
}

export function mountCollection(root, { params }) {
  let tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'board';
  let show = SHOW.some((s) => s.value === params.get('show')) ? params.get('show') : 'all';
  let editing = false, dead = false, gen = 0;
  let data = null;                       // { items, order, profile } from the API
  const byId = new Map();

  const countEl = h('span', { class: 'coll-count' });
  const body = h('div', { class: 'coll-body' }, h('div', { class: 'skeleton sk-hero' }));
  const addBox = perfumePicker({
    placeholder: 'Add a fragrance you own — search by name or house…', label: 'Add a fragrance to your collection',
    clearOnPick: true, skip: () => new Set(data ? data.items.map((x) => x.id) : []), onPick: (p) => add(p),
  });
  const tabs = segmented(TABS, tab, (v) => { tab = v; syncUrl(); draw(); }, 'Collection view');
  const head = h('header', { class: 'page-head coll-head' },
    h('p', { class: 'eyebrow' }, 'Your shelf'), h('h1', null, 'My Collection ', countEl),
    h('p', { class: 'lede' }, 'Everything you own, ranked your way. Add a bottle, settle where it belongs with a few quick "which do you love more?" questions, and see what your shelf says about your taste.'));
  const tools = h('div', { class: 'coll-tools' }, addBox, tabs);
  root.append(h('section', { class: 'view coll' }, head, tools, body));

  const syncUrl = () => sync('/collection', { tab: tab === 'board' ? '' : tab, show: show === 'all' ? '' : show });

  // ---------------------------------------------------------------- data
  function apply(r) {
    data = r;
    byId.clear();
    r.items.forEach((it) => byId.set(it.id, it));
    countEl.textContent = r.items.length ? `· ${r.items.length}` : '';
    mine.setAll({ ...Object.fromEntries(mine.map), ...Object.fromEntries(r.items.map((it) => [String(it.id), { status: 'owned', rating: it.my.rating, has_note: !!it.my.note }])) });
  }
  const ranked = () => data.order.map((id) => byId.get(id)).filter(Boolean);
  const unranked = () => data.items.filter((it) => !it.rank);

  async function load() {
    const my = ++gen;
    if (!session.user) {
      tools.hidden = true;
      body.replaceChildren(h('div', { class: 'empty coll-empty' },
        h('div', { class: 'coll-empty-art', 'aria-hidden': 'true' }, svgIcon('star', 40)),
        h('h2', null, 'Build your personal leaderboard'),
        h('p', null, 'Sign in to add the fragrances you own, rank them from your #1 down, discover your scent profile and get layering ideas from your own shelf.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAuthModal({ mode: 'signup' }) }, 'Create a free account'),
          h('button', { class: 'btn', type: 'button', onclick: () => openAuthModal({ mode: 'login' }) }, 'Sign in'))));
      return;
    }
    tools.hidden = false;
    try {
      const r = await api.get('/api/me/collection');
      if (dead || my !== gen) return;
      apply(r);
      draw();
    } catch (e) {
      if (!dead && my === gen) body.replaceChildren(h('p', { class: 'list-msg' }, 'Could not load your collection.'));
    }
  }

  async function add(p) {
    if (byId.has(p.id)) { toast(`${p.name} is already on your shelf.`); return; }
    try {
      apply(await api.post('/api/me/collection', { perfume_id: p.id }));
      draw();
      const it = byId.get(p.id);
      if (!ranked().length) await saveOrder([p.id], `${p.name} is your #1 — for now.`);
      else toast(`Added ${p.name}.`, 6000, { label: 'Rank it', onClick: () => rankOne(it) });
    } catch (e) { toast(e.detail || 'Could not add it.'); }
  }

  let saving = Promise.resolve();
  function saveOrder(ids, msg) {
    data.order = ids.slice();
    data.items.forEach((it) => { const k = ids.indexOf(it.id); it.rank = k >= 0 ? k + 1 : null; });
    saving = saving.then(async () => {
      try {
        const r = await api.put('/api/me/collection/order', { ids });
        if (dead) return;
        apply(r);
        if (msg) toast(msg);
        if (!editing) draw(); else if (tab === 'profile') draw();
      } catch (e) { toast('Could not save the new order.'); load(); }
    });
    if (!editing) draw();
    return saving;
  }

  async function removeItem(it) {
    const before = { order: data.order.slice() };
    try {
      await mine.save(it.id, { status: null });
      await load();
      toast(`Removed ${it.name}.`, 6000, { label: 'Undo', onClick: async () => {
        await api.post('/api/me/collection', { perfume_id: it.id });
        await api.put('/api/me/collection/order', { ids: before.order });
        load();
      } });
    } catch (e) { toast('Could not remove it.'); }
  }

  // ---------------------------------------------------------------- ranking: head-to-head binary insertion
  async function rankOne(it, batch = null) {
    const others = ranked().filter((x) => x.id !== it.id);
    const pos = await duel(it, others, batch);
    if (pos == null) return false;
    const ids = others.map((x) => x.id);
    ids.splice(pos, 0, it.id);
    await saveOrder(ids, batch ? null : `${it.name} placed at #${pos + 1}.`);
    return true;
  }
  async function rankAll() {
    const todo = unranked();
    let done = 0;
    for (const it of todo) {
      if (dead || !(await rankOne(it, { n: done + 1, of: todo.length }))) break;
      done++;
    }
    if (done) toast(done === todo.length ? `All ${plural(done, 'fragrance')} ranked.` : `${plural(done, 'fragrance')} ranked; the rest can wait.`);
  }

  /** Ask "which do you love more?" until the slot for `it` among `list` (best first) is known. Resolves to the 0-based
   *  insert index, or null when cancelled. */
  function duel(it, list, batch = null) {
    if (!list.length) return Promise.resolve(0);
    let lo = 0, hi = list.length, asked = 0;
    const undo = [];
    const total = Math.ceil(Math.log2(list.length + 1));
    const stage = h('div', { class: 'duel' });
    const dlg = openDialog({ title: 'Which do you love more?', content: stage, className: 'duel-modal' });
    const pickSide = (newWins) => {
      undo.push([lo, hi]);
      asked++;
      const mid = (lo + hi) >> 1;
      if (newWins) hi = mid; else lo = mid + 1;
      step();
    };
    const card = (p, tag, onPick, key) => h('button', { class: 'duel-card', type: 'button', onclick: onPick, 'aria-keyshortcuts': key },
      h('span', { class: 'duel-tag' }, tag),
      h('span', { class: 'duel-img' }, bottleImg(p, '')),
      h('b', { class: 'duel-name' }, p.name), h('small', { class: 'muted' }, p.brand),
      miniAccords(p.accords));
    function step() {
      if (lo >= hi) { dlg.close(lo); return; }
      const other = list[(lo + hi) >> 1];
      stage.replaceChildren(
        h('p', { class: 'duel-progress muted small' }, `Placing ${it.name}${batch ? ` (${batch.n} of ${batch.of})` : ''} · question ${asked + 1} of about ${Math.max(total, asked + 1)}`),
        h('div', { class: 'duel-pair' },
          card(it, 'New', () => pickSide(true), 'ArrowLeft'),
          h('span', { class: 'duel-vs', 'aria-hidden': 'true' }, 'or'),
          card(other, `#${data.order.indexOf(other.id) + 1}`, () => pickSide(false), 'ArrowRight')),
        h('div', { class: 'duel-foot' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: !undo.length, onclick: () => { [lo, hi] = undo.pop(); asked--; step(); } }, 'Back'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'They are about equal: place it right here', onclick: () => dlg.close((lo + hi) >> 1) }, 'Too close to call'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => dlg.close(list.length) }, 'Put it last'),
          h('span', { class: 'duel-keys muted small' }, h('kbd', null, '←'), ' ', h('kbd', null, '→'), ' to choose')));
      const first = stage.querySelector('.duel-card');
      if (first) first.focus({ preventScroll: true });
    }
    dlg.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); pickSide(true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pickSide(false); }
    });
    step();
    return dlg.closed.then((v) => (v === false || v == null ? null : v));
  }

  async function moveTo(it) {
    const n = data.order.length;
    const input = h('input', { class: 'input', type: 'number', min: '1', max: String(n), value: String(it.rank || n), 'aria-label': 'New position' });
    const form = h('form', { class: 'stack' }, h('p', { class: 'muted' }, `Where should ${it.name} sit? 1 is your favourite.`), input,
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Move'), h('button', { class: 'btn', type: 'button', onclick: () => dlg.close(false) }, 'Cancel')));
    const dlg = openDialog({ title: 'Move to position', content: form });
    form.addEventListener('submit', (e) => { e.preventDefault(); dlg.close(Math.max(1, Math.min(n, parseInt(input.value, 10) || 1))); });
    setTimeout(() => input.select(), 0);
    const pos = await dlg.closed;
    if (!pos) return;
    const ids = data.order.filter((x) => x !== it.id);
    ids.splice(pos - 1, 0, it.id);
    saveOrder(ids);
  }

  // ---------------------------------------------------------------- item actions menu
  function actionsMenu(anchor, it) {
    const old = document.querySelector('.popmenu.coll-menu');
    if (old) old.remove();
    const close = () => { menu.remove(); document.removeEventListener('click', onDoc, true); };
    const onDoc = (e) => { if (!menu.contains(e.target)) close(); };
    const item = (label, fn, icon) => h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, icon ? svgIcon(icon, 15) : null, label);
    const menu = h('div', { class: 'popmenu coll-menu', role: 'menu', 'aria-label': `${it.name} actions` },
      item('Details', () => openPerfume(it.id)),
      item('Layering ideas', () => go(`/layering/${it.id}`), 'swap'),
      h('hr'),
      it.rank ? item('Move to position…', () => moveTo(it)) : item('Rank it', () => rankOne(it), 'star'),
      it.rank ? item('Re-rank with questions', () => rankOne(it)) : null,
      it.rank ? item('Take off the leaderboard', () => saveOrder(data.order.filter((x) => x !== it.id))) : null,
      h('hr'),
      item('Remove from collection', () => removeItem(it), 'trash'));
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } });
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
    const f = menu.querySelector('.menu-item');
    if (f) f.focus();
  }
  const moreBtn = (it) => h('button', { class: 'icon-btn coll-more', type: 'button', 'aria-label': `More actions for ${it.name}`, 'aria-haspopup': 'menu',
    onclick: (e) => { e.stopPropagation(); actionsMenu(e.currentTarget, it); } }, h('span', { class: 'dots', 'aria-hidden': 'true' }, '•••'));

  // ---------------------------------------------------------------- leaderboard
  function podiumCard(it, place) {
    const el = h('article', { class: `podium-card place-${place}`, tabindex: '0', role: 'link', 'aria-label': `#${place}: ${it.name} by ${it.brand}` },
      h('div', { class: 'medal', 'aria-hidden': 'true' }, String(place)),
      h('div', { class: 'podium-img' }, bottleImg(it, `${it.name} bottle`)),
      h('h3', { class: 'podium-name' }, it.name),
      h('div', { class: 'podium-brand' }, brandLink(it.brand)),
      miniAccords(it.accords),
      h('div', { class: 'podium-foot' }, stars(it.my.rating), moreBtn(it)));
    el.addEventListener('click', (e) => { if (!e.target.closest('button, a')) openPerfume(it.id); });
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openPerfume(it.id); } });
    return el;
  }

  function rankRow(it, place, { drag = false } = {}) {
    const row = h('li', { class: `rank-row${drag ? ' editable' : ''}`, dataset: { id: it.id } },
      drag ? h('button', { class: 'drag-handle', type: 'button', 'aria-label': `Reorder ${it.name}: drag, or use the arrow keys`, title: 'Drag to reorder' }, h('span', { 'aria-hidden': 'true' }, '⠿')) : null,
      h('span', { class: 'rank-num' }, place ? String(place) : '–'),
      h('span', { class: 'rank-img' }, bottleImg(it, '')),
      h('button', { class: 'rank-main', type: 'button', onclick: () => openPerfume(it.id) },
        h('b', { class: 'rank-name' }, it.name), h('span', { class: 'rank-brand' }, it.brand, it.year ? ` · ${it.year}` : '')),
      h('span', { class: 'rank-acc' }, miniAccords(it.accords)),
      h('span', { class: 'rank-stars' }, stars(it.my.rating)),
      drag ? h('span', { class: 'rank-move' },
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Move ${it.name} up`, onclick: () => nudge(it.id, -1) }, svgIcon('chevron', 15)),
        h('button', { class: 'icon-btn sm down', type: 'button', 'aria-label': `Move ${it.name} down`, onclick: () => nudge(it.id, 1) }, svgIcon('chevron', 15)))
        : place ? moreBtn(it)
          : h('span', { class: 'rank-actions' },
            h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => rankOne(it) }, 'Rank'),
            moreBtn(it)));
    return row;
  }

  function nudge(id, d) {
    const ids = data.order.slice();
    const k = ids.indexOf(id), j = k + d;
    if (k < 0 || j < 0 || j >= ids.length) return;
    [ids[k], ids[j]] = [ids[j], ids[k]];
    saveOrder(ids);
    drawBoardInto();
    const btn = body.querySelector(`.rank-row[data-id="${id}"] .rank-move .${d < 0 ? 'icon-btn:not(.down)' : 'down'}`);
    if (btn) btn.focus();
  }

  /** Pointer-driven reordering (mouse, pen and touch). Rows move slot by slot under the pointer. */
  function sortable(list) {
    let row = null;
    const renumber = () => [...list.children].forEach((li, k) => { const n = li.querySelector('.rank-num'); if (n) n.textContent = String(k + 1); });
    list.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle || e.button > 0) return;
      e.preventDefault();
      row = handle.closest('.rank-row');
      handle.setPointerCapture(e.pointerId);
      row.classList.add('lifted');
      list.classList.add('sorting');
    });
    list.addEventListener('pointermove', (e) => {
      if (!row) return;
      const y = e.clientY;
      const sibs = [...list.children].filter((li) => li !== row);
      const before = sibs.find((li) => { const r = li.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (before) { if (row.nextSibling !== before) list.insertBefore(row, before); } else if (list.lastChild !== row) list.append(row);
      renumber();
      if (y < 70) window.scrollBy(0, -14); else if (y > window.innerHeight - 70) window.scrollBy(0, 14);
    });
    const end = () => {
      if (!row) return;
      row.classList.remove('lifted');
      list.classList.remove('sorting');
      row = null;
      const ids = [...list.children].map((li) => Number(li.dataset.id));
      if (ids.join() !== data.order.join()) saveOrder(ids);
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
    list.addEventListener('keydown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const id = Number(handle.closest('.rank-row').dataset.id);
      nudge(id, e.key === 'ArrowUp' ? -1 : 1);
      const again = body.querySelector(`.rank-row[data-id="${id}"] .drag-handle`);
      if (again) again.focus();
    });
  }

  let boardEl = null;
  function drawBoard() {
    const r = ranked(), u = unranked();
    const wrap = h('div', { class: 'board' });
    if (!data.items.length) {
      wrap.append(h('div', { class: 'empty coll-empty' },
        h('div', { class: 'coll-empty-art', 'aria-hidden': 'true' }, svgIcon('plus', 40)),
        h('h2', null, 'Your shelf is empty'),
        h('p', null, 'Search above to add the fragrances you own. Anything you mark as “Owned” elsewhere on the site shows up here too.')));
      return wrap;
    }
    if (r.length) {
      const showSeg = segmented(SHOW, show, (v) => { show = v; syncUrl(); drawBoardInto(); }, 'How much of the leaderboard to show');
      const reorder = h('button', { class: `btn btn-sm${editing ? ' btn-primary' : ''}`, type: 'button', 'aria-pressed': String(editing),
        onclick: () => { editing = !editing; drawBoardInto(); } }, editing ? svgIcon('check', 15) : svgIcon('swap', 15), editing ? 'Done' : 'Reorder');
      wrap.append(h('div', { class: 'toolbar board-bar' }, editing ? h('p', { class: 'muted small' }, 'Drag the handles, or use the arrows. Changes save as you go.') : showSeg, h('span', { class: 'spacer' }), reorder));
      if (editing) {
        const list = h('ol', { class: 'rank-list editing' }, r.map((it, k) => rankRow(it, k + 1, { drag: true })));
        sortable(list);
        wrap.append(list);
      } else {
        const lim = show === 'all' ? Infinity : Number(show);
        const top = r.slice(0, Math.min(3, lim));
        wrap.append(h('div', { class: `podium n${top.length}` }, top.map((it, k) => podiumCard(it, k + 1))));
        for (const [a, b, label] of TIERS) {
          if (lim <= a || r.length <= a) break;
          const part = r.slice(a, Math.min(b, lim));
          wrap.append(h('section', { class: 'tier-block' },
            h('h3', { class: 'tier-title' }, h('span', null, label), h('small', null, `#${a + 1}${part.length > 1 ? `–${a + part.length}` : ''}`)),
            h('ol', { class: 'rank-list', start: String(a + 1) }, part.map((it, k) => rankRow(it, a + k + 1)))));
        }
        if (lim < r.length) {
          wrap.append(h('button', { class: 'btn btn-ghost show-more', type: 'button', onclick: () => { show = 'all'; syncUrl(); drawBoardInto(); } },
            `Show all ${r.length} ranked`, svgIcon('chevron', 15)));
        }
      }
    }
    if (u.length) {
      wrap.append(h('section', { class: 'unranked' },
        h('div', { class: 'toolbar' },
          h('h3', { class: 'tier-title' }, h('span', null, r.length ? 'Not ranked yet' : 'Start your leaderboard'), h('small', null, plural(u.length, 'fragrance'))),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => rankAll() }, svgIcon('star', 15), u.length > 1 ? 'Rank them all' : 'Rank it')),
        h('p', { class: 'muted small' }, r.length ? 'Answer a few “which do you love more?” questions and each one drops into its place.' : 'Pick your favourite first, then each next bottle is placed with a couple of quick questions.'),
        h('ol', { class: 'rank-list unranked-list' }, u.map((it) => rankRow(it, null)))));
    }
    return wrap;
  }
  function drawBoardInto() {
    if (tab !== 'board' || !boardEl) return;
    const next = drawBoard();
    boardEl.replaceWith(next);
    boardEl = next;
  }

  // ---------------------------------------------------------------- scent profile
  function drawProfile() {
    const p = data.profile;
    if (!p.count) return h('p', { class: 'muted' }, 'Add a few fragrances to see your scent profile.');
    const pct = (x) => `${Math.round(x * 100)}%`;
    const fams = p.families.filter((f) => f.share >= 0.01);
    const tile = (label, value, sub) => h('div', { class: 'stat-tile' }, h('small', null, label), h('b', null, value), sub ? h('span', { class: 'muted small' }, sub) : null);
    return h('div', { class: 'profile-page' },
      h('section', { class: 'archetype' },
        h('p', { class: 'eyebrow' }, 'Your scent profile'),
        h('h2', { class: 'archetype-title' }, p.archetype.title),
        h('p', { class: 'archetype-blurb' }, p.archetype.blurb),
        h('div', { class: 'fam-strip big', role: 'img', 'aria-label': 'Scent families: ' + fams.map((f) => `${f.label} ${pct(f.share)}`).join(', ') },
          fams.map((f) => h('span', { style: { flexGrow: String(f.share), background: f.color }, title: `${f.label} ${pct(f.share)}` }, f.share > 0.11 ? f.label : ''))),
        h('ul', { class: 'fam-legend' }, fams.slice(0, 6).map((f) => h('li', null, h('i', { style: { background: f.color } }), f.label, h('small', null, pct(f.share))))),
        h('p', { class: 'muted small' }, `Based on ${plural(p.count, 'fragrance')}${p.ranked ? `; your top-ranked ones count more` : ''}. Rank more of them to sharpen it.`)),
      h('div', { class: 'profile-grid' },
        h('section', { class: 'profile-card' },
          h('h3', { class: 'sec-title' }, 'Favourite accords'),
          p.favorite_accord ? h('p', { class: 'fav-line' }, 'Number one: ', h('b', { style: { color: p.favorite_accord.color } }, p.favorite_accord.name),
            p.favorite_accord.perfumes ? h('span', { class: 'muted' }, ` · a main accord in ${plural(p.favorite_accord.perfumes, 'of your fragrances', 'of your fragrances')}`) : null) : null,
          accordBars(p.accords.slice(0, 8).map((a, k) => ({ ...a, strength: a.share / p.accords[0].share, name: `${a.name} · ${pct(a.share)}` })))),
        h('section', { class: 'profile-card' },
          h('h3', { class: 'sec-title' }, 'Signature notes'),
          h('div', { class: 'sig-notes' }, p.favorite_notes.map((n) => h('a', { class: 'sig-note', href: `#/note/${encodeURIComponent(n.slug)}`, style: { '--fam': n.color } },
            noteImgEl(n, '', 'sig-img'), h('b', null, n.name), h('small', { class: 'muted' }, `in ${n.perfumes} of ${p.count}`)))),
          h('ol', { class: 'profile-notes compact' }, p.notes.slice(3, 12).map((n) => h('li', { style: { '--fam': n.color } },
            h('a', { class: 'profile-note', href: `#/note/${encodeURIComponent(n.slug)}` }, noteImgEl(n, '', 'profile-img'), h('span', { class: 'profile-name' }, n.name),
              h('span', { class: 'profile-bar' }, h('i', { style: { width: `${Math.max(6, Math.round(n.share * 100))}%` } })), h('small', null, `${n.perfumes}`))))))),
      h('section', { class: 'stat-row' },
        p.houses.length ? tile('Houses', p.houses.map((x) => `${x.label} ${pct(x.share)}`).slice(0, 2).join(' · '), p.houses.slice(2).map((x) => `${x.label} ${pct(x.share)}`).join(' · ')) : null,
        p.brands.length ? tile('Most collected house', p.brands[0].name, p.brands[0].count > 1 ? plural(p.brands[0].count, 'bottle') : null) : null,
        p.perfumers.length ? tile('Favourite perfumer', p.perfumers[0].name, plural(p.perfumers[0].count, 'creation')) : null,
        p.era ? tile('Era', `${p.era.median_year}`, `median release · ${p.era.oldest}–${p.era.newest}`) : null,
        p.community_rating ? tile('Community rating', `★ ${p.community_rating.toFixed(2)}`, 'average of your shelf') : null),
      p.gaps.length ? h('section', { class: 'gaps' },
        h('h3', { class: 'sec-title' }, 'Room to grow'),
        h('ul', { class: 'gap-list' }, p.gaps.map((g) => h('li', null, h('b', null, g.label), h('span', { class: 'muted' }, g.hint),
          h('a', { class: 'btn btn-sm', href: gapLink(g.key) }, 'Explore'))))) : null,
      p.notes.length ? h('div', { class: 'hero-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('/combine', { include: p.favorite_notes.map((n) => n.slug).join(','), mode: 'all' }) }, svgIcon('search', 16), 'Perfumes with my signature notes'),
        h('button', { class: 'btn', type: 'button', onclick: () => { tab = 'layering'; tabs.set('layering'); syncUrl(); draw(); } }, svgIcon('swap', 16), 'Layering ideas from my shelf')) : null);
  }
  function gapLink(key) {
    const acc = { fresh: 'citrus~fresh~aquatic~aromatic', woody: 'woody', warm: 'amber~vanilla~warm spicy', floral: 'floral~rose~white floral' }[key];
    return `#/combine?accords=${encodeURIComponent(acc)}&acc_any=1&acc_main=1`;
  }

  // ---------------------------------------------------------------- frame
  function draw() {
    if (!data) return;
    boardEl = null;
    if (tab === 'board') { boardEl = drawBoard(); body.replaceChildren(boardEl); }
    else if (tab === 'profile') body.replaceChildren(drawProfile());
    else body.replaceChildren(layeringIdeas({ items: data.items }));
  }

  const off = session.onChange(() => { if (!dead) load(); });
  load();
  return () => { dead = true; off(); const m = document.querySelector('.popmenu.coll-menu'); if (m) m.remove(); };
}
