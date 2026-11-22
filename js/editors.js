// Add-row sheet, row editor and the code / QR / barcode screen (ui/Editors.kt, ui/QrEditor.kt).
import { h, icon, I, iconButton, primary, outline, sectionLabel, segmented, chip, chipGroup, slider, textField, toast } from './ui.js';
import { draft, edit, addRow, updateRow, removeRow, undoRemove, findRow } from './state.js';
import {
  ROW_KINDS, INFO_KINDS, FILLER_KINDS, FIELD_ICONS, SYMBOLS, SUB_GRAPHICS, SUB_WIDTH, SUB_REPEAT, QR_TYPES, NP_KEYS, NP_GROUPS,
  isField, isPattern, rowHeight, makeRow, npField, payload, css,
} from './model.js';
import { normalize, collides, encodeNp1 } from './np1.js';
import { bits, RECOMMENDED_VERSION, MAX_VERSION, ECC_NAME } from './capacity.js';
import { cardCodes } from './codes.js';
import { drawCard } from './render.js';
import { canvasView } from './ui.js';
import { openSheet } from './sheet.js';
import { rowPreview, rowSwatch } from './previews.js';
import { rowIconPath } from './builder.js';

// ═══ Add a row ═══════════════════════════════════════════════════════════════════════════

export function addRowSheet(initialHeader, onPicked) {
  const cfg = draft();
  let header = initialHeader, filter = initialHeader ? 2 : 0;
  const content = h('div', { class: 'stack' });
  let s;
  const pick = async (kind, inHeader) => {
    const row = addRow(kind, inHeader);
    await s.close();
    onPicked(kind, row, inHeader);
  };
  function render() {
    const kids = [
      h('h2', { class: 'sheet-title' }, 'Add a row'),
      segmented([false, true], header, (v) => (v ? 'Header, beside QR' : 'Card body'), (v) => { header = v; if (v) filter = 2; render(); }),
      chipGroup([0, 1, 2], filter, (i) => ['All', 'Info', 'Filler'][i], (i) => { filter = i; render(); }),
    ];
    if (filter !== 2) {
      kids.push(sectionLabel('Info', 'mt'));
      if (header) kids.push(h('p', { class: 'body muted' }, 'Only filler visuals fit beside the QR.'));
      kids.push(h('div', { class: 'pick-grid' }, INFO_KINDS.map((k) => {
        const enabled = !header || ROW_KINDS[k].filler;
        return h('button', { type: 'button', class: 'pick-tile', disabled: !enabled, onclick: () => pick(k, header), 'aria-label': `Add ${ROW_KINDS[k].title}` },
          icon(rowIconPath(makeRow(k)), { size: 20, color: 'var(--orange)' }), h('span', {}, ROW_KINDS[k].title));
      })));
      kids.push(h('button', { type: 'button', class: 'custom-tile', disabled: header, onclick: () => pick('custom', false) },
        icon(I.plus, { size: 22, color: 'var(--orange)', stroke: 2.2 }),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Custom field'), h('span', { class: 'body muted' }, 'Pick an icon, write a label and a value'))));
    }
    if (filter !== 1) {
      kids.push(sectionLabel('Filler visuals', 'mt'));
      kids.push(h('div', { class: 'pick-grid' }, FILLER_KINDS.map((k) => h('button', { type: 'button', class: 'pick-tile filler', onclick: () => pick(k, header), 'aria-label': `Add ${ROW_KINDS[k].title}` },
        h('span', { class: 'filler-strip', style: { background: css(cfg.labelColor) } }, rowSwatch(cfg, { ...makeRow(k), id: 0 }, cfg.ink)),
        h('span', {}, ROW_KINDS[k].title)))));
    }
    content.querySelectorAll('canvas').forEach((c) => c.dispose?.());
    content.replaceChildren(...kids);
  }
  render();
  s = openSheet(content, { label: 'Add a row' });
  return s;
}

// ═══ Row editor ══════════════════════════════════════════════════════════════════════════

export function rowEditorScreen(rowId, header, nav) {
  const cfg = draft();
  const original = cfg && findRow(cfg, rowId);
  if (!original) { queueMicrotask(() => nav.back()); return { el: h('main', { class: 'screen' }), destroy() {} }; }
  let row = structuredClone(original);
  const title = row.kind === 'custom' ? 'Custom field' : ROW_KINDS[row.kind].title;

  const preview = rowPreview(draft, () => row);
  const fields = h('div', { class: 'stack' });
  const set = (r) => { row = r; preview.sync(); };

  if (isField(row.kind)) {
    fields.append(
      textField('Label', row.label, (v) => set({ ...row, label: v.toUpperCase() }), { mono: true, max: 10, caps: true, supporting: 'Shown in small caps' }),
      textField('Value', row.value, (v) => set({ ...row, value: v }), { max: 32, supporting: 'Longer text is cut with …', autocapitalize: 'words' }));
    if (row.kind === 'custom') {
      const grid = h('div', { class: 'icon-grid', role: 'radiogroup' }, Object.keys(FIELD_ICONS).map((k) => h('button', {
        type: 'button', role: 'radio', class: 'icon-tile', 'aria-checked': String(row.icon === k), 'aria-label': `Icon ${k}`,
        onclick: () => { set({ ...row, icon: k }); grid.querySelectorAll('.icon-tile').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.k === k))); }, 'data-k': k,
      }, icon(FIELD_ICONS[k], { size: 22 }), h('span', { class: 'mono-small' }, k))));
      fields.append(sectionLabel('Icon', 'mt'), grid);
    }
  } else if (row.kind === 'checks') {
    const opts = h('div', { class: 'stack tight' });
    const renderOpts = () => {
      opts.replaceChildren(...row.checks.map((c, i) => h('div', { class: 'check-row' },
        h('button', { type: 'button', class: 'checkbox', role: 'checkbox', 'aria-checked': String(c.checked), 'aria-label': `Option ${i + 1} checked`,
          onclick: () => { set({ ...row, checks: row.checks.map((o, j) => (j === i ? { ...o, checked: !o.checked } : o)) }); renderOpts(); } }, icon(I.check, { size: 16, stroke: 3 })),
        textField(`Option ${i + 1}`, c.label, (t) => set({ ...row, checks: row.checks.map((o, j) => (j === i ? { ...o, label: t.toUpperCase() } : o)) }), { mono: true, max: 10, caps: true, class: 'grow' }),
        iconButton(I.close, 'Remove option', () => { set({ ...row, checks: row.checks.filter((_, j) => j !== i) }); renderOpts(); }))),
      row.checks.length < 4 ? h('button', { type: 'button', class: 'text-btn lime', onclick: () => { set({ ...row, checks: [...row.checks, { label: 'OPTION', checked: false }] }); renderOpts(); } }, icon(I.plus, { size: 18 }), ' Add option') : null);
    };
    renderOpts();
    fields.append(sectionLabel('Options'), opts);
  } else if (row.kind === 'warning') {
    fields.append(textField('Warning text', row.value, (v) => set({ ...row, value: v.toUpperCase() }), { mono: true, max: 18, caps: true }));
  }

  // Height in card units; the default is stored as null so a future default change still applies.
  const k = ROW_KINDS[row.kind];
  const resetBtn = h('button', { type: 'button', class: 'text-btn lime', hidden: row.height == null, onclick: () => { set({ ...row, height: null }); hs.set(rowHeight(row)); resetBtn.hidden = true; } }, 'Reset');
  const hs = slider('Height', rowHeight(row), k.min, k.max, 1, (v) => `${v} PX`, (v) => { const n = Math.round(v); set({ ...row, height: n === k.def ? null : n }); resetBtn.hidden = row.height == null; });
  fields.append(hs, h('div', { class: 'inline' }, h('p', { class: 'body muted grow' }, 'Taller rows push later rows down; rows that no longer fit are hidden.'), resetBtn));

  const save = () => { updateRow(row); nav.back(); };
  const el = h('main', { class: 'screen editor' },
    h('header', { class: 'topbar' }, iconButton(I.close, 'Discard and close', () => nav.back()), h('h1', { class: 'bar-title grow' }, title),
      h('button', { type: 'button', class: 'save-btn', onclick: save }, 'Save')),
    h('div', { class: 'scroll' }, h('div', { class: 'stage dots row-stage' }, preview, h('p', { class: 'mono-small' }, 'ROW PREVIEW')), fields,
      h('button', { type: 'button', class: 'text-btn danger center', onclick: async () => { await nav.back(); removeRow(row.id); toast('Row removed', { label: 'Undo', run: undoRemove }); } },
        icon(I.trash, { size: 20 }), ' Delete row')));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
  return { el, destroy() { preview.dispose(); } };
}

// ═══ Code, QR & barcode ══════════════════════════════════════════════════════════════════

export function codesScreen(nav) {
  const c0 = draft();
  // Live crop of the card's header, pinned so subline tweaks stay visible while scrolling.
  const head = canvasView((ctx, w) => { const c = draft(); if (c) drawCard(ctx, c, cardCodes(payload(c.qr), c.barcodeLink), 0, 0, w); }, 'head-canvas', 'Card header preview');
  const meta = h('p', { class: 'mono-small' });

  // Card
  const code = textField('Card code', c0.code, (v) => edit((x) => ({ ...x, code: v.toUpperCase() })), { mono: true, max: 8, caps: true, supporting: 'Required · e.g. KK-01, NX-07' });
  const sub = textField('Subline (optional)', c0.subText, (v) => edit((x) => ({ ...x, subText: v.toUpperCase() })), { mono: true, max: 24, caps: true });
  const graphic = chipGroup(Object.keys(SUB_GRAPHICS), c0.subGraphic, (g) => SUB_GRAPHICS[g], (g) => { edit((x) => ({ ...x, subGraphic: g })); syncGraphic(); });
  const widthSl = slider('Width', c0.subWidth, SUB_WIDTH[0], SUB_WIDTH[1], 1, (v) => `${v} U`, (v) => edit((x) => ({ ...x, subWidth: Math.round(v) })));
  const subSym = symbolPicker(c0.subSymbol, (s) => edit((x) => ({ ...x, subSymbol: s })));
  const repeat = slider('Repeat', c0.subRepeat, SUB_REPEAT[0], SUB_REPEAT[1], 1, (v) => `×${v}`, (v) => edit((x) => ({ ...x, subRepeat: Math.round(v) })));
  const graphicCtl = h('div', { class: 'stack' });
  function syncGraphic() {
    const g = draft().subGraphic;
    graphicCtl.replaceChildren(...(isPattern(g) ? [widthSl] : g === 'SYMBOL' ? [subSym, repeat] : []));
  }
  syncGraphic();

  // QR
  const qrType = segmented(Object.keys(QR_TYPES), c0.qr.type, (t) => QR_TYPES[t], (t) => { edit((x) => ({ ...x, qr: { ...x.qr, type: t } })); renderQrEditor(); });
  const qrEditor = h('div', { class: 'stack' });
  const qrField = (key, label, opts) => textField(label, draft().qr[key], (v) => edit((x) => ({ ...x, qr: { ...x.qr, [key]: v } })), opts);
  function renderQrEditor() {
    const t = draft().qr.type;
    if (t === 'FIELDS') qrEditor.replaceChildren(fieldsEditor());
    else if (t === 'CONTACT') qrEditor.replaceChildren(qrField('name', 'Name', { max: 40, autocapitalize: 'words', autocomplete: 'name' }),
      qrField('phone', 'Phone', { max: 24, type: 'tel', inputmode: 'tel' }), qrField('email', 'Email', { max: 48, type: 'email', inputmode: 'email' }));
    else if (t === 'LINK') qrEditor.replaceChildren(qrField('link', 'Link', { mono: true, max: 120, type: 'url', inputmode: 'url' }));
    else qrEditor.replaceChildren(qrField('text', 'Text', { max: 200, multiline: true, autocapitalize: 'sentences' }));
  }
  const capacity = capacityPanel();
  const qrPos = segmented([false, true], c0.qrRight, (v) => (v ? 'Right' : 'Left'), (v) => edit((x) => ({ ...x, qrRight: v })));

  // Barcode
  const meter = h('div', { class: 'meter' }, h('i'));
  const longNote = h('p', { class: 'note warn', hidden: true }, 'Over 24 characters: bars get thin and may not scan from a screen.');
  const link = textField('Reader app link', c0.barcodeLink, (v) => edit((x) => ({ ...x, barcodeLink: v })), { mono: true, max: 40, supporting: 'Shorter links make wider bars', type: 'url', inputmode: 'url' });
  const caption = textField('Caption', c0.barcodeCaption, (v) => edit((x) => ({ ...x, barcodeCaption: v.toUpperCase() })), { mono: true, max: 16, caps: true });
  const capSym = symbolPicker(c0.symbol, (s) => edit((x) => ({ ...x, symbol: s })));

  const el = h('main', { class: 'screen codes' },
    h('header', { class: 'topbar' }, iconButton(I.back, 'Back to builder', () => nav.back()), h('h1', { class: 'bar-title grow' }, 'Code, QR & barcode')),
    h('div', { class: 'head-box' }, head),
    h('div', { class: 'scroll' }, meta,
      sectionLabel('Card', 'orange mt'), code, sub, sectionLabel('Subline graphic'), graphic, graphicCtl,
      sectionLabel('QR code · required', 'orange mt'), qrType, qrEditor, capacity, h('div', { class: 'inline' }, h('span', { class: 'title grow' }, 'Position'), qrPos),
      sectionLabel('Barcode · required · always at the bottom', 'orange mt'), link, meter, longNote, caption, sectionLabel('Caption symbol'), capSym),
    h('div', { class: 'action-bar single' }, primary('Done', () => nav.back())));
  head.style.aspectRatio = '2.9';

  function update(c) {
    head.invalidate();
    const codes = cardCodes(payload(c.qr), c.barcodeLink);
    const kind = c.qr.type === 'CONTACT' ? 'VCARD' : c.qr.type === 'FIELDS' ? 'NP1' : c.qr.type;
    meta.textContent = `${kind} · ${codes.qrBytes} B · V${codes.qrVersion} · ECC ${codes.qrEcc}`;
    capacity.update(c, codes.plan);
    const len = c.barcodeLink.length;
    meter.firstChild.style.width = `${Math.min(1, len / 24) * 100}%`;
    meter.classList.toggle('over', len > 24);
    longNote.hidden = len <= 24;
    fieldsApi?.update(c);
  }

  // ── NP1 field list ──
  let fieldsApi = null;
  function fieldsEditor() {
    const wrap = h('div', { class: 'stack tight' });
    const list = h('div', { class: 'field-list' });
    const empty = h('p', { class: 'body muted' }, 'No fields yet. Add only what you want people to see.');
    const sortHint = h('p', { class: 'mono-small' }, 'DRAG ⠿ TO SORT · ORDER IN THE CODE FOLLOWS THE LIST');
    const items = new Map(); // id → { el, input field }
    let order = '', fdrag = null;
    // Rows differ in height (multi-line address), so swap once past half the neighbour.
    list.addEventListener('pointermove', (ev) => {
      if (!fdrag || ev.pointerId !== fdrag.pointerId) return;
      let off = ev.clientY - fdrag.start;
      const mov = draft().qr.fields.filter((x) => x.key !== 'TXT'), at = mov.findIndex((x) => x.id === fdrag.id);
      const next = mov[at + 1], prev = mov[at - 1];
      const nh = next && items.get(next.id)?.el.offsetHeight, ph = prev && items.get(prev.id)?.el.offsetHeight;
      if (next && off > nh / 2) { swap(fdrag.id, next.id); fdrag.start += nh; off -= nh; }
      else if (prev && off < -ph / 2) { swap(fdrag.id, prev.id); fdrag.start -= ph; off += ph; }
      const it = items.get(fdrag.id)?.el;
      if (it) { it.classList.add('dragging'); it.style.transform = `translateY(${off}px)`; }
    });
    const endFieldDrag = () => {
      if (!fdrag) return;
      const it = items.get(fdrag.id)?.el; fdrag = null;
      if (it) { it.classList.remove('dragging'); it.style.transform = ''; }
    };
    list.addEventListener('pointerup', endFieldDrag); list.addEventListener('pointercancel', endFieldDrag); list.addEventListener('lostpointercapture', endFieldDrag);

    const editFields = (f) => edit((x) => ({ ...x, qr: { ...x.qr, fields: f(x.qr.fields) } }));
    const swap = (a, b) => editFields((l) => {
      const i = l.findIndex((x) => x.id === a), j = l.findIndex((x) => x.id === b);
      if (i < 0 || j < 0) return l;
      const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });

    function item(f) {
      const k = NP_KEYS[f.key];
      const isTxt = f.key === 'TXT';
      const tf = textField(`${k.title} · ${k.code}`, f.value, (v) => editFields((l) => l.map((x) => (x.id === f.id ? { ...x, value: v } : x))), {
        mono: k.input === 'url' || k.group === 'SOCIAL', max: k.max, multiline: k.input === 'multiline', class: 'grow',
        type: k.input === 'email' ? 'email' : k.input === 'phone' ? 'tel' : k.input === 'url' ? 'url' : 'text',
        inputmode: { phone: 'tel', email: 'email', url: 'url', number: 'numeric' }[k.input],
        autocapitalize: k.input === 'text' || k.input === 'multiline' ? (k.keepCase ? 'sentences' : 'words') : 'off',
      });
      const handle = isTxt
        ? h('span', { class: 'drag-handle pinned', title: `${k.title} always goes last` }, icon(I.lock, { size: 16, color: 'var(--outline)', label: `${k.title} always goes last` }))
        : h('button', { type: 'button', class: 'drag-handle', 'aria-label': `Reorder ${k.title}. Use arrow keys to move.` }, icon(I.drag, { size: 20, color: 'var(--muted)' }));
      const el = h('div', { class: 'field-item', 'data-id': String(f.id) }, handle, tf,
        iconButton(I.trash, `Remove ${k.title}`, () => editFields((l) => l.filter((x) => x.id !== f.id)), { class: 'muted' }));
      if (!isTxt) {
        handle.addEventListener('keydown', (e) => {
          const mov = draft().qr.fields.filter((x) => x.key !== 'TXT'), at = mov.findIndex((x) => x.id === f.id);
          const other = e.key === 'ArrowUp' ? mov[at - 1] : e.key === 'ArrowDown' ? mov[at + 1] : null;
          if (other) { e.preventDefault(); swap(f.id, other.id); requestAnimationFrame(() => handle.focus()); }
        });
        handle.addEventListener('pointerdown', (e) => {
          if (e.button) return;
          e.preventDefault();
          // Capture on the list: reordering moves item nodes, which would drop a capture on them.
          fdrag = { id: f.id, start: e.clientY, pointerId: e.pointerId };
          list.setPointerCapture(e.pointerId);
          el.classList.add('dragging');
        });
      }
      return { el, tf };
    }

    function update(c) {
      const fields = c.qr.fields;
      // TXT is encoded last whatever its position, so it stays pinned at the bottom.
      const ordered = [...fields.filter((f) => f.key !== 'TXT'), ...fields.filter((f) => f.key === 'TXT')];
      const ids = ordered.map((f) => f.id).join(',');
      for (const id of [...items.keys()]) if (!fields.some((f) => f.id === id)) { items.get(id).el.remove(); items.delete(id); }
      for (const f of ordered) if (!items.has(f.id)) items.set(f.id, item(f));
      if (ids !== order) {
        order = ids;
        // Re-append in order (the drag's capture sits on the list, so moving nodes is safe).
        ordered.forEach((f) => list.append(items.get(f.id).el));
      }
      for (const f of ordered) {
        const { tf } = items.get(f.id);
        // Values changed elsewhere (e.g. "Make CAPS") show up, but never under the user's cursor.
        if (document.activeElement !== tf.input) tf.setValue(f.value);
        const written = normalize(f.key, f.value);
        if (collides(f.key, f.value)) tf.setSupporting('Contains " KEY:" — the app would split it here. Reword it.', true);
        else if (!written) tf.setSupporting('Empty — left out of the code');
        else tf.setSupporting(`→ ${f.key}:` + (written.length > 36 ? written.slice(0, 36) + '…' : written));
      }
      empty.hidden = fields.length > 0;
      sortHint.hidden = fields.filter((f) => f.key !== 'TXT').length < 2;
    }

    wrap.append(empty, sortHint, list, outline('Add field', () => addFieldSheet(draft().qr.fields, (k) => editFields((l) => [...l, npField(k)])), { icon: I.plus }));
    fieldsApi = { update };
    update(draft());
    return wrap;
  }

  renderQrEditor();
  update(c0);
  return { el, update, destroy() { head.dispose(); } };
}

function symbolPicker(selected, onPick) {
  const el = h('div', { class: 'symbol-row', role: 'radiogroup' }, Object.keys(SYMBOLS).map((s) => h('button', {
    type: 'button', role: 'radio', class: 'symbol', 'data-s': s, 'aria-checked': String(s === selected), 'aria-label': `Symbol ${s}`,
    onclick: () => { el.querySelectorAll('.symbol').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.s === s))); onPick(s); },
  }, icon(SYMBOLS[s], { size: 20, filled: true }))));
  return el;
}

function addFieldSheet(current, onPick) {
  const used = new Set(current.map((f) => f.key));
  let s;
  const groups = Object.entries(NP_GROUPS).map(([g, title]) => {
    const keys = Object.values(NP_KEYS).filter((k) => k.group === g && (k.repeat || !used.has(k.code)));
    if (!keys.length) return null;
    return [sectionLabel(title, 'mt'), h('div', { class: 'chips wrap' }, keys.map((k) => chip(`${k.title}  ${k.code}`, false, async () => { await s.close(); onPick(k.code); })))];
  });
  s = openSheet([h('h2', { class: 'sheet-title' }, 'Add to QR'),
    h('p', { class: 'body muted' }, 'Short keys keep the code small and still read clearly in any scanner app.'), groups], { label: 'Add to QR' });
}

/** Live size readout for any QR type, with warnings when the code gets too dense. */
function capacityPanel() {
  const sizeEl = h('span', { class: 'mono-small' });
  const bar = h('div', { class: 'meter thick' }, h('i'));
  const more = h('p', { class: 'body' });
  const warns = h('div', { class: 'stack tight' });
  const capsRow = h('div', { class: 'inline' });
  const raw = h('pre', { class: 'raw mono-small' });
  const el = h('div', { class: 'panel-box' }, h('div', { class: 'inline' }, h('span', { class: 'mono-small muted grow' }, 'QR SIZE'), sizeEl), bar, more, warns, capsRow,
    sectionLabel('What any scanner shows', 'mt'), raw);
  el.update = (c, pl) => {
    const cls = pl.status === 'OK' ? 'lime' : pl.status === 'TOO_LONG' ? 'error' : 'orange';
    el.dataset.status = cls;
    sizeEl.textContent = `V${pl.version} · ${pl.modules}×${pl.modules} · ECC ${ECC_NAME[pl.ecc]}`;
    sizeEl.className = 'mono-small ' + cls;
    bar.firstChild.style.width = `${Math.min(1, pl.fill) * 100}%`;
    bar.className = 'meter thick ' + cls;
    more.textContent = pl.freeBits > 0 ? `≈ ${pl.moreCaps} more CAPS characters · or ≈ ${pl.moreOther} lowercase/other` : 'No room left in a comfortable-size code';
    const w = [];
    if (pl.status === 'TOO_LONG') w.push([`Too much for one QR on a wallpaper (V${pl.version}, limit V${MAX_VERSION}). Remove or shorten fields.`, 'error']);
    else if (pl.status === 'DENSE') w.push([`Past the comfortable size (V${RECOMMENDED_VERSION}). It still encodes, but small modules may not scan off a screen.`, 'orange']);
    else if (pl.status === 'NEAR') w.push(['Close to the limit — keep additions short.', 'orange']);
    if (c.qr.type === 'FIELDS') {
      const keys = c.qr.fields.filter((f) => f.value.trim()).map((f) => f.key);
      if (keys.includes('PW')) w.push(['Anyone who scans can read the password. Use it for guest Wi-Fi, not accounts.', 'orange']);
      if (c.qr.fields.filter((f) => f.key === 'TXT').length > 1) w.push(['Only the first free text is encoded.', 'orange']);
      if (c.qr.fields.some((f) => collides(f.key, f.value))) w.push(['A field contains " KEY:" text that would split it when read back.', 'error']);
    }
    warns.replaceChildren(...w.map(([t, k]) => h('p', { class: 'body ' + k }, t)));
    // Uppercasing free text is the biggest single win; offer it when it helps.
    capsRow.replaceChildren();
    const txt = c.qr.fields.find((f) => f.key === 'TXT');
    if (c.qr.type === 'FIELDS' && txt && txt.value !== txt.value.toUpperCase()) {
      const p = payload(c.qr);
      const up = encodeNp1(c.qr.fields.map((f) => (f.id === txt.id ? { ...f, value: f.value.toUpperCase() } : f)));
      const saved = Math.floor((bits(p, RECOMMENDED_VERSION) - bits(up, RECOMMENDED_VERSION)) / 5.5);
      if (saved > 0) capsRow.append(h('p', { class: 'body muted grow' }, `Free text in CAPS frees ≈ ${saved} characters.`),
        chip('Make CAPS', false, () => edit((x) => ({ ...x, qr: { ...x.qr, fields: x.qr.fields.map((f) => (f.id === txt.id ? { ...f, value: f.value.toUpperCase() } : f)) } }))));
    }
    raw.textContent = payload(c.qr) || '—';
  };
  return el;
}

