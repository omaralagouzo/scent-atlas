// Owner-only account recovery page. Talks to /api/admin/*; never shows or handles any stored hash.
import { h, toast, svgIcon, debounce } from '/js/util.js';
import { api } from '/js/api.js';
import { openDialog, field } from '/js/dialog.js';

const main = document.getElementById('main');
const end = document.getElementById('admin-end');
const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : '-');

async function boot() {
  try {
    const r = await api.get('/api/admin/me');
    r.authenticated ? showUsers() : showLogin();
  } catch (e) {
    showDisabled();
  }
}

function showDisabled() {
  end.replaceChildren();
  main.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Admin disabled')));
}

function showLogin() {
  end.replaceChildren();
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, maxlength: '1024' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'auth-form admin-login', novalidate: true }, field('Admin password', pw), err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    try {
      await api.post('/api/admin/login', { password: pw.value });
      showUsers();
    } catch (ex) {
      err.textContent = ex.status === 404 ? 'Admin is disabled.' : (ex.detail || 'Sign-in failed.');
      err.hidden = false;
      pw.value = '';
      btn.disabled = false;
      pw.focus();
    }
  });
  main.replaceChildren(h('section', { class: 'view admin-card' }, h('h1', { class: 'admin-h1' }, 'Admin sign-in'), form));
  pw.focus();
}

async function showUsers() {
  end.replaceChildren(h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
    try { await api.post('/api/admin/logout', {}); } catch (e) { /* ignore */ }
    showLogin();
  } }, 'Sign out'));
  const tbody = h('tbody');
  const count = h('span', { class: 'result-count' });
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Filter by username or email', 'aria-label': 'Filter users', autocomplete: 'off' });
  const table = h('table', { class: 'admin-table' },
    h('thead', null, h('tr', null, ['User', 'Email', 'Created', 'Last login', 'Fav', 'Coll.', 'Saved', 'Sessions', ''].map((t) => h('th', null, t)))), tbody);
  main.replaceChildren(h('section', { class: 'view' },
    h('header', { class: 'page-head' }, h('h1', null, 'Accounts'), h('p', { class: 'lede' }, 'Reset a password, sign a user out everywhere, rename or delete. Passwords and hashes are never shown.')),
    h('div', { class: 'toolbar' }, q, count), h('div', { class: 'admin-scroll' }, table)));

  async function load() {
    try {
      const r = await api.get('/api/admin/users', { q: q.value.trim() });
      count.textContent = `${r.users.length} account${r.users.length === 1 ? '' : 's'}`;
      tbody.replaceChildren(...(r.users.length ? r.users.map(row) : [h('tr', null, h('td', { colspan: '9', class: 'muted' }, 'No matching accounts.'))]));
    } catch (e) {
      if (e.status === 401) showLogin(); else toast('Could not load users.');
    }
  }
  const row = (u) => h('tr', null,
    h('td', null, h('b', null, u.username)), h('td', null, u.email), h('td', { class: 'small' }, when(u.created_at)), h('td', { class: 'small' }, when(u.last_login_at)),
    h('td', null, u.favorites), h('td', null, u.collection), h('td', null, u.saved), h('td', null, u.sessions),
    h('td', { class: 'admin-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => resetDialog(u) }, 'Reset password'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => revoke(u), disabled: u.sessions ? null : true }, 'Sign out everywhere'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editDialog(u) }, 'Edit'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${u.username}`, title: 'Delete account', onclick: () => deleteDialog(u) }, svgIcon('trash', 16))));

  async function revoke(u) {
    try { const r = await api.post(`/api/admin/users/${u.id}/revoke-sessions`, {}); toast(`Signed out ${u.username} (${r.revoked} session${r.revoked === 1 ? '' : 's'}).`); load(); }
    catch (e) { toast(e.detail || 'Failed.'); }
  }

  function formDialog(title, body, build) {
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const btn = h('button', { class: build.danger ? 'btn btn-danger' : 'btn btn-primary', type: 'submit' }, build.label);
    const form = h('form', { class: 'auth-form', novalidate: true }, ...body, err, btn);
    const dlg = openDialog({ title, content: form, className: 'auth-modal' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      btn.disabled = true;
      try { await build.run(); dlg.close(true); load(); }
      catch (ex) { err.textContent = ex.detail || 'Failed.'; err.hidden = false; btn.disabled = false; if (ex.status === 401) { dlg.close(false); showLogin(); } }
    });
    return dlg;
  }

  function resetDialog(u) {
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', maxlength: '128' });
    formDialog(`Reset password: ${u.username}`, [h('p', { class: 'muted' }, 'Choose a new password and tell the user. All of their sessions are signed out.'), field('New password', pw, 'At least 8 characters; not a common password.')], {
      label: 'Set password', run: async () => { await api.post(`/api/admin/users/${u.id}/password`, { new_password: pw.value }); toast(`Password reset for ${u.username}.`); },
    });
    pw.focus();
  }

  function editDialog(u) {
    const name = h('input', { class: 'input', type: 'text', required: true, value: u.username, maxlength: '32', autocapitalize: 'none' });
    const mail = h('input', { class: 'input', type: 'email', required: true, value: u.email, maxlength: '254' });
    formDialog(`Edit ${u.username}`, [field('Username', name), field('Email', mail)], {
      label: 'Save', run: async () => {
        const body = {};
        if (name.value.trim() !== u.username) body.username = name.value.trim();
        if (mail.value.trim() !== u.email) body.email = mail.value.trim();
        if (Object.keys(body).length) { await api.patch(`/api/admin/users/${u.id}`, body); toast('Saved.'); }
      },
    });
  }

  function deleteDialog(u) {
    const confirmIn = h('input', { class: 'input', type: 'text', required: true, autocomplete: 'off', placeholder: u.username, 'aria-label': 'Type the username to confirm' });
    formDialog(`Delete ${u.username}?`, [h('p', null, 'This permanently deletes the account and all its favorites, collection, ratings, notes, saved searches and history. Type the username to confirm.'), field('Username', confirmIn)], {
      label: 'Delete account', danger: true,
      run: async () => {
        if (confirmIn.value.trim().toLowerCase() !== u.username.toLowerCase()) throw Object.assign(new Error('x'), { detail: 'The username does not match.' });
        await api.del(`/api/admin/users/${u.id}`);
        toast(`Deleted ${u.username}.`);
      },
    });
  }

  q.addEventListener('input', debounce(load, 200));
  load();
}

boot();
