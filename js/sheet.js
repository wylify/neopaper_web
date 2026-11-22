// Bottom sheets and centred dialogs, closed by back, Escape, the scrim or a swipe down.
import { h } from './ui.js';
import { pushLayer, pop } from './nav.js';

/**
 * Opens [content] (element or array) in a sheet. Returns { el, close() }; close() pops it.
 * opts: { label, dialog: true for a centred dialog, onClose }
 */
export function openSheet(content, opts = {}) {
  const lastFocus = document.activeElement;
  const body = h('div', { class: 'sheet-body' }, content);
  const panel = h('section', { class: opts.dialog ? 'dialog' : 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || 'Dialog', tabindex: '-1' },
    opts.dialog ? null : h('div', { class: 'handle', 'aria-hidden': 'true' }), body);
  const scrim = h('div', { class: 'scrim' });
  const wrap = h('div', { class: 'sheet-wrap' + (opts.dialog ? ' center' : '') }, scrim, panel);
  document.body.append(wrap);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  panel.focus({ preventScroll: true });

  let closed = false;
  const teardown = () => {
    if (closed) return; closed = true;
    wrap.classList.remove('open');
    setTimeout(() => { wrap.remove(); if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('modal-open'); }, 260);
    lastFocus?.focus?.({ preventScroll: true });
    opts.onClose?.();
  };
  pushLayer(teardown, 'overlay');
  const close = () => (closed ? Promise.resolve() : pop());
  scrim.addEventListener('click', close);

  // Keep keyboard focus inside the sheet.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Swipe down from the handle area (or when scrolled to the top) to dismiss.
  if (!opts.dialog) {
    let y0 = null, dy = 0;
    panel.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || panel.scrollTop > 0) return;
      if (e.target.closest('input, textarea, button, a, [data-nodrag]') && !e.target.closest('.handle')) return;
      y0 = e.clientY; dy = 0;
    });
    panel.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.clientY - y0);
      if (dy > 6) { panel.style.transition = 'none'; panel.style.transform = `translate(-50%, ${dy}px)`; }
    });
    const end = () => {
      if (y0 == null) return;
      y0 = null; panel.style.transition = ''; panel.style.transform = '';
      if (dy > 90) close();
    };
    panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);
  }
  return { el: panel, body, close };
}
