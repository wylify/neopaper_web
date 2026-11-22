// Small DOM toolkit: element builder, line icons and the NEOPAPER controls.

export const $ = (id) => document.getElementById(id);

/** h('p', { class: 'x', onclick }, 'text', child…). `style` may be an object. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

/** UI line icons (24-unit paths, same set as the Android app). */
export const I = {
  back: 'M19 12H5M11 18l-6-6 6-6', close: 'M6 6l12 12M18 6 6 18', more: 'M12 5h.01M12 12h.01M12 19h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', plus: 'M12 5v14M5 12h14',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  chevron: 'M9 6l6 6-6 6', next: 'M5 12h14M13 6l6 6-6 6', check: 'M5 12l5 5 9-10', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01', download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  cards: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', templates: 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4', date: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6', serial: 'M4 7h16M4 12h10M4 17h13', warning: 'M12 3 22 20.5H2zM12 9.5v5M12 17.5v.2',
  wallpaper: 'M6 2h12v20H6zM6 17l4-4 3 3 2-2 3 3', copy: 'M8 8h12v12H8zM4 16V4h12', phone: 'M7 2h10v20H7zM11 18h2',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  scan: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M4 12h16', torch: 'M9 2h6v5l-2 3v12h-2V10L9 7zM9 7h6',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v8h14v-8', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14', external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(d, opts = {}) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  if (opts.label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', opts.label); } else s.setAttribute('aria-hidden', 'true');
  const cls = ['ico', opts.cls, opts.filled && 'filled', (d === I.more || d === I.drag) && 'dots'].filter(Boolean).join(' ');
  s.setAttribute('class', cls);
  if (opts.size) { s.style.width = s.style.height = opts.size + 'px'; }
  if (opts.color) s.style.color = opts.color;
  if (opts.stroke) s.style.strokeWidth = opts.stroke;
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p);
  return s;
}

export const iconButton = (d, label, onclick, extra = {}) =>
  h('button', { class: 'icon-btn ' + (extra.class || ''), 'aria-label': label, title: label, onclick, type: 'button' }, icon(d));

export const primary = (text, onclick, opts = {}) =>
  h('button', { class: 'btn primary ' + (opts.class || ''), onclick, type: 'button', disabled: opts.disabled }, h('span', {}, text), opts.icon && icon(opts.icon));
export const outline = (text, onclick, opts = {}) =>
  h('button', { class: 'btn outline ' + (opts.class || ''), onclick, type: 'button' }, opts.icon && icon(opts.icon), h('span', {}, text));

export const sectionLabel = (text, cls = '') => h('p', { class: 'section-label ' + cls }, text.toUpperCase());
export const tag = (text) => h('span', { class: 'tag' }, text);
export const hint = (text) => h('div', { class: 'empty-hint' }, text);

/** Single-choice row of squared buttons; returns the element with .set(value). */
export function segmented(options, selected, label, onSelect, cls = '') {
  const el = h('div', { class: 'segmented ' + cls, role: 'radiogroup' });
  const btns = options.map((o) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(o === selected),
    onclick: () => { el.set(o); onSelect(o); },
  }, label(o)));
  el.append(...btns);
  el.set = (v) => btns.forEach((b, i) => b.setAttribute('aria-checked', String(options[i] === v)));
  return el;
}

export function chip(text, selected, onclick) {
  return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!selected), onclick }, text);
}

/** Group of chips where exactly one is selected. */
export function chipGroup(options, selected, label, onSelect) {
  const el = h('div', { class: 'chips', role: 'radiogroup' });
  const btns = options.map((o) => h('button', {
    type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(o === selected),
    onclick: () => { el.set(o); onSelect(o); },
  }, label(o)));
  el.append(...btns);
  el.set = (v) => btns.forEach((b, i) => b.setAttribute('aria-checked', String(options[i] === v)));
  return el;
}

export function switchRow(title, subtitle, checked, onChange) {
  const sw = h('span', { class: 'switch', 'aria-hidden': 'true' }, h('i'));
  const row = h('button', { type: 'button', class: 'switch-row', role: 'switch', 'aria-checked': String(checked) },
    h('span', { class: 'grow' }, h('span', { class: 'title' }, title), subtitle && h('span', { class: 'sub' }, subtitle)), sw);
  row.addEventListener('click', () => { const v = row.getAttribute('aria-checked') !== 'true'; row.setAttribute('aria-checked', String(v)); onChange(v); });
  return row;
}

/** Labelled range slider. format(v) gives the readout; snap(v) rounds what is applied. */
export function slider(label, value, min, max, step, format, onChange, snap = (v) => v) {
  const out = h('span', { class: 'readout' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const paint = () => input.style.setProperty('--p', ((input.value - min) / (max - min) * 100) + '%');
  input.addEventListener('input', () => { const v = snap(parseFloat(input.value)); out.textContent = format(v); paint(); onChange(v); });
  paint();
  const el = h('label', { class: 'slider-row' }, h('span', { class: 'title' }, label), input, out);
  el.set = (v) => { input.value = v; out.textContent = format(v); paint(); };
  return el;
}

/**
 * Outlined text field with a counter. opts: { mono, max, supporting, multiline, caps, inputmode, type, autocomplete }.
 * onChange(value) runs on every keystroke. Returns the wrapper with .input and .setSupporting().
 */
export function textField(label, value, onChange, opts = {}) {
  const max = opts.max ?? 64;
  const input = h(opts.multiline ? 'textarea' : 'input', {
    class: 'field-input' + (opts.mono ? ' mono' : ''), maxlength: max, rows: opts.multiline ? 3 : null,
    type: opts.multiline ? null : (opts.type || 'text'), inputmode: opts.inputmode, autocomplete: opts.autocomplete || 'off',
    autocapitalize: opts.caps ? 'characters' : opts.autocapitalize || 'off', spellcheck: 'false', enterkeyhint: 'done',
  });
  input.value = value;
  const count = h('span', { class: 'count' }, `${value.length} / ${max}`);
  const sup = h('span', { class: 'sup' }, opts.supporting || '');
  input.addEventListener('input', () => {
    if (opts.caps) {
      const s = input.selectionStart, e = input.selectionEnd, up = input.value.toUpperCase();
      if (up !== input.value) { input.value = up; try { input.setSelectionRange(s, e); } catch {} }
    }
    count.textContent = `${input.value.length} / ${max}`;
    onChange(input.value);
  });
  if (!opts.multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const el = h('label', { class: 'field' + (opts.class ? ' ' + opts.class : '') }, h('span', { class: 'field-label' }, label), input,
    h('span', { class: 'field-foot' }, sup, count));
  el.input = input;
  el.setSupporting = (t, warn = false) => { sup.textContent = t; sup.classList.toggle('warn', warn); };
  el.setValue = (v) => { if (input.value !== v) { input.value = v; count.textContent = `${v.length} / ${max}`; } };
  return el;
}

// ── Feedback ────────────────────────────────────────────────────────────────────────────

let toastTimer, toastAction = null;
/** Snackbar with an optional action (e.g. Undo). */
export function toast(msg, action = null, ms = 3200) {
  const t = $('toast');
  t.replaceChildren(h('span', {}, msg));
  toastAction = action;
  if (action) t.append(h('button', { type: 'button', onclick: () => { const a = toastAction; toastAction = null; t.classList.remove('show'); a?.run(); } }, action.label));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); toastAction = null; }, action ? Math.max(ms, 4500) : ms);
}

export function busy(text) {
  const b = $('busy');
  if (text == null) { b.classList.remove('show'); setTimeout(() => { if (!b.classList.contains('show')) b.hidden = true; }, 200); return; }
  b.querySelector('.busy-text').textContent = text.toUpperCase();
  b.hidden = false;
  requestAnimationFrame(() => b.classList.add('show'));
}

/** Two frames, so a busy overlay is on screen before blocking work starts. */
export const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast('Copied');
}

// ── Canvas that keeps its backing store at device resolution ───────────────────────────

/**
 * A <canvas> that repaints with draw(ctx, cssW, cssH) whenever it is resized or invalidated.
 * Repaints are coalesced to one per frame.
 */
const MAX_ZOOM_PIXELS = 16_000_000; // iOS Safari draws nothing on bigger canvases

export function canvasView(draw, cls = '', label = '') {
  const c = h('canvas', { class: cls, role: label ? 'img' : null, 'aria-label': label || null });
  const ctx = c.getContext('2d');
  let w = 0, hh = 0, queued = false, alive = true;
  const paint = () => {
    queued = false;
    if (!alive || !w || !hh) return;
    // c.zoom > 1 (set by zoomPan) renders more pixels so a zoomed-in preview stays sharp.
    const k = Math.min(3, window.devicePixelRatio || 1) * (c.zoom || 1);
    let bw = Math.round(w * k), bh = Math.round(hh * k);
    const cap = MAX_ZOOM_PIXELS / (bw * bh);
    if (cap < 1) { bw = Math.round(bw * Math.sqrt(cap)); bh = Math.round(bh * Math.sqrt(cap)); }
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    ctx.setTransform(bw / w, 0, 0, bh / hh, 0, 0);
    draw(ctx, w, hh);
  };
  c.invalidate = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  const ro = new ResizeObserver(([e]) => {
    const r = e.contentRect;
    if (r.width !== w || r.height !== hh) { w = r.width; hh = r.height; paint(); }
  });
  ro.observe(c);
  c.dispose = () => { alive = false; ro.disconnect(); };
  return c;
}

/**
 * Pinch, wheel or double-tap/click to zoom [target] (a canvasView) inside [box], drag to pan.
 * The view never pans past the target's edges. A single tap/click at 1× calls onTap
 * (e.g. close). Once a gesture settles the canvas is redrawn at the zoomed resolution.
 * Returns { reset, dispose }.
 */
export function zoomPan(box, target, { onTap, max = 6 } = {}) {
  box.classList.add('zoom-box');
  let s = 1, x = 0, y = 0;
  const pts = new Map();
  let start = null, moved = false, lastTap = 0, tapTimer = 0, sharpTimer = 0;

  const clamp = () => {
    s = Math.min(max, Math.max(1, s));
    const mx = (target.offsetWidth * (s - 1)) / 2, my = (target.offsetHeight * (s - 1)) / 2;
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
  };
  const apply = (animate = false) => {
    clamp();
    target.style.transition = animate ? 'transform .25s cubic-bezier(.2,.9,.3,1)' : 'none';
    target.style.transform = s === 1 ? '' : `translate(${x}px, ${y}px) scale(${s})`;
    box.classList.toggle('zoomed', s > 1.01);
    clearTimeout(sharpTimer);
    sharpTimer = setTimeout(() => { if ((target.zoom || 1) !== s) { target.zoom = s; target.invalidate?.(); } }, 180);
  };
  // Zoom to [ns] keeping the content point under (cx, cy) (client coords) in place.
  const zoomAt = (ns, cx, cy, animate) => {
    const r = box.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    ns = Math.min(max, Math.max(1, ns));
    const f = ns / s;
    x = px - (px - x) * f; y = py - (py - y) * f; s = ns;
    apply(animate);
  };
  const reset = () => { s = 1; x = 0; y = 0; apply(true); };

  const mid = () => { const [a, b] = [...pts.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  const begin = () => {
    if (pts.size >= 2) { const m = mid(); start = { ...m, s, x, y }; }
    else if (pts.size === 1) { const [p] = pts.values(); start = { cx: p.x, cy: p.y, s, x, y }; }
  };

  box.addEventListener('pointerdown', (e) => {
    try { box.setPointerCapture(e.pointerId); } catch { /* synthetic or already-gone pointer */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) moved = false;
    begin();
  });
  box.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!start) return;
    if (pts.size >= 2) {
      const m = mid();
      moved = true;
      // Re-derive from the gesture start so the pinch tracks the fingers exactly.
      s = start.s; x = start.x; y = start.y;
      zoomAt(start.s * (m.d / (start.d || 1)), start.cx, start.cy, false);
      x += m.cx - start.cx; y += m.cy - start.cy; apply();
    } else {
      const [p] = pts.values();
      const dx = p.x - start.cx, dy = p.y - start.cy;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (moved && s > 1) { x = start.x + dx; y = start.y + dy; apply(); }
    }
  });
  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    begin();
    if (pts.size || moved || e.type === 'pointercancel') return;
    const now = performance.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      if (s > 1.01) reset(); else zoomAt(2.5, e.clientX, e.clientY, true);
    } else {
      lastTap = now;
      if (s <= 1.01 && onTap) tapTimer = setTimeout(() => onTap(), 300);
    }
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as wheel + ctrlKey with small deltas; a mouse wheel has big steps.
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    zoomAt(s * k, e.clientX, e.clientY, false);
  }, { passive: false });

  return { reset, dispose() { clearTimeout(tapTimer); clearTimeout(sharpTimer); } };
}
