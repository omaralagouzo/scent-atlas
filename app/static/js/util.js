// Tiny DOM + formatting helpers. No innerHTML with data: all text goes through text nodes.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendKids(el, kids);
  return el;
}

export function svgIcon(name, size = 18) {
  const paths = {
    heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 5 6 5c2.1 0 3.6 1.2 4.5 2.6h3C14.4 6.2 15.9 5 18 5c3.3 0 5.1 3.4 3.6 6.8C19.5 16.4 12 21 12 21z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    swap: '<path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3"/>',
    star: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
    user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.9-3.6 4-5.4 7.5-5.4s6.6 1.8 7.5 5.4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  };
  const wrap = document.createElement('span');
  wrap.className = 'ico';
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  return wrap;
}

export function debounce(fn, ms = 200) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const compact = (n) => {
  if (n == null) return '';
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

export const LAYERS = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Heart' },
  { key: 'base', label: 'Base' },
];
export const layerLabel = (k) =>
  ({ top: 'Top', middle: 'Heart', base: 'Base', general: 'Notes', any: 'Any layer' }[k] || k);

export function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`;
}

export function toast(msg, ms = 3200) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export const noteImg = (slug) => `/img/note/${encodeURIComponent(slug)}`;

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// read/write a view's state from the URL ----------------------------------
export function csv(s) {
  return (s || '').split(',').map((x) => x.trim()).filter(Boolean);
}
