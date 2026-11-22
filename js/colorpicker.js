// Colour wells, suggested swatches and the HSV picker dialog (ui/ColorPicker.kt).
import { h, icon, I, sectionLabel, textField } from './ui.js';
import { css, hex6 } from './model.js';
import { toHsv, fromHsv, contrast, luminance } from './colors.js';
import { openSheet } from './sheet.js';

/** Row of auto-suggested swatches; tapping one applies it. Returns el with .update(colors, selected). */
export function suggestedSwatches(label, colors, selected, against, onPick) {
  const row = h('div', { class: 'swatch-row' });
  const el = h('div', { class: 'suggest' }, sectionLabel(label), row);
  el.update = (cs, sel, ag) => {
    row.replaceChildren(...cs.map((c) => {
      const isSel = c === sel;
      return h('button', { type: 'button', class: 'suggest-swatch', 'aria-pressed': String(isSel), 'aria-label': `Suggested colour #${hex6(c)}`, onclick: () => onPick(c) },
        h('span', { class: 'chip-color', style: { background: css(c) } }, isSel ? icon(I.check, { size: 16, stroke: 3, color: luminance(c) > 0.4 ? 'var(--on-accent)' : 'var(--lime)' }) : null),
        h('span', { class: 'mono-small' }, `${contrast(c, ag).toFixed(1)}:1`));
    }));
  };
  el.update(colors, selected, against);
  return el;
}

/** Big swatch button that opens the picker. Returns el with .set(color). */
export function colorWell(label, color, onClick) {
  const sw = h('span', { class: 'well-swatch' });
  const code = h('span', { class: 'mono-small' });
  const el = h('button', { type: 'button', class: 'well', onclick: onClick, 'aria-label': `Pick ${label.toLowerCase()} colour` }, sw,
    h('span', { class: 'well-text' }, h('span', { class: 'title' }, label), code));
  el.set = (c) => { sw.style.background = css(c); code.textContent = '#' + hex6(c); };
  el.set(color);
  return el;
}

/**
 * Visual HSV picker: saturation/value square, hue strip and hex field, with contrast against
 * [against] and contrast-safe [suggestions]. onApply(color) on Apply.
 */
export function colorPickerDialog(title, initial, against, target, suggestions, onApply) {
  let [hh, s, v] = toHsv(initial);
  const current = () => fromHsv(hh, s, v);

  const sv = h('div', { class: 'sv-box', role: 'slider', tabindex: '0', 'aria-label': 'Saturation and brightness' }, h('i', { class: 'sv-knob' }));
  const hue = h('div', { class: 'hue-strip', role: 'slider', tabindex: '0', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '360' }, h('i', { class: 'hue-knob' }));
  const sample = h('span', { class: 'sample', style: { background: css(against) } }, 'Aa');
  const hex = textField('Hex  RRGGBB', hex6(initial), (t) => {
    const clean = t.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(clean)) { [hh, s, v] = toHsv((0xFF000000 | parseInt(clean, 16)) | 0); paint(false); }
  }, { mono: true, max: 7, caps: true });
  const readout = h('p', { class: 'contrast mono-small' });
  const sugg = suggestedSwatches('Suggested', suggestions, null, against, (c) => { [hh, s, v] = toHsv(c); paint(); });

  function paint(syncHex = true) {
    const c = current();
    sv.style.setProperty('--hue', css(fromHsv(hh, 1, 1)));
    sv.querySelector('.sv-knob').style.cssText = `left:${s * 100}%;top:${(1 - v) * 100}%`;
    hue.querySelector('.hue-knob').style.left = `${hh / 360 * 100}%`;
    hue.setAttribute('aria-valuenow', String(Math.round(hh)));
    sample.style.color = css(c);
    if (syncHex) hex.setValue(hex6(c));
    const k = contrast(c, against), ok = k >= target;
    readout.replaceChildren(icon(ok ? I.check : I.warning, { size: 14, stroke: 3 }), ` CONTRAST ${k.toFixed(1)}:1 · ${ok ? 'GOOD' : 'LOW'}`);
    readout.classList.toggle('bad', !ok);
    sugg.update(suggestions, c, against);
  }

  const drag = (el, fn) => {
    const at = (e) => { const r = el.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); paint(); };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); at(e); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) at(e); });
  };
  drag(sv, (x, y) => { s = x; v = 1 - y; });
  drag(hue, (x) => { hh = x * 359.9; });
  sv.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') s = Math.max(0, s - d); else if (e.key === 'ArrowRight') s = Math.min(1, s + d);
    else if (e.key === 'ArrowUp') v = Math.min(1, v + d); else if (e.key === 'ArrowDown') v = Math.max(0, v - d); else return;
    e.preventDefault(); paint();
  });
  hue.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') hh = (hh - d + 360) % 360; else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') hh = (hh + d) % 360; else return;
    e.preventDefault(); paint();
  });

  const sheet = openSheet([
    h('h2', { class: 'sheet-title' }, title), sv, hue,
    h('div', { class: 'hex-row' }, sample, hex), readout, sugg,
    h('div', { class: 'dialog-actions' },
      h('button', { type: 'button', class: 'text-btn', onclick: () => sheet.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'text-btn lime', onclick: () => { onApply(current()); sheet.close(); } }, 'Apply')),
  ], { label: title, dialog: true });
  paint();
  return sheet;
}
