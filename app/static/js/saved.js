// "Save" + "Saved" buttons for the Combine and Pyramid views.
import { h, svgIcon, toast } from './util.js';
import { api, session } from './api.js';
import { requireAuth } from './auth.js';
import { openDialog, field } from './dialog.js';
import { noteImgEl } from './components.js';
import { go } from './router.js';

const PATH = { combine: '/combine', pyramid: '/pyramid' };

/** kind: 'combine' | 'pyramid'; getState() -> view params object; hasNotes() -> bool; suggest() -> default name */
export function savedBar(kind, { getState, hasNotes, suggest }) {
  const saveBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Save this search to My Atlas', onclick: save }, svgIcon('save', 15), 'Save');
  const listBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Re-open a saved search', onclick: openList }, svgIcon('bookmark', 15), 'Saved');
  const el = h('div', { class: 'saved-bar' }, saveBtn, listBtn);

  async function save() {
    if (!hasNotes()) { toast('Add a note first, then save the search.'); return; }
    if (!session.user && !(await requireAuth('Sign in to save searches.'))) return;
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const name = h('input', { class: 'input', type: 'text', required: true, maxlength: '80', value: (suggest() || '').slice(0, 80), autocomplete: 'off' });
    const go1 = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
    const form = h('form', { class: 'auth-form', novalidate: true },
      field(kind === 'combine' ? 'Name this note combination' : 'Name this pyramid', name, 'Saving with an existing name replaces that search.'), err, go1);
    const dlg = openDialog({ title: 'Save search', content: form, className: 'auth-modal' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'Give it a name.'; err.hidden = false; return; }
      go1.disabled = true;
      try {
        await api.post('/api/me/saved', { kind, name: name.value.trim(), state: getState() });
        toast('Saved to My Atlas.');
        dlg.close(true);
      } catch (ex) { err.textContent = ex.detail || 'Could not save.'; err.hidden = false; go1.disabled = false; }
    });
    name.focus(); name.select();
  }

  async function openList() {
    if (!session.user && !(await requireAuth('Sign in to see your saved searches.'))) return;
    const box = h('div', { class: 'saved-list' }, h('div', { class: 'skeleton sk-line' }));
    const dlg = openDialog({ title: kind === 'combine' ? 'Saved combinations' : 'Saved pyramids', content: box, className: 'saved-modal' });
    try {
      const r = await api.get('/api/me/saved', { kind });
      draw(box, dlg, r.items);
    } catch (e) { box.replaceChildren(h('p', { class: 'muted' }, 'Could not load saved searches.')); }
  }

  function draw(box, dlg, items) {
    if (!items.length) { box.replaceChildren(h('p', { class: 'muted' }, 'Nothing saved yet. Build something and press Save.')); return; }
    box.replaceChildren(...items.map((it) => savedRow(it, {
      onOpen: () => { dlg.close(true); go(PATH[kind], it.state); },
      onDelete: async () => {
        try { await api.del(`/api/me/saved/${it.id}`); draw(box, dlg, items.filter((x) => x.id !== it.id)); } catch (e) { toast('Could not delete.'); }
      },
    })));
  }
  return el;
}

/** One saved-search row (shared with the My Atlas page). */
export function savedRow(it, { onOpen, onDelete }) {
  return h('div', { class: 'saved-item' },
    h('div', { class: 'saved-thumbs' }, it.notes.slice(0, 4).map((n) => noteImgEl(n, n.name, 'saved-thumb'))),
    h('div', { class: 'saved-main' },
      h('b', { class: 'saved-name' }, it.name),
      h('small', { class: 'muted' }, `${it.kind === 'combine' ? 'Combine' : 'Pyramid'} · ${it.summary}`)),
    h('div', { class: 'saved-actions' },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: onOpen }, 'Open'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${it.name}`, title: 'Delete', onclick: onDelete }, svgIcon('trash', 16))));
}
