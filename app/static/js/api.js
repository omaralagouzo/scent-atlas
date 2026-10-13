// Fetch helpers + the client-side stores for the signed-in user (session, favourites, personal status).
const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, v);
  }
  const s = u.toString();
  return s ? `?${s}` : '';
};

async function req(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { ...(opts.headers || {}) };
  if (method !== 'GET' && method !== 'HEAD') headers['X-Requested-With'] = 'scent-atlas'; // CSRF guard header
  const r = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
  if (!r.ok) {
    let detail = '';
    try {
      const j = await r.json();
      detail = typeof j.detail === 'string' ? j.detail : (Array.isArray(j.detail) ? (j.detail[0] && j.detail[0].msg) || '' : '');
    } catch (e) { /* not json */ }
    const err = new Error(detail || `${r.status} ${r.statusText}`);
    err.status = r.status;
    err.detail = detail;
    throw err;
  }
  return r.json();
}

const jsonBody = (method) => (path, body, signal) =>
  req(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body === undefined ? {} : body), signal });

export const api = {
  get: (path, params, signal) => req(path + qs(params), { signal }),
  post: jsonBody('POST'),
  put: jsonBody('PUT'),
  patch: jsonBody('PATCH'),
  del: (path) => req(path, { method: 'DELETE' }),
};

// ---- note cache (slug -> {slug,name,image,...}) so chips can be rebuilt from URLs
const noteCache = new Map();
export function cacheNotes(list) {
  for (const n of list || []) if (n && n.slug) noteCache.set(n.slug, { ...noteCache.get(n.slug), ...n });
}
export async function resolveSlugs(slugs) {
  const missing = slugs.filter((s) => !noteCache.has(s));
  if (missing.length) {
    try {
      const r = await api.post('/api/notes/resolve', { names: missing.map((s) => s.replace(/-/g, ' ')) });
      r.matches.forEach((m, i) => {
        if (m.slug) noteCache.set(missing[i], { slug: m.slug, name: m.name, image: m.image || `/img/note/${m.slug}` });
      });
    } catch (e) { /* offline: fall through */ }
  }
  return slugs.map((s) => noteCache.get(s)).filter(Boolean);
}

// ---- session: who is signed in (null = anonymous browsing)
const listeners = new Set();
export const session = {
  user: null,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { listeners.forEach((fn) => { try { fn(this.user); } catch (e) { console.error(e); } }); },
  async load() {
    try {
      const r = await api.get('/api/me');
      this.apply(r);
    } catch (e) { this.apply({ user: null, favorites: { perfumes: [], notes: [] }, statuses: {} }); }
  },
  apply(r) {
    this.user = r.user || null;
    favs.setAll(r.favorites || { perfumes: [], notes: [] });
    mine.setAll(r.statuses || {});
    this.emit();
  },
  /** after sign-in / sign-up / sign-out: reload everything user-specific */
  async refresh() { await this.load(); },
};

// ---- favourites (hearts)
export const favs = {
  perfumes: new Set(),
  notes: new Set(),
  setAll(f) {
    this.perfumes = new Set((f.perfumes || []).map(String));
    this.notes = new Set(f.notes || []);
    this.refresh();
  },
  async load() { await session.load(); },
  has(type, id) {
    return (type === 'perfume' ? this.perfumes : this.notes).has(String(id));
  },
  /** Toggle; anonymous visitors get the sign-in modal first (resolved lazily to avoid an import cycle). */
  async toggle(type, id) {
    if (!session.user) {
      const { requireAuth } = await import('./auth.js');
      if (!(await requireAuth('Sign in to save favorites.'))) return null;
    }
    const set = type === 'perfume' ? this.perfumes : this.notes;
    const key = String(id);
    const liked = !set.has(key);
    liked ? set.add(key) : set.delete(key);
    this.refresh();
    try {
      await api.post('/api/favorites', { type, id: type === 'perfume' ? Number(id) : key, liked });
    } catch (e) {
      liked ? set.delete(key) : set.add(key);
      this.refresh();
      if (e.status === 401) session.refresh();
    }
    return liked;
  },
  refresh() {
    document.querySelectorAll('.heart[data-type]').forEach((b) => {
      const on = this.has(b.dataset.type, b.dataset.id);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  },
};

// ---- personal status (owned / tried / wishlist), 1-5 rating, private note
export const STATUS_LABEL = { owned: 'Owned', tried: 'Tried', wishlist: 'Wishlist' };
export const mine = {
  map: new Map(),
  setAll(obj) {
    this.map = new Map(Object.entries(obj || {}));
    this.refresh();
  },
  get(pid) { return this.map.get(String(pid)) || null; },
  status(pid) { const m = this.get(pid); return m ? m.status : null; },
  async save(pid, fields) {
    if (!session.user) {
      const { requireAuth } = await import('./auth.js');
      if (!(await requireAuth('Sign in to track perfumes you own, tried or want.'))) return null;
    }
    const r = await api.put(`/api/me/perfumes/${pid}`, fields);
    if (r.status || r.rating || r.note) this.map.set(String(pid), { status: r.status, rating: r.rating, has_note: !!r.note });
    else this.map.delete(String(pid));
    this.refresh();
    return r;
  },
  refresh() {
    document.querySelectorAll('.status-btn[data-pid]').forEach((b) => {
      const s = this.status(b.dataset.pid);
      if (s) b.dataset.status = s; else delete b.dataset.status;
      b.setAttribute('aria-label', s ? `${STATUS_LABEL[s]} - change status` : 'Mark as owned, tried or wishlist');
    });
  },
};

// ---- history (fire-and-forget; only for signed-in users)
export const history = {
  record(body) {
    if (!session.user) return;
    api.post('/api/me/history', body).catch(() => {});
  },
};
