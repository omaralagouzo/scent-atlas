// Sign in / sign up modal, header account menu, change-password and delete-account dialogs.
import { h, svgIcon, toast, $ } from './util.js';
import { api, session } from './api.js';
import { openDialog, field } from './dialog.js';
import { go, parseHash } from './router.js';

/** Resolves true when the visitor ends up signed in, false if they dismiss the dialog. */
export function requireAuth(reason) {
  if (session.user) return Promise.resolve(true);
  return openAuthModal({ mode: 'login', reason });
}

let openModal = null;

export function openAuthModal({ mode = 'login', reason = '' } = {}) {
  if (openModal) openModal.close(false);
  let current = mode;
  const body = h('div', { class: 'auth' });
  const dlg = openDialog({ title: '', content: body, className: 'auth-modal' });
  openModal = dlg;
  dlg.closed.then(() => { if (openModal === dlg) openModal = null; });
  let done;
  const result = new Promise((r) => { done = r; });
  dlg.closed.then((v) => done(!!v && !!session.user));

  function render() {
    const login = current === 'login';
    dlg.setTitle(login ? 'Sign in' : 'Create your account');
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const showErr = (m) => { err.textContent = m; err.hidden = !m; };
    const idIn = h('input', { class: 'input', name: 'identifier', type: 'text', autocomplete: 'username', required: true, maxlength: '254', autocapitalize: 'none', spellcheck: 'false' });
    const userIn = h('input', { class: 'input', name: 'username', type: 'text', autocomplete: 'username', required: true, minlength: '3', maxlength: '32', pattern: '[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}', autocapitalize: 'none', spellcheck: 'false' });
    const mailIn = h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: '254' });
    const pwIn = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: login ? 'current-password' : 'new-password', required: true, minlength: login ? null : '8', maxlength: '128' });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, login ? 'Sign in' : 'Create account');
    const form = h('form', { class: 'auth-form', novalidate: true },
      reason ? h('p', { class: 'auth-reason' }, reason) : null,
      login
        ? field('Username or email', idIn)
        : [field('Username', userIn, '3-32 letters, digits, dot, dash or underscore.'), field('Email', mailIn, 'Used to identify your account only. We never send email.')],
      field('Password', pwIn, login ? null : 'At least 8 characters; not a common password.'),
      err, submit,
      h('p', { class: 'auth-switch' }, login ? 'New here? ' : 'Already have an account? ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => { current = login ? 'signup' : 'login'; render(); } }, login ? 'Create an account' : 'Sign in')),
      h('p', { class: 'auth-note' }, 'Browsing and searching never need an account. Accounts only keep your favorites, collection, saved searches and history.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showErr('');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      submit.disabled = true;
      submit.textContent = login ? 'Signing in…' : 'Creating…';
      try {
        if (login) await api.post('/api/auth/login', { identifier: idIn.value.trim(), password: pwIn.value });
        else await api.post('/api/auth/signup', { username: userIn.value.trim(), email: mailIn.value.trim(), password: pwIn.value });
        await session.refresh();
        toast(login ? `Welcome back, ${session.user.username}.` : `Welcome to Scent Atlas, ${session.user.username}.`);
        dlg.close(true);
      } catch (ex) {
        showErr(ex.detail || (ex.status === 0 || ex.status == null ? 'Could not reach the server.' : 'Something went wrong. Please try again.'));
        submit.disabled = false;
        submit.textContent = login ? 'Sign in' : 'Create account';
        pwIn.value = '';
        pwIn.focus();
      }
    });
    body.replaceChildren(form);
    (login ? idIn : userIn).focus();
  }
  render();
  return result;
}

// ---------------------------------------------------------------- account dialogs
function openPasswordDialog() {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, maxlength: '128' });
  const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', maxlength: '128' });
  const nw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', maxlength: '128' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password');
  const form = h('form', { class: 'auth-form', novalidate: true },
    field('Current password', cur), field('New password', nw, 'At least 8 characters; not a common password.'), field('Repeat new password', nw2), err, btn,
    h('p', { class: 'auth-note' }, 'Other devices are signed out when you change your password.'));
  const dlg = openDialog({ title: 'Change password', content: form, className: 'auth-modal' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (nw.value !== nw2.value) { err.textContent = 'The new passwords do not match.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await api.post('/api/auth/password', { current_password: cur.value, new_password: nw.value });
      toast('Password changed.');
      dlg.close(true);
    } catch (ex) { err.textContent = ex.detail || 'Could not change the password.'; err.hidden = false; btn.disabled = false; }
  });
  cur.focus();
}

function openDeleteDialog() {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, maxlength: '128' });
  const btn = h('button', { class: 'btn btn-danger', type: 'submit' }, 'Delete my account');
  const form = h('form', { class: 'auth-form', novalidate: true },
    h('p', null, 'This permanently deletes your account, favorites, collection, ratings, notes, saved searches and history. It cannot be undone.'),
    field('Confirm with your password', pw), err, btn);
  const dlg = openDialog({ title: 'Delete account', content: form, className: 'auth-modal' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    btn.disabled = true;
    try {
      await api.post('/api/auth/delete', { password: pw.value });
      await session.refresh();
      dlg.close(true);
      toast('Your account has been deleted.');
      if (parseHash().path === '/atlas') go('/notes');
    } catch (ex) { err.textContent = ex.detail || 'Could not delete the account.'; err.hidden = false; btn.disabled = false; }
  });
  pw.focus();
}

async function signOut() {
  try { await api.post('/api/auth/logout', {}); } catch (e) { /* ignore */ }
  await session.refresh();
  toast('Signed out.');
  if (parseHash().path === '/atlas') go('/notes');
}

// ---------------------------------------------------------------- header account menu
export function mountAccountMenu(root) {
  let menuOpen = false;
  const close = () => { menuOpen = false; draw(); };
  document.addEventListener('click', (e) => { if (menuOpen && !root.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) { close(); } });

  function draw() {
    const u = session.user;
    if (!u) {
      root.replaceChildren(h('button', { class: 'btn btn-sm account-signin', type: 'button', onclick: () => openAuthModal({ mode: 'login' }) }, svgIcon('user', 16), h('span', null, 'Sign in')));
      return;
    }
    const trigger = h('button', {
      class: 'account-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': String(menuOpen), title: u.email,
      onclick: (e) => { e.stopPropagation(); menuOpen = !menuOpen; draw(); if (menuOpen) { const first = root.querySelector('[role=menuitem]'); if (first) first.focus(); } },
    }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.username[0].toUpperCase()), h('span', { class: 'account-name' }, u.username), svgIcon('chevron', 14));
    const item = (label, fn) => h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, label);
    const menu = menuOpen ? h('div', { class: 'menu', role: 'menu' },
      h('div', { class: 'menu-head' }, h('b', null, u.username), h('small', null, u.email)),
      item('My Collection', () => go('/collection')),
      item('My Atlas', () => go('/atlas')),
      item('Change password', openPasswordDialog),
      item('Delete account…', openDeleteDialog),
      h('hr'),
      item('Sign out', signOut)) : null;
    root.replaceChildren(...[trigger, menu].filter(Boolean));
    if (menu) menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[role=menuitem]')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { close(); const t = root.querySelector('.account-btn'); if (t) t.focus(); }
    });
  }
  session.onChange(draw);
  draw();
}
