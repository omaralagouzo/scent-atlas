// My Atlas: taste profile, collection, favorites, saved searches and history for the signed-in user.
import { h, svgIcon, toast, compact } from '../util.js';
import { api, session, mine } from '../api.js';
import { perfumeCard, noteTile, noteChip, noteImgEl, bottleImg, segmented } from '../components.js';
import { savedRow } from '../saved.js';
import { openAuthModal } from '../auth.js';
import { go, openPerfume } from '../router.js';

const STATUS_TABS = [['owned', 'Owned'], ['tried', 'Tried'], ['wishlist', 'Wishlist']];

function ago(ts) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function myExtra(it) {
  const m = it.my || {};
  if (!m.rating && !m.note) return null;
  return h('div', { class: 'my-extra' },
    m.rating ? h('span', { class: 'my-stars', title: `My rating: ${m.rating} / 5`, 'aria-label': `My rating ${m.rating} of 5` }, '★'.repeat(m.rating) + '☆'.repeat(5 - m.rating)) : null,
    m.note ? h('p', { class: 'my-note' }, m.note) : null);
}

export function mountAtlas(root) {
  const body = h('div', { class: 'atlas' }, h('div', { class: 'skeleton sk-hero' }));
  root.append(h('section', { class: 'view' },
    h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Your corner of the atlas'), h('h1', null, 'My Atlas'),
      h('p', { class: 'lede' }, 'Your favorites, what you own and have tried, saved searches and recent history, and the notes you keep coming back to.')),
    body));
  let dead = false, gen = 0;

  async function load() {
    const my = ++gen;
    if (!session.user) {
      body.replaceChildren(h('div', { class: 'empty' },
        h('h2', null, 'Sign in to see your atlas'),
        h('p', null, 'Browsing and searching work without an account. Sign in to keep favorites, a collection, saved searches and history.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAuthModal({ mode: 'login' }) }, 'Sign in'),
          h('button', { class: 'btn', type: 'button', onclick: () => openAuthModal({ mode: 'signup' }) }, 'Create an account'))));
      return;
    }
    try {
      const r = await api.get('/api/me/atlas');
      if (dead || my !== gen) return;
      render(r);
    } catch (e) {
      if (dead || my !== gen) return;
      body.replaceChildren(h('p', { class: 'list-msg' }, 'Could not load your atlas.'));
    }
  }

  function render(r) {
    body.replaceChildren(profileSection(r.profile), collectionSection(r), favoritesSection(r.favorites), savedSection(r.saved), historySection(r.history));
  }

  // ---------------------------------------------------------------- notes I gravitate to
  function profileSection(pr) {
    const sec = h('section', { class: 'atlas-sec profile' });
    sec.append(h('h2', { class: 'sec-title' }, 'Notes I gravitate to'));
    if (!pr.notes.length) {
      sec.append(h('p', { class: 'muted' }, 'Heart a few perfumes, mark some as owned or tried, or rate them, and the notes you favor show up here, weighted toward your strongest signals and rarer notes.'));
      return sec;
    }
    const b = pr.based_on;
    const bits = [[b.favorites, 'favorite'], [b.owned, 'owned'], [b.tried, 'tried'], [b.wishlist, 'on wishlist'], [b.rated, 'rated']].filter(([n]) => n);
    sec.append(h('p', { class: 'muted small' }, `From ${bits.map(([n, l]) => `${n} ${l}`).join(' · ')}.`));
    if (pr.families.length) {
      sec.append(h('div', { class: 'fam-strip', role: 'img', 'aria-label': 'Note families: ' + pr.families.map((f) => `${f.name} ${Math.round(f.share * 100)}%`).join(', ') },
        pr.families.map((f) => h('span', { style: { flexGrow: String(f.share), background: f.color }, title: `${f.name} ${Math.round(f.share * 100)}%` }, f.share > 0.12 ? f.name : ''))));
    }
    sec.append(h('ol', { class: 'profile-notes' }, pr.notes.map((n) =>
      h('li', { style: { '--fam': n.color } },
        h('a', { class: 'profile-note', href: `#/note/${encodeURIComponent(n.slug)}`, title: `${n.name}: in ${n.perfumes} of your perfumes` },
          noteImgEl(n, '', 'profile-img'), h('span', { class: 'profile-name' }, n.name),
          h('span', { class: 'profile-bar' }, h('i', { style: { width: `${Math.max(6, Math.round(n.share * 100))}%` } })),
          h('small', null, `${n.perfumes}`))))));
    const top3 = pr.notes.slice(0, 3).map((n) => n.slug).join(',');
    sec.append(h('div', { class: 'hero-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('/pyramid', pr.pyramid_params) }, svgIcon('search', 16), 'Find perfumes like this profile'),
      h('button', { class: 'btn', type: 'button', onclick: () => go('/combine', { include: top3 }) }, 'Perfumes with my top 3 notes')));
    return sec;
  }

  // ---------------------------------------------------------------- collection
  function collectionSection(r) {
    const sec = h('section', { class: 'atlas-sec' });
    const lists = { ...r.collection, rated: r.rated_only };
    const tabs = [...STATUS_TABS.map(([k, l]) => ({ value: k, label: `${l} · ${lists[k].length}` })), { value: 'rated', label: `Rated only · ${lists.rated.length}` }];
    const first = (STATUS_TABS.find(([k]) => lists[k].length) || STATUS_TABS[0])[0];
    const grid = h('div', { class: 'grid grid-cards' });
    const draw = (k) => {
      const items = lists[k] || [];
      grid.replaceChildren(...(items.length ? items.map((it) => perfumeCard(it, { extra: myExtra(it) }))
        : [h('p', { class: 'muted' }, k === 'rated' ? 'Perfumes you rated without marking a status appear here.' : 'Nothing here yet. Use the bookmark on any perfume card to add it.')]));
    };
    sec.append(h('div', { class: 'toolbar' }, h('h2', { class: 'sec-title inline' }, 'My collection'), segmented(tabs, first, draw, 'Collection')), grid);
    draw(first);
    return sec;
  }

  // ---------------------------------------------------------------- favorites
  function favoritesSection(f) {
    const sec = h('section', { class: 'atlas-sec' });
    sec.append(h('h2', { class: 'sec-title' }, `Favorite perfumes (${f.perfumes.length})`),
      f.perfumes.length ? h('div', { class: 'grid grid-cards' }, f.perfumes.map((p) => perfumeCard(p)))
        : h('p', { class: 'muted' }, 'No favorite perfumes yet. Tap the heart on any card.'),
      h('h2', { class: 'sec-title' }, `Favorite notes (${f.notes.length})`),
      f.notes.length ? h('div', { class: 'grid grid-notes' }, f.notes.map(noteTile))
        : h('p', { class: 'muted' }, 'No favorite notes yet. Open a note page and tap its heart.'));
    return sec;
  }

  // ---------------------------------------------------------------- saved searches
  function savedSection(items) {
    const sec = h('section', { class: 'atlas-sec' });
    const box = h('div', { class: 'saved-list' });
    const draw = (list) => {
      box.replaceChildren(...(list.length ? list.map((it) => savedRow(it, {
        onOpen: () => go(it.kind === 'combine' ? '/combine' : '/pyramid', it.state),
        onDelete: async () => {
          try { await api.del(`/api/me/saved/${it.id}`); draw(list.filter((x) => x.id !== it.id)); } catch (e) { toast('Could not delete.'); }
        },
      })) : [h('p', { class: 'muted' }, 'Nothing saved yet. Use Save on the Combine or Pyramid pages to keep a search.')]));
    };
    draw(items);
    sec.append(h('h2', { class: 'sec-title' }, 'Saved searches'), box);
    return sec;
  }

  // ---------------------------------------------------------------- history
  function historySection(items) {
    const sec = h('section', { class: 'atlas-sec' });
    const box = h('ul', { class: 'history' });
    const clearBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
      if (!window.confirm('Clear your whole history?')) return;
      try { await api.del('/api/me/history'); draw([]); toast('History cleared.'); } catch (e) { toast('Could not clear history.'); }
    } }, svgIcon('trash', 15), 'Clear history');
    const KIND = { view: 'Viewed', like: 'Smells like', pyramid: 'Pyramid', combine: 'Combine' };
    const draw = (list) => {
      clearBtn.hidden = !list.length;
      box.replaceChildren(...(list.length ? list.map((it) => {
        const open = () => {
          if (it.kind === 'view') openPerfume(it.perfume.id);
          else if (it.kind === 'like') go(`/like/${it.perfume.id}`);
          else go(it.kind === 'combine' ? '/combine' : '/pyramid', it.state);
        };
        return h('li', { class: 'history-item' },
          it.perfume ? h('span', { class: 'history-img' }, bottleImg(it.perfume, '')) : h('span', { class: 'history-ico' }, svgIcon('search', 16)),
          h('button', { class: 'history-main', type: 'button', onclick: open },
            h('span', { class: 'history-kind' }, KIND[it.kind]),
            h('span', { class: 'history-label' }, it.perfume ? `${it.perfume.name} · ${it.perfume.brand}` : it.label)),
          h('small', { class: 'muted' }, ago(it.created_at)),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove from history', title: 'Remove', onclick: async () => {
            try { await api.del(`/api/me/history/${it.id}`); draw(list.filter((x) => x.id !== it.id)); } catch (e) { /* ignore */ }
          } }, svgIcon('close', 14)));
      }) : [h('li', { class: 'muted' }, 'Nothing yet. Perfumes you open and searches you run are listed here (newest first, last 200 kept).')]));
    };
    draw(items);
    sec.append(h('div', { class: 'toolbar' }, h('h2', { class: 'sec-title inline' }, 'Recent history'), clearBtn), box);
    return sec;
  }

  const off = session.onChange(() => { if (!dead) load(); });
  load();
  return () => { dead = true; off(); };
}
