// Live card and wallpaper canvases (CardCanvas / WallpaperCanvas / RowGlyph in the Android app).
import { canvasView, h } from './ui.js';
import { unitSize, payload, ROW_KINDS, rowHeight, css } from './model.js';
import { cardCodes } from './codes.js';
import { drawCard, drawWallpaper, drawRow } from './render.js';
import { cardOverlaps, guideScreen } from './placement.js';
import { drawFoldWallpaper, foldStrip } from './fold.js';

const codesFor = (cfg) => cardCodes(payload(cfg.qr), cfg.barcodeLink);

/** Card on a canvas, fitted and centred in its box. onInfo({ shown, total }) after each paint. */
export function cardCanvas(getCfg, onInfo, cls = 'card-canvas') {
  const c = canvasView((ctx, w, h) => {
    const cfg = getCfg();
    if (!cfg) return;
    const [uw, uh] = unitSize(cfg);
    const cw = Math.min(w, h * uw / uh), ch = cw * uh / uw;
    const info = drawCard(ctx, cfg, codesFor(cfg), (w - cw) / 2, (h - ch) / 2, cw);
    onInfo?.(info);
  }, cls, 'Card preview');
  c.sync = () => { const cfg = getCfg(); if (cfg) { const [uw, uh] = unitSize(cfg); c.style.aspectRatio = `${uw} / ${uh}`; } c.invalidate(); };
  c.sync();
  return c;
}

/**
 * Wallpaper preview: exactly what the export will contain, at the largest size of the target
 * aspect ratio (getSize() → [w, h]) that fits its box. While opts.guides() names a screen
 * ('HOME' | 'LOCK'), its clock and dock areas are marked on top; a band turns orange when the
 * card runs into it.
 * opts.fold() → [fold, 'CLOSED' | 'OPEN'] draws a foldable's view: the open one outlines the closed
 * screen's strip instead of the guides. opts.card() false draws the backdrop alone (dual home).
 * Returns the box, with sync/invalidate/dispose.
 */
export function wallpaperCanvas(getCfg, getPhoto, getSize, cls = 'wall-canvas', opts = {}) {
  const c = canvasView((ctx, w, h) => {
    const cfg = getCfg();
    if (!cfg) return;
    const f = opts.fold?.(), card = opts.card?.() ?? true;
    if (f) drawFoldWallpaper(ctx, cfg, codesFor(cfg), getPhoto(), f[0], f[1], w, h, { card });
    else drawWallpaper(ctx, cfg, codesFor(cfg), getPhoto(), w, h, { card });
  }, cls, opts.label || 'Wallpaper preview');
  const clockLabel = h('span', {}), dockLabel = h('span', {});
  const clock = h('i', { class: 'g-band g-clock' }, clockLabel);
  const dock = h('i', { class: 'g-band g-dock' }, dockLabel);
  let shownFor = null;
  const guides = h('div', { class: 'guides', 'aria-hidden': 'true', hidden: true }, clock, dock);
  const strip = h('i', { class: 'fold-strip', 'aria-hidden': 'true', hidden: true });
  const frame = h('div', { class: 'wall-frame' }, c, guides, strip);
  const box = h('div', { class: 'wall-fit' }, frame);
  let bw = 0, bh = 0;
  const fit = () => {
    if (!bw || !bh) return;
    const [w, hh] = getSize();
    const s = Math.min(bw / w, bh / hh);
    frame.style.width = `${Math.floor(w * s)}px`; frame.style.height = `${Math.floor(hh * s)}px`;
    c.classList.toggle('landscape', w > hh);
  };
  const paintGuides = () => {
    // A foldable's open view: outline what the closed screen shows; the guides belong to that one.
    const f = opts.fold?.();
    const open = f && f[1] === 'OPEN';
    strip.hidden = !open;
    if (open) {
      const st = foldStrip(f[0]);
      Object.assign(strip.style, { left: `${st.x / f[0].openW * 100}%`, top: `${st.y / f[0].openH * 100}%`, width: `${st.w / f[0].openW * 100}%`, height: `${st.h / f[0].openH * 100}%` });
    }
    const screen = open ? null : opts.guides?.() || null;
    guides.hidden = !screen;
    const cfg = getCfg();
    if (!screen || !cfg) return;
    if (shownFor !== screen) {
      shownFor = screen;
      const g = guideScreen(screen);
      clock.style.height = `${g.clockEnd * 100}%`; dock.style.top = `${g.dockStart * 100}%`;
      clockLabel.textContent = `${g.short} · ${g.top.toUpperCase()}`; dockLabel.textContent = `${g.short} · ${g.bottom.toUpperCase()}`;
    }
    const [w, hh] = f ? [f[0].closedW, f[0].closedH] : getSize();
    const o = cardOverlaps(cfg, w, hh, screen);
    clock.classList.toggle('hit', o.clock); dock.classList.toggle('hit', o.dock);
  };
  const ro = new ResizeObserver(([e]) => { bw = e.contentRect.width; bh = e.contentRect.height; fit(); });
  ro.observe(box);
  box.sync = () => { fit(); paintGuides(); c.invalidate(); };
  box.invalidate = () => c.invalidate();
  box.canvas = c;
  box.dispose = () => { ro.disconnect(); c.dispose(); };
  return box;
}

/** Small swatch of a filler pattern, or nothing for info rows (they use an icon). */
export function rowSwatch(cfg, row, color, bg = null, cls = 'row-swatch') {
  return canvasView((ctx, w, h) => {
    if (bg != null) { ctx.fillStyle = css(bg); ctx.fillRect(0, 0, w, h); }
    const rh = Math.max(1, rowHeight(row)), base = Math.max(rh, 12);
    const k = h / base;
    ctx.save(); ctx.scale(k, k);
    drawRow(ctx, row, cfg, 0, (base - rh) / 2, w / k, css(color));
    ctx.restore();
  }, cls);
}

/** One row on a strip of card colour at card scale (row editor preview). */
export function rowPreview(getCfg, getRow) {
  const c = canvasView((ctx, w) => {
    const cfg = getCfg(), row = getRow();
    const k = w / 300;
    ctx.fillStyle = css(cfg.labelColor); ctx.fillRect(0, 0, w, (rowHeight(row) + 24) * k);
    ctx.save(); ctx.scale(k, k); drawRow(ctx, row, cfg, 12, 12, 276, css(cfg.ink)); ctx.restore();
  }, 'row-preview');
  c.sync = () => { c.style.aspectRatio = `300 / ${rowHeight(getRow()) + 24}`; c.invalidate(); };
  c.sync();
  return c;
}

export const isFillerKind = (k) => ROW_KINDS[k].filler;
