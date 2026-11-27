// Rendering a wallpaper to an image file and handing it to the user (export/Exporter.kt).
// Browsers can't set the wallpaper, so the image is saved (download, or the share sheet on iOS)
// and the user sets it in the system settings.
import { DEVICE, CUSTOM, FOLD, DEVICE_PRESETS, payload } from './model.js';
import { cardCodes } from './codes.js';
import { drawWallpaper } from './render.js';
import { settings } from './settings.js';
import { deviceFold, drawFoldWallpaper, foldStrip } from './fold.js';

export const isAndroid = /android/i.test(navigator.userAgent);
// iPadOS reports itself as a Mac; touch support gives it away.
export const isIos = !isAndroid && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const isMobile = isIos || isAndroid || matchMedia('(pointer: coarse)').matches;

/** This device's fold while Settings › Foldable layout is on, else null. */
export const activeFold = () => (settings.foldLayout ? deviceFold() : null);

/**
 * This screen's size in device pixels. Phones and tablets are portrait, like the Android app. On a
 * foldable (with the layout on) it is the closed screen, the one "This device" designs for.
 */
export function deviceSize() {
  const f = activeFold();
  if (f) return [f.closedW, f.closedH];
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(screen.width * dpr), hh = Math.round(screen.height * dpr);
  if (isMobile) return [Math.min(w, hh), Math.max(w, hh)];
  return [w, hh];
}

export function targetSize(cfg) {
  if (cfg.exportPreset === CUSTOM) return [clampDim(cfg.customW), clampDim(cfg.customH)];
  if (cfg.exportPreset === DEVICE) return deviceSize();
  if (cfg.exportPreset === FOLD) { const f = activeFold(); return f ? [f.openW, f.openH] : deviceSize(); }
  const p = DEVICE_PRESETS.find((x) => x.id === cfg.exportPreset);
  return p ? [p.w, p.h] : deviceSize();
}
/** [fold, view] when [cfg]'s size is drawn from this foldable's picture: the closed or open screen. */
export function foldFor(cfg) {
  const f = activeFold();
  if (!f) return null;
  if (cfg.exportPreset === DEVICE) return [f, 'CLOSED'];
  if (cfg.exportPreset === FOLD) return [f, 'OPEN'];
  return null;
}

/** "Set as wallpaper" size: this screen, or on a foldable the open picture that serves both screens. */
export function wallpaperSize() {
  const f = activeFold();
  return f ? [f.openW, f.openH] : deviceSize();
}
/** What "Set as wallpaper" draws: the foldable's open picture, or this screen. */
export const wallpaperFold = () => { const f = activeFold(); return f ? [f, 'OPEN'] : null; };

/** The area the card is laid out for in a w×h output of [fold]: the closed-screen strip of an open picture. */
export function cardArea(fold, w, h) {
  if (!fold || fold[1] !== 'OPEN') return [w, h];
  const s = foldStrip(fold[0]);
  return [Math.round(s.w * w / fold[0].openW), Math.round(s.h * h / fold[0].openH)];
}

const clampDim = (v) => Math.min(8192, Math.max(200, v | 0 || 200));

/**
 * Pixel budget for one canvas. iOS Safari refuses canvases over ~16.7 MP (and silently draws
 * nothing); other phones get a little less than the Android app's 48 MP to stay within memory.
 */
export const MAX_PIXELS = isIos ? 16_000_000 : isMobile ? 33_000_000 : 48_000_000;
const MAX_SIDE = 16384;

/** Output size for the export settings, scaled down to fit the budget. { w, h, capped } */
export function exportSize(w, hh, scale) {
  let ow = w * scale, oh = hh * scale, capped = false;
  if (ow * oh > MAX_PIXELS) { const f = Math.sqrt(MAX_PIXELS / (ow * oh)); ow = Math.floor(ow * f); oh = Math.floor(oh * f); capped = true; }
  if (Math.max(ow, oh) > MAX_SIDE) { const f = MAX_SIDE / Math.max(ow, oh); ow = Math.floor(ow * f); oh = Math.floor(oh * f); capped = true; }
  return { w: ow, h: oh, capped };
}

function toBlob(canvas, png) {
  return new Promise((r) => canvas.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.95));
}

/**
 * Renders the wallpaper; on failure (out of memory) retries at a smaller size.
 * opts: { card: false for the bare backdrop, fold: [fold, view] to draw a foldable's view }.
 */
export async function renderImage(cfg, photo, size, opts = {}) {
  const codes = cardCodes(payload(cfg.qr), cfg.barcodeLink);
  let { w, h } = size;
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { alpha: false });
    if (ctx) {
      if (opts.fold) drawFoldWallpaper(ctx, cfg, codes, photo, opts.fold[0], opts.fold[1], w, h, { card: opts.card });
      else drawWallpaper(ctx, cfg, codes, photo, w, h, { card: opts.card });
      // A canvas over the browser's limit draws nothing: check a pixel before encoding.
      const px = ctx.getImageData(0, 0, 1, 1).data;
      const blank = px[3] === 0;
      const blob = blank ? null : await toBlob(c, cfg.exportPng);
      c.width = c.height = 0; // free the memory right away (matters on iOS)
      if (blob) return { blob, w, h };
    }
    w = Math.floor(w * 0.7); h = Math.floor(h * 0.7);
  }
  throw new Error('render failed');
}

/** [suffix] names the half of a dual pair: 'lock' or 'home'. */
export const fileName = (cfg, suffix = '', t = Date.now()) =>
  `${(cfg.code.trim() || 'NEOPAPER').replace(/[^\w\-]+/g, '_')}_${t}${suffix ? '_' + suffix : ''}.${cfg.exportPng ? 'png' : 'jpg'}`;

export function canShareFile(file) { return canShareFiles([file]); }
export function canShareFiles(files) {
  try { return !!navigator.canShare?.({ files }); } catch { return false; }
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Share sheet with the file ("Save Image" on iOS). Needs a fresh tap. 'shared' | 'cancelled' | 'failed' */
export async function shareFile(file) { return shareFiles([file]); }
export async function shareFiles(files) {
  try { await navigator.share({ files }); return 'shared'; }
  catch (e) { return e?.name === 'AbortError' ? 'cancelled' : 'failed'; }
}

/**
 * Platform steps for setting a saved image as the wallpaper. opts: { dual } for a lock + home pair,
 * { fold } for a foldable's open picture (Android's wallpaper picker crops it for each screen).
 */
export function wallpaperSteps(opts = {}) {
  const { dual, fold } = opts;
  if (isIos) {
    if (dual) return ['Tap “Save to Photos” below and save both images.', 'Settings → Wallpaper → Add New Wallpaper → Photos: pick the _lock image, then Add.',
      'Choose “Customize Home Screen” → Photos, pick the _home image and tap Done.'];
    return ['Tap “Save to Photos” below (Share → Save Image).', 'Open Photos, open the image and tap Share.', 'Choose “Use as Wallpaper”, then Add.'];
  }
  if (isAndroid) {
    const keep = fold ? ' Keep the picker’s centred crop: the card sits in the middle for the closed screen.' : '';
    if (dual) return ['Save both images: they go to Downloads.', `Open the _lock image in Photos or Files → ⋮ → “Set as wallpaper” → Lock screen.${keep}`,
      'Open the _home image the same way → Home screen.'];
    return ['Tap “Save image”: it goes to Downloads.', `Open it in Photos or Files and tap ⋮ → “Use as” or “Set as wallpaper”.${keep}`, 'Pick Home screen, Lock screen or both.'];
  }
  if (/Mac/.test(navigator.platform)) {
    if (dual) return ['Save the image you want: macOS shows the desktop picture on the lock screen too.',
      'The _home image keeps the desktop clear, the _lock image shows the card. Then System Settings → Wallpaper → Add Photo.'];
    return ['Save the image.', 'Open System Settings → Wallpaper → Add Photo, or right-click the file in Finder → Set Desktop Picture.'];
  }
  if (/Win/.test(navigator.platform)) {
    if (dual) return ['Save both images.', 'Settings → Personalization → Lock screen → Picture: browse to the _lock image.', 'Right-click the _home image in File Explorer → “Set as desktop background”.'];
    return ['Save the image.', 'Right-click it in File Explorer → “Set as desktop background”.'];
  }
  if (dual) return ['Save both images.', 'Set the _lock image as the lock screen and the _home image as the desktop in your system settings.'];
  return ['Save the image.', 'Set it as the wallpaper in your system settings.'];
}
