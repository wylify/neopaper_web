// Card builder: Card / Style / Backdrop / Export tabs over a live preview (ui/BuilderScreen.kt).
import { h, icon, I, iconButton, primary, outline, sectionLabel, tag, hint, segmented, chipGroup, switchRow, slider, textField, toast, busy, nextPaint } from './ui.js';
import { S, draft, edit, subscribe, removeRow, undoRemove, moveRow, setPhotoBlob, flush } from './state.js';
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

  // ── Top bar + tabs ──
  const titleEl = h('p', { class: 'bar-title' });
  const tabBtns = TABS.map((t, i) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(i === tab), onclick: () => setTab(i) }, t));
  const tabRow = h('div', { class: 'tabs', role: 'tablist' }, tabBtns, h('i', { class: 'tab-ink' }));

  // ── Stage ──
  const liveEl = h('span', { class: 'stage-note left mono-small' });
  const fitEl = h('span', { class: 'stage-note right mono-small' });
  const card = cardCanvas(draft, (info) => { fit = info; paintFit(); }, 'stage-card');
  const wall = wallpaperCanvas(draft, () => S.photo, () => (tab === 3 ? targetSize(draft()) : dev), 'stage-wall');
  const stage = h('div', { class: 'stage dots builder-stage' }, h('div', { class: 'stage-inner' }, card, wall), liveEl, fitEl);

  const pane = h('div', { class: 'pane', role: 'tabpanel' });
  const actions = h('div', { class: 'action-bar' });

  const el = h('main', { class: 'screen builder' },
    h('header', { class: 'topbar' }, iconButton(I.back, 'Back to your cards', () => nav.back()),
      h('div', { class: 'grow bar-text' }, titleEl, h('p', { class: 'mono-small' }, 'DRAFT · AUTOSAVED')),
      iconButton(I.eye, 'Preview wallpaper full screen', () => fullPreview())),
    tabRow,
    h('div', { class: 'builder-body' }, stage, h('div', { class: 'builder-side' }, pane, actions)));

  function paintFit() {
    if (!fit.total) { fitEl.textContent = ''; return; }
    const all = fit.shown === fit.total;
    fitEl.textContent = all ? `${fit.shown} ROWS FIT` : `${fit.shown}/${fit.total} ROWS FIT`;
    fitEl.classList.toggle('bad', !all);
  }

  let paneApi = null;
  function setTab(i) {
    const dir = i > tab ? 1 : -1;
    tab = i; S.builderTab = i;
    tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    tabRow.style.setProperty('--tab', i);
    stage.classList.toggle('wall-mode', i >= 2);
    paneApi?.destroy?.();
    paneApi = [cardTab, styleTab, backdropTab, exportTab][i]();
    pane.replaceChildren(paneApi.el);
    pane.scrollTop = 0;
    pane.animate?.([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)' });
    renderActions();
    refresh();
  }

  function renderActions() {
    const add = () => openAddRow(false);
    if (tab === 0) actions.replaceChildren(outline('Add row', add, { icon: I.plus }), primary('Next: Style', () => setTab(1), { icon: I.next }));
    else if (tab === 3) actions.replaceChildren(outline('Save image', () => saveImage(false), { icon: I.download }), primary('Set as wallpaper', () => saveImage(true), { class: 'wide' }));
    else actions.replaceChildren(outline('Back', () => setTab(tab - 1)), primary(`Next: ${TABS[tab + 1]}`, () => setTab(tab + 1), { class: 'wide' }));
  }

  function refresh() {
    const c = draft();
    if (!c) return;
    titleEl.textContent = c.code.trim() || 'Untitled';
    liveEl.textContent = tab < 2 ? `LIVE · ${ratioLabel(c.ratio)}` : tab === 3 ? `${targetSize(c).join(' × ')}` : 'THIS DEVICE';
    if (tab < 2) { card.sync(); fitEl.hidden = false; } else { wall.sync(); fitEl.hidden = true; }
    paneApi?.update?.(c);
  }

  // ═══ Card tab ═══════════════════════════════════════════════════════════════════════

  function cardTab() {
    const req = h('div', { class: 'req-row' });
    const head = h('div', { class: 'row-list' });
    const body = h('div', { class: 'row-list' });
    const el = h('div', { class: 'tab-card' },
      h('div', { class: 'label-row' }, sectionLabel('Required'), icon(I.lock, { size: 14, color: 'var(--muted)' })), req,
      h('div', { class: 'label-row' }, sectionLabel('Header · beside QR'), h('button', { type: 'button', class: 'text-btn lime', onclick: () => openAddRow(true) }, 'Add filler')), head,
      h('div', { class: 'label-row' }, sectionLabel('Rows · top to bottom'), h('span', { class: 'mono-small' }, isMobile ? 'DRAG ⠿ · SWIPE ✕' : 'DRAG ⠿ TO SORT')), body);

    let sig = '';
    const reqTile = (label, value) => h('button', { type: 'button', class: 'req-tile', onclick: () => nav.openCodes(), 'aria-label': `Edit ${label}` },
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
          navigator.vibrate?.(15);
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
        navigator.vibrate?.(5);
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
      req.replaceChildren(reqTile('CODE', c.code.trim() || '—'), reqTile(`QR · ${c.qrRight ? 'RIGHT' : 'LEFT'}`, qrSummary(c.qr)), reqTile('BARCODE', c.barcodeLink.trim() || '—'));
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

    function pickBg() {
      const x = draft();
      colorPickerDialog('Backdrop colour', x.bgColor, x.labelColor, BACKDROP_TARGET, suggestBackdrop(x.labelColor), (v) => edit((y) => ({ ...y, bgColor: v, bgMode: 'COLOR' })));
    }

    const el = h('div', { class: 'stack' }, mode, colorBox, photoBox, sectionLabel('Overlay', 'mt'), overlays,
      sectionLabel('Placement', 'mt'), size, nudge, tilt, crop);

    let thumbFor = null;
    function update(x) {
      mode.set(x.bgMode);
      colorBox.hidden = x.bgMode !== 'COLOR'; photoBox.hidden = x.bgMode !== 'PHOTO';
      swatches.querySelectorAll('.bg-swatch').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.c === x.bgColor)));
      well.set(x.bgColor);
      sugg.update(suggestBackdrop(x.labelColor), x.bgColor, x.labelColor);
      overlays.querySelectorAll('.overlay-tile').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.o === x.overlay)));
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
    const out = h('span', { class: 'mono-small' }), cardOut = h('span', { class: 'mono-small' }), bar = h('span', { class: 'mono-small' });
    const capNote = h('p', { class: 'note', hidden: true });
    const line = (k, v) => h('div', { class: 'readout-line' }, h('span', { class: 'mono-small muted grow' }, k), v);
    const el = h('div', { class: 'stack' }, sectionLabel('Size'), list, custom,
      sectionLabel('Quality · saved image', 'mt'), h('div', { class: 'row' }, scale, fmt),
      h('div', { class: 'panel-box' }, line('OUTPUT', out), line('CARD', cardOut), line('BARCODE BAR', bar), capNote,
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
      capNote.hidden = !o.capped;
      capNote.textContent = `Scaled down to ${(MAX_PIXELS / 1e6).toFixed(0)} MP, the most this browser can draw in one image.`;
    }
    update(c);
    return { el, update };
  }

  // ── Sheets ──

  function openAddRow(header) { nav.openAddRow(header); }

  function fullPreview() {
    const cv = wallpaperCanvas(draft, () => S.photo, () => dev, 'full-wall');
    const s = openSheet([cv], { label: 'Wallpaper preview', dialog: true, onClose: () => cv.dispose() });
    s.el.classList.add('fullscreen');
    s.el.parentElement.classList.add('black');
    s.el.addEventListener('click', () => s.close());
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

  const unsub = subscribe((k) => { if (k === 'draft' || k === 'photo') refresh(); });
  setTab(tab);
  return {
    el,
    refresh,
    destroy() { unsub(); paneApi?.destroy?.(); card.dispose(); wall.dispose(); },
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
