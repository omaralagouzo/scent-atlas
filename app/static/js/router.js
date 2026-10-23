// Hash router: #/path?query. The `p` query param opens the perfume drawer on top of any view.
const routes = [];
let current = { key: null, cleanup: null };
let drawerHooks = { open: () => {}, close: () => {} };
let drawerPushed = false;

export function route(pattern, mount) {
  const names = [];
  const rx = new RegExp(
    '^' + pattern.replace(/:([a-z]+)/g, (_, n) => (names.push(n), '([^/]+)')) + '/?$'
  );
  routes.push({ rx, names, mount });
}
export function setDrawer(h) {
  drawerHooks = h;
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/notes';
  const i = raw.indexOf('?');
  const path = i < 0 ? raw : raw.slice(0, i);
  return { path, params: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) };
}

export function buildHash(path, params) {
  const parts = [];
  for (const [k, v] of params.entries()) {
    if (v === '' || v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/gi, ',').replace(/%40/g, '@').replace(/%3A/gi, ':')}`);
  }
  return `#${path}${parts.length ? '?' + parts.join('&') : ''}`;
}

const viewKey = (path, params) => {
  const p = new URLSearchParams(params);
  p.delete('p');
  return path + '?' + p.toString();
}

export function go(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) p.set(k, v);
  location.hash = buildHash(path, p);
}

// Update the URL for state that lives inside a view, without re-rendering it. By default the entry is replaced;
// with { push: true } a history entry is added when the URL really changes, so the Back button steps through
// query / filter / sort changes (the view re-mounts from the URL on Back).
export function sync(path, paramsObj, { push = false } = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) if (v !== '' && v != null) p.set(k, v);
  current.key = viewKey(path, p);
  const open = parseHash().params.get('p');
  if (open) p.set('p', open);
  const hash = buildHash(path, p);
  const same = (a, b) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch (e) { return a === b; } };
  if (push && !same(hash, location.hash)) history.pushState(null, '', hash);
  else history.replaceState(null, '', hash);
}

export function openPerfume(id) {
  const { path, params } = parseHash();
  params.set('p', String(id));
  drawerPushed = true;
  location.hash = buildHash(path, params);
}

export function closeDrawer() {
  const { path, params } = parseHash();
  if (!params.has('p')) return;
  if (drawerPushed) {
    drawerPushed = false;
    history.back();
  } else {
    params.delete('p');
    history.replaceState(null, '', buildHash(path, params));
    drawerHooks.close();
  }
}

export function render() {
  const { path, params } = parseHash();
  const key = viewKey(path, params);
  if (key !== current.key) {
    const prevPath = current.key ? current.key.split('?')[0] : null;
    if (current.cleanup) {
      try { current.cleanup(); } catch (e) { console.error(e); }
    }
    current = { key, cleanup: null };
    const root = document.getElementById('main');
    root.replaceChildren();
    let matched = false;
    const vp = new URLSearchParams(params);
    vp.delete('p');
    for (const r of routes) {
      const m = r.rx.exec(path);
      if (!m) continue;
      const args = {};
      r.names.forEach((n, i) => (args[n] = decodeURIComponent(m[i + 1])));
      matched = true;
      current.cleanup = r.mount(root, { args, params: vp, path }) || null;
      break;
    }
    if (!matched) location.hash = '#/notes';
    document.querySelectorAll('.nav a').forEach((a) => {
      const base = a.getAttribute('href').slice(1);
      const on = path === base || path.startsWith(base + '/') || (base === '/notes' && path.startsWith('/note/'));
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    // on narrow screens the nav scrolls sideways: keep the current page's link in view (horizontally only)
    const nav = document.querySelector('.nav'), cur = document.querySelector('.nav a[aria-current]');
    if (nav && cur && nav.scrollWidth > nav.clientWidth) {
      const l = cur.offsetLeft - nav.offsetLeft, r = l + cur.offsetWidth;
      if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: Math.max(0, l - 24), behavior: 'smooth' });
    }
    if (prevPath !== path) window.scrollTo(0, 0);
  }
  const p = params.get('p');
  if (p) drawerHooks.open(p);
  else { drawerPushed = false; drawerHooks.close(); }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
