// Rendering a wallpaper to an image file and handing it to the user (export/Exporter.kt).
// Browsers can't set the wallpaper, so the image is saved (download, or the share sheet on iOS)
// and the user sets it in the system settings.
import { DEVICE, CUSTOM, DEVICE_PRESETS, payload } from './model.js';
import { cardCodes } from './codes.js';
import { drawWallpaper } from './render.js';

export const isAndroid = /android/i.test(navigator.userAgent);
// iPadOS reports itself as a Mac; touch support gives it away.
export const isIos = !isAndroid && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const isMobile = isIos || isAndroid || matchMedia('(pointer: coarse)').matches;

/** This screen's size in device pixels. Phones and tablets are portrait, like the Android app. */
export function deviceSize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(screen.width * dpr), hh = Math.round(screen.height * dpr);
  if (isMobile) return [Math.min(w, hh), Math.max(w, hh)];
  return [w, hh];
}

export function targetSize(cfg) {
  if (cfg.exportPreset === CUSTOM) return [clampDim(cfg.customW), clampDim(cfg.customH)];
  if (cfg.exportPreset === DEVICE) return deviceSize();
  const p = DEVICE_PRESETS.find((x) => x.id === cfg.exportPreset);
  return p ? [p.w, p.h] : deviceSize();
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

/** Renders the wallpaper; on failure (out of memory) retries at a smaller size. */
export async function renderImage(cfg, photo, size) {
  const codes = cardCodes(payload(cfg.qr), cfg.barcodeLink);
  let { w, h } = size;
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { alpha: false });
    if (ctx) {
      drawWallpaper(ctx, cfg, codes, photo, w, h);
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

export const fileName = (cfg) => `${(cfg.code.trim() || 'NEOPAPER').replace(/[^\w\-]+/g, '_')}_${Date.now()}.${cfg.exportPng ? 'png' : 'jpg'}`;

export function canShareFile(file) {
  try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; }
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Share sheet with the file ("Save Image" on iOS). Needs a fresh tap. 'shared' | 'cancelled' | 'failed' */
export async function shareFile(file) {
  try { await navigator.share({ files: [file] }); return 'shared'; }
  catch (e) { return e?.name === 'AbortError' ? 'cancelled' : 'failed'; }
}

/** Platform steps for setting a saved image as the wallpaper. */
export function wallpaperSteps() {
  if (isIos) return ['Tap “Save to Photos” below (Share → Save Image).', 'Open Photos, open the image and tap Share.', 'Choose “Use as Wallpaper”, then Add.'];
  if (isAndroid) return ['Tap “Save image”: it goes to Downloads.', 'Open it in Photos or Files and tap ⋮ → “Use as” or “Set as wallpaper”.', 'Pick Home screen, Lock screen or both.'];
  if (/Mac/.test(navigator.platform)) return ['Save the image.', 'Open System Settings → Wallpaper → Add Photo, or right-click the file in Finder → Set Desktop Picture.'];
  if (/Win/.test(navigator.platform)) return ['Save the image.', 'Right-click it in File Explorer → “Set as desktop background”.'];
  return ['Save the image.', 'Set it as the wallpaper in your system settings.'];
}
