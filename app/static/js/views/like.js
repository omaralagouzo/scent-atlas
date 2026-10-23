// View 4: "Smells like…" — pick a perfume you love, get its pyramid and its nearest neighbours.
import { h, svgIcon, plural } from '../util.js';
import { api, favs, history } from '../api.js';
import { bottleImg, statusButton, heart, pyramidDiagram, accordBars, resultRow, legend, infinite, perfumeCard, ratingBadge, perfumePicker } from '../components.js';
import { go, sync, openPerfume } from '../router.js';
import { brandLink, tagBadges, dupeBadges } from '../brandtags.js';
import { createFilters, pillsBar, readFilters, filterParams, hydrateFilters } from '../filters.js';

const PER = 24;

export function mountLike(root, { args, params }) {
  const pid = args.id ? Number(args.id) : null;
  const pick = perfumePicker({ onPick: (p) => go(`/like/${p.id}`) });
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
  const f = readFilters(params);
  let noSameBrand = params.get('other_brands') === '1';
  let onlyDupes = params.get('only_dupes') === '1';
  const target = h('div', { class: 'like-target' }, h('div', { class: 'skeleton sk-hero' }));
  const count = h('span', { class: 'result-count', 'aria-live': 'polite' });
  const results = h('div', { class: 'results' });
  const brandChk = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: noSameBrand, onchange: (e) => { noSameBrand = e.target.checked; reload(); } }), 'Other houses only');
  const dupeChk = h('label', { class: 'check', title: 'Perfumes linked to this one as an original or an inspired-by version, plus fragrances from dupe houses' },
    h('input', { type: 'checkbox', checked: onlyDupes, onchange: (e) => { onlyDupes = e.target.checked; reload(); } }), 'Only dupes / alternatives');
  const panel = createFilters({
    f, features: { notes: false, perfumers: true }, onChange: () => reload(),
    fetchFacet: (name, { fq = '', offset = 0, limit = 12 } = {}) => api.get(`/api/perfumes/${pid}/similar/facet`, { facet: name, fq, offset, limit, exclude_brand: noSameBrand ? 'true' : '', only_dupes: onlyDupes ? 'true' : '', ...filterParams(f) }),
  });
  const pills = pillsBar(f, () => { panel.redraw(); reload(); });
  section.append(target,
    h('div', { class: 'toolbar results-bar' }, h('h2', { class: 'sec-title inline' }, 'Most similar'), brandChk, dupeChk, panel.openBtn, count),
    legend(),
    h('div', { class: 'rlayout' }, panel.scrim, panel.el, h('div', { class: 'rmain' }, pills.el, results)));
  hydrateFilters(f).then(() => { panel.redraw(); pills.draw(); });

  const get = (page) => api.get(`/api/perfumes/${pid}/similar`, {
    limit: PER, offset: (page - 1) * PER, exclude_brand: noSameBrand ? 'true' : '', only_dupes: onlyDupes ? 'true' : '', ff: page === 1 ? 1 : 0, ...filterParams(f),
  });
  let firstResp = null;
  list = infinite(results, async (page) => {
    const r = firstResp && page === 1 ? firstResp : await get(page);
    firstResp = null;
    if (!dead && !target.dataset.ready) { drawTarget(r.source); history.record({ kind: 'like', perfume_id: r.source.id }); }
    if (page === 1) { count.textContent = plural(r.total, 'perfume'); panel.update(r.filter_facets, r.total); }
    const off = (page - 1) * PER;
    return { items: r.results.map((x, i) => ({ ...x, _rank: off + i + 1 })), hasMore: off + PER < r.total };
  }, (it) => resultRow(it, it._rank), { empty: 'Nothing similar found with those filters. If “Only dupes / alternatives” is ticked, untick it to see everything similar.' });

  function drawTarget(p) {
    target.dataset.ready = '1';
    const gen = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : '';
    target.replaceChildren(
      h('div', { class: 'like-card' },
        h('div', { class: 'like-bottle', style: { '--tint': (p.accords[0] && p.accords[0].color) || 'var(--accent)' } }, bottleImg(p, p.name)),
        h('div', { class: 'like-info' },
          h('p', { class: 'eyebrow' }, brandLink(p.brand), tagBadges(p)),
          h('h2', null, p.name),
          dupeBadges(p),
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
    sync(`/like/${pid}`, { ...filterParams(f), other_brands: noSameBrand ? '1' : '', only_dupes: onlyDupes ? '1' : '' }, { push: true });
    pills.draw();
    panel.update(null, null);
    firstResp = null;
    list.reset();
  }
  list.reset();
  return () => { dead = true; list && list.destroy(); panel.destroy(); };
}
