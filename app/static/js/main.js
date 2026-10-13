import { $, h, svgIcon } from './util.js';
import { api, session } from './api.js';
import { route, start, setDrawer, go, closeDrawer } from './router.js';
import { initDrawer, showDrawer, hideDrawer } from './drawer.js';
import { mountNotes } from './views/notes.js';
import { mountNote } from './views/note.js';
import { mountCombine } from './views/combine.js';
import { mountPyramid } from './views/pyramid.js';
import { mountLike } from './views/like.js';
import { mountAtlas } from './views/atlas.js';
import { mountAbout } from './views/about.js';
import { mountAccountMenu } from './auth.js';

// ---- theme
const root = document.documentElement;
function applyTheme(t) {
  root.dataset.theme = t;
  const b = $('#theme-toggle');
  if (b) {
    b.replaceChildren(svgIcon(t === 'dark' ? 'sun' : 'moon', 19));
    b.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    b.title = b.getAttribute('aria-label');
  }
}
applyTheme(root.dataset.theme || 'dark');
$('#theme-toggle').addEventListener('click', () => {
  const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(t);
  try { localStorage.setItem('scent-theme', t); } catch (e) { /* ignore */ }
});

// ---- routes
route('/notes', mountNotes);
route('/note/:slug', mountNote);
route('/combine', mountCombine);
route('/pyramid', mountPyramid);
route('/like', mountLike);
route('/like/:id', mountLike);
route('/atlas', mountAtlas);
route('/favorites', () => { location.replace('#/atlas'); });  // old bookmark
route('/about', mountAbout);
setDrawer({ open: showDrawer, close: hideDrawer });
initDrawer();
mountAccountMenu($('#account'));

// ---- keyboard: "/" focuses the page's search, Escape closes the drawer
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
    const s = $('#drawer[aria-hidden="false"]') ? null : $('#main [data-search]');
    if (s) { e.preventDefault(); s.focus(); s.select && s.select(); }
  } else if (e.key === 'Escape') {
    closeDrawer();
  }
});

// ---- demo-data ribbon
api.get('/api/status').then((s) => {
  if (s.kind === 'fixture') {
    $('#ribbon').hidden = false;
    $('#ribbon').textContent = `Demo data: ${s.perfumes} perfumes, ${s.notes} notes — the full dataset (data/master.db) is not built yet. It will be picked up automatically on the next start.`;
  }
  $('#footer-stats').textContent = `${s.perfumes.toLocaleString()} perfumes · ${s.notes.toLocaleString()} notes`;
}).catch(() => {
  $('#ribbon').hidden = false;
  $('#ribbon').textContent = 'Cannot reach the Scent Atlas server. If you run it locally, is start.bat still running?';
});

session.load().finally(() => start());
