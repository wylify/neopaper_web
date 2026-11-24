// Card builder: Card / Style / Backdrop / Export tabs over a live preview (ui/BuilderScreen.kt).
import { vibrate, settings, setSettings, guides, onSettings } from './settings.js';
import { cardOverlaps, overlapsAny, fitBetweenGuides, overlapText, guideScreen } from './placement.js';
import { pushLayer, pop, popTo, depth, isTop } from './nav.js';
import { cardEditTab, liveSel, stageLabel } from './cardedit.js';
import { guidesPicker } from './home.js';
import { h, icon, I, iconButton, primary, outline, sectionLabel, tag, hint, segmented, chipGroup, switchRow, slider, textField, toast, busy, nextPaint, zoomPan } from './ui.js';
import { S, draft, edit, subscribe, select, removeRow, undoRemove, moveRow, setPhotoBlob, flush, undo, redo, canUndo, canRedo, clearHistory } from './state.js';
import {
  RATIOS, ratioLabel, CORNERS, COLOR_PRESETS, BACKGROUND_COLORS, OVERLAYS, PHOTO_EFFECTS, DEVICE, CUSTOM, DEVICE_PRESETS,
  ROW_KINDS, FIELD_ICONS, isField, rowHeight, qrSummary, unitSize, css,
} from './model.js';
import { suggestInk, suggestBackdrop, contrast, INK_TARGET, BACKDROP_TARGET, luminance } from './colors.js';
import { cardCanvas, wallpaperCanvas, rowSwatch } from './previews.js';
import { colorWell, suggestedSwatches, colorPickerDialog } from './colorpicker.js';
import { openSheet } from './sheet.js';
import { deviceSize, targetSize, exportSize, renderImage, fileName, download, shareFile, canShareFile, isIos, isMobile, wallpaperSteps, MAX_PIXELS } from './export.js';
import { prepareFile } from './photo.js';
import { barcode } from './codes.js';
import { cardPx, WARNING_PATH } from './render.js';

const TABS = ['Card', 'Style', 'Backdrop', 'Export'];

// Preview stage heights (px) the user picks with the handle; card and wallpaper stages keep their own.
// Defaults scale with the window so short screens keep room for the controls; tall phones still
// get the full 236 / 300px.
const STAGE_MIN = 120;
const stageDefault = (key) => Math.round(Math.min(key === 'wall' ? 300 : 236, Math.max(STAGE_MIN, innerHeight * (key === 'wall' ? 0.34 : 0.3))));
const stageH = { card: null, wall: null, edit: null };

export function rowTitle(r) {
  if (isField(r.kind)) { const t = (r.label.trim() || ROW_KINDS[r.kind].title).toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }
  return ROW_KINDS[r.kind].title;
}
export function rowValue(r) {
  if (isField(r.kind)) return r.value.trim() || '—';
  if (r.kind === 'checks') return r.checks.map((c) => (c.checked ? '[x] ' : '') + c.label).join(' · ');
  if (r.kind === 'warning') return r.value;
  if (r.kind === 'micro') return 'AUTO FROM CODE';
  return `FILLER · ${rowHeight(r)} PX`;
}
export function rowIconPath(r) {
  switch (r.kind) {
    case 'owner': return FIELD_ICONS.user; case 'contact': return FIELD_ICONS.mail; case 'date': return I.date;
    case 'custom': return FIELD_ICONS[r.icon]; case 'checks': return I.checkbox; case 'warning': return WARNING_PATH; case 'micro': return I.serial;
    default: return null;
  }
}
/** Tiny glyph for a row: its icon, or a live swatch of the filler pattern. */
export function rowGlyph(cfg, r, color = cfg ? cfg.labelColor : 0, bg = null) {
  const d = rowIconPath(r);
  if (d) return h('span', { class: 'row-glyph' }, icon(d, { size: 18, color: 'var(--orange)' }));
  return h('span', { class: 'row-glyph' }, rowSwatch(cfg, r, color, bg));
}

export function builderScreen(nav) {
  let tab = S.builderTab;
  let fit = { shown: 0, total: 0 };
  const dev = deviceSize();
  // History entries below this builder: the ← button always goes straight back to the cards.
  const base = depth();
  const cardMode = () => settings.cardEditor === 'CARD';

  // ── Top bar: back · the tabs as one sliding pill · preview ──
  const tabBtns = TABS.map((t, i) => h('button', { type: 'button', role: 'tab', class: 'pill-tab', 'aria-selected': String(i === tab), onclick: () => setTab(i) }, h('span', {}, t)));
  const tabRow = h('div', { class: 'pill-tabs', role: 'tablist', 'aria-label': 'Builder steps' }, h('i', { class: 'pill-ink', 'aria-hidden': 'true' }), tabBtns);

  // ── Stage ──
  const liveEl = h('span', { class: 'stage-note left mono-small' });
  const fitEl = h('button', { type: 'button', class: 'stage-note right mono-small' });
  const card = cardCanvas(draft, (info) => { fit = info; paintFit(); }, 'stage-card');
  const wall = wallpaperCanvas(draft, () => S.photo, () => (tab === 3 ? targetSize(draft()) : dev), 'stage-wall', { guides: () => (tab >= 2 ? guides() : null) });
  // Backdrop: the card runs under this screen's clock or dock. Tap to fit it between them.
  const placeText = h('span', {});
  const placeBadge = h('button', { type: 'button', class: 'place-badge', hidden: true, onclick: () => fitToScreen() },
    icon(I.warning, { size: 14, stroke: 2.6 }), placeText);
  const fitToScreen = () => edit((x) => fitBetweenGuides(x, dev[0], dev[1], settings.guideScreen));
  // The tab bar can fold away on any screen: back, preview and the toggle then float on the stage
  // and the edit mode sits above the card.
  const modeEl = h('p', { class: 'stage-mode mono-label' });
  const toggleBtn = h('button', { type: 'button', class: 'stage-btn stage-toggle', onclick: () => toggleTabs() });
  // Undo / redo: the last 10 steps on this card, while the editor is open (Ctrl/⌘+Z, Shift+Z or Y).
  const undoBtn = h('button', { type: 'button', class: 'stage-btn stage-undo', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => stepHistory(false) }, icon(I.undo, { size: 20 }));
  const redoBtn = h('button', { type: 'button', class: 'stage-btn stage-redo', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => stepHistory(true) }, icon(I.redo, { size: 20 }));
  function stepHistory(forward) { if (forward ? redo() : undo()) vibrate(6); }
  function paintHistory() {
    undoBtn.disabled = !canUndo(); redoBtn.disabled = !canRedo();
    // A redo only appears once there is something to redo; undo stays put so the stage does not shift.
    if (redoBtn.hidden !== !canRedo()) { redoBtn.hidden = !canRedo(); editApi?.relayout(); }
  }
  const stageCtl = h('div', { class: 'stage-ctl' },
    h('button', { type: 'button', class: 'stage-btn stage-back', 'aria-label': 'Back to your cards', title: 'Back to your cards', onclick: () => exit() }, icon(I.back, { size: 22 })),
    undoBtn, redoBtn,
    modeEl,
    h('button', { type: 'button', class: 'stage-btn stage-eye', 'aria-label': 'Preview wallpaper full screen', title: 'Preview wallpaper full screen', onclick: () => fullPreview() }, icon(I.eye, { size: 22 })),
    toggleBtn);
  const handle = h('div', {
    class: 'stage-handle', role: 'separator', tabindex: '0', 'aria-orientation': 'horizontal',
    'aria-label': 'Resize preview. Drag or use arrow keys, double-click to reset', title: 'Drag to resize · double-click to reset',
  }, h('i'));
  // Style tab: the warning jumps to the Card tab with the first hidden row selected.
  fitEl.addEventListener('click', () => {
    const c = draft(); if (!c || fit.shown >= fit.total) return;
    if (cardMode()) select(c.rows[fit.shown]?.id ?? null);
    setTab(0);
  });
  const stageInner = h('div', { class: 'stage-inner' }, card, wall);
  const stage = h('div', { class: 'stage dots builder-stage' }, stageInner, liveEl, fitEl, placeBadge, stageCtl, handle);
  wireStageHandle();

  const pane = h('div', { class: 'pane', role: 'tabpanel' });
  const actions = h('div', { class: 'action-bar' });

  const el = h('main', { class: 'screen builder' },
    h('header', { class: 'topbar builder-top' }, iconButton(I.back, 'Back to your cards', () => exit()),
      h('div', { class: 'grow pill-wrap' }, tabRow),
      iconButton(I.eye, 'Preview wallpaper full screen', () => fullPreview())),
    h('div', { class: 'builder-body' }, stage, h('div', { class: 'builder-side' }, pane, actions)));

  // ── Back: Escape / system back steps out of typing, then the selection, then to the previous
  // tab; the ← buttons always leave. One history entry stands for "there is a step to go back". ──
  let stepLayer = null, exiting = false, dropping = null, stepping = false;
  function canStep() { return tab > 0 || (tab === 0 && cardMode() && (editApi?.typing() || liveSel(draft()) != null)); }
  function syncBack() {
    if (exiting || dropping || stepping) return;
    if (canStep() && !stepLayer) {
      stepLayer = pushLayer(() => {
        stepLayer = null;
        if (exiting) return;
        // No new entry while the popstate that closed this one is still being handled.
        stepping = true;
        try { if (!(tab === 0 && editApi?.stepBack()) && tab > 0) setTab(tab - 1); } finally { stepping = false; }
        setTimeout(syncBack, 0); // a new entry for the next step, once this back has settled
      }, 'step');
    } else if (!canStep() && stepLayer && isTop(stepLayer)) {
      // Nothing left to step back from (e.g. Card tab clicked): drop the entry without acting on it.
      const l = stepLayer; stepLayer = null; l.close = () => {};
      dropping = pop().then(() => { dropping = null; syncBack(); });
    }
  }
  function exit() { exiting = true; popTo(base); }

  function toggleTabs() { setSettings({ tabsHidden: !settings.tabsHidden }); paintTabsHidden(); }
  function paintTabsHidden() {
    const hidden = settings.tabsHidden;
    el.classList.toggle('tabs-hidden', hidden);
    toggleBtn.replaceChildren(icon(hidden ? I.barShow : I.barHide, { size: 22 }));
    toggleBtn.setAttribute('aria-label', hidden ? 'Show tabs' : 'Hide tabs');
    toggleBtn.title = hidden ? 'Show tabs' : 'Hide tabs';
    editApi?.relayout();
  }

  function paintFit() {
    if (!fit.total) { fitEl.textContent = ''; return; }
    const all = fit.shown === fit.total;
    fitEl.textContent = all ? `${fit.shown} ROWS FIT` : `${fit.shown}/${fit.total} ROWS FIT`;
    fitEl.classList.toggle('bad', !all);
    fitEl.disabled = all;
    fitEl.setAttribute('aria-label', all ? `${fit.shown} rows fit` : `${fit.total - fit.shown} rows don’t fit on the card. Show them`);
  }

  let paneApi = null, editApi = null;
  function setTab(i, force = false) {
    if (i === tab && !force && paneApi) return;
    const dir = i > tab ? 1 : -1;
    tab = i; S.builderTab = i;
    modeEl.textContent = TABS[i].toUpperCase();
    tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    tabRow.style.setProperty('--tab', i);
    stage.classList.toggle('wall-mode', i >= 2);
    // Card tab, on-the-card layout: the editor takes the stage and the pane.
    const editing = i === 0 && cardMode();
    el.classList.toggle('card-mode', editing);
    if (editing && !editApi) {
      editApi = cardEditTab({
        onAddRow: (after) => openAddRow(false, after),
        onAddFiller: () => openAddRow(true),
        onReorder: () => nav.openReorder(() => openAddRow(false)),
        openCodes: (part, focusQr) => nav.openCodes(part, focusQr),
        openRowEditor: (id, header) => nav.openRowEditor(id, header),
        setList: () => setSettings({ cardEditor: 'LIST' }),
        onState: () => { el.classList.toggle('typing', editApi.typing()); paintBar(); syncBack(); },
      });
      stage.append(editApi.stage);
    } else if (!editing && editApi) {
      editApi.destroy(); editApi.stage.remove(); editApi = null;
      el.classList.remove('typing');
    }
    stageInner.hidden = editing;
    handle.hidden = i === 0 && !editing;
    applyStageH();
    paneApi?.destroy?.();
    paneApi = editing ? { el: editApi.panel, update: (c) => editApi.update(c) } : [cardTab, styleTab, backdropTab, exportTab][i]();
    pane.replaceChildren(paneApi.el);
    pane.scrollTop = 0;
    pane.animate?.([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)' });
    renderActions();
    refresh();
    syncBack();
  }

  /** Card tab: the Add row / Next bar steps aside while typing, and on short screens while something is selected. */
  function paintBar() {
    const short = matchMedia('(max-height: 639px) and (max-width: 699px), (max-height: 639px) and (max-aspect-ratio: 17/20)').matches;
    const hide = tab === 0 && !!editApi && (editApi.typing() || (short && liveSel(draft()) != null));
    actions.hidden = hide;
    el.classList.toggle('bar-hidden', hide);
  }

  function renderActions() {
    const add = () => openAddRow(false);
    actions.hidden = false; el.classList.remove('bar-hidden');
    if (tab === 0) actions.replaceChildren(outline('Add row', add, { icon: I.plus }), primary('Next: Style', () => setTab(1), { icon: I.next }));
    else if (tab === 3) actions.replaceChildren(outline('Save image', () => saveImage(false), { icon: I.download }), primary('Set as wallpaper', () => saveImage(true), { class: 'wide' }));
    else actions.replaceChildren(outline('Back', () => setTab(tab - 1)), primary(`Next: ${TABS[tab + 1]}`, () => setTab(tab + 1), { class: 'wide' }));
  }

  // ── Stage resize handle (BuilderScreen.kt StageHandle) ──
  const stageKey = () => (tab >= 2 ? 'wall' : editApi ? 'edit' : 'card');
  const stageMax = () => Math.max(200, Math.round(innerHeight * 0.62));
  const clampH = (v) => Math.min(stageMax(), Math.max(STAGE_MIN, Math.round(v ?? stageDefault(stageKey()))));
  function applyStageH() {
    // The on-card editor's stage is flexible (at least 55% of the height) until the user drags it.
    if (stageKey() === 'edit') {
      if (stageH.edit == null) stage.style.removeProperty('--edit-h'); else stage.style.setProperty('--edit-h', `${stageH.edit}px`);
      stage.classList.toggle('sized', stageH.edit != null);
      handle.setAttribute('aria-valuenow', String(Math.round(stage.offsetHeight)));
      return;
    }
    stage.style.setProperty('--stage-h', `${clampH(stageH[stageKey()])}px`);
    handle.setAttribute('aria-valuenow', String(clampH(stageH[stageKey()])));
  }
  /** Editor stage: from 120px down to where the panel keeps its title row and one row of fields. */
  function clampEdit(v) {
    const body = el.querySelector('.builder-body').clientHeight;
    const minPanel = (actions.hidden ? 0 : 88) + (liveSel(draft()) == null ? 60 : 170);
    return Math.round(Math.min(Math.max(STAGE_MIN, body - minPanel), Math.max(STAGE_MIN, v)));
  }
  function wireStageHandle() {
    let drag = null; // { id, y, h }
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, y: e.clientY, h: stageKey() === 'edit' ? stage.offsetHeight : clampH(stageH[stageKey()]) };
      stage.classList.add('resizing');
      vibrate(8);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      stageH[stageKey()] = stageKey() === 'edit' ? clampEdit(drag.h + e.clientY - drag.y) : clampH(drag.h + e.clientY - drag.y);
      applyStageH();
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      stage.classList.remove('resizing');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => { stageH[stageKey()] = null; applyStageH(); });
    handle.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0;
      if (e.key === 'Home' || e.key === 'Escape') { stageH[stageKey()] = null; }
      else if (step) stageH[stageKey()] = stageKey() === 'edit' ? clampEdit(stage.offsetHeight + step) : clampH(clampH(stageH[stageKey()]) + step);
      else return;
      e.preventDefault();
      applyStageH();
    });
  }

  function refresh() {
    const c = draft();
    if (!c) return;
    // The card's name lives on the stage now that the top bar holds the tabs.
    liveEl.textContent = tab < 2 ? stageLabel(c) : tab === 3 ? `${targetSize(c).join(' × ')}` : 'THIS DEVICE';
    liveEl.hidden = !!editApi; // the editor has its own label
    if (editApi) { fitEl.hidden = true; }
    else if (tab < 2) { card.sync(); fitEl.hidden = false; } else { wall.sync(); fitEl.hidden = true; }
    // Backdrop: the card runs under the clock or dock of the screen the guides follow. Tap to fit.
    const gs = guides();
    const o = gs ? cardOverlaps(c, dev[0], dev[1], gs) : { clock: false, dock: false };
    placeBadge.hidden = tab !== 2 || !overlapsAny(o);
    if (gs && overlapsAny(o)) {
      const t = overlapText(o, gs), g = guideScreen(gs);
      placeText.textContent = `${t.badge} · FIT`;
      placeBadge.setAttribute('aria-label', `Card overlaps the ${g.title.toLowerCase()} ${t.spoken}. Fit it`);
    }
    paneApi?.update?.(c);
    if (editApi) { paintBar(); syncBack(); }
  }

  // ═══ Card tab ═══════════════════════════════════════════════════════════════════════

  function cardTab() {
    const req = h('div', { class: 'req-row' });
    const head = h('div', { class: 'row-list' });
    const body = h('div', { class: 'row-list' });
    const el = h('div', { class: 'tab-card' },
      h('button', { type: 'button', class: 'switch-layout', onclick: () => setSettings({ cardEditor: 'CARD' }) },
        icon(I.tapCard, { size: 20, color: 'var(--lime)' }), h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Edit on the card'), h('span', { class: 'body muted' }, 'Tap a part of the card to change it, type right on it')), icon(I.chevron, { size: 18, color: 'var(--muted)' })),
      h('div', { class: 'label-row' }, sectionLabel('Required'), icon(I.lock, { size: 14, color: 'var(--muted)' })), req,
      h('div', { class: 'label-row' }, sectionLabel('Header · beside QR'), h('button', { type: 'button', class: 'text-btn lime', onclick: () => openAddRow(true) }, 'Add filler')), head,
      h('div', { class: 'label-row' }, sectionLabel('Rows · top to bottom'), h('span', { class: 'mono-small' }, isMobile ? 'DRAG ⠿ · SWIPE ✕' : 'DRAG ⠿ TO SORT')), body);

    let sig = '';
    const reqTile = (label, value, part, focusQr) => h('button', { type: 'button', class: 'req-tile', onclick: () => nav.openCodes(part, focusQr), 'aria-label': `Edit ${label}` },
      h('span', { class: 'req-label' }, label), h('span', { class: 'req-value' }, value));

    let drag = null; // { id, startY, shift, pointerId }
    const ITEM = 58;

    function rowItem(c, r, header, index) {
      const handle = header ? h('span', { class: 'handle-space' }) : h('button', {
        type: 'button', class: 'drag-handle', 'aria-label': `Reorder ${ROW_KINDS[r.kind].title}. Use arrow keys to move.`,
        onkeydown: (e) => {
          if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); moveRow(index, index - 1); focusHandle(r.id); }
          if (e.key === 'ArrowDown' && index < c.rows.length - 1) { e.preventDefault(); moveRow(index, index + 1); focusHandle(r.id); }
        },
      }, icon(I.drag, { size: 20, color: 'var(--outline-strong)' }));
      const item = h('div', { class: 'row-item', 'data-id': String(r.id) },
        h('div', { class: 'row-bg', 'aria-hidden': 'true' }, icon(I.trash, { color: 'var(--error)' }), icon(I.trash, { color: 'var(--error)' })),
        h('div', { class: 'row-fg' }, handle,
          h('button', { type: 'button', class: 'row-main', onclick: () => nav.openRowEditor(r.id, header), 'aria-label': `Edit ${ROW_KINDS[r.kind].title}` },
            rowGlyph(c, r, 0xFFFF6A13 | 0),
            h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, rowTitle(r), header ? tag('HEADER') : null), h('span', { class: 'mono-small ellip' }, rowValue(r))),
            icon(I.chevron, { size: 20, color: 'var(--muted)' })),
          h('button', { type: 'button', class: 'icon-btn row-del', 'aria-label': `Remove ${ROW_KINDS[r.kind].title}`, onclick: () => remove(r.id) }, icon(I.trash, { size: 18 }))));
      swipeToRemove(item, () => remove(r.id));
      if (!header) {
        handle.addEventListener('pointerdown', (e) => {
          if (e.button) return;
          e.preventDefault();
          drag = { id: r.id, startY: e.clientY, shift: 0, pointerId: e.pointerId };
          body.setPointerCapture(e.pointerId);
          vibrate(15);
          applyDrag(0);
        });
      }
      return item;
    }
    function focusHandle(id) { requestAnimationFrame(() => body.querySelector(`[data-id="${id}"] .drag-handle`)?.focus()); }
    function applyDrag(dy) {
      const it = body.querySelector(`[data-id="${drag?.id}"]`);
      body.querySelectorAll('.row-item.dragging').forEach((x) => { if (x !== it) { x.classList.remove('dragging'); x.style.transform = ''; } });
      if (it) { it.classList.add('dragging'); it.style.transform = `translateY(${dy}px) scale(1.02)`; }
    }
    body.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const c = draft();
      let dy = e.clientY - drag.startY - drag.shift;
      const from = c.rows.findIndex((r) => r.id === drag.id);
      const to = Math.max(0, Math.min(c.rows.length - 1, from + Math.round(dy / ITEM)));
      if (from >= 0 && to !== from) {
        moveRow(from, to); // re-renders the list; the drag continues on the new element
        drag.shift += (to - from) * ITEM; dy -= (to - from) * ITEM;
        vibrate(5);
      }
      applyDrag(dy);
    });
    const endDrag = () => {
      if (!drag) return;
      const it = body.querySelector(`[data-id="${drag.id}"]`);
      drag = null;
      if (it) { it.classList.remove('dragging'); it.style.transform = ''; }
    };
    body.addEventListener('pointerup', endDrag); body.addEventListener('pointercancel', endDrag); body.addEventListener('lostpointercapture', endDrag);

    function remove(id) {
      removeRow(id);
      toast('Row removed', { label: 'Undo', run: undoRemove });
    }

    function update(c) {
      req.replaceChildren(reqTile('CODE', c.code.trim() || '—', 'TOP'), reqTile(`QR · ${c.qrRight ? 'RIGHT' : 'LEFT'}`, qrSummary(c.qr), 'TOP', true), reqTile('BARCODE', c.barcodeLink.trim() || '—', 'BOTTOM'));
      const s = JSON.stringify([c.headFill, c.rows, c.labelColor, c.ink, c.code]);
      if (s === sig) return;
      sig = s;
      head.replaceChildren(...(c.headFill.length ? c.headFill.map((r, i) => rowItem(c, r, true, i)) : [hint('No header fillers. The space under the code stays clean.')]));
      body.replaceChildren(...(c.rows.length ? c.rows.map((r, i) => rowItem(c, r, false, i)) : [hint('No rows. The card shows code, QR and barcode only — add rows for details and texture.')]));
      if (drag) applyDrag(0);
    }
    update(draft());
    return { el, update };
  }

  // ═══ Style tab ══════════════════════════════════════════════════════════════════════

  function styleTab() {
    const c = draft();
    const ratios = h('div', { class: 'ratio-row', role: 'radiogroup' }, Object.keys(RATIOS).map((r) => {
      const [a, b] = RATIOS[r];
      return h('button', { type: 'button', role: 'radio', class: 'ratio', 'data-r': r, 'aria-checked': String(c.ratio === r), onclick: () => edit((x) => ({ ...x, ratio: r })) },
        h('i', { class: 'ratio-glyph', style: { width: (a === b ? 14 : 16 * a / b) + 'px', height: (a === b ? 14 : 16) + 'px' } }), ratioLabel(r));
    }));
    const orient = segmented([false, true], c.landscape, (v) => (v ? 'Landscape' : 'Portrait'), (v) => edit((x) => ({ ...x, landscape: v })));
    const corner = segmented(CORNERS, c.corner, (v) => v.charAt(0) + v.slice(1).toLowerCase(), (v) => edit((x) => ({ ...x, corner: v })));
    const marks = switchRow('Corner marks', 'Thin brackets inside the card edge', c.cornerMarks, (v) => edit((x) => ({ ...x, cornerMarks: v })));

    const presets = h('div', { class: 'preset-row' }, COLOR_PRESETS.map((p) => h('button', {
      type: 'button', class: 'preset cut-s', 'aria-label': p.name, title: p.name, 'data-card': p.card, 'data-ink': p.ink,
      style: { background: css(p.card), color: css(p.ink) }, onclick: () => edit((x) => ({ ...x, labelColor: p.card, ink: p.ink })),
    }, 'Aa')), h('button', { type: 'button', class: 'preset add', 'aria-label': 'Custom card colour', onclick: () => pick('card') }, icon(I.plus, { size: 20 })));
    const cardWell = colorWell('Card', c.labelColor, () => pick('card'));
    const inkWell = colorWell('Ink', c.ink, () => pick('ink'));
    const sugg = suggestedSwatches('Suggested ink', suggestInk(c.labelColor), c.ink, c.labelColor, (v) => edit((x) => ({ ...x, ink: v })));
    const readout = h('p', { class: 'contrast mono-small' });
    const invertNote = h('p', { class: 'note warn', hidden: true },
      'Light ink on a dark card: phone cameras read the QR, but many barcode scanners (zxing, the Android app) can’t read light-on-dark bars. NEOSCAN and this app’s scanner retry inverted.');

    function pick(which) {
      const x = draft();
      if (which === 'card') colorPickerDialog('Card colour', x.labelColor, x.ink, 4.5, suggestInk(x.ink), (v) => edit((y) => ({ ...y, labelColor: v })));
      else colorPickerDialog('Ink colour', x.ink, x.labelColor, INK_TARGET, suggestInk(x.labelColor), (v) => edit((y) => ({ ...y, ink: v })));
    }

    const el = h('div', { class: 'stack' }, sectionLabel('Shape'), ratios, orient, corner, marks,
      sectionLabel('Colour', 'mt'), presets, h('div', { class: 'row' }, cardWell, inkWell), sugg, readout, invertNote);

    function update(x) {
      ratios.querySelectorAll('.ratio').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.r === x.ratio)));
      orient.set(x.landscape); corner.set(x.corner);
      presets.querySelectorAll('.preset[data-card]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.card === x.labelColor && +b.dataset.ink === x.ink)));
      cardWell.set(x.labelColor); inkWell.set(x.ink);
      sugg.update(suggestInk(x.labelColor), x.ink, x.labelColor);
      const k = contrast(x.labelColor, x.ink), ok = k >= 4.5;
      readout.replaceChildren(icon(ok ? I.check : I.warning, { size: 14, stroke: 3 }), ` INK CONTRAST ${k.toFixed(1)}:1 · ${ok ? 'SCANNABLE' : 'CODES MAY NOT SCAN'}`);
      readout.classList.toggle('bad', !ok);
      invertNote.hidden = !(luminance(x.ink) > luminance(x.labelColor));
    }
    update(c);
    return { el, update };
  }

  // ═══ Backdrop tab ═══════════════════════════════════════════════════════════════════

  function backdropTab() {
    const c = draft();
    const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0]; fileInput.value = '';
      if (!f) return;
      busy('Loading photo…');
      try { await setPhotoBlob(await prepareFile(f)); } catch (e) { console.warn(e); toast('Couldn’t open that image'); }
      busy(null);
    });
    const mode = segmented(['COLOR', 'PHOTO'], c.bgMode, (v) => (v === 'COLOR' ? 'Colour' : 'Photo'), (v) => edit((x) => ({ ...x, bgMode: v })));
    const swatches = h('div', { class: 'preset-row' }, BACKGROUND_COLORS.map((col) => h('button', {
      type: 'button', class: 'bg-swatch', 'data-c': col, style: { background: css(col) }, 'aria-label': `Backdrop colour #${(col & 0xFFFFFF).toString(16)}`,
      onclick: () => edit((x) => ({ ...x, bgColor: col })),
    }, icon(I.check, { size: 18, stroke: 3, color: luminance(col) > 0.5 ? 'var(--on-accent)' : 'var(--lime)' }))),
    h('button', { type: 'button', class: 'preset add', 'aria-label': 'Custom backdrop colour', onclick: pickBg }, icon(I.plus, { size: 20 })));
    const well = colorWell('Backdrop', c.bgColor, pickBg);
    const sugg = suggestedSwatches('Suggested backdrop', suggestBackdrop(c.labelColor), c.bgColor, c.labelColor, (v) => edit((x) => ({ ...x, bgColor: v })));
    const colorBox = h('div', { class: 'stack' }, swatches, well, sugg);

    const thumb = h('img', { class: 'photo-thumb', alt: 'Selected photo', hidden: true });
    const pickLabel = h('span', {}, 'Choose a photo');
    const photoBox = h('div', { class: 'stack' },
      h('div', { class: 'row' }, thumb, h('button', { type: 'button', class: 'pick-photo', onclick: () => fileInput.click() }, icon(I.image, { size: 22 }), pickLabel)), fileInput,
      slider('Dim', c.photoDim, 0, 0.8, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => edit((x) => ({ ...x, photoDim: v }))),
      h('div', { class: 'inline' }, h('span', { class: 'title w64' }, 'Effect'),
        chipGroup(Object.keys(PHOTO_EFFECTS), c.photoEffect, (v) => PHOTO_EFFECTS[v], (v) => edit((x) => ({ ...x, photoEffect: v })))));

    const overlays = h('div', { class: 'overlay-row', role: 'radiogroup' }, Object.keys(OVERLAYS).map((o) => h('button', {
      type: 'button', role: 'radio', class: 'overlay-tile', 'data-o': o, onclick: () => edit((x) => ({ ...x, overlay: o })),
    }, h('i', { class: `ov ov-${o.toLowerCase()}` }), h('span', {}, OVERLAYS[o]))));

    const size = slider('Size', c.cardSize, 0.3, 0.95, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => edit((x) => ({ ...x, cardSize: v })));
    const nudge = slider('Nudge', c.nudge, -0.25, 0.25, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => edit((x) => ({ ...x, nudge: Math.abs(v) < 0.01 ? 0 : v })));
    const tilt = slider('Tilt', c.tilt, -8, 8, 1, (v) => `${Math.round(v)}°`, (v) => edit((x) => ({ ...x, tilt: Math.round(v) })));
    const crop = switchRow('Crop marks', 'Brackets around the card on the background', c.cropMarks, (v) => edit((x) => ({ ...x, cropMarks: v })));
    const warnText = h('span', { class: 'grow' });
    const fitBtn = h('button', { type: 'button', class: 'text-btn lime', 'aria-label': 'Fit between clock and dock', onclick: () => fitToScreen() }, 'Fit');
    const warn = h('div', { class: 'place-warn', hidden: true }, icon(I.warning, { size: 16, stroke: 2.6, color: 'var(--orange)' }), warnText,
      fitBtn);

    function pickBg() {
      const x = draft();
      colorPickerDialog('Backdrop colour', x.bgColor, x.labelColor, BACKDROP_TARGET, suggestBackdrop(x.labelColor), (v) => edit((y) => ({ ...y, bgColor: v, bgMode: 'COLOR' })));
    }

    const el = h('div', { class: 'stack' }, mode, colorBox, photoBox, sectionLabel('Overlay', 'mt'), overlays,
      sectionLabel('Placement', 'mt'), h('div', { class: 'inline' }, h('span', { class: 'title w64' }, 'Guides'), guidesPicker()), warn, size, nudge, tilt, crop);

    let thumbFor = null;
    function update(x) {
      mode.set(x.bgMode);
      colorBox.hidden = x.bgMode !== 'COLOR'; photoBox.hidden = x.bgMode !== 'PHOTO';
      swatches.querySelectorAll('.bg-swatch').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.c === x.bgColor)));
      well.set(x.bgColor);
      sugg.update(suggestBackdrop(x.labelColor), x.bgColor, x.labelColor);
      overlays.querySelectorAll('.overlay-tile').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.o === x.overlay)));
      size.set(x.cardSize); nudge.set(x.nudge); tilt.set(x.tilt);
      const gs = guides();
      const o = gs ? cardOverlaps(x, dev[0], dev[1], gs) : { clock: false, dock: false };
      warn.hidden = !overlapsAny(o);
      if (gs) {
        const g = guideScreen(gs);
        warnText.textContent = overlapText(o, gs).sentence;
        fitBtn.setAttribute('aria-label', `Fit between ${g.top} and ${g.bottom}`);
      }
      const p = S.photo;
      if (p && thumbFor !== p) {
        thumbFor = p;
        const t = document.createElement('canvas'); t.width = 128; t.height = 128;
        const tc = t.getContext('2d'), sc = Math.max(128 / p.full.width, 128 / p.full.height);
        tc.drawImage(p.full, (128 - p.full.width * sc) / 2, (128 - p.full.height * sc) / 2, p.full.width * sc, p.full.height * sc);
        thumb.src = t.toDataURL('image/jpeg', 0.8);
      }
      thumb.hidden = !p; pickLabel.textContent = p ? 'Change photo' : x.photoUri ? 'Photo missing · choose again' : 'Choose a photo';
    }
    update(c);
    return { el, update };
  }

  // ═══ Export tab ═════════════════════════════════════════════════════════════════════

  function exportTab() {
    const c = draft();
    const presets = [{ id: DEVICE, name: 'This device', w: dev[0], h: dev[1] }, ...DEVICE_PRESETS, { id: CUSTOM, name: 'Custom' }];
    const list = h('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Image size' }, presets.map((p) => h('button', {
      type: 'button', role: 'radio', class: 'radio-item', 'data-id': p.id, onclick: () => edit((x) => ({ ...x, exportPreset: p.id })),
    }, h('i', { class: 'radio-dot' }), h('span', { class: 'grow title' }, p.name), p.id === DEVICE ? tag('DETECTED') : null,
    h('span', { class: 'mono-small' }, p.id === CUSTOM ? 'W × H' : `${p.w} × ${p.h}`))));
    const num = (label, key) => textField(label, String(c[key]), (s) => {
      const v = parseInt(s.replace(/\D/g, ''), 10);
      if (v) edit((x) => ({ ...x, [key]: v }));
    }, { mono: true, max: 4, inputmode: 'numeric', supporting: '200–8192' });
    const custom = h('div', { class: 'row' }, num('Width px', 'customW'), num('Height px', 'customH'));
    const scale = segmented([1, 2, 3], c.exportScale, (v) => `${v}×`, (v) => edit((x) => ({ ...x, exportScale: v })));
    const fmt = segmented([true, false], c.exportPng, (v) => (v ? 'PNG' : 'JPG'), (v) => edit((x) => ({ ...x, exportPng: v })));
    const out = h('span', { class: 'mono-small' }), cardOut = h('span', { class: 'mono-small' }), bar = h('span', { class: 'mono-small' }), place = h('span', { class: 'mono-small' });
    const placeKey = h('span', { class: 'mono-small muted grow' });
    const capNote = h('p', { class: 'note', hidden: true });
    const line = (k, v) => h('div', { class: 'readout-line' }, h('span', { class: 'mono-small muted grow' }, k), v);
    const placeLine = h('div', { class: 'readout-line' }, placeKey, place);
    const el = h('div', { class: 'stack' }, sectionLabel('Size'), list, custom,
      sectionLabel('Quality · saved image', 'mt'), h('div', { class: 'row' }, scale, fmt),
      h('div', { class: 'panel-box' }, line('OUTPUT', out), line('CARD', cardOut), placeLine, line('BARCODE BAR', bar), capNote,
        h('p', { class: 'note' }, 'Browsers can’t change the wallpaper themselves: “Set as wallpaper” saves the image and shows the steps for this device.')));

    function update(x) {
      list.querySelectorAll('.radio-item').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === x.exportPreset)));
      custom.hidden = x.exportPreset !== CUSTOM;
      const [tw, th] = targetSize(x);
      const o = exportSize(tw, th, x.exportScale);
      out.textContent = `${o.w} × ${o.h} PX`;
      const [uw, uh] = unitSize(x);
      const cp = cardPx(x, o.w, o.h);
      cardOut.textContent = `${Math.round(cp)} × ${Math.round(cp * uh / uw)} PX`;
      // The narrowest barcode bar in the output is the first thing to fail when scanning.
      const modulePx = (uw - 32) * (cp / uw) / barcode(x.barcodeLink).modules;
      const ok = modulePx >= 2;
      bar.textContent = `≈ ${modulePx.toFixed(1)} PX · ${ok ? 'SCANNABLE' : 'SHORTEN THE LINK'}`;
      bar.classList.toggle('lime', ok); bar.classList.toggle('orange', !ok);
      // Only while guides are on, for the screen they follow.
      const gs = guides();
      placeLine.hidden = !gs;
      if (gs) {
        const g = guideScreen(gs), ov = cardOverlaps(x, o.w, o.h, gs);
        placeKey.textContent = `${g.short} · ${g.top.toUpperCase()} · ${g.bottom.toUpperCase()}`;
        place.textContent = !overlapsAny(ov) ? 'CLEAR' : ov.clock && ov.dock ? 'UNDER BOTH' : ov.clock ? `UNDER ${g.top.toUpperCase()}` : `UNDER ${g.bottom.toUpperCase()}`;
        place.classList.toggle('lime', !overlapsAny(ov)); place.classList.toggle('orange', overlapsAny(ov));
      }
      capNote.hidden = !o.capped;
      capNote.textContent = `Scaled down to ${(MAX_PIXELS / 1e6).toFixed(0)} MP, the most this browser can draw in one image.`;
    }
    update(c);
    return { el, update };
  }

  // ── Sheets ──

  function openAddRow(header, after = null) { nav.openAddRow(header, after); }

  function fullPreview() {
    const cv = wallpaperCanvas(draft, () => S.photo, () => dev, 'full-wall');
    const zoomHint = h('p', { class: 'zoom-hint mono-small' }, 'PINCH OR DOUBLE-TAP TO ZOOM · TAP TO CLOSE');
    let zoom = null;
    const s = openSheet([cv, zoomHint], { label: 'Wallpaper preview', dialog: true, onClose: () => { zoom?.dispose(); cv.dispose(); } });
    s.el.classList.add('fullscreen');
    s.el.parentElement.classList.add('black');
    zoom = zoomPan(s.el, cv.canvas, { onTap: () => s.close() });
  }

  async function saveImage(wallpaper) {
    const c = draft();
    await flush();
    busy(wallpaper ? 'Rendering wallpaper…' : 'Rendering image…');
    await nextPaint();
    let res;
    try {
      // "Set as wallpaper" always uses this screen's exact size, like the Android app.
      const size = wallpaper ? exportSize(dev[0], dev[1], 1) : exportSize(...targetSize(c), c.exportScale);
      res = await renderImage(c, S.photo, size);
    } catch (e) { console.warn(e); busy(null); toast('Couldn’t render the image'); return; }
    busy(null);
    const file = new File([res.blob], fileName(c), { type: res.blob.type });
    // Desktop and Android save straight to Downloads; iOS goes through the share sheet.
    if (!wallpaper && !isIos) { download(res.blob, file.name); toast(isAndroid() ? 'Saved to Downloads' : 'Image saved'); return; }
    imageReady(file, res, wallpaper);
  }

  function imageReady(file, res, wallpaper) {
    const url = URL.createObjectURL(file);
    const share = canShareFile(file);
    const saveBtn = isIos && share
      ? primary('Save to Photos', async () => { const r = await shareFile(file); if (r === 'failed') download(file, file.name); })
      : primary('Save image', () => { download(file, file.name); toast(isAndroid() ? 'Saved to Downloads' : 'Image saved'); }, { icon: I.download });
    openSheet([
      h('h2', { class: 'sheet-title' }, wallpaper ? 'Set as wallpaper' : 'Image ready'),
      h('div', { class: 'ready' }, h('img', { src: url, alt: 'Rendered wallpaper', class: 'ready-img' }),
        h('div', { class: 'ready-info' }, h('p', { class: 'mono-small' }, `${res.w} × ${res.h} PX · ${file.type === 'image/png' ? 'PNG' : 'JPG'} · ${(file.size / 1048576).toFixed(1)} MB`),
          wallpaper ? h('ol', { class: 'steps' }, wallpaperSteps().map((t) => h('li', {}, t))) : h('p', { class: 'body muted' }, isIos ? 'Tap Save to Photos, then choose “Save Image”. You can also press and hold the picture.' : ''))),
      saveBtn,
      share && !isIos ? outline('Share…', () => shareFile(file), { icon: I.share }) : null,
      isIos && share ? outline('Save to Files', () => download(file, file.name), { icon: I.download }) : null,
    ], { label: wallpaper ? 'Set as wallpaper' : 'Image ready', onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000) });
  }

  const isAndroid = () => /android/i.test(navigator.userAgent);

  const unsub = subscribe((k) => {
    if (k === 'draft' || k === 'photo') refresh();
    else if (k === 'sel' && editApi) refresh();
    else if (k === 'undo') paintHistory();
  });
  // Settings changed (here or in another place): the layout switch, the guides.
  const unsubSettings = onSettings(() => {
    if ((tab === 0) && !!editApi !== cardMode()) setTab(0, true);
    else refresh();
    if (tab >= 2) wall.sync();
  });
  paintTabsHidden();
  paintHistory();
  setTab(tab, true);
  return {
    el,
    refresh,
    /** Ctrl/⌘ + 1–4 switch tabs, S saves the image, Z undoes, Shift+Z or Y redoes. */
    shortcut(key) {
      if (key === 'z' || key === 'Z' || key === 'y') return (key === 'z' ? undo() : redo()) || true;
      if (key >= '1' && key <= '4') { setTab(+key - 1); return true; }
      if (key === 's') { saveImage(false); return true; }
      return false;
    },
    destroy() { exiting = true; clearHistory(); unsub(); unsubSettings(); paneApi?.destroy?.(); editApi?.destroy(); card.dispose(); wall.dispose(); },
  };
}

/** Swipe a row sideways (touch) past 40% of its width to remove it. */
function swipeToRemove(item, onRemove) {
  const fg = item.querySelector('.row-fg');
  let x0 = null, y0 = 0, dx = 0, active = false;
  fg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('.drag-handle')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; active = false;
  });
  fg.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!active) {
      if (Math.abs(my) > 10) { x0 = null; return; }
      if (Math.abs(mx) > 12) { active = true; fg.setPointerCapture(e.pointerId); item.classList.add('swiping'); }
    }
    if (active) { dx = mx; fg.style.transform = `translateX(${dx}px)`; }
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    item.classList.remove('swiping');
    if (active && Math.abs(dx) > item.offsetWidth * 0.4) {
      fg.style.transition = 'transform .18s ease-in'; fg.style.transform = `translateX(${Math.sign(dx) * item.offsetWidth}px)`;
      setTimeout(onRemove, 160);
    } else { fg.style.transform = ''; }
    if (active) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; fg.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => fg.removeEventListener('click', stop, { capture: true }), 50); }
    active = false;
  };
  fg.addEventListener('pointerup', end); fg.addEventListener('pointercancel', end);
}
