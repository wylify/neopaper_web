// Full-screen photo framing (ui/PhotoFramer.kt): drag to move, pinch or wheel to zoom, double-tap
// to reset, arrows and +/− on the keyboard. The photo is drawn on its own canvas from local state,
// the card above it on a still one, so a gesture only repaints the photo. Nothing reaches the card
// (or the undo history) until Done.
import { h, chip, outline, primary, canvasView } from './ui.js';
import { openSheet } from './sheet.js';
import { PHOTO_ZOOM_RANGE, payload } from './model.js';
import { cardCodes } from './codes.js';
import { drawWallpaper, photoRect } from './render.js';
import { drawFoldWallpaper, foldStrip } from './fold.js';

const [ZMIN, ZMAX] = PHOTO_ZOOM_RANGE;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * cfg: the card; photo: { full, blurred, mono() }; w×h: the picture's size. fold: a foldable whose
 * open picture is framed (w×h is then the open screen; the closed screen's strip is outlined).
 * onDone(zoom, x, y) once, on Done.
 */
export function openPhotoFramer({ cfg, photo, w, h: hh, fold = null, onDone }) {
  let zoom = cfg.photoZoom, px = cfg.photoX, py = cfg.photoY, showCard = true;
  const codes = cardCodes(payload(cfg.qr), cfg.barcodeLink);
  const iw = photo.full.width, ih = photo.full.height;
  const now = () => ({ ...cfg, photoZoom: zoom, photoX: px, photoY: py });

  const photoLayer = canvasView((ctx, cw, ch) => {
    if (fold) drawFoldWallpaper(ctx, now(), codes, photo, fold, 'OPEN', cw, ch, { card: false });
    else drawWallpaper(ctx, now(), codes, photo, cw, ch, { card: false });
  }, 'framer-photo');
  const cardLayer = canvasView((ctx, cw, ch) => {
    if (fold) drawFoldWallpaper(ctx, cfg, codes, photo, fold, 'OPEN', cw, ch, { backdrop: false });
    else drawWallpaper(ctx, cfg, codes, photo, cw, ch, { backdrop: false });
  }, 'framer-card');
  const strip = fold ? (() => {
    const s = foldStrip(fold);
    return h('i', { class: 'fold-strip', 'aria-hidden': 'true', style: { left: `${s.x / fold.openW * 100}%`, top: `${s.y / fold.openH * 100}%`, width: `${s.w / fold.openW * 100}%`, height: `${s.h / fold.openH * 100}%` } });
  })() : null;
  const frame = h('div', {
    class: 'framer-frame', tabindex: '0', role: 'img',
    'aria-label': 'Photo framing. Drag to move, pinch or scroll to zoom, double-tap to reset. Arrow keys move, plus and minus zoom, 0 resets.',
  }, photoLayer, cardLayer, strip);
  const box = h('div', { class: 'framer-box' }, frame);
  const pct = h('span', { class: 'mono-small muted', 'aria-live': 'polite' });
  const cardChip = chip('Card', true, () => { showCard = !showCard; cardChip.setAttribute('aria-pressed', String(showCard)); cardLayer.hidden = !showCard; });

  const paint = () => {
    pct.textContent = `${Math.round(zoom * 100)}%`;
    frame.setAttribute('aria-valuetext', `Zoom ${Math.round(zoom * 100)} percent`);
    photoLayer.invalidate();
  };
  const reset = () => { zoom = 1; px = 0; py = 0; paint(); };

  /** A pinch of [f] around (cx, cy) plus a pan, all in CSS px of the frame (PhotoFramer.kt transform). */
  function transform(cx, cy, dx, dy, f) {
    const bw = frame.clientWidth, bh = frame.clientHeight;
    if (!bw || !bh) return;
    const r = photoRect(now(), iw, ih, { x: 0, y: 0, w: bw, h: bh });
    const z = clamp(zoom * f, ZMIN, ZMAX), k = z / zoom;
    const left = cx - (cx - r.x) * k + dx, top = cy - (cy - r.y) * k + dy;
    const sx = (r.w * k - bw) / 2, sy = (r.h * k - bh) / 2;
    zoom = z;
    px = sx < 0.5 ? 0 : clamp((-left - sx) / sx, -1, 1);
    py = sy < 0.5 ? 0 : clamp((-top - sy) / sy, -1, 1);
    paint();
  }

  // ── Gestures ──
  const pts = new Map();
  let last = null, lastTap = 0, moved = false;
  const local = (e) => { const b = frame.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const gesture = () => {
    const v = [...pts.values()];
    if (v.length >= 2) return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) };
    return v.length ? { x: v[0].x, y: v[0].y, d: 0 } : null;
  };
  frame.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    try { frame.setPointerCapture(e.pointerId); } catch {}
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) moved = false;
    last = gesture();
  });
  frame.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    const g = gesture();
    if (!g || !last) { last = g; return; }
    if (Math.hypot(g.x - last.x, g.y - last.y) > 0.5 || (g.d && last.d && g.d !== last.d)) moved = true;
    transform(g.x, g.y, g.x - last.x, g.y - last.y, g.d && last.d ? g.d / last.d : 1);
    last = g;
  });
  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    last = gesture();
    if (pts.size || moved || e.type === 'pointercancel') return;
    const t = performance.now();
    if (t - lastTap < 300) { lastTap = 0; reset(); } else lastTap = t;
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as wheel + ctrlKey with small deltas; a mouse wheel has big steps.
    const p = local(e);
    transform(p.x, p.y, 0, 0, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });
  frame.addEventListener('keydown', (e) => {
    const step = 0.1;
    if (e.key === 'ArrowLeft') px = clamp(px + step, -1, 1);
    else if (e.key === 'ArrowRight') px = clamp(px - step, -1, 1);
    else if (e.key === 'ArrowUp') py = clamp(py + step, -1, 1);
    else if (e.key === 'ArrowDown') py = clamp(py - step, -1, 1);
    else if (e.key === '+' || e.key === '=') zoom = clamp(zoom * 1.25, ZMIN, ZMAX);
    else if (e.key === '-' || e.key === '_') zoom = clamp(zoom / 1.25, ZMIN, ZMAX);
    else if (e.key === '0') { zoom = 1; px = 0; py = 0; }
    else return;
    e.preventDefault(); paint();
  });

  // Fit the frame to the picture's aspect inside the box.
  const ro = new ResizeObserver(([en]) => {
    const { width: bw, height: bh } = en.contentRect;
    if (!bw || !bh) return;
    const s = Math.min(bw / w, bh / hh);
    frame.style.width = `${Math.floor(w * s)}px`; frame.style.height = `${Math.floor(hh * s)}px`;
  });
  ro.observe(box);

  const sheet = openSheet([
    h('div', { class: 'framer-top' }, h('h2', { class: 'sheet-title grow' }, fold ? 'Frame photo · open + closed' : 'Frame photo'), pct, cardChip),
    box,
    h('div', { class: 'framer-actions' },
      outline('Reset', reset), outline('Cancel', () => sheet.close()),
      primary('Done', () => { onDone(zoom, px, py); sheet.close(); }, { class: 'wide' })),
  ], { label: 'Frame photo', dialog: true, onClose: () => { ro.disconnect(); photoLayer.dispose(); cardLayer.dispose(); } });
  sheet.el.classList.add('fullscreen', 'framer');
  sheet.el.parentElement.classList.add('black');
  paint();
  requestAnimationFrame(() => frame.focus({ preventScroll: true }));
  return sheet;
}
