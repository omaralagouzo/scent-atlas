// Brand ("house") tags, dupe links and everything that renders them: badges, tooltip, brand links, brand header,
// "inspired by" / "alternatives" blocks and the compare-notes panel. Text only goes through text nodes (see util.h).
import { h, svgIcon, plural } from './util.js';
import { api } from './api.js';
import { buildHash, openPerfume } from './router.js';
import { bottleImg } from './components.js';

// ---------------------------------------------------------------- tag vocabulary
export const TAGS = {
  niche: { label: 'Niche', short: 'Niche', tip: 'A perfume-first house with limited distribution.' },
  designer: { label: 'Designer', short: 'Designer', tip: 'A fashion / luxury / lifestyle house or mainstream prestige brand.' },
  dupe: { label: 'Dupe house', short: 'Dupe', tip: 'A house whose catalogue is largely inspired by other perfumes.' },
  middle_eastern: { label: 'Middle Eastern', short: 'ME', tip: 'Founded or headquartered in the Middle East / GCC / Levant.' },
  middle_eastern_original: { label: 'ME original', short: 'ME original', tip: 'Middle Eastern house that makes its own originals.' },
  middle_eastern_dupe: { label: 'ME dupe', short: 'ME dupe', tip: 'Middle Eastern dupe house.' },
  untagged: { label: 'Untagged', short: 'Untagged', tip: 'No house type recorded for this brand yet.' },
};
export const CHIP_ORDER = ['niche', 'designer', 'dupe', 'middle_eastern', 'middle_eastern_original', 'middle_eastern_dupe', 'untagged'];
const CONF = { high: 'High', medium: 'Medium', low: 'Low' };
export const confLabel = (c) => CONF[c] || c || '';

const encName = (s) => String(s).replace(/\\/g, '\\\\').replace(/~/g, '\\~');
export const brandHref = (name) => buildHash('/combine', new URLSearchParams({ brands: encName(name) }));
export const tagHref = (tag) => buildHash('/combine', new URLSearchParams({ btags: tag }));

// ---------------------------------------------------------------- brand info cache + tooltip
const infoCache = new Map();
export function brandInfo(name) {
  let p = infoCache.get(name);
  if (!p) {
    p = api.get('/api/brands/info', { name }).catch((e) => { infoCache.delete(name); throw e; });
    infoCache.set(name, p);
  }
  return p;
}

let tipEl = null, tipToken = 0;
function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'tagtip', role: 'tooltip', hidden: true });
    document.body.append(tipEl);
  }
  return tipEl;
}
export function hideTip() { tipToken++; if (tipEl) tipEl.hidden = true; }

function tipBody(info) {
  const tags = (info.tags || []).filter((t) => t !== 'middle_eastern' || !(info.tags || []).some((x) => x.startsWith('middle_eastern_')));
  const meta = [info.origin_country, info.parent_company ? `part of ${info.parent_company}` : null].filter(Boolean).join(' · ');
  return [
    h('strong', { class: 'tagtip-name' }, info.name),
    info.tagged ? h('div', { class: 'tagtip-tags' }, tags.map((t) => h('span', { class: `btag t-${t}` }, TAGS[t] ? TAGS[t].label : t))) : h('div', { class: 'muted' }, 'No house type recorded yet.'),
    info.dupe_style ? h('div', { class: 'tagtip-line' }, `Dupe style: ${info.dupe_style === 'open' ? 'openly inspired-by' : info.dupe_style === 'partial' ? 'mix of originals and inspired-by' : 'inspired-by, not stated publicly'}`) : null,
    meta ? h('div', { class: 'tagtip-line' }, meta) : null,
    info.notes ? h('p', { class: 'tagtip-notes' }, info.notes) : null,
    info.tagged ? h('div', { class: 'tagtip-conf' }, `Confidence: ${info.confidence || 'unknown'}`, info.inferred ? ' · inferred by heuristics, not individually researched' : '') : null,
  ];
}

function showTip(target, name) {
  const my = ++tipToken;
  brandInfo(name).then((info) => {
    if (my !== tipToken || !target.isConnected) return;
    const t = tip();
    t.replaceChildren(...tipBody(info).filter(Boolean));
    t.hidden = false;
    const r = target.getBoundingClientRect();
    const w = t.offsetWidth, hh = t.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 6);
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
  }).catch(() => {});
}

export function attachTip(el, name) {
  el.addEventListener('mouseenter', () => showTip(el, name));
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('focusin', () => showTip(el, name));
  el.addEventListener('focusout', hideTip);
  el.addEventListener('click', hideTip);
  return el;
}

// ---------------------------------------------------------------- badges
function shownTags(tags, mode) {
  const main = ['niche', 'designer', 'dupe'].filter((t) => tags.includes(t));
  if (mode === 'card') {
    const out = main.slice(0, 1);
    if (tags.includes('middle_eastern')) out.push('middle_eastern');
    return out;
  }
  const me = tags.find((t) => t === 'middle_eastern_original' || t === 'middle_eastern_dupe') || (tags.includes('middle_eastern') ? 'middle_eastern' : null);
  return me ? [...main, me] : main;
}

/** Small coloured badges for a brand. `p` = {brand, brand_tags[], brand_tags_inferred}; mode card (compact) | full (drawer). */
export function tagBadges(p, { mode = 'card', link = false } = {}) {
  const tags = p.brand_tags || [];
  if (!tags.length) return null;
  const items = shownTags(tags, mode).map((t) => {
    const meta = TAGS[t];
    const cls = `btag t-${t}${p.brand_tags_inferred ? ' inferred' : ''}`;
    return link ? h('a', { class: cls, href: tagHref(t), title: `Show all ${meta.label.toLowerCase()} houses` }, mode === 'card' ? meta.short : meta.label)
      : h('span', { class: cls }, mode === 'card' ? meta.short : meta.label);
  });
  const wrap = h('span', { class: 'btags', tabindex: '-1' }, items);
  return attachTip(wrap, p.brand);
}

/** The brand name as a link that opens the Combine page filtered to this brand. */
export function brandLink(name, cls = '') {
  const a = h('a', { class: `brand-link ${cls}`.trim(), href: brandHref(name), title: `All ${name} perfumes` }, name);
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

/** Perfume-level badges: "Inspired by" for dupes, "N alternatives" for originals with known dupes. */
export function dupeBadges(p) {
  const out = [];
  if (p.is_dupe) out.push(h('span', { class: 'dbadge insp', title: 'Inspired by a known original - open it to see which' }, 'Inspired by…'));
  if (p.n_dupes) out.push(h('span', { class: 'dbadge alt', title: `${plural(p.n_dupes, 'known dupe')} / alternatives` }, plural(p.n_dupes, 'alternative')));
  return out.length ? h('div', { class: 'dbadges' }, out) : null;
}

/** On a smells-like row: how this result is linked to the source perfume. */
export function linkBadge(link) {
  if (!link) return null;
  const txt = link.relation === 'dupe' ? 'Alternative to this' : 'The original it is inspired by';
  return h('span', { class: `dbadge ${link.relation === 'dupe' ? 'alt' : 'insp'}`, title: `${link.basis_label} · ${confLabel(link.confidence)} confidence` }, txt);
}

// ---------------------------------------------------------------- brand header (Combine page, one brand selected)
export function brandHeader(name) {
  const box = h('section', { class: 'brand-head', 'aria-label': `About ${name}` });
  brandInfo(name).then((i) => {
    const meta = [i.origin_country, i.parent_company ? `part of ${i.parent_company}` : null, plural(i.count, 'perfume')].filter(Boolean);
    box.replaceChildren(...[
      h('div', { class: 'brand-head-top' },
        h('h2', null, i.name),
        i.tagged ? tagBadges({ brand: i.name, brand_tags: i.tags, brand_tags_inferred: i.inferred }, { mode: 'full', link: true }) : h('span', { class: 'muted small' }, 'No house type recorded yet')),
      h('p', { class: 'brand-head-meta' }, meta.join(' · ')),
      i.notes ? h('p', { class: 'brand-head-notes' }, i.notes, i.confidence ? h('span', { class: 'muted' }, ` (${i.confidence} confidence${i.inferred ? ', inferred' : ''})`) : null) : null,
      sourceLinks(i.sources)].filter(Boolean));
  }).catch(() => { box.hidden = true; });
  return box;
}

export function sourceLinks(urls, max = 3) {
  const list = (urls || []).filter((u) => /^https?:\/\//.test(u)).slice(0, max);
  if (!list.length) return null;
  return h('span', { class: 'srcs' }, list.map((u) => {
    let host = u;
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { /* keep raw */ }
    return h('a', { class: 'src', href: u, target: '_blank', rel: 'noopener noreferrer', title: u, onclick: (e) => e.stopPropagation() }, host);
  }));
}

// ---------------------------------------------------------------- mini cards (drawer)
function confPill(c) { return h('span', { class: `cpill c-${c}` }, confLabel(c)); }

function miniCard(it, { onCompare, active }) {
  const card = h('article', { class: `mcard${active ? ' active' : ''}`, tabindex: '0', role: 'link', 'aria-label': `${it.name} by ${it.brand}`, dataset: { id: it.id } },
    h('div', { class: 'mcard-img' }, bottleImg(it, `${it.name} bottle`)),
    h('div', { class: 'mcard-body' },
      h('h4', { class: 'mcard-name' }, it.name),
      h('div', { class: 'mcard-brand' }, brandLink(it.brand), tagBadges(it)),
      h('div', { class: 'mcard-conf' }, confPill(it.confidence), h('span', { class: 'mcard-basis', title: 'How this link was established' }, it.basis_label)),
      sourceLinks(it.sources, 2),
      h('button', { class: 'btn btn-sm mcard-cmp', type: 'button', onclick: (e) => { e.stopPropagation(); onCompare(it); } }, 'Compare notes')));
  const open = () => openPerfume(it.id);
  card.addEventListener('click', (e) => { if (!e.target.closest('a, button')) open(); });
  card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); } });
  return card;
}

/** Everything the drawer shows about dupe links: the "inspired by" block, the alternatives carousel, compare panel. */
export function dupeSections(p) {
  const host = h('div', { class: 'dupe-sections' });
  const cmpHost = h('section', { class: 'detail-sec cmp-host', hidden: true });
  let activeId = null;
  const mark = () => host.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('active', c.dataset.id === String(activeId)));
  const compare = async (it) => {
    if (activeId === it.id && !cmpHost.hidden) { activeId = null; cmpHost.hidden = true; mark(); return; }
    activeId = it.id; mark();
    cmpHost.hidden = false;
    cmpHost.replaceChildren(h('h3', { class: 'sec-title' }, 'Compare notes'), h('div', { class: 'skeleton sk-line' }), h('div', { class: 'skeleton sk-line short' }));
    cmpHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    try {
      const r = await api.get(`/api/perfumes/${p.id}/compare/${it.id}`);
      if (activeId !== it.id) return;
      cmpHost.replaceChildren(comparePanel(r, () => { activeId = null; cmpHost.hidden = true; mark(); }));
    } catch (e) { cmpHost.replaceChildren(h('p', { class: 'list-msg' }, 'Could not compare these two.')); }
  };

  if (p.dupe_of && p.dupe_of.length) {
    host.append(h('section', { class: 'detail-sec inspired' },
      h('h3', { class: 'sec-title' }, 'Inspired by'),
      h('p', { class: 'muted small inspired-lede' }, `${p.name} is an alternative to ${p.dupe_of.length === 1 ? 'this fragrance' : 'these fragrances'}. Open the original to see how close the notes are.`),
      h('div', { class: 'mcards' }, p.dupe_of.map((it) => miniCard(it, { onCompare: compare })))));
  }
  if (p.dupes_total) {
    const items = [...p.dupes];
    const c = p.dupes_counts || {};
    const row = h('div', { class: 'carousel', role: 'list', tabindex: '-1' });
    const more = h('button', { class: 'btn btn-sm', type: 'button', hidden: items.length >= p.dupes_total }, `Show more (${p.dupes_total - items.length})`);
    const draw = () => { row.replaceChildren(...items.map((it) => { const m = miniCard(it, { onCompare: compare }); m.setAttribute('role', 'listitem'); return m; })); more.hidden = items.length >= p.dupes_total; more.textContent = `Show more (${p.dupes_total - items.length})`; mark(); };
    more.addEventListener('click', async () => {
      more.disabled = true;
      try { const r = await api.get(`/api/perfumes/${p.id}/dupes`, { offset: items.length, limit: 24 }); items.push(...r.items); draw(); } catch (e) { /* ignore */ }
      more.disabled = false;
    });
    draw();
    host.append(h('section', { class: 'detail-sec alternatives' },
      h('h3', { class: 'sec-title' }, 'Known dupes & alternatives'),
      h('p', { class: 'muted small' }, `${plural(p.dupes_total, 'perfume')} listed as alternatives to ${p.name}: `,
        [c.high ? `${c.high} high` : null, c.medium ? `${c.medium} medium` : null, c.low ? `${c.low} low` : null].filter(Boolean).join(' · '), ' confidence. Best evidence first, then most popular.'),
      row, more));
  } else if (p.dupe_status && p.dupe_status.researched && p.dupe_status.is_original) {
    host.append(h('p', { class: 'muted small original-note' }, 'Checked for dupes: this looks like an original and no inspired-by versions are known.'));
  }
  host.append(cmpHost);
  return host;
}

// ---------------------------------------------------------------- compare notes (side by side pyramid)
const LAYER_ROWS = [['top', 'Top'], ['middle', 'Heart'], ['base', 'Base'], ['general', 'Notes']];

export function comparePanel(r, onClose) {
  const slugsOf = (pyr) => new Set(Object.values(pyr).flat().map((n) => n.slug));
  const A = slugsOf(r.a.pyramid), B = slugsOf(r.b.pyramid);
  const sameLayer = r.shared_same_layer || {};
  const side = (who, other, pyr) => LAYER_ROWS.map(([k, label]) => {
    const notes = pyr[k] || [];
    if (!notes.length) return null;
    return h('div', { class: `cmp-layer L-${k}` },
      h('span', { class: 'cmp-layer-name' }, label),
      h('div', { class: 'cmp-notes' }, notes.map((n) => {
        const shared = other.has(n.slug);
        const same = (sameLayer[k] || []).includes(n.slug);
        return h('span', { class: `cmp-note${shared ? ' shared' : ''}${same ? ' same' : ''}`, title: shared ? (same ? 'Shared, same layer' : 'Shared, different layer') : 'Only in this one' }, n.name);
      })));
  });
  const head = (x) => h('div', { class: 'cmp-head' }, h('div', { class: 'cmp-img' }, bottleImg(x, x.name)), h('div', null, h('b', null, x.name), h('small', null, x.brand)));
  const pct = Math.round((r.score || 0) * 100);
  return h('div', { class: 'cmp' },
    h('div', { class: 'cmp-top' },
      h('h3', { class: 'sec-title' }, 'Compare notes'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close comparison', onclick: onClose }, svgIcon('close', 16))),
    h('div', { class: 'cmp-score' },
      h('div', { class: 'score-num', title: `Our "smells like" score of ${r.b.name} against ${r.a.name}` }, pct, h('small', null, '%')),
      h('div', { class: 'cmp-score-text' },
        h('div', { class: 'score-bar' }, h('span', { style: { width: `${Math.max(3, pct)}%` } })),
        h('small', { class: 'muted' }, `${r.shared.length} shared notes · ${r.only_a} only in ${r.a.name} · ${r.only_b} only in ${r.b.name}`),
        r.link ? h('small', { class: 'muted' }, `${r.link.relation === 'dupe' ? `${r.b.name} is an alternative to ${r.a.name}` : `${r.b.name} is the original`} · ${r.link.basis_label} · ${confLabel(r.link.confidence)} confidence`) : null)),
    h('div', { class: 'cmp-cols' },
      h('div', { class: 'cmp-col' }, head(r.a), side('a', B, r.a.pyramid)),
      h('div', { class: 'cmp-col' }, head(r.b), side('b', A, r.b.pyramid))),
    h('p', { class: 'muted small cmp-legend' }, h('span', { class: 'cmp-note shared same' }, 'shared, same layer'), ' ', h('span', { class: 'cmp-note shared' }, 'shared, other layer'), ' ', h('span', { class: 'cmp-note' }, 'only here')));
}
