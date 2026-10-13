// A tiny modal built on <dialog>: focus trap, Escape and backdrop-click close come from the platform.
import { h, svgIcon } from './util.js';

let seq = 0;

/** openDialog({title, content, className}) -> { el, close(value), closed: Promise<value> } */
export function openDialog({ title, content, className = '', labelledBy = null }) {
  const id = `dlg-title-${++seq}`;
  const lastFocus = document.activeElement;
  const titleEl = h('h2', { class: 'modal-title', id: labelledBy || id }, title || '');
  const closeBtn = h('button', { class: 'icon-btn modal-close', type: 'button', 'aria-label': 'Close', onclick: () => close(false) }, svgIcon('close', 18));
  const box = h('div', { class: 'modal-box' }, h('div', { class: 'modal-head' }, titleEl, closeBtn), h('div', { class: 'modal-body' }, content));
  const el = h('dialog', { class: `modal ${className}`.trim(), 'aria-labelledby': labelledBy || id }, box);
  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  let value = false;
  function close(v) {
    value = v;
    if (el.open) el.close(); else finish();
  }
  function finish() {
    el.remove();
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    resolve(value);
  }
  el.addEventListener('close', finish, { once: true });
  el.addEventListener('click', (e) => { if (e.target === el) close(false); }); // click on the backdrop
  document.body.append(el);
  if (el.showModal) el.showModal(); else el.setAttribute('open', '');
  return { el, close, closed, setTitle: (t) => { titleEl.textContent = t; } };
}

/** Labelled form field helper. */
export function field(label, input, hint) {
  const id = input.id || `f-${++seq}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('small', { class: 'field-hint' }, hint) : null);
}
