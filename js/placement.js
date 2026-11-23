// Where the card sits on the wallpaper and what the system draws over it (render/Placement.kt).
import { unitSize } from './model.js';

/**
 * Screen areas the system usually draws over, as fractions of the screen height: status bar,
 * clock and At a Glance at the top; dock, search bar and gesture bar at the bottom. Approximate,
 * launchers differ: these are guides, not rules.
 */
export const CLOCK_END = 0.22;
export const DOCK_START = 0.84;

export const CARD_SIZE_RANGE = [0.3, 0.95];
export const NUDGE_RANGE = [-0.25, 0.25];
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** The card's centre and size on a W×H screen, before tilt. Shared with drawWallpaper. */
export function cardPlacement(cfg, W, H) {
  const [cw, ch] = unitSize(cfg);
  let width = Math.min(W, H) * cfg.cardSize;
  if (width * ch / cw > H * 0.92) width = H * 0.92 * cw / ch; // never taller than the screen
  const height = width * ch / cw;
  const r = (cfg.tilt || 0) * Math.PI / 180;
  const boundsH = width * Math.abs(Math.sin(r)) + height * Math.abs(Math.cos(r));
  const cy = H / 2 + cfg.nudge * H;
  return { cx: W / 2, cy, width, height, boundsH, top: cy - boundsH / 2, bottom: cy + boundsH / 2 };
}

/** { clock, dock }: which system areas the card runs into on a W×H screen. */
export function cardOverlaps(cfg, W, H) {
  if (!(W > 0 && H > 0)) return { clock: false, dock: false };
  const p = cardPlacement(cfg, W, H);
  return { clock: p.top < CLOCK_END * H, dock: p.bottom > DOCK_START * H };
}
export const overlapsAny = (o) => o.clock || o.dock;

/**
 * Smallest change that puts the card between the clock and the dock: shrinks it only if it is
 * taller than the gap, then moves it just far enough. Returns cfg itself when it already fits.
 */
export function fitBetweenGuides(cfg, W, H) {
  if (!overlapsAny(cardOverlaps(cfg, W, H))) return cfg;
  const margin = 0.01 * H;
  const top = CLOCK_END * H + margin, bottom = DOCK_START * H - margin, gap = bottom - top;
  const p = cardPlacement(cfg, W, H);
  let cardSize = cfg.cardSize;
  if (p.boundsH > gap) cardSize = clamp((p.width / Math.min(W, H)) * gap / p.boundsH, CARD_SIZE_RANGE);
  const q = cardPlacement({ ...cfg, cardSize, nudge: 0 }, W, H);
  const half = q.boundsH / 2;
  // Keep the user's nudge where possible; only move as far as needed.
  const cy = Math.min(Math.max(top + half, bottom - half), Math.max(top + half, q.cy + cfg.nudge * H));
  let nudge = clamp((cy - q.cy) / H, NUDGE_RANGE);
  if (Math.abs(nudge) < 0.005) nudge = 0;
  return { ...cfg, cardSize, nudge };
}

/** Phone-sized screens (short side under 600 CSS px) at most 1.2:1, where landscape cards fit better. */
export function isSmallSquarish(w, h) {
  if (!(w > 0 && h > 0)) return false;
  return Math.min(w, h) < 600 && Math.max(w, h) / Math.min(w, h) <= 1.2;
}
