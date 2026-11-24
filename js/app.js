// NEOPAPER web: entry point. Screens stack like the Android app (Home → Builder → editors),
// mirrored in browser history so back gestures and buttons work everywhere.
import { $, h, toast, runToastAction } from './ui.js';
import { S, init, openCard, createCard, flush, subscribe, setEditingCheck } from './state.js';
import { initHistory, pushLayer, pop, popTo, depth } from './nav.js';
import { resetTextCache } from './render.js';
import { homeScreen } from './home.js';
import { builderScreen } from './builder.js';
import { addRowSheet, rowEditorScreen, codesScreen } from './editors.js';
import { scannerScreen } from './scan.js';

const root = $('app');
const screens = []; // { api, name }

function mount(name, make, animate = true) {
  const prev = screens[screens.length - 1];
  const api = make();
  screens.push({ api, name });
  root.append(api.el);
  if (prev) {
    const pel = prev.api.el;
    pel.classList.add('covered');
    pel.setAttribute('inert', '');
    // Once the new screen has slid in, take the old one out of layout so it never repaints.
    clearTimeout(pel._gone); pel._gone = setTimeout(() => { if (pel.classList.contains('covered')) pel.classList.add('gone'); }, 280);
  }
  if (animate) api.el.animate?.([{ opacity: 0, transform: 'translateX(6%)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
  pushLayer(() => unmount(), 'screen');
  document.body.dataset.screen = name;
  focusScreen(api.el);
}

function unmount() {
  const top = screens.pop();
  if (!top) return;
  const el = top.api.el;
  top.api.destroy?.();
  const anim = el.animate?.([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(6%)' }], { duration: 180, easing: 'ease-in' });
  if (anim) anim.onfinish = () => el.remove(); else el.remove();
  const now = screens[screens.length - 1];
  if (now) {
    clearTimeout(now.api.el._gone);
    now.api.el.classList.remove('covered', 'gone');
    now.api.el.removeAttribute('inert');
    now.api.refresh?.();
    focusScreen(now.api.el);
  }
  if (top.name === 'builder') { flush(); remember(null); }
  document.body.dataset.screen = now?.name || '';
}

/** The card being edited survives a reload (an update, or iOS reloading a background tab). */
function remember(id) {
  try { if (id == null) sessionStorage.removeItem('neopaper.open'); else sessionStorage.setItem('neopaper.open', String(id)); } catch {}
}

function focusScreen(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  requestAnimationFrame(() => { if (!el.contains(document.activeElement)) el.focus({ preventScroll: true }); });
}

/** Navigation used by every screen. */
const nav = {
  back: () => pop(),
  async openCard(id) {
    await popTo(0);
    openCard(id);
    remember(id);
    mount('builder', () => builderScreen(nav));
  },
  async openNew(template) {
    const c = createCard(template);
    await nav.openCard(c.id);
  },
  openScanner: () => mount('scanner', () => scannerScreen(() => nav.back())),
  openCodes: () => mount('codes', () => withDraft(codesScreen(nav))),
  openRowEditor: (id, header) => mount('row', () => rowEditorScreen(id, header, nav)),
  openAddRow(header) {
    addRowSheet(header, (kind, row) => { if (kind === 'custom') nav.openRowEditor(row.id, false); });
  },
};

/** Screens that edit the draft get live updates while they are on top. */
function withDraft(api) {
  const unsub = subscribe((k) => { if (k === 'draft') api.update?.(S.cards.find((c) => c.id === S.draftId)); });
  const d = api.destroy;
  api.destroy = () => { unsub(); d?.(); };
  return api;
}

// ── Keyboard shortcuts (MainActivity.dispatchKeyEvent) ──────────────────────────────────
// Ctrl or ⌘: Z undoes a removal while its Undo snackbar is up, N makes a new card on Home,
// 1–4 switch builder tabs, S saves the image. Text fields keep their own keys (and Ctrl+Z).
// Escape is handled by nav.js. Browsers keep Ctrl+N for a new window outside an installed app.
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && t.type !== 'range') return;
  if (document.querySelector('.sheet-wrap.open')) return; // a sheet or dialog is open
  const key = e.key.toLowerCase();
  const top = screens[screens.length - 1]?.api;
  if (key === 'z' ? runToastAction() : top?.shortcut?.(key)) e.preventDefault();
});

// ── Start ──────────────────────────────────────────────────────────────────────────────

async function start() {
  initHistory();
  setEditingCheck(() => screens.length > 1);
  // Canvas text needs the real fonts: wait for them (briefly) before the first paint.
  const fonts = Promise.all(['700 46px "Space Grotesk"', '500 13px "Space Grotesk"', '600 8px "JetBrains Mono"', '400 8px "JetBrains Mono"', '700 8px "JetBrains Mono"',
    '10px "Warn Hanzi"', '10px "Warn Kana"', '10px "Warn Cyrillic"', '10px "Warn Hangul"']
    .map((f) => document.fonts.load(f))).catch(() => {});
  await Promise.all([init(), Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))])]);
  resetTextCache();
  // Home is the base layer: it is never popped, so history depth counts screens above it.
  const home = homeScreen(nav);
  screens.push({ api: home, name: 'home' });
  root.append(home.el);
  document.body.dataset.screen = 'home';
  $('boot')?.remove();
  document.fonts.addEventListener?.('loadingdone', () => { resetTextCache(); screens.forEach((s) => s.api.refresh?.()); });
  if (S.saveFailed) toast('Storage is unavailable: changes won’t be kept');
  // Deep links from the manifest's shortcuts.
  const want = new URLSearchParams(location.search).get('open');
  let reopen = null;
  try { reopen = Number(sessionStorage.getItem('neopaper.open')) || null; } catch {}
  if (want) history.replaceState(history.state, '', location.pathname);
  if (want === 'scan') nav.openScanner();
  else if (want === 'new') nav.openNew();
  else if (reopen && S.cards.some((c) => c.id === reopen)) nav.openCard(reopen);
}

start().catch((e) => {
  console.error(e);
  root.replaceChildren(h('div', { class: 'fatal' }, h('h1', {}, 'NEOPAPER couldn’t start'), h('p', {}, String(e?.message || e))));
});

// ── Offline + updates ──────────────────────────────────────────────────────────────────

// Only over https (GitHub Pages): on a local dev server a cache would hide edits.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const had = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reload = () => { reloading = true; flush().then(() => location.reload()); };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || reloading) return;
    // A new version took over. Reload at once on the home screen; elsewhere, offer it.
    if (depth() === 0) reload();
    else toast('NEOPAPER was updated', { label: 'Reload', run: reload }, 10000);
  });
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
