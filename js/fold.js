// Foldable layout (render/Fold.kt): one open-screen picture with the closed screen's wallpaper at
// its centre, so a book-style foldable shows the card centred on both screens.
//
// Android 15+ keeps one crop for an image wallpaper and derives every screen's view from it: the
// open screen shows the whole picture, the closed screen the closed-shaped centre strip. Browsers
// can't ask for both screen sizes, so they are learned: every visit stores this screen's size, and
// once a tall phone screen and a much bigger, nearly square one have both been seen, it's a fold.
import { drawWallpaper } from './render.js';

/** Which screen of a foldable a preview shows. */
export const FOLD_VIEWS = ['CLOSED', 'OPEN'];

const KEY = 'neopaper.screens';
const isAndroid = /android/i.test(navigator.userAgent);

/**
 * The two screens from a list of [w, h] sizes (px, natural orientation). Null unless there is a
 * tall phone-shaped screen and a much bigger, nearly square one: a book-style fold. Flip phones
 * (tall inner screen, cover screen on another display) and tablets don't qualify.
 * Same rules as FoldGeometry.from in Fold.kt. Returns { closedW, closedH, openW, openH }.
 */
export function foldFrom(sizes) {
  const valid = sizes.filter(([w, h]) => w > 0 && h > 0);
  const aspect = ([w, h]) => Math.min(w, h) / Math.max(w, h);
  const area = ([w, h]) => w * h;
  const closed = valid.filter((s) => aspect(s) < 0.62).sort((a, b) => area(a) - area(b))[0];
  if (!closed) return null;
  const open = valid.filter((s) => aspect(s) > 0.7 && area(s) > area(closed) * 1.5).sort((a, b) => area(b) - area(a))[0];
  if (!open) return null;
  // Same rotation: turn both together so the closed screen is portrait.
  return closed[0] > closed[1]
    ? { closedW: closed[1], closedH: closed[0], openW: open[1], openH: open[0] }
    : { closedW: closed[0], closedH: closed[1], openW: open[0], openH: open[1] };
}

/** The largest closed-screen-shaped rect, centred on the open picture: what the closed screen shows. */
export function foldStrip(f) {
  const a = f.closedW / f.closedH;
  let w, h;
  if (f.openW / f.openH > a) { h = f.openH; w = h * a; } else { w = f.openW; h = w / a; }
  return { x: (f.openW - w) / 2, y: (f.openH - h) / 2, w, h };
}

/** Output size for [view]: the open screen, or the closed one. */
export const foldSize = (f, view) => (view === 'OPEN' ? [f.openW, f.openH] : [f.closedW, f.closedH]);

/**
 * Draws [fold]'s wallpaper as [view] shows it into a W×H area: OPEN fits the whole picture,
 * CLOSED fills the area with the centre strip. The photo is framed for the whole picture so both
 * views come from the same image. opts: { card, backdrop } as drawWallpaper.
 */
export function drawFoldWallpaper(ctx, cfg, codes, photo, fold, view, W, H, opts = {}) {
  const canvas = { x: 0, y: 0, w: fold.openW, h: fold.openH };
  const strip = foldStrip(fold);
  const src = view === 'OPEN' ? canvas : strip;
  const k = Math.min(W / src.w, H / src.h);
  ctx.save();
  ctx.translate((W - src.w * k) / 2 - src.x * k, (H - src.h * k) / 2 - src.y * k);
  ctx.scale(k, k);
  const info = drawWallpaper(ctx, cfg, codes, photo, fold.openW, fold.openH, { ...opts, viewport: strip, photoFrame: canvas });
  ctx.restore();
  return info;
}

// ── This device ─────────────────────────────────────────────────────────────────────────

/** This screen in device px, in its natural orientation (the way it was held before any turn). */
function currentScreen() {
  const dpr = window.devicePixelRatio || 1;
  let w = Math.round(screen.width * dpr), h = Math.round(screen.height * dpr);
  const angle = screen.orientation?.angle ?? (typeof window.orientation === 'number' ? window.orientation : 0);
  if (Math.abs(angle) % 180 === 90) [w, h] = [h, w];
  return [w, h];
}

function loadScreens() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter((s) => Array.isArray(s) && s.length === 2 && s.every((v) => Number.isInteger(v) && v > 0 && v < 20000)) : [];
  } catch { return []; }
}

let screens = isAndroid ? loadScreens() : [];
let fold = foldFrom(screens);
const listeners = new Set();
/** fn() whenever the detected fold changes (a new screen was seen). Returns unsubscribe. */
export const onFoldChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/**
 * Stores this screen's size. Only on Android: a desktop moved between monitors, or an iPad, would
 * otherwise look like a fold. Sizes within a few px of a known one (pixel-ratio rounding) count as it.
 */
export function noteScreen() {
  if (!isAndroid) return;
  const [w, h] = currentScreen();
  if (!(w > 0 && h > 0)) return;
  if (screens.some(([a, b]) => Math.abs(a - w) <= 4 && Math.abs(b - h) <= 4)) return;
  screens = [...screens, [w, h]].slice(-8);
  try { localStorage.setItem(KEY, JSON.stringify(screens)); } catch {}
  const next = foldFrom(screens);
  if (JSON.stringify(next) !== JSON.stringify(fold)) { fold = next; listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
}

/** This device's two screens when it is a book-style foldable (seen both), else null. */
export const deviceFold = () => fold;

/** Starts learning: now, and whenever the screen changes (fold, unfold, turn). */
export function watchScreens() {
  noteScreen();
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(noteScreen, 400); };
  addEventListener('resize', later);
  screen.orientation?.addEventListener?.('change', later);
}
