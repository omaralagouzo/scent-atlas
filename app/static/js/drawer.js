// Perfume detail drawer.
import { h, svgIcon, plural, layerLabel } from './util.js';
import { api, cacheNotes, session, mine, history } from './api.js';
import { bottleImg, heart, accordBars, pyramidDiagram, ratingBadge, segmented } from './components.js';
import { closeDrawer, go } from './router.js';
import { openAuthModal } from './auth.js';
import { brandLink, tagBadges, dupeSections, confLabel } from './brandtags.js';

const drawer = () => document.getElementById('drawer');
const scrim = () => document.getElementById('scrim');
const body = () => document.getElementById('drawer-body');
let openId = null, lastFocus = null, token = 0;

export function hideDrawer() {
  const d = drawer();
  if (!d || d.getAttribute('aria-hidden') === 'true') return;
  d.setAttribute('aria-hidden', 'true');
  d.classList.remove('open');
  scrim().classList.remove('open');
  document.body.classList.remove('no-scroll');
  openId = null;
  token++;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  setTimeout(() => { if (d.getAttribute('aria-hidden') === 'true') body().replaceChildren(); }, 300);
}

export async function showDrawer(id) {
  const d = drawer();
  if (openId === String(id) && d.getAttribute('aria-hidden') === 'false') return;
  openId = String(id);
  const my = ++token;
  if (d.getAttribute('aria-hidden') !== 'false') lastFocus = document.activeElement;
  d.setAttribute('aria-hidden', 'false');
  d.classList.add('open');
  scrim().classList.add('open');
  document.body.classList.add('no-scroll');
  body().replaceChildren(h('div', { class: 'drawer-loading' }, h('div', { class: 'skeleton sk-img' }), h('div', { class: 'skeleton sk-line' }), h('div', { class: 'skeleton sk-line short' })));
  d.focus({ preventScroll: true });
  try {
    const p = await api.get(`/api/perfumes/${encodeURIComponent(id)}`);
    if (my !== token) return;
    for (const k of ['top', 'middle', 'base', 'general']) cacheNotes(p.pyramid[k]);
    body().replaceChildren(renderDetail(p));
    d.scrollTop = 0;
    history.record({ kind: 'view', perfume_id: p.id });
  } catch (e) {
    if (my !== token) return;
    body().replaceChildren(closeButton(), h('p', { class: 'list-msg' }, 'Could not load this fragrance.'));
  }
}

function closeButton() {
  return h('button', { class: 'icon-btn drawer-close', type: 'button', 'aria-label': 'Close details', onclick: () => closeDrawer() }, svgIcon('close', 20));
}

function renderDetail(p) {
  const pyrParams = {};
  for (const [k, qk] of [['top', 'top'], ['middle', 'middle'], ['base', 'base'], ['general', 'any']]) {
    const slugs = (p.pyramid[k] || []).map((n) => n.slug);
    if (slugs.length) pyrParams[qk] = slugs.join(',');
  }
  const gender = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : null;
  const meta = [p.year, gender, p.country].filter(Boolean);
  return h('div', { class: 'detail' },
    closeButton(),
    h('div', { class: 'detail-hero' },
      h('div', { class: 'detail-bottle', style: { '--tint': (p.accords[0] && p.accords[0].color) || 'var(--accent)' } }, bottleImg(p, `${p.name} bottle`)),
      h('div', { class: 'detail-head' },
        h('p', { class: 'eyebrow' }, brandLink(p.brand)),
        brandStrip(p),
        h('h2', { id: 'drawer-title' }, p.name),
        h('p', { class: 'detail-meta' }, meta.join(' · ')),
        h('div', { class: 'detail-rating' }, ratingBadge(p), p.rating_count ? h('span', { class: 'muted' }, `${plural(p.rating_count, 'vote')}`) : null),
        p.perfumers && p.perfumers.length ? h('p', { class: 'perfumers' }, h('span', { class: 'muted' }, p.perfumers.length > 1 ? 'Perfumers ' : 'Perfumer '), p.perfumers.join(', ')) : null)),
    h('div', { class: 'detail-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(`/like/${p.id}`) }, svgIcon('search', 16), 'Find similar'),
      h('button', { class: 'btn', type: 'button', onclick: () => go('/pyramid', pyrParams), title: 'Load this pyramid into the builder' }, 'Edit as pyramid'),
      h('a', { class: 'btn', href: p.link, target: '_blank', rel: 'noopener noreferrer', title: p.link_is_exact ? 'Open on Fragrantica' : 'Search on Fragrantica' },
        p.link_is_exact ? 'Fragrantica' : 'Search Fragrantica', svgIcon('external', 14)),
      heart('perfume', p.id, 'Add to favorites')),
    dupeSections(p),
    personalPanel(p),
    p.accords.length ? h('section', { class: 'detail-sec' }, h('h3', { class: 'sec-title' }, 'Main accords'), accordBars(p.accords)) : null,
    h('section', { class: 'detail-sec' }, h('h3', { class: 'sec-title' }, 'Fragrance pyramid'), pyramidDiagram(p.pyramid, { onNote: () => {} })));
}

/** Brand tags (as links to the filtered list), origin country and the research note, right under the perfume name. */
function brandStrip(p) {
  const i = p.brand_info;
  if (!i) return null;
  const meta = [i.origin_country, i.parent_company ? `part of ${i.parent_company}` : null].filter(Boolean).join(' · ');
  const badges = tagBadges({ brand: p.brand, brand_tags: p.brand_tags, brand_tags_inferred: i.inferred }, { mode: 'full', link: true });
  if (!badges && !meta) return null;
  return h('div', { class: 'brand-strip' }, badges, meta ? h('span', { class: 'muted small' }, meta) : null,
    i.notes ? h('p', { class: 'brand-strip-notes muted small' }, i.notes, i.confidence ? ` (${confLabel(i.confidence).toLowerCase()} confidence${i.inferred ? ', inferred' : ''})` : '') : null);
}

// ---------------------------------------------------------------- "my" panel: status, rating, private note
function personalPanel(p) {
  const wrap = h('section', { class: 'detail-sec my-panel', 'aria-label': 'My notes on this fragrance' });
  let gen = 0;
  async function render() {
    const my = ++gen;
    if (!session.user) {
      wrap.replaceChildren(
        h('h3', { class: 'sec-title' }, 'My notes'),
        h('p', { class: 'muted' }, 'Sign in to mark this owned, tried or on your wishlist, rate it and keep a private note.'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openAuthModal({ mode: 'login', reason: 'Sign in to keep your own collection.' }) }, 'Sign in'));
      return;
    }
    wrap.replaceChildren(h('h3', { class: 'sec-title' }, 'My notes'), h('div', { class: 'skeleton sk-line' }));
    let cur;
    try { cur = await api.get(`/api/me/perfumes/${p.id}`); } catch (e) { wrap.replaceChildren(h('p', { class: 'muted' }, 'Could not load your notes.')); return; }
    if (my !== gen) return;
    const flash = h('span', { class: 'saved-flash', role: 'status', 'aria-live': 'polite' });
    const saved = (msg = 'Saved') => { flash.textContent = msg; setTimeout(() => { if (flash.textContent === msg) flash.textContent = ''; }, 1600); };
    const put = async (fields) => {
      try { const r = await mine.save(p.id, fields); if (r) { cur = r; saved(); } return r; }
      catch (e) { flash.textContent = e.detail || 'Could not save'; return null; }
    };
    const seg = segmented(
      [{ value: '', label: 'None' }, { value: 'owned', label: 'Owned' }, { value: 'tried', label: 'Tried' }, { value: 'wishlist', label: 'Wishlist' }],
      cur.status || '', (v) => put({ status: v || null }), 'Personal status');
    const stars = h('div', { class: 'stars', role: 'group', 'aria-label': 'My rating' });
    const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', {
      class: 'star', type: 'button', 'aria-pressed': String(cur.rating >= n), 'aria-label': `${n} star${n > 1 ? 's' : ''}`, title: cur.rating === n ? 'Click again to clear' : `${n} / 5`,
      onclick: async () => { const r = await put({ rating: cur.rating === n ? null : n }); if (r) drawStars(); },
    }, svgIcon('star', 22))));
    drawStars();
    const note = h('textarea', { class: 'textarea', rows: '3', maxlength: '500', placeholder: 'A private note: when you wear it, what it reminds you of…', 'aria-label': 'Private note' }, cur.note || '');
    let last = cur.note || '';
    note.addEventListener('blur', async () => { if (note.value.trim() !== last.trim()) { const r = await put({ note: note.value.trim() || null }); if (r) last = note.value; } });
    wrap.replaceChildren(
      h('div', { class: 'my-head' }, h('h3', { class: 'sec-title' }, 'My notes'), h('small', { class: 'muted' }, 'Only you can see this.'), flash),
      h('div', { class: 'my-row' }, seg, stars), note);
  }
  const off = session.onChange(() => { if (!wrap.isConnected) { off(); return; } render(); });
  render();
  return wrap;
}

export function initDrawer() {
  scrim().addEventListener('click', () => closeDrawer());
  drawer().addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const f = [...drawer().querySelectorAll('a[href],button:not([disabled]),input,select,[tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer())) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // clicking a note inside the drawer navigates; make sure the drawer closes afterwards
  drawer().addEventListener('click', (e) => {
    const a = e.target.closest('a.note-card');
    if (a) { e.preventDefault(); const href = a.getAttribute('href'); go(href.slice(1)); }
  });
}
