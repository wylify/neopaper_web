// Card tab, "on the card" layout: the card is the editor (ui/CardEditor.kt). Tap the header, the
// QR, a row or the barcode to select it; tap a text again to type straight on the card in its own
// font. A panel holds the selected part's settings; remove and add-below sit beside the selected
// row; rows that don't fit are listed under the card. Plus the Reorder screen.
import { h, icon, I, tag, toast, textField, chip, segmented, sectionLabel } from './ui.js';
import { S, draft, edit, select, updateRow, removeRow, undoRemove, duplicateRow, moveRow, undo, redo } from './state.js';
import { ROW_KINDS, FILLER_KINDS, isField, rowHeight, ratioLabel, qrSummary, payload, css } from './model.js';
import { cardGeometry, targetRect, hitTarget, drawCard, codeSize, CODE_FONT, VALUE_FONT } from './render.js';
import { cardCodes } from './codes.js';
import { canvasView } from './ui.js';
import { rowTitle, rowGlyph } from './builder.js';
import { barcodeNotice, barcodeChanged, resetBarcode } from './editors.js';
import { vibrate } from './settings.js';

const codesFor = (cfg) => cardCodes(payload(cfg.qr), cfg.barcodeLink);
const GUTTER = 52, LABEL_H = 40, TRAY_H = 44, ACCESSORY_H = 52, GUTTER_H = 90;
const CODE_MAX = 8, VALUE_MAX = 32;
/** "Short" as in the CSS: under 640px tall and not the wide side-pane layout. */
const isShort = () => matchMedia('(max-height: 639px) and (max-width: 699px), (max-height: 639px) and (max-aspect-ratio: 17/20)').matches;
const isWide = () => matchMedia('(min-width: 700px) and (min-aspect-ratio: 17/20)').matches;

/** The selection, or null when it went stale (row removed). Rows off the card stay selectable from the tray. */
export function liveSel(c) {
  const t = S.sel;
  if (t == null || !c) return null;
  if (typeof t === 'number') return c.rows.some((r) => r.id === t) ? t : null;
  return t;
}
const rowOf = (c, t) => (typeof t === 'number' ? c.rows.find((r) => r.id === t) || null : null);
/** Targets whose text can be typed straight on the card, top to bottom. */
const typeable = (g) => ['header', ...g.rows.filter((s) => s.fits && isField(s.row.kind)).map((s) => s.row.id)];
/** Every part in reading order, for arrow keys. */
const readingOrder = (g) => ['header', 'qr', ...g.rows.filter((s) => s.fits).map((s) => s.row.id), 'footer'];
export const stageLabel = (c) => `${c.code.trim() || 'UNTITLED'} · LIVE · ${ratioLabel(c.ratio)}`;
const partName = (c, t) => (t === 'header' ? 'Header' : t === 'qr' ? 'QR code' : t === 'footer' ? 'Barcode' : rowOf(c, t) ? rowTitle(rowOf(c, t)) : '');

/**
 * hooks: { onAddRow(after), onAddFiller(), onReorder(), openCodes(part, focusQr), openRowEditor(id, header),
 *          setList(), onState() } — onState runs when typing or the selection changes (for the action bar).
 * Returns { stage, panel, update(c), destroy(), typing(), stepBack() }.
 */
export function cardEditTab(hooks) {
  let typing = false;
  let geo = null, box = { left: 0, top: 0, w: 0, h: 0, s: 1, W: 0, H: 0 };

  // ── Stage ──
  const canvas = canvasView((ctx, w, hh) => {
    const c = draft(); if (!c) return;
    const sel = liveSel(c);
    drawCard(ctx, c, codesFor(c), 0, 0, w, typing ? { hideCode: sel === 'header', hideValueOf: typeof sel === 'number' ? sel : null } : null);
  }, 'ce-canvas');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ce-ov'); svg.setAttribute('aria-hidden', 'true');
  const hoverRect = document.createElementNS(NS, 'rect'); hoverRect.setAttribute('class', 'hover');
  const antsRect = document.createElementNS(NS, 'rect'); antsRect.setAttribute('class', 'ants');
  svg.append(hoverRect, antsRect);
  const input = h('input', {
    class: 'ce-input', type: 'text', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'next', hidden: true,
  });
  const cardBox = h('div', {
    class: 'ce-card', tabindex: '0', role: 'group',
    'aria-roledescription': 'card editor',
    'aria-label': 'Card. Click a part of the card to edit it. Arrow keys move the selection, Enter types on it, Delete removes a row.',
  }, canvas, svg, input);
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const trashBtn = h('button', { type: 'button', class: 'ce-gbtn danger' }, icon(I.trash, { size: 20, stroke: 2.2 }));
  const addBtn = h('button', { type: 'button', class: 'ce-gbtn lime' }, icon(I.plus, { size: 20, stroke: 2.2 }));
  const gutter = h('div', { class: 'ce-gutter', hidden: true }, trashBtn, addBtn);
  const trayList = h('div', { class: 'ce-tray-list' });
  const tray = h('div', { class: 'ce-tray', hidden: true }, h('p', { class: 'ce-tray-label' }, 'NOT ON', h('br'), 'CARD'), trayList);
  const label = h('p', { class: 'ce-label mono-small' });
  const badgeText = h('span', {});
  const badge = h('button', { type: 'button', class: 'ce-badge' }, icon(I.warning, { size: 14, stroke: 2.6 }), badgeText);
  const accTitle = h('span', { class: 'ce-acc-title mono-label' });
  const accCount = h('span', { class: 'mono-small' });
  const accessory = h('div', { class: 'ce-acc', hidden: true }, accTitle, accCount,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous field', title: 'Previous field (Shift+Tab)', onclick: () => step(-1) }, icon(I.prev, { size: 20 })),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next field', title: 'Next field (Enter or Tab)', onclick: () => step(1) }, icon(I.nextField, { size: 20 })),
    h('button', { type: 'button', class: 'ce-done', onclick: () => stopTyping() }, 'Done'));
  // Buttons in the accessory bar must not steal focus from the field (that would drop the keyboard).
  accessory.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  const stage = h('div', { class: 'ce-stage' }, cardBox, gutter, tray, label, badge, accessory, live);

  // ── Panel ──
  const panel = h('div', { class: 'ctx' });
  let more = false, panelSig = '';

  // ── Layout: card as big as fits between the gutters, above the label (or tray / typing bar) ──
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);

  function layout() {
    const c = draft(); if (!c) return;
    geo = cardGeometry(c);
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const hidden = geo.rows.some((s) => !s.fits);
    const bottom = typing ? ACCESSORY_H : LABEL_H + (hidden ? TRAY_H : 0);
    const availW = Math.max(0, W - GUTTER * 2), ratio = geo.w / geo.h;
    const fitIn = (reserve) => {
      const availH = Math.max(0, H - bottom - reserve - 12);
      const w = Math.min(availW, availH * ratio), hh = w / ratio;
      return { left: (W - w) / 2, top: reserve + 12 + (availH - hh) / 2, w, h: hh, s: w / geo.w, W, H };
    };
    box = fitIn(0);
    // Buttons floating on the stage (undo, redo, the tab toggle; back and the title with the tab
    // bar folded away): when one would cover the card, keep the card below their row.
    const ctl = stage.parentElement?.querySelector(':scope > .stage-ctl');
    if (ctl) {
      const o = stage.getBoundingClientRect();
      const hits = [...ctl.children].some((b) => {
        const r = b.getBoundingClientRect();
        if (!r.width || getComputedStyle(b).visibility === 'hidden') return false;
        const x0 = r.left - o.left, x1 = r.right - o.left, y1 = r.bottom - o.top;
        return x1 > box.left && x0 < box.left + box.w && y1 > box.top;
      });
      if (hits) box = fitIn(Math.max(0, ctl.getBoundingClientRect().bottom - o.top - 6));
    }
    const { w, h: hh } = box;
    Object.assign(cardBox.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${w}px`, height: `${hh}px` });
    svg.setAttribute('width', w); svg.setAttribute('height', hh);
    paintOverlays(c);
  }

  function setRect(el, r) {
    if (!r) { el.style.display = 'none'; return; }
    const pad = 3, s = box.s;
    el.style.display = '';
    el.setAttribute('x', (r.x - pad) * s); el.setAttribute('y', (r.y - pad) * s);
    el.setAttribute('width', Math.max(0, (r.w + 2 * pad) * s)); el.setAttribute('height', Math.max(0, (r.h + 2 * pad) * s));
  }

  let hover = null;
  function paintOverlays(c) {
    if (!geo) return;
    const sel = liveSel(c);
    svg.style.color = css(c.ink);
    setRect(antsRect, sel != null ? targetRect(geo, sel) : null);
    setRect(hoverRect, hover != null && hover !== sel && !typing ? targetRect(geo, hover) : null);
    cardBox.classList.toggle('pointing', hover != null);
    // Remove / add below, beside the selected row, outside the card. Skipped while the stage is
    // shorter than the two buttons.
    const slot = typeof sel === 'number' ? geo.rows.find((s) => s.row.id === sel && s.fits) : null;
    const showGutter = !!slot && !typing && box.H >= GUTTER_H;
    gutter.hidden = !showGutter;
    if (showGutter) {
      const name = rowTitle(slot.row);
      const y = Math.min(box.H - GUTTER_H, Math.max(48, box.top + box.s * (slot.top + slot.height / 2) - 22));
      gutter.style.transform = `translate(${box.left + box.w + 4}px, ${y}px)`;
      trashBtn.setAttribute('aria-label', `Remove ${name} row`); trashBtn.title = `Remove ${name} row`;
      addBtn.setAttribute('aria-label', 'Add a row below'); addBtn.title = 'Add a row below';
      trashBtn.onclick = () => { remove(slot.row.id); };
      addBtn.onclick = () => hooks.onAddRow(slot.row.id);
    }
    if (typing) placeInput(c, sel);
  }

  // ── Everything that depends on the card ──
  function update(c) {
    if (!c) return;
    const sel = liveSel(c);
    if (typing && !(sel != null && typeable(cardGeometry(c)).includes(sel))) stopTyping(false);
    const g = cardGeometry(c);
    const hidden = g.rows.filter((s) => !s.fits);
    stage.classList.toggle('has-tray', hidden.length > 0 && !typing);
    tray.hidden = !hidden.length || typing;
    if (!tray.hidden) paintTray(c, hidden, sel);
    label.hidden = badge.hidden = typing;
    label.textContent = sel == null ? 'TAP THE CARD TO EDIT' : stageLabel(c);
    paintBadge(g);
    accessory.hidden = !typing;
    if (typing) paintAccessory(c, sel);
    cardBox.setAttribute('aria-label', `Card ${c.code || 'untitled'}. ${sel == null ? 'Nothing selected.' : partName(c, sel) + ' selected.'} Click a part to edit it; arrow keys move the selection, Enter types on it, Delete removes a row.`);
    canvas.invalidate();
    layout();
    paintPanel(c, sel, hidden);
  }

  let lastOver = 0;
  function paintBadge(g) {
    const total = g.rows.length, shown = g.rowsShown, over = total - shown;
    badge.hidden = badge.hidden || !total;
    badge.classList.toggle('over', over > 0);
    badgeText.textContent = over > 0 ? `${shown}/${total} ROWS FIT` : `${shown} ROWS FIT`;
    badge.disabled = over <= 0;
    badge.setAttribute('aria-label', over <= 0 ? `${shown} rows fit` : over === 1 ? '1 row doesn’t fit on the card. Show it' : `${over} rows don’t fit on the card. Show them`);
    if (over > lastOver) badge.animate?.([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.34,1.8,.5,1)' });
    lastOver = over;
  }
  badge.onclick = () => {
    const g = cardGeometry(draft());
    const first = g.rows.find((s) => !s.fits);
    if (first) { stopTyping(false); select(first.row.id); }
  };

  let traySig = '';
  function paintTray(c, hidden, sel) {
    const sig = hidden.map((s) => `${s.row.id}:${s.row.kind}:${s.row.label}`).join(',') + '|' + c.labelColor;
    if (sig !== traySig) {
      traySig = sig;
      trayList.querySelectorAll('canvas').forEach((x) => x.dispose?.());
      trayList.replaceChildren(...hidden.map((s) => h('button', {
        type: 'button', class: 'ce-chip', 'data-id': String(s.row.id), 'aria-label': `Edit hidden ${rowTitle(s.row)} row`,
        onclick: () => { stopTyping(false); select(s.row.id); },
      }, rowGlyph(c, s.row, 0xFFA2A2AA | 0), h('span', {}, rowTitle(s.row)))));
    }
    let selChip = null;
    trayList.querySelectorAll('.ce-chip').forEach((b) => { const on = +b.dataset.id === sel; b.setAttribute('aria-pressed', String(on)); if (on) selChip = b; });
    // Keep the selected chip in view, e.g. after the badge picks the first hidden row.
    selChip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  // ── Pointer: tap selects, tap again types; mouse hover outlines ──
  cardBox.addEventListener('click', (e) => {
    if (e.target === input) return;
    const c = draft(); if (!c || !geo) return;
    const r = cardBox.getBoundingClientRect();
    const t = hitTarget(geo, (e.clientX - r.left) / box.s, (e.clientY - r.top) / box.s);
    const sel = liveSel(c);
    if (t != null && t === sel && typeable(geo).includes(t)) startTyping(); // focus inside the tap: keeps the keyboard on iOS
    else { stopTyping(false); select(t); if (t != null) vibrate(6); }
  });
  cardBox.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !geo) return;
    const r = cardBox.getBoundingClientRect();
    const t = hitTarget(geo, (e.clientX - r.left) / box.s, (e.clientY - r.top) / box.s);
    if (t !== hover) { hover = t; paintOverlays(draft()); }
  });
  cardBox.addEventListener('pointerleave', () => { if (hover != null) { hover = null; paintOverlays(draft()); } });

  // Keyboard: arrows walk the parts, Enter types, Delete removes a row (Escape is the builder's back).
  cardBox.addEventListener('keydown', (e) => {
    if (e.target !== cardBox) return;
    const c = draft(); if (!c) return;
    const g = cardGeometry(c), order = readingOrder(g), sel = liveSel(c);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = order.indexOf(sel), d = e.key === 'ArrowDown' ? 1 : -1;
      select(order[i < 0 ? (d > 0 ? 0 : order.length - 1) : (i + d + order.length) % order.length]);
    } else if ((e.key === 'Enter' || e.key === 'F2') && sel != null) {
      e.preventDefault();
      if (typeable(g).includes(sel)) startTyping();
      else panel.querySelector('input, button:not(.ctx-close)')?.focus();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && typeof sel === 'number') {
      e.preventDefault(); remove(sel);
    }
  });

  // ── Typing on the card ──
  let moving = false;
  function startTyping() {
    const c = draft(); const sel = liveSel(c);
    if (sel == null) return;
    typing = true;
    input.hidden = false;
    loadInput(c, sel);
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    hooks.onState?.();
    update(c);
  }
  function stopTyping(refocus = true) {
    if (!typing) return;
    typing = false;
    input.hidden = true;
    if (refocus && document.activeElement === input) cardBox.focus({ preventScroll: true });
    hooks.onState?.();
    update(draft());
  }
  function loadInput(c, sel) {
    const r = rowOf(c, sel);
    input.value = sel === 'header' ? c.code : r?.value ?? '';
    input.maxLength = sel === 'header' ? CODE_MAX : VALUE_MAX;
    input.setAttribute('aria-label', sel === 'header' ? 'Card code' : `${rowTitle(r)} value`);
    input.setAttribute('autocapitalize', sel === 'header' ? 'characters' : 'words');
    input.classList.toggle('code', sel === 'header');
  }
  /** Lays the field exactly over the text it replaces: same font, size and colour. */
  function placeInput(c, sel) {
    const g = geo, s = box.s;
    const slot = typeof sel === 'number' ? g.rows.find((x) => x.row.id === sel) : null;
    const r = sel === 'header' ? g.code : slot?.value;
    if (!r) return;
    const f = sel === 'header' ? { ...CODE_FONT, size: codeSize(c) } : VALUE_FONT;
    // iOS zooms the page into fields under 16px: draw at 16px or more and scale down instead.
    const px = f.size * s, k = Math.min(1, px / 16), fs = px / k;
    Object.assign(input.style, {
      left: `${r.x * s}px`, top: `${r.y * s}px`, width: `${r.w * s / k}px`, height: `${r.h * s / k}px`,
      font: `${f.weight} ${fs}px/${r.h * s / k}px ${f.family}`, letterSpacing: `${f.ls}em`,
      transform: k < 1 ? `scale(${k})` : '', color: css(c.ink), caretColor: css(c.ink),
    });
  }
  input.addEventListener('input', () => {
    const c = draft(); const sel = liveSel(c);
    if (sel === 'header') {
      const p = input.selectionStart, up = input.value.toUpperCase();
      if (up !== input.value) { input.value = up; try { input.setSelectionRange(p, p); } catch {} }
      edit((x) => ({ ...x, code: input.value }), 'type:header');
    } else {
      const r = rowOf(c, sel);
      if (r) updateRow({ ...r, value: input.value }, `type:${sel}`);
    }
  });
  input.addEventListener('keydown', (e) => {
    // Ctrl/⌘+Z here steps the card's history (the field's own undo would not see the other fields).
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey, k = e.key.toLowerCase();
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault();
      if (k === 'y' || e.shiftKey ? redo() : undo()) {
        const c = draft(), sel = liveSel(c);
        if (sel == null || !typeable(cardGeometry(c)).includes(sel)) stopTyping();
        else { loadInput(c, sel); try { input.setSelectionRange(input.value.length, input.value.length); } catch {} }
      }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); step(1); }
    else if (e.key === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopTyping(); }
  });
  input.addEventListener('blur', () => { setTimeout(() => { if (!moving && typing && document.activeElement !== input) stopTyping(false); }, 0); });

  /** Next / previous typeable text, keeping the same field (and the on-screen keyboard). */
  function step(d) {
    const c = draft(); const order = typeable(cardGeometry(c));
    const i = order.indexOf(liveSel(c));
    moving = true;
    select(order[(i + d + order.length) % order.length]);
    loadInput(draft(), liveSel(draft()));
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    moving = false;
  }
  function paintAccessory(c, sel) {
    const r = rowOf(c, sel);
    accTitle.textContent = `EDITING · ${sel === 'header' ? 'CODE' : r ? rowTitle(r).toUpperCase() : ''}`;
    const n = sel === 'header' ? c.code.length : r?.value.length ?? 0, max = sel === 'header' ? CODE_MAX : VALUE_MAX;
    accCount.textContent = `${n}/${max}`;
    accCount.classList.toggle('orange', n >= max);
    accCount.setAttribute('aria-label', `${n} of ${max} characters`);
  }

  function remove(id) {
    stopTyping(false);
    removeRow(id); select(null);
    toast('Row removed', { label: 'Undo', run: () => { undoRemove(); select(id); } });
  }

  // ── Panel under (or beside) the card: settings for what is selected ──
  function smallBtn(text, onclick, d, cls = '') {
    return h('button', { type: 'button', class: 'small-btn ' + cls, onclick }, d && icon(d, { size: 18 }), h('span', {}, text));
  }

  function paintPanel(c, sel, hidden) {
    const r = rowOf(c, sel);
    const selHidden = r != null && hidden.some((s) => s.row.id === r.id);
    const sig = JSON.stringify([sel, selHidden, r && [r.kind, r.checks, rowHeight(r), r.icon], c.rows.length, r && c.rows.indexOf(r),
      sel === 'header' && c.headFill.map((f) => f.kind), sel === 'footer' && barcodeChanged(c), sel === 'qr' && [qrSummary(c.qr), c.qrRight]]);
    if (sig === panelSig) {
      // Same controls: just show values typed elsewhere (on the card), never under the cursor.
      panel.querySelectorAll('[data-bind]').forEach((f) => { if (document.activeElement !== f.input) f.setValue(f.read(draft())); });
      return;
    }
    panelSig = sig;
    const focusKey = document.activeElement?.closest?.('[data-k]')?.dataset.k;
    panel.replaceChildren(...panelContent(c, sel, r, selHidden));
    panel.classList.toggle('more', more);
    if (focusKey) panel.querySelector(`[data-k="${focusKey}"]`)?.querySelector('input, textarea')?.focus({ preventScroll: true }) ?? panel.querySelector(`[data-k="${focusKey}"]`)?.focus?.({ preventScroll: true });
  }

  /** A text field bound to the card: read(c) gives its value, write(v) stores it. */
  function bound(key, labelText, read, write, opts) {
    const f = textField(labelText, read(draft()), write, opts);
    f.dataset.bind = ''; f.dataset.k = key; f.read = read;
    return f;
  }

  function panelContent(c, sel, r, selHidden) {
    if (sel == null) {
      return [h('div', { class: 'ctx-head' }, h('p', { class: 'title grow' }, 'Nothing selected'),
        smallBtn('Reorder rows', () => hooks.onReorder(), I.reorder),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Switch to the row list', title: 'Switch to the row list', onclick: () => hooks.setList() }, icon(I.list, { size: 20 }))),
      h('p', { class: 'body muted tall-only' }, 'Tap a row, the header, the QR or the barcode to edit it. Tap a text again to type on the card.')];
    }
    const index = r ? c.rows.indexOf(r) : -1;
    const head = h('div', { class: 'ctx-head' },
      selHidden ? h('span', { class: 'tag tag-orange' }, 'NOT ON CARD') : r ? tag(`ROW ${index + 1}/${c.rows.length}`) : tag('LOCKED'),
      h('p', { class: 'title grow ellip' }, partName(c, sel)),
      h('button', { type: 'button', class: 'text-btn lime more-btn', 'data-k': 'more', 'aria-expanded': String(more), onclick: () => { more = !more; panel.classList.toggle('more', more); panel.querySelector('.more-btn').textContent = more ? 'LESS' : 'MORE'; panel.querySelector('.more-btn').setAttribute('aria-expanded', String(more)); } }, more ? 'LESS' : 'MORE'),
      h('button', { type: 'button', class: 'icon-btn muted ctx-close', 'aria-label': 'Deselect', title: 'Deselect (Esc)', onclick: () => { select(null); cardBox.focus({ preventScroll: true }); } }, icon(I.close, { size: 20 })));
    const out = [head];
    if (sel === 'header') {
      out.push(h('div', { class: 'row' },
        bound('code', 'Code', (x) => x.code, (v) => edit((x) => ({ ...x, code: v.toUpperCase() })), { mono: true, max: 8, caps: true, class: 'grow' }),
        bound('sub', 'Subline', (x) => x.subText, (v) => edit((x) => ({ ...x, subText: v.toUpperCase() })), { mono: true, max: 24, caps: true, class: 'grow2' })));
      out.push(h('div', { class: 'more-only stack tight' }, sectionLabel('Header fillers'),
        h('div', { class: 'chips scroll-x' }, c.headFill.map((f) => chip(ROW_KINDS[f.kind].title, false, () => hooks.openRowEditor(f.id, true))),
          smallBtn('Add filler', () => hooks.onAddFiller(), I.plus)),
        smallBtn('Subline graphic and more', () => hooks.openCodes('TOP'), null, 'full')));
    } else if (sel === 'qr') {
      out.push(h('p', { class: 'body muted' }, `Holds: ${qrSummary(c.qr)}`),
        segmented([false, true], c.qrRight, (v) => (v ? 'QR right' : 'QR left'), (v) => edit((x) => ({ ...x, qrRight: v }))),
        smallBtn('Edit QR content', () => hooks.openCodes('TOP', true), I.qr, 'full'));
    } else if (sel === 'footer') {
      out.push(h('div', { class: 'more-only' }, barcodeNotice()),
        h('div', { class: 'row' },
          bound('cap', 'Caption', (x) => x.barcodeCaption, (v) => edit((x) => ({ ...x, barcodeCaption: v.toUpperCase() })), { mono: true, max: 16, caps: true, class: 'grow' }),
          bound('link', 'Link', (x) => x.barcodeLink, (v) => edit((x) => ({ ...x, barcodeLink: v })), { mono: true, max: 40, type: 'url', inputmode: 'url', class: 'grow2' })),
        h('div', { class: 'row' }, barcodeChanged(c) ? smallBtn('Reset', () => resetBarcode(), I.undo) : null,
          smallBtn('Symbol and more', () => hooks.openCodes('BOTTOM'), null, 'grow')));
    } else if (r) {
      if (selHidden) out.push(h('div', { class: 'hidden-note' },
        h('div', { class: 'inline' }, icon(I.warning, { size: 18, stroke: 2.4, color: 'var(--orange)' }),
          h('p', { class: 'body' }, 'No room left, so this row won’t print. Lower a row’s height, remove a row, or reorder to move it up.')),
        h('div', { class: 'row' }, smallBtn('Reorder', () => hooks.onReorder(), I.reorder, 'grow'), smallBtn('Remove', () => remove(r.id), I.trash, 'grow danger'))));
      out.push(...rowControls(c, r));
    }
    if (r == null) out.push(h('p', { class: 'locked-note more-only' }, icon(I.lock, { size: 14, color: 'var(--muted)' }), 'Always on the card — can be edited, not moved or removed'));
    return out;
  }

  function rowControls(c, r) {
    const out = [];
    const id = r.id;
    const cur = () => rowOf(draft(), id) || r;
    if (isField(r.kind)) {
      out.push(h('div', { class: 'row' },
        bound('label', 'Label', () => cur().label, (v) => updateRow({ ...cur(), label: v.toUpperCase() }), { mono: true, max: 10, caps: true, class: 'grow' }),
        bound('value', 'Value', () => cur().value, (v) => updateRow({ ...cur(), value: v }), { max: VALUE_MAX, autocapitalize: 'words', class: 'grow2' })));
    } else if (r.kind === 'warning') {
      out.push(bound('warn', 'Warning text', () => cur().value, (v) => updateRow({ ...cur(), value: v.toUpperCase() }), { mono: true, max: 18, caps: true }));
    } else if (r.kind === 'checks') {
      out.push(h('div', { class: 'chips scroll-x' }, r.checks.map((o, i) => {
        const b = chip(o.label, o.checked, () => updateRow({ ...cur(), checks: cur().checks.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)) }));
        b.dataset.k = `check${i}`;
        return b;
      })));
    } else if (r.kind === 'micro') {
      out.push(h('p', { class: 'body muted' }, 'Serial print is generated from the card code.'));
    } else {
      out.push(h('div', { class: 'chips scroll-x' }, FILLER_KINDS.map((k) => {
        const b = chip(ROW_KINDS[k].title, r.kind === k, () => { if (cur().kind !== k) updateRow({ ...cur(), kind: k, height: null }); });
        b.dataset.k = `kind-${k}`;
        return b;
      })));
    }
    const k = ROW_KINDS[r.kind], hh = rowHeight(r);
    const setH = (v) => { const n = Math.min(k.max, Math.max(k.min, v)); updateRow({ ...cur(), height: n === k.def ? null : n }); };
    const stepBtn = (t, labelText, enabled, fn, key) => h('button', { type: 'button', class: 'step-btn', 'data-k': key, 'aria-label': labelText, title: labelText, disabled: !enabled, onclick: fn }, t);
    out.push(h('div', { class: 'ctx-tools more-only' },
      h('span', { class: 'section-label' }, 'HEIGHT'),
      stepBtn('−', 'Decrease row height', hh > k.min, () => setH(rowHeight(cur()) - 1), 'hdown'),
      h('span', { class: 'mono-small step-val', 'aria-live': 'polite' }, String(hh)),
      stepBtn('+', 'Increase row height', hh < k.max, () => setH(rowHeight(cur()) + 1), 'hup'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'icon-btn', 'data-k': 'dup', 'aria-label': 'Duplicate row', title: 'Duplicate row', onclick: () => { const d = duplicateRow(id); if (d) select(d.id); } }, icon(I.copy, { size: 20 })),
      h('button', { type: 'button', class: 'icon-btn', 'data-k': 'all', 'aria-label': 'All row settings', title: 'All row settings', onclick: () => hooks.openRowEditor(id, false) }, icon(I.settings, { size: 20 })),
      h('button', { type: 'button', class: 'small-btn compact', 'data-k': 'reorder', 'aria-label': 'Reorder rows', title: 'Reorder rows', onclick: () => hooks.onReorder() },
        icon(I.reorder, { size: 18 }), h('span', { class: 'wide-only' }, 'Reorder'))));
    return out;
  }

  // Announce selection changes for screen readers.
  let announced;
  function announce(c) {
    const sel = liveSel(c);
    if (sel === announced) return;
    announced = sel;
    if (sel == null) { live.textContent = 'Nothing selected'; return; }
    const r = rowOf(c, sel);
    live.textContent = `${partName(c, sel)} selected${r ? `, row ${c.rows.indexOf(r) + 1} of ${c.rows.length}` : ''}`;
  }

  return {
    stage, panel,
    update(c) { update(c); announce(c); },
    /** Re-fit the card after something outside the stage changed (the tab bar folding away). */
    relayout: () => layout(),
    typing: () => typing,
    /** One step back (Escape / system back): stop typing, else deselect. False when there was nothing to do. */
    stepBack() {
      if (typing) { stopTyping(); return true; }
      if (liveSel(draft()) != null) { select(null); return true; }
      return false;
    },
    destroy() { ro.disconnect(); canvas.dispose(); trayList.querySelectorAll('canvas').forEach((x) => x.dispose?.()); },
  };
}

// ═══ Reorder: the real card, to scale, with handles beside its rows ═════════════════════════

/** Order while [id] is dragged by [dy] units: { order, drawDy, to }. */
function reorderPreview(g, base, id, dy) {
  const idx = base.findIndex((r) => r.id === id);
  if (idx < 0) return { order: base, drawDy: 0, to: -1 };
  const s0 = g.rows[idx];
  const want = s0.top + s0.height / 2 + dy;
  const others = base.filter((_, i) => i !== idx);
  const to = g.slotsFor(others).filter((s) => s.top + s.height / 2 < want).length;
  const order = [...others]; order.splice(to, 0, base[idx]);
  return { order, drawDy: s0.top + dy - g.slotsFor(order)[to].top, to };
}

export function reorderScreen(nav, onAddRow) {
  let drag = null; // { id, pointerId, startY, dy, to }
  let L = null; // layout
  const warn = h('div', { class: 'ro-warn', hidden: true });
  const canvas = canvasView((ctx, w) => {
    const c = draft(); if (!c || !L) return;
    const { shown, drawDy } = current(c);
    const g = cardGeometry(shown), s = w / g.w;
    drawCard(ctx, shown, codesFor(c), 0, -L.viewTop * s, w, { showOverflow: true, dragRowId: drag?.id, dragDy: drawDy });
    const cut = g.rows.find((x) => !x.fits);
    if (cut) {
      const y = (cut.top - 3.5 - L.viewTop) * s;
      ctx.save(); ctx.strokeStyle = css(c.ink); ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.restore();
    }
  }, 'ro-canvas', 'Card with its rows');
  const endTag = h('span', { class: 'ro-end mono-small', hidden: true }, 'CARD ENDS HERE');
  const handles = h('div', { class: 'ro-handles' });
  const locks = h('div', {});
  const boxEl = h('div', { class: 'ro-box' }, canvas, locks, endTag, handles);
  const fitNote = h('p', { class: 'mono-small lime ro-fit' });
  const view = h('div', { class: 'ro-view dots' }, warn, h('div', { class: 'ro-scroll' }, h('div', { class: 'ro-spacer' }), boxEl, fitNote));
  const el = h('main', { class: 'screen reorder' },
    h('header', { class: 'topbar' },
      h('div', { class: 'grow bar-text' }, h('h1', { class: 'bar-title' }, 'Reorder rows'), h('p', { class: 'mono-small' }, 'HEADER, QR & BARCODE STAY PUT')),
      h('button', { type: 'button', class: 'save-btn cut-s', onclick: () => nav.back() }, 'Done')),
    view,
    h('div', { class: 'ro-foot' }, h('p', { class: 'body muted grow' }, 'Drag ⠿ to move a row, ✕ removes it.'),
      h('button', { type: 'button', class: 'small-btn', onclick: async () => { await nav.back(); onAddRow(); } }, icon(I.plus, { size: 18 }), h('span', {}, 'Add row'))));

  function current(c) {
    if (!drag) return { shown: c, drawDy: 0 };
    const p = reorderPreview(cardGeometry(c), c.rows, drag.id, drag.dy);
    return { shown: { ...c, rows: p.order }, drawDy: p.drawDy, to: p.to };
  }

  const ro = new ResizeObserver(() => paint());
  ro.observe(view);
  let sig = '';

  function paint() {
    const c = draft(); if (!c) return;
    const { shown, drawDy } = current(c);
    const g = cardGeometry(shown), g0 = cardGeometry(c);
    const hidden = g.rows.filter((x) => !x.fits).length;
    warn.hidden = !hidden;
    if (hidden) warn.replaceChildren(icon(I.warning, { size: 22, stroke: 2.2, color: 'var(--orange)' }),
      h('div', {}, h('p', { class: 'title' }, hidden === 1 ? '1 row won’t be on the card' : `${hidden} rows won’t be on the card`),
        h('p', { class: 'body muted' }, 'Greyed rows sit past the card’s free space and won’t appear on the final card. Drag them above the dashed line, or remove a row.')));
    const scroller = view.querySelector('.ro-scroll');
    const gut = 44, fullW = scroller.clientWidth, padV = 16;
    const availH = scroller.clientHeight - padV * 2 - 28;
    if (fullW <= 0 || availH <= 0) return;
    // Always to scale. Show the whole card unless that makes the rows hard to grab; only then
    // crop the fixed header and barcode, and scroll if even that won't fit.
    const widthUnit = (fullW - gut * 2 - 8) / g0.w;
    const wholeUnit = Math.min(widthUnit, availH / g0.h);
    const whole = wholeUnit >= widthUnit * 0.75;
    const viewTop = whole ? 0 : g0.contentTop - 16;
    const viewBottom = whole || hidden > 0 ? g0.h : g0.bottomTop + 22;
    const unit = whole ? wholeUnit : Math.min(widthUnit, Math.max(availH / (viewBottom - viewTop), widthUnit * 0.75));
    const cardW = unit * g0.w, vpH = unit * (viewBottom - viewTop), cardX = (fullW - cardW) / 2;
    L = { unit, viewTop, whole, cardW, vpH, cardX };
    view.querySelector('.ro-spacer').style.height = `${Math.max(0, (availH - vpH) / 2)}px`;
    boxEl.style.height = `${vpH}px`;
    Object.assign(canvas.style, { left: `${cardX}px`, width: `${cardW}px`, height: `${vpH}px` });
    boxEl.classList.toggle('cropped', !whole);
    const cut = g.rows.find((x) => !x.fits);
    endTag.hidden = !cut;
    if (cut) Object.assign(endTag.style, { top: `${unit * (cut.top - 3.5 - viewTop) + 2}px`, right: `${cardX + 10}px`, background: css(c.ink), color: css(c.labelColor) });
    fitNote.hidden = hidden > 0;
    fitNote.textContent = `${g.rowsShown} ROWS FIT`;
    // Fixed parts get a lock where the handles would be (not the barcode's while rows cover it).
    locks.replaceChildren(...(whole ? [g.header.y + g.header.h / 2, hidden ? null : g.footer.y + g.footer.h / 2].filter((v) => v != null)
      .map((cy) => h('span', { class: 'ro-lock', style: { left: `${cardX - gut - 4}px`, top: `${unit * cy - 22}px` } }, icon(I.lock, { size: 16, color: 'var(--outline-strong)' }))) : []));

    // Handles: rebuilt when the rows change, moved otherwise (a drag keeps its element).
    const s2 = c.rows.map((r) => r.id + ':' + rowTitle(r)).join(',');
    if (s2 !== sig) { sig = s2; buildHandles(c); }
    for (const slot of g.rows) {
      const id = slot.row.id, dragging = drag?.id === id;
      const y = unit * (slot.top - 3.5 - viewTop + (dragging ? drawDy : 0)), hh = unit * (slot.height + 7);
      const pair = handles.querySelectorAll(`[data-id="${id}"]`);
      pair.forEach((b) => {
        const left = b.classList.contains('ro-drag') ? cardX - gut - 4 : cardX + cardW + 4;
        Object.assign(b.style, { transform: `translate(${left}px, ${y}px)`, height: `${hh}px` });
        b.classList.toggle('dragging', dragging); b.classList.toggle('off', !slot.fits);
      });
    }
    canvas.invalidate();
  }

  function buildHandles(c) {
    handles.replaceChildren(...c.rows.flatMap((r) => {
      const name = rowTitle(r);
      const d = h('button', { type: 'button', class: 'ro-drag', 'data-id': String(r.id), 'aria-label': `Move ${name} row. Drag, or use the arrow keys.` }, icon(I.drag, { size: 20 }));
      const x = h('button', { type: 'button', class: 'ro-del', 'data-id': String(r.id), 'aria-label': `Remove ${name} row`, title: `Remove ${name} row`,
        onclick: () => { removeRow(r.id); toast('Row removed', { label: 'Undo', run: undoRemove }); } }, icon(I.close, { size: 14, stroke: 2.6 }));
      d.addEventListener('keydown', (e) => {
        const rows = draft().rows, i = rows.findIndex((y) => y.id === r.id);
        const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
        if (to < 0 || to >= rows.length) return;
        e.preventDefault(); moveRow(i, to); vibrate(5);
        requestAnimationFrame(() => handles.querySelector(`.ro-drag[data-id="${r.id}"]`)?.focus());
      });
      d.addEventListener('pointerdown', (e) => {
        if (e.button) return;
        e.preventDefault();
        d.setPointerCapture(e.pointerId);
        drag = { id: r.id, pointerId: e.pointerId, startY: e.clientY, dy: 0, to: draft().rows.findIndex((y) => y.id === r.id) };
        vibrate(15);
        paint();
      });
      d.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.dy = (e.clientY - drag.startY) / L.unit;
        const t = reorderPreview(cardGeometry(draft()), draft().rows, drag.id, drag.dy).to;
        if (t !== drag.to) { drag.to = t; vibrate(5); }
        queuePaint();
      });
      const end = (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const rows = draft().rows, from = rows.findIndex((y) => y.id === drag.id);
        const t = reorderPreview(cardGeometry(draft()), rows, drag.id, drag.dy).to;
        drag = null;
        if (from >= 0 && t >= 0 && t !== from) moveRow(from, t); else paint();
      };
      d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
      return [d, x];
    }));
  }
  let queued = false;
  const queuePaint = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paint(); }); } };

  requestAnimationFrame(paint);
  return { el, update: () => paint(), destroy() { ro.disconnect(); canvas.dispose(); } };
}
