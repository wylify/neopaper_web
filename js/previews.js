// Live card and wallpaper canvases (CardCanvas / WallpaperCanvas / RowGlyph in the Android app).
import { canvasView, h } from './ui.js';
import { unitSize, payload, ROW_KINDS, rowHeight, css } from './model.js';
import { cardCodes } from './codes.js';
import { drawCard, drawWallpaper, drawRow } from './render.js';

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
 * aspect ratio (getSize() → [w, h]) that fits its box. Returns the box, with sync/invalidate/dispose.
 */
export function wallpaperCanvas(getCfg, getPhoto, getSize, cls = 'wall-canvas') {
  const c = canvasView((ctx, w, h) => {
    const cfg = getCfg();
    if (cfg) drawWallpaper(ctx, cfg, codesFor(cfg), getPhoto(), w, h);
  }, cls, 'Wallpaper preview');
  const box = h('div', { class: 'wall-fit' }, c);
  let bw = 0, bh = 0;
  const fit = () => {
    if (!bw || !bh) return;
    const [w, hh] = getSize();
    const s = Math.min(bw / w, bh / hh);
    c.style.width = `${Math.floor(w * s)}px`; c.style.height = `${Math.floor(hh * s)}px`;
    c.classList.toggle('landscape', w > hh);
  };
  const ro = new ResizeObserver(([e]) => { bw = e.contentRect.width; bh = e.contentRect.height; fit(); });
  ro.observe(box);
  box.sync = () => { fit(); c.invalidate(); };
  box.invalidate = () => c.invalidate();
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
