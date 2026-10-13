// View 4: "Smells like…" — pick a perfume you love, get its pyramid and its nearest neighbours.
import { h, svgIcon, debounce, plural } from '../util.js';
import { api, favs, history } from '../api.js';
import { bottleImg, statusButton, heart, pyramidDiagram, accordBars, resultRow, legend, infinite, perfumeCard, ratingBadge } from '../components.js';
import { go, sync, openPerfume } from '../router.js';

const PER = 24;

function picker(onPick) {
  const input = h('input', { class: 'input big', type: 'search', placeholder: 'Search a perfume or brand — Aventus, Shalimar, Tom Ford…', 'aria-label': 'Search for a perfume', autocomplete: 'off', 'data-search': '', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const list = h('ul', { class: 'pick-list', role: 'listbox', hidden: true });
  let items = [], active = -1, seq = 0;
  const setActive = (i) => { active = i; [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i))); if (list.children[i]) list.children[i].scrollIntoView({ block: 'nearest' }); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const draw = () => {
    list.replaceChildren(...items.map((p, i) => {
      const li = h('li', { class: 'pick-item', role: 'option', 'aria-selected': 'false' },
        bottleImg(p, '', 'pick-img'),
        h('span', { class: 'pick-text' }, h('b', null, p.name), h('small', null, `${p.brand}${p.year ? ' · ' + p.year : ''}`)),
        h('span', { class: 'pick-rate' }, p.rating ? `★ ${p.rating.toFixed(2)}` : ''));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(p); });
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
    try { const r = await api.get('/api/perfumes', { q, limit: 8 }); if (my !== seq) return; items = r.results; draw(); } catch (e) { /* ignore */ }
  };
  input.addEventListener('input', debounce(fetchNow, 140));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) fetchNow(); else setActive((active + 1) % Math.max(items.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % Math.max(items.length, 1)); }
    else if (e.key === 'Enter' && !list.hidden && items[active]) { e.preventDefault(); onPick(items[active]); }
    else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); }
  });
  return h('div', { class: 'picker' }, h('span', { class: 'ac-ico' }, svgIcon('search', 18)), input, list);
}

export function mountLike(root, { args, params }) {
  const pid = args.id ? Number(args.id) : null;
  const pick = picker((p) => go(`/like/${p.id}`));
  let list = null, dead = false;

  const section = h('section', { class: 'view' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Smells like…'),
      h('h1', null, pid ? 'Kindred fragrances' : 'What do you love wearing?'),
      h('p', { class: 'lede' }, 'Pick a perfume and we will read its pyramid, then find the ones that share its notes — in the same layers first.')),
    pick);
  root.append(section);

  if (!pid) {
    const home = h('div', { class: 'like-home' });
    section.append(home);
    (async () => {
      try {
        const fv = await api.get('/api/favorites');
        if (dead) return;
        if (fv.perfume_items.length) {
          home.append(h('h2', { class: 'sec-title' }, 'Your favorites'), h('div', { class: 'grid grid-cards compact' }, fv.perfume_items.slice(0, 12).map((p) => perfumeCard(p))));
        }
        const pop = await api.get('/api/search', { per_page: 12, facets: 0 });
        if (dead) return;
        home.append(h('h2', { class: 'sec-title' }, 'Popular starting points'), h('div', { class: 'grid grid-cards compact' }, pop.results.map((p) => perfumeCard(p))));
        home.append(h('p', { class: 'muted small' }, 'Click any card to open its details, then “Find similar”.'));
      } catch (e) { /* ignore */ }
    })();
    return () => { dead = true; };
  }

  // ---- a chosen perfume
  let gender = params.get('gender') || '';
  let noSameBrand = params.get('other_brands') === '1';
  let yMin = params.get('year_min') || '';
  const target = h('div', { class: 'like-target' }, h('div', { class: 'skeleton sk-hero' }));
  const count = h('span', { class: 'result-count', 'aria-live': 'polite' });
  const results = h('div', { class: 'results' });
  const genderSel = h('select', { class: 'select', 'aria-label': 'Gender', onchange: (e) => { gender = e.target.value; reload(); } },
    [['', 'Any gender'], ['women', 'Women'], ['men', 'Men'], ['unisex', 'Unisex']].map(([v, l]) => h('option', { value: v, selected: v === gender }, l)));
  const brandChk = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: noSameBrand, onchange: (e) => { noSameBrand = e.target.checked; reload(); } }), 'Other houses only');
  const yearIn = h('input', { class: 'input num', type: 'number', placeholder: 'Released after', value: yMin, 'aria-label': 'Released after year', onchange: (e) => { yMin = e.target.value; reload(); } });
  section.append(target,
    h('div', { class: 'toolbar results-bar' }, h('h2', { class: 'sec-title inline' }, 'Most similar'), genderSel, brandChk, yearIn, count),
    legend(), results);

  const get = (page) => api.get(`/api/perfumes/${pid}/similar`, {
    limit: PER, offset: (page - 1) * PER, gender, year_min: yMin, exclude_brand: noSameBrand ? 'true' : '',
  });
  let firstResp = null;
  list = infinite(results, async (page) => {
    const r = firstResp && page === 1 ? firstResp : await get(page);
    firstResp = null;
    if (!dead && !target.dataset.ready) { drawTarget(r.source); history.record({ kind: 'like', perfume_id: r.source.id }); }
    if (page === 1) count.textContent = plural(r.total, 'perfume');
    const off = (page - 1) * PER;
    return { items: r.results.map((x, i) => ({ ...x, _rank: off + i + 1 })), hasMore: off + PER < r.total };
  }, (it) => resultRow(it, it._rank), { empty: 'Nothing similar found with those filters.' });

  function drawTarget(p) {
    target.dataset.ready = '1';
    const gen = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : '';
    target.replaceChildren(
      h('div', { class: 'like-card' },
        h('div', { class: 'like-bottle', style: { '--tint': (p.accords[0] && p.accords[0].color) || 'var(--accent)' } }, bottleImg(p, p.name)),
        h('div', { class: 'like-info' },
          h('p', { class: 'eyebrow' }, p.brand),
          h('h2', null, p.name),
          h('p', { class: 'detail-meta' }, [p.year, gen, p.country].filter(Boolean).join(' · ')),
          h('div', { class: 'detail-rating' }, ratingBadge(p)),
          p.accords.length ? accordBars(p.accords.slice(0, 5)) : null,
          h('div', { class: 'hero-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => openPerfume(p.id) }, 'Full details'),
            h('button', { class: 'btn', type: 'button', onclick: () => {
              const q = {};
              for (const [k, qk] of [['top', 'top'], ['middle', 'middle'], ['base', 'base'], ['general', 'any']]) {
                const s = p.pyramid[k].map((n) => n.slug).join(',');
                if (s) q[qk] = s;
              }
              go('/pyramid', q);
            } }, 'Tweak as pyramid'),
            statusButton(p.id), heart('perfume', p.id, 'Add to favorites'))),
        h('div', { class: 'like-pyr' }, pyramidDiagram(p.pyramid))));
  }
  function reload() {
    sync(`/like/${pid}`, { gender, year_min: yMin, other_brands: noSameBrand ? '1' : '' });
    firstResp = null;
    list.reset();
  }
  list.reset();
  return () => { dead = true; list && list.destroy(); };
}
