// About & credits (dataset licence, image attribution, non-commercial notice).
import { h } from '../util.js';
import { api } from '../api.js';

export function mountAbout(root) {
  const credits = h('ul', { class: 'credit-list' });
  root.append(h('section', { class: 'view prose' },
    h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'About'), h('h1', null, 'About & credits'),
      h('p', { class: 'lede' }, 'Scent Atlas is a non-commercial personal project for exploring fragrance notes.')),
    h('h2', { class: 'sec-title' }, 'Data'),
    h('p', null, 'The catalogue (perfumes, notes, accords and ratings) is a merged, de-duplicated dataset derived from public Fragrantica-based datasets. The main sources are the Decant dump (',
      h('a', { href: 'https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes', target: '_blank', rel: 'noopener noreferrer' }, 'ledecanteur on Kaggle'), ', ',
      h('a', { href: 'https://codeberg.org/decant', target: '_blank', rel: 'noopener noreferrer' }, 'codeberg.org/decant'), ') and ',
      h('a', { href: 'https://www.kaggle.com/datasets/olgagmiufana1/fragrantica-com-fragrance-dataset', target: '_blank', rel: 'noopener noreferrer' }, 'olgagmiufana1'),
      ', both released under ', h('a', { href: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', target: '_blank', rel: 'noopener noreferrer' }, 'CC BY-NC-SA 4.0'),
      ', with additional fields from other public Kaggle/GitHub datasets listed in the repository\'s data/BUILD_REPORT.md.'),
    h('p', null, 'Because of the share-alike and non-commercial terms, this derived catalogue is likewise offered under CC BY-NC-SA 4.0: attribute the sources above, no commercial use, share adaptations under the same licence.'),
    h('h2', { class: 'sec-title' }, 'Images'),
    h('p', null, 'Bottle photos and note images are © Fragrantica and their respective owners. They are loaded directly from Fragrantica\'s image servers (fimgs.net) and are not stored or redistributed by this site. A handful of note photos come from Wikipedia/Wikimedia Commons under their own licences:'),
    credits,
    h('h2', { class: 'sec-title' }, 'Accounts & privacy'),
    h('p', null, 'Browsing needs no account. If you create one, we store your username, email (never used to send mail), a salted argon2id hash of your password, and the favorites, collection, ratings, notes, saved searches and history you add. Delete your account from the account menu to remove all of it.'),
    h('p', { class: 'muted small' }, 'Not affiliated with or endorsed by Fragrantica. Perfume names and brands belong to their owners.')));
  let dead = false;
  api.get('/api/credits').then((r) => {
    if (dead) return;
    const seen = new Set();
    const items = Object.values(r.note_images || {}).filter((c) => !seen.has(c) && seen.add(c));
    credits.replaceChildren(...(items.length ? items.map((c) => h('li', null, c)) : [h('li', { class: 'muted' }, 'None in this build.')]));
  }).catch(() => {});
  return () => { dead = true; };
}
