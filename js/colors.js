// Colour helpers and contrast-safe suggestions: a port of NEOPAPER's model/ColorSuggest.kt.

const r8 = (c) => (c >>> 16) & 0xFF, g8 = (c) => (c >>> 8) & 0xFF, b8 = (c) => c & 0xFF;
const pack = (r, g, b) => (0xFF000000 | (r << 16) | (g << 8) | b) | 0;

/** [h 0–360, s 0–1, v 0–1] */
export function toHsv(c) {
  const r = r8(c) / 255, g = g8(c) / 255, b = b8(c) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function fromHsv(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return pack(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

export function luminance(c) {
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r8(c)) + 0.7152 * lin(g8(c)) + 0.0722 * lin(b8(c));
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ink must keep text and codes readable and scannable: aim well above 4.5:1. */
export const INK_TARGET = 7;
/** Backdrop only needs the card to stand out from it. */
export const BACKDROP_TARGET = 3;

function baseOf(card) {
  const [h, s] = toHsv(card);
  // Greys have no meaningful hue; borrow the brand's acid-lime hue so suggestions still have character.
  return [s < 0.12 ? 72 : h, luminance(card) > 0.18];
}

function mix(c, toward, t) {
  const k = Math.min(1, Math.max(0, t));
  const ch = (v) => Math.min(255, Math.max(0, Math.trunc(v + (toward * 255 - v) * k)));
  return pack(ch(r8(c)), ch(g8(c)), ch(b8(c)));
}

/** Mix [c] toward black or white (whichever is away from [against]) until contrast ≥ [target]. */
function fit(c, against, target) {
  const toward = luminance(against) > 0.18 ? 0 : 1;
  let t = 0, out = c;
  while (contrast(out, against) < target && t < 1) { t += 0.04; out = mix(c, toward, t); }
  return out;
}

const distinct = (a) => [...new Set(a)];

export function suggestInk(card) {
  const [h, light] = baseOf(card);
  return distinct([
    fit(fromHsv(h + 25, 0.7, light ? 0.3 : 0.95), card, INK_TARGET),
    fit(fromHsv(h + 180, 0.85, light ? 0.45 : 0.9), card, INK_TARGET),
    fit(fromHsv(h, 0.08, light ? 0.08 : 0.96), card, INK_TARGET),
  ]);
}

export function suggestBackdrop(card) {
  const [h, light] = baseOf(card);
  return distinct([
    fit(fromHsv(h - 30, 0.55, light ? 0.2 : 0.85), card, BACKDROP_TARGET),
    fit(fromHsv(h + 180, 0.35, light ? 0.28 : 0.8), card, BACKDROP_TARGET),
    fit(fromHsv(h, 0.1, light ? 0.09 : 0.92), card, BACKDROP_TARGET),
  ]);
}

/** Compose's Color.luminance() is the same relative luminance. */
export const isLight = (c, threshold) => luminance(c) > threshold;
