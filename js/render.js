// Card and wallpaper drawing on Canvas 2D: a port of NEOPAPER's render/CardRenderer.kt and
// render/WallpaperRenderer.kt. Layout happens in card units (a 3:4 card is 300×400) and is scaled
// once, so previews, thumbnails and a 4K export are the same design.
import { cardPlacement } from './placement.js';
import { FIELD_ICONS, SYMBOLS, ROW_KINDS, rowHeight, unitSize, css, PHOTO_ZOOM_RANGE } from './model.js';
import { luminance } from './colors.js';

// ── Glyphs, parsed once ────────────────────────────────────────────────────────────────

const P = (d) => new Path2D(d);
const icons = Object.fromEntries(Object.entries(FIELD_ICONS).map(([k, d]) => [k, P(d)]));
const symbols = Object.fromEntries(Object.entries(SYMBOLS).map(([k, d]) => [k, P(d)]));
export const WARNING_PATH = 'M12 3 22 20.5H2zM12 9.5v5M12 17.5v.2';
const warning = P(WARNING_PATH);

function strip(fn) { const p = new Path2D(); fn(p); return p; }
const G = {
  // Subline patterns, long enough for the widest setting and clipped to the chosen width.
  subChevrons: strip((p) => { for (let i = 0; i < 15; i++) { const o = i * 7 + 1; p.moveTo(o, 1); p.lineTo(o + 3, 4); p.lineTo(o, 7); } }),
  subBars: strip((p) => {
    const unit = [[0, 3], [4, 1], [7, 2], [10, 1], [13, 3], [17, 1], [19, 2], [23, 1], [25, 3]];
    for (let i = 0; i < 4; i++) for (const [x, w] of unit) p.rect(i * 30 + x, 0, w, 8);
  }),
  // Filler strips, 600 units wide, drawn at 1:1 and clipped to the row width.
  x: strip((p) => { for (let i = 0; i < 30; i++) { const o = i * 20 + 1; p.moveTo(o, 1); p.lineTo(o + 12, 13); p.moveTo(o + 12, 1); p.lineTo(o, 13); } }),
  chevrons: strip((p) => { for (let i = 0; i < 60; i++) { const o = i * 10 + 1; p.moveTo(o, 1); p.lineTo(o + 5, 6); p.lineTo(o, 11); } }),
  ticks: strip((p) => { for (let i = 0; i < 150; i++) { const o = i * 4 + 0.5; const l = i % 10 === 0 ? 12 : i % 5 === 0 ? 8 : 4; p.moveTo(o, 0); p.lineTo(o, l); } }),
  glitch: strip((p) => {
    let s = 7;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    let o = 0;
    while (o < 600) {
      const w = 1 + Math.trunc(rnd() * 16), gap = 1 + Math.trunc(rnd() * 9);
      const y = rnd() < 0.5 ? 0 : Math.trunc(rnd() * 5);
      const hh = 12 - y - Math.trunc(rnd() * 4);
      p.rect(o, y, w, hh); o += w + gap;
    }
  }),
  circuit: strip((p) => {
    for (let o = 0; o < 600; o += 200) {
      p.moveTo(o, 12); p.lineTo(o + 40, 12); p.lineTo(o + 48, 4); p.lineTo(o + 110, 4); p.lineTo(o + 118, 12); p.lineTo(o + 160, 12);
      p.moveTo(o + 166, 12); p.arc(o + 163, 12, 3, 0, Math.PI * 2);
      p.moveTo(o + 166, 12); p.lineTo(o + 200, 12); p.moveTo(o + 80, 4); p.lineTo(o + 80, 1);
    }
  }),
};

// ── Text ───────────────────────────────────────────────────────────────────────────────
// Text is laid out at a 100px base size and scaled, so layout is identical at every zoom
// level and browsers never round tiny glyph advances.

const BASE = 100;
const nativeSpacing = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
const mctx = document.createElement('canvas').getContext('2d');

export const SANS = '"Space Grotesk"', MONO = '"JetBrains Mono"';
const style = (family, weight, size, ls = 0) => ({ family, weight, size, ls, font: `${weight} ${BASE}px ${family}`, key: `${family}${weight}${ls}` });
const MONO_S = style(MONO, 600, 7.5, 0.12);
const SUB_S = style(MONO, 600, 8.5, 0.14);
const VALUE_S = style(SANS, 500, 13.5);
const WARN_S = style(MONO, 700, 8, 0.16);
const MICRO_S = style(MONO, 400, 6.5, 0.16);
const codeStyle = (size) => style(SANS, 700, size, -0.05);

const metrics = new Map();
function fontMetrics(st) {
  let m = metrics.get(st.font);
  if (!m) {
    mctx.font = st.font;
    const t = mctx.measureText('Hg');
    const asc = t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent * 1.1;
    const desc = t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent * 1.3;
    m = { asc, desc };
    metrics.set(st.font, m);
  }
  return m;
}

const charW = new Map();
/** Width at the base size, letter spacing included. */
function baseWidth(text, st) {
  const ls = st.ls * BASE;
  if (nativeSpacing) {
    mctx.font = st.font; mctx.letterSpacing = `${ls}px`;
    const w = mctx.measureText(text).width;
    mctx.letterSpacing = '0px';
    return w;
  }
  mctx.font = st.font;
  if (!ls) return mctx.measureText(text).width;
  let w = 0;
  for (const ch of text) {
    const k = st.font + ch;
    let cw = charW.get(k);
    if (cw == null) { cw = mctx.measureText(ch).width; charW.set(k, cw); }
    w += cw + ls;
  }
  return w;
}

let measured = new Map();
/** One line, cut with "…" to fit [maxW] card units. { text, width, asc, desc, height } in units. */
function line(text, st, maxW = 10000) {
  const key = `${st.key}|${st.size}|${Math.round(maxW * 8)}|${text}`;
  let r = measured.get(key);
  if (r) return r;
  const k = st.size / BASE;
  const limit = Math.max(1, Math.ceil(maxW)) / k;
  let t = text, w = baseWidth(t, st);
  if (w > limit) {
    const cps = [...text];
    let lo = 0, hi = cps.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (baseWidth(cps.slice(0, mid).join('') + '…', st) <= limit) lo = mid; else hi = mid - 1;
    }
    t = lo ? cps.slice(0, lo).join('').trimEnd() + '…' : '';
    w = t ? baseWidth(t, st) : 0;
  }
  const m = fontMetrics(st);
  r = { text: t, width: w * k, asc: m.asc * k, desc: m.desc * k, height: (m.asc + m.desc) * k, st };
  if (measured.size > 4000) measured = new Map();
  measured.set(key, r);
  return r;
}

/** Fonts finished loading: drop measurements taken with fallback fonts. */
export function resetTextCache() { measured = new Map(); metrics.clear(); charW.clear(); }

/** Draws a measured line with its layout box top-left at (x, top). */
function drawLine(ctx, l, x, top, color, boxH = l.height) {
  if (!l.text) return;
  const st = l.st, k = st.size / BASE;
  const baseline = top + boxH / 2 - l.height / 2 + l.asc;
  ctx.save();
  ctx.translate(x, baseline); ctx.scale(k, k);
  ctx.font = st.font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const ls = st.ls * BASE;
  if (nativeSpacing || !ls) {
    if (nativeSpacing) ctx.letterSpacing = `${ls}px`;
    ctx.fillText(l.text, 0, 0);
    if (nativeSpacing) ctx.letterSpacing = '0px';
  } else {
    let cx = 0;
    for (const ch of l.text) { ctx.fillText(ch, cx, 0); cx += (charW.get(st.font + ch) ?? ctx.measureText(ch).width) + ls; }
  }
  ctx.restore();
}

// ── Card ───────────────────────────────────────────────────────────────────────────────

const PAD = 16, PAD_B = 14;

export function microText(code) {
  // djb2-xor over UTF-16 units in 32-bit unsigned arithmetic, like the Kotlin Long version.
  let h = 5381n;
  for (let i = 0; i < code.length; i++) h = ((h * 33n) ^ BigInt(code.charCodeAt(i))) & 0xFFFFFFFFn;
  const hex = (n) => (n & 0xFFFFn).toString(16).toUpperCase().padStart(4, '0');
  return `${code} // ${hex(h)}-${hex(h >> 7n)} // DEVICE.TAG.V2 // AUTH ${hex(h * 31n)} // `.repeat(3);
}

export function cardShape(cfg, w, h) {
  const p = new Path2D();
  if (cfg.corner === 'CUT') { p.moveTo(0, 0); p.lineTo(w - 16, 0); p.lineTo(w, 16); p.lineTo(w, h); p.lineTo(16, h); p.lineTo(0, h - 16); p.closePath(); }
  else roundRect(p, 0, 0, w, h, cfg.corner === 'ROUNDED' ? 12 : 2);
  return p;
}
function roundRect(p, x, y, w, h, r) {
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.arcTo(x + w, y, x + w, y + r, r);
  p.lineTo(x + w, y + h - r); p.arcTo(x + w, y + h, x + w - r, y + h, r);
  p.lineTo(x + r, y + h); p.arcTo(x, y + h, x, y + h - r, r);
  p.lineTo(x, y + r); p.arcTo(x, y, x + r, y, r); p.closePath();
}

function stroke(ctx, path, color, width, round = false) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.lineCap = round ? 'round' : 'butt'; ctx.lineJoin = round ? 'round' : 'miter'; ctx.miterLimit = 4;
  ctx.stroke(path);
}

function clipRect(ctx, x, y, w, h, fn) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); fn(); ctx.restore();
}

/** Draws a 24-unit glyph at [size]. */
function icon(ctx, path, x, y, size, color, filled) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24);
  if (filled) { ctx.fillStyle = color; ctx.fill(path); } else stroke(ctx, path, color, 2.2, true);
  ctx.restore();
}

/** -45° hazard stripes: [stripe] wide bands with [gap] between them, measured across the band. */
function stripes(ctx, x, y, w, h, stripe, gap, ink) {
  if (w <= 0) return;
  clipRect(ctx, x, y, w, h, () => {
    const k = 1.41421, sw = stripe * k, period = (stripe + gap) * k;
    const p = new Path2D();
    for (let sx = x - h; sx < x + w; sx += period) { p.moveTo(sx, y + h); p.lineTo(sx + h, y); p.lineTo(sx + h + sw, y); p.lineTo(sx + sw, y + h); p.closePath(); }
    ctx.fillStyle = ink; ctx.fill(p);
  });
}

function dots(ctx, x, y, w, h, cell, r, ink) {
  clipRect(ctx, x, y, w, h, () => {
    const p = new Path2D();
    for (let yy = y + cell / 2; yy < y + h; yy += cell) for (let xx = x + cell / 2; xx < x + w; xx += cell) { p.moveTo(xx + r, yy); p.arc(xx, yy, r, 0, Math.PI * 2); }
    ctx.fillStyle = ink; ctx.fill(p);
  });
}

/** A 600-unit pattern strip scaled by [k] (row height over its default), tiled across [w]. */
function patternStrip(ctx, p, x, y, w, h, ink, sw, k) {
  clipRect(ctx, x, y, w, h, () => {
    for (let ox = 0; ox < w; ox += 600 * k) {
      ctx.save(); ctx.translate(x + ox, y); ctx.scale(k, k);
      if (sw > 0) stroke(ctx, p, ink, sw); else { ctx.fillStyle = ink; ctx.fill(p); }
      ctx.restore();
    }
  });
}

/** Draws one row at (x, y) in card units. Also used by row previews in the UI. */
export function drawRow(ctx, r, cfg, x, y, width, ink, hideValue = false) {
  const rh = rowHeight(r);
  // Extra height above the default is split evenly above and below the content.
  const dy = (rh - ROW_KINDS[r.kind].def) / 2;
  switch (r.kind) {
    case 'owner': case 'contact': case 'date': case 'custom': {
      let cx = x;
      const ic = r.kind === 'custom' && r.icon !== 'none' ? icons[r.icon] : null;
      if (ic) { icon(ctx, ic, cx, y + dy + 3, 11, ink, false); cx += 18; }
      const lab = line(r.label.toUpperCase(), MONO_S, 50);
      drawLine(ctx, lab, cx, y + dy + 8.5 - lab.height / 2, ink);
      cx += 57;
      if (!hideValue) {
        const v = line(r.value, VALUE_S, x + width - cx);
        drawLine(ctx, v, cx, y + dy + 8.5 - v.height / 2, ink);
      }
      ctx.fillStyle = ink; ctx.fillRect(x, y + rh - 1, width, 1);
      break;
    }
    case 'checks': {
      let cx = x;
      for (const c of r.checks) {
        if (cx > x + width - 20) break;
        if (c.checked) { ctx.fillStyle = ink; ctx.fillRect(cx, y + dy + 1, 8, 8); }
        else { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, y + dy + 1.5, 7, 7); }
        const t = line(c.label.toUpperCase(), MONO_S, x + width - cx - 13);
        drawLine(ctx, t, cx + 13, y + dy + 5 - t.height / 2, ink);
        cx += 13 + t.width + 14;
      }
      break;
    }
    case 'warning': {
      icon(ctx, warning, x, y + dy, 14, ink, false);
      const t = line(r.value.toUpperCase(), WARN_S, width - 60);
      drawLine(ctx, t, x + 21, y + dy + 7 - t.height / 2, ink);
      const tx = x + 21 + t.width + 7;
      if (tx < x + width) stripes(ctx, tx, y + dy + 3, x + width - tx, 8, 3, 4, ink);
      break;
    }
    case 'micro':
      clipRect(ctx, x, y, width, rh, () => {
        const t = line(microText(cfg.code), MICRO_S);
        drawLine(ctx, t, x, y + rh / 2 - t.height / 2, ink);
      });
      break;
    case 'hazard': stripes(ctx, x, y, width, rh, 5, 6, ink); break;
    case 'dots': dots(ctx, x, y, width, rh, 6, 1.1, ink); break;
    case 'scan':
      clipRect(ctx, x, y, width, rh, () => { ctx.fillStyle = ink; for (let yy = y; yy < y + rh; yy += 3) ctx.fillRect(x, yy, width, 1); });
      break;
    case 'x': case 'chevrons': case 'ticks': case 'circuit': case 'glitch': {
      const sw = { x: 1.6, chevrons: 1.8, ticks: 1, circuit: 1.2, glitch: 0 }[r.kind];
      patternStrip(ctx, G[r.kind], x, y, width, rh, ink, sw, rh / ROW_KINDS[r.kind].def);
      break;
    }
    case 'hanzi': case 'kana': case 'cyrillic': case 'hangul':
      ticker(ctx, TICKERS[r.kind], x, y, width, rh, ink, css(cfg.labelColor));
      break;
    case 'rule': case 'thick': ctx.fillStyle = ink; ctx.fillRect(x, y, width, rh); break;
    default: break;
  }
}

// ── Foreign-script warning tickers ─────────────────────────────────────────────────────
// A short run of parts laid out on a 14-unit row and repeated across the width, like signage
// tape. Taller rows scale the whole run. Same parts as the Android CardRenderer.kt.

const TAG_S = style(MONO, 700, 4.6, 0.1);
const TICKERS = {
  // "Warning · high voltage danger · keep away"
  hanzi: { st: style('"Warn Hanzi"', 400, 10, 0.04), parts: [['plate', '警告'], ['words', '高压危险'], ['chev', 14], ['words', '禁止靠近'], ['tag', 'ZH-07', 'WARN'], ['bars', 28]] },
  // "Danger · no entry · monitored zone"
  kana: { st: style('"Warn Kana"', 400, 9.5, 0.06), parts: [['words', '危険'], ['plate', '立入禁止'], ['words', '監視区域'], ['tag', 'JP-13', 'KEIKOKU'], ['stripes', 20]] },
  // "Attention · danger zone · do not enter"
  cyrillic: { st: style('"Warn Cyrillic"', 400, 8, 0.08), parts: [['plate', 'ВНИМАНИЕ'], ['words', 'ОПАСНАЯ ЗОНА'], ['stripes', 22], ['words', 'НЕ ВХОДИТЬ'], ['tag', 'RU-21', 'VNIM']] },
  // "Warning · no entry · surveillance zone"
  hangul: { st: style('"Warn Hangul"', 400, 9.5, 0.02), parts: [['plate', '경고'], ['words', '출입금지'], ['bars', 18], ['words', '감시구역'], ['tag', 'KR-44', 'GYEONGGO'], ['chev', 14]] },
};

function ticker(ctx, t, x, y, width, rh, ink, paper) {
  clipRect(ctx, x, y, width, rh, () => {
    const k = rh / 14, w = width / k;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    let cx = 0;
    while (cx < w) {
      for (const p of t.parts) {
        if (cx >= w) break;
        cx += tickPart(ctx, p, t.st, cx, ink, paper) + 6;
      }
    }
    ctx.restore();
  });
}

/** Draws one part with its left edge at [x] on a 14-unit row and returns its width. */
function tickPart(ctx, [kind, a, b], st, x, ink, paper) {
  switch (kind) {
    case 'plate': {
      const t = line(a, st), pw = t.width + 6;
      ctx.fillStyle = ink; ctx.fillRect(x, 1, pw, 12);
      // A notch in the top-right corner, like the card's cut corner.
      ctx.fillStyle = paper; ctx.beginPath(); ctx.moveTo(x + pw - 3, 1); ctx.lineTo(x + pw, 1); ctx.lineTo(x + pw, 4); ctx.closePath(); ctx.fill();
      drawLine(ctx, t, x + 3, 7 - t.height / 2, paper);
      return pw;
    }
    case 'words': { const t = line(a, st); drawLine(ctx, t, x, 7 - t.height / 2, ink); return t.width; }
    case 'tag': {
      const top = line(a, TAG_S), bot = line(b, TAG_S);
      ctx.fillStyle = ink; ctx.fillRect(x, 2, 1, 10);
      drawLine(ctx, top, x + 3, 4.5 - top.height / 2, ink);
      drawLine(ctx, bot, x + 3, 9.5 - bot.height / 2, ink);
      return 3 + Math.max(top.width, bot.width);
    }
    case 'stripes': stripes(ctx, x, 3, a, 8, 2.5, 3, ink); return a;
    case 'bars':
      clipRect(ctx, x, 3, a, 8, () => { ctx.save(); ctx.translate(x, 3); ctx.fillStyle = ink; ctx.fill(G.subBars); ctx.restore(); });
      return a;
    case 'chev':
      clipRect(ctx, x, 2, a, 10, () => { ctx.save(); ctx.translate(x, 3); stroke(ctx, G.subChevrons, ink, 1.6); ctx.restore(); });
      return a;
    default: return 0;
  }
}

// ── Geometry ───────────────────────────────────────────────────────────────────────
// Where every part of a card sits, in card units. Drawing, hit-testing and the builder's on-card
// overlays all read this, so a tap or a text cursor lands exactly on what is drawn.

const ROW_GAP = 7;
/** Code text size in card units for this card's shape. */
export const codeSize = (cfg) => { const [w, h] = unitSize(cfg); return w > h ? 40 : w < 280 ? 38 : 46; };
/** Fonts for the builder's inline fields: { family, weight, size, ls } in card units (ls in em). */
export const CODE_FONT = { family: SANS, weight: 700, ls: -0.05 };
export const VALUE_FONT = { family: SANS, weight: 500, size: 13.5, ls: 0 };

function valueRect(r, y, rh, right) {
  if (!(r.kind === 'owner' || r.kind === 'contact' || r.kind === 'date' || r.kind === 'custom')) return null;
  const dy = (rh - ROW_KINDS[r.kind].def) / 2;
  const x = PAD + (r.kind === 'custom' && r.icon !== 'none' ? 18 : 0) + 57;
  return { x, y: y + dy, w: right - x, h: 17 };
}

/** Body rows laid out top to bottom from [top]; once one runs into the footer, every later row is off the card. */
function slotRows(rows, top, bottomTop, right) {
  let ry = top, ok = true;
  return rows.map((r) => {
    const rh = rowHeight(r);
    if (ry + rh > bottomTop + 0.5) ok = false;
    const slot = { row: r, top: ry, height: rh, fits: ok, value: valueRect(r, ry, rh, right) };
    ry += rh + ROW_GAP;
    return slot;
  });
}

const geoCache = new WeakMap();
/**
 * { w, h, qr, qrX, textX, textW, innerW, codeH, hasSub, fills, fillsH, headerH, ruleY, contentTop,
 *   barH, barTop, capTop, bottomTop, rows: [{ row, top, height, fits, value }], code/header/qr/footer rects,
 *   rowsShown, slotsFor(order) }. Cached per card object (every edit makes a new one).
 */
export function cardGeometry(cfg) {
  let g = geoCache.get(cfg);
  if (g) return g;
  const [w, h] = unitSize(cfg);
  const landscape = w > h;
  const qr = Math.min(76, h * 0.22);
  const innerW = w - 2 * PAD;
  const textX = cfg.qrRight ? PAD : PAD + qr + 12;
  const textW = innerW - qr - 12;
  const codeH = codeSize(cfg) * 0.9;
  let y = PAD + codeH;
  const hasSub = !!(cfg.subText.trim() || cfg.subGraphic !== 'NONE');
  const subY = y + 7;
  if (hasSub) y += 17;
  const fills = cfg.headFill.filter((r) => ROW_KINDS[r.kind].filler);
  const fillsH = fills.length ? fills.reduce((a, r) => a + rowHeight(r), 0) + 5 * (fills.length - 1) : 0;
  const headerH = Math.max(qr, (y - PAD) + (fills.length ? 7 + fillsH : 0));
  const ruleY = PAD + headerH + 10;
  const contentTop = ruleY + 1.5 + 9;
  const barH = landscape ? 34 : 40;
  const barTop = h - PAD_B - barH;
  const capTop = barTop - 5 - 10;
  const bottomTop = capTop - 9;
  const qrX = cfg.qrRight ? w - PAD - qr : PAD;
  const rows = slotRows(cfg.rows, contentTop, bottomTop, PAD + innerW);
  g = {
    w, h, landscape, qr, qrX, innerW, textX, textW, codeH, hasSub, subY, fills, fillsH, headerH,
    ruleY, contentTop, barH, barTop, capTop, bottomTop, rows,
    rowLeft: PAD, rowRight: PAD + innerW,
    code: { x: textX, y: PAD, w: textW, h: codeH },
    header: { x: textX, y: PAD, w: textW, h: headerH },
    qrRect: { x: qrX, y: PAD, w: qr, h: qr },
    footer: { x: PAD, y: capTop - 1, w: innerW, h: barTop + barH - capTop + 1 },
    rowsShown: rows.filter((s) => s.fits).length,
    /** Body rows laid out in [order] from the same top, e.g. a reorder in progress. */
    slotsFor: (order) => slotRows(order, contentTop, bottomTop, PAD + innerW),
  };
  geoCache.set(cfg, g);
  return g;
}

/** Target ids: 'header' | 'qr' | 'footer' | row id (number). Rect of a target in card units, or null. */
export function targetRect(g, t) {
  if (t === 'header') return g.header;
  if (t === 'qr') return g.qrRect;
  if (t === 'footer') return g.footer;
  const s = g.rows.find((x) => x.row.id === t && x.fits);
  return s ? { x: g.rowLeft, y: s.top, w: g.innerW, h: s.height } : null;
}

/** What a tap at (x, y) in card units lands on. Each row also owns half the gap around it. */
export function hitTarget(g, x, y) {
  const s = g.rows.find((r) => r.fits && y >= r.top - ROW_GAP / 2 && y < r.top + r.height + ROW_GAP / 2);
  if (s) return s.row.id;
  const inside = (r, m) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;
  if (inside(g.qrRect, 6)) return 'qr';
  if (inside(g.header, 6)) return 'header';
  if (y >= g.capTop - 6) return 'footer';
  return null;
}

// ── Card ───────────────────────────────────────────────────────────────────────────────

/** Plate and ink for rows that won't be on the card (reorder view only). */
const OVERFLOW_PLATE = '#A3A3A8', OVERFLOW_INK = '#34343A';

/**
 * Draws a card with its top-left at (x, y), [widthPx] wide (height follows the ratio).
 * Returns { shown, total }: how many body rows fit.
 * Builder-only [opts] (the defaults draw the card exactly as it is exported):
 * hideValueOf / hideCode leave room for an on-card text field; showOverflow draws rows that
 * don't fit greyed out over the footer; dragRowId is drawn last, shifted by dragDy units;
 * geo draws with another row order's geometry.
 */
export function drawCard(ctx, cfg, codes, x, y, widthPx, opts = null) {
  const g = opts?.geo || cardGeometry(cfg);
  const s = widthPx / g.w;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  const shape = cardShape(cfg, g.w, g.h);
  ctx.fillStyle = css(cfg.labelColor); ctx.fill(shape);
  ctx.clip(shape);
  drawCardContent(ctx, cfg, codes, g, css(cfg.ink), opts || {});
  ctx.restore();
  return { shown: g.rowsShown, total: g.rows.length };
}

function drawCardContent(ctx, cfg, codes, g, ink, o) {
  const { w, h, textX, textW, innerW } = g;

  // ── Header: code, subline, header fillers ──
  if (!o.hideCode) {
    const code = line(cfg.code.trim() ? cfg.code : ' ', codeStyle(codeSize(cfg)), textW);
    drawLine(ctx, code, textX, PAD, ink, g.codeH);
  }
  if (g.hasSub) {
    const y = g.subY;
    let x = textX;
    const gy = y + 1;
    // Patterns never take more than the text column; text after them gets what is left.
    const gw = Math.min(cfg.subWidth, textW);
    switch (cfg.subGraphic) {
      case 'CHEVRONS':
        clipRect(ctx, x, gy - 1, gw, 10, () => { ctx.save(); ctx.translate(x, gy); stroke(ctx, G.subChevrons, ink, 1.6); ctx.restore(); });
        x += gw + 7; break;
      case 'HAZARD': stripes(ctx, x, gy, gw, 8, 2.5, 3, ink); x += gw + 7; break;
      case 'DOTS': dots(ctx, x, gy, gw, 8, 4, 0.9, ink); x += gw + 7; break;
      case 'BARS':
        clipRect(ctx, x, gy, gw, 8, () => { ctx.save(); ctx.translate(x, gy); ctx.fillStyle = ink; ctx.fill(G.subBars); ctx.restore(); });
        x += gw + 7; break;
      case 'SYMBOL': {
        const n = Math.min(Math.max(1, cfg.subRepeat), Math.max(1, Math.trunc((textW + 3) / 13)));
        for (let i = 0; i < n; i++) icon(ctx, symbols[cfg.subSymbol], x + i * 13, gy - 1, 10, ink, true);
        x += n * 13 + 4; break;
      }
    }
    if (cfg.subText.trim()) {
      const sub = line(cfg.subText, SUB_S, textX + textW - x);
      drawLine(ctx, sub, x, y + 5 - sub.height / 2, ink);
    }
  }
  let fy = PAD + g.headerH - g.fillsH;
  for (const r of g.fills) { drawRow(ctx, r, cfg, textX, fy, textW, ink); fy += rowHeight(r) + 5; }

  // QR with a 2-module quiet zone; the card colour is the light module colour.
  const mod = g.qr / (codes.qrModules + 4);
  ctx.save(); ctx.translate(g.qrX + 2 * mod, PAD + 2 * mod); ctx.scale(mod, mod);
  ctx.fillStyle = ink; ctx.fill(codes.qrPath);
  ctx.restore();

  ctx.fillStyle = ink; ctx.fillRect(PAD, g.ruleY, innerW, 1.5);

  // ── Footer: caption + barcode, always last ──
  const capTop = g.capTop;
  icon(ctx, symbols[cfg.symbol], PAD, capTop - 0.5, 11, ink, true);
  const cap = line(cfg.barcodeCaption, MONO_S, innerW / 2);
  drawLine(ctx, cap, PAD + 17, capTop + 5 - cap.height / 2, ink);
  const link = line(cfg.barcodeLink, MONO_S, innerW - 17 - cap.width - 12);
  drawLine(ctx, link, w - PAD - link.width, capTop + 5 - link.height / 2, ink);
  ctx.save(); ctx.translate(PAD, g.barTop); ctx.scale(innerW / codes.barModules, g.barH);
  ctx.fillStyle = ink; ctx.fill(codes.barPath);
  ctx.restore();

  // ── Body rows, top to bottom, until space runs out ──
  // Rows past the free space share one grey band over the footer, so they read as a block that
  // won't print and the barcode doesn't show through the gaps between them.
  if (o.showOverflow) {
    const over = g.rows.filter((s) => !s.fits && s.row.id !== o.dragRowId);
    if (over.length) {
      const top = over[0].top - ROW_GAP / 2, last = over[over.length - 1];
      ctx.fillStyle = OVERFLOW_PLATE; ctx.fillRect(PAD - 4, top, innerW + 8, last.top + last.height + ROW_GAP / 2 - top);
    }
  }
  let dragged = null;
  for (const s of g.rows) {
    if (s.row.id === o.dragRowId) { dragged = s; continue; }
    if (s.fits) drawRow(ctx, s.row, cfg, PAD, s.top, innerW, ink, s.row.id === o.hideValueOf);
    else if (o.showOverflow) drawRow(ctx, s.row, cfg, PAD, s.top, innerW, OVERFLOW_INK);
    else break;
  }
  if (dragged) drawRow(ctx, dragged.row, cfg, PAD, dragged.top + (o.dragDy || 0), innerW, ink);

  if (cfg.cornerMarks) {
    const p = new Path2D();
    const mark = (x, y0, dx, dy) => { p.moveTo(x, y0 + dy * 6); p.lineTo(x, y0); p.lineTo(x + dx * 6, y0); };
    mark(6, 6, 1, 1); mark(w - 6, h - 6, -1, -1);
    if (cfg.corner !== 'CUT') { mark(w - 6, 6, -1, 1); mark(6, h - 6, 1, -1); }
    stroke(ctx, p, ink, 1);
  }
}

// ── Wallpaper ──────────────────────────────────────────────────────────────────────────

const rgba = (c, a) => `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${a})`;

/**
 * Draws the whole wallpaper into a W×H area of [ctx]. [photo]: { full, blurred, mono() } or null.
 * Used for the live preview and the export — same code, same result.
 * opts (all optional, as WallpaperRenderer.kt):
 *  - card: false draws the backdrop alone (the home half of a dual wallpaper)
 *  - backdrop: false draws the card alone on a clear canvas (the photo framer's still top layer)
 *  - viewport: { x, y, w, h }, the part the card is laid out for (a foldable's closed-screen strip)
 *  - photoFrame: { x, y, w, h } the photo is framed for; the viewport unless given
 */
export function drawWallpaper(ctx, cfg, codes, photo, W, H, opts = {}) {
  const vp = opts.viewport || { x: 0, y: 0, w: W, h: H };
  const short = Math.min(vp.w, vp.h);
  const u = short / 390; // one CSS px of the 390-wide design

  const isPhoto = cfg.bgMode === 'PHOTO';
  const light = !isPhoto && luminance(cfg.bgColor) > 0.45;
  const lc = light ? 0x141414 : 0xFFFFFF;
  if (opts.backdrop !== false) {
    ctx.fillStyle = isPhoto ? '#1B1B21' : css(cfg.bgColor);
    ctx.fillRect(0, 0, W, H);
    if (isPhoto && photo) {
      const img = cfg.photoEffect === 'BLUR' ? photo.blurred : cfg.photoEffect === 'MONO' ? photo.mono() : photo.full;
      const r = photoRect(cfg, photo.full.width, photo.full.height, opts.photoFrame || vp);
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      // A soft fill wherever the photo runs out (it is framed for the visible screen).
      if (r.x > 0.5 || r.y > 0.5 || r.x + r.w < W - 0.5 || r.y + r.h < H - 0.5) {
        const b = photo.blurred, f = Math.max(W / b.width, H / b.height);
        ctx.drawImage(b, (W - b.width * f) / 2, (H - b.height * f) / 2, b.width * f, b.height * f);
      }
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (isPhoto) {
      // No photo yet: hatched placeholder.
      const p = new Path2D();
      for (let x = -H; x < W; x += 14 * u) { p.moveTo(x, H); p.lineTo(x + H, 0); }
      stroke(ctx, p, 'rgba(255,255,255,0.06)', 2 * u);
    }
    if (isPhoto) { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.9, Math.max(0, cfg.photoDim))})`; ctx.fillRect(0, 0, W, H); }

    if (cfg.overlay !== 'NONE') {
      const p = new Path2D();
      let a = 0.1;
      if (cfg.overlay === 'SCANLINES') for (let y = 0; y < H; y += 3 * u) p.rect(0, y, W, u);
      else if (cfg.overlay === 'GRID') {
        const step = 32 * u;
        for (let x = 0; x < W; x += step) p.rect(x, 0, u, H);
        for (let y = 0; y < H; y += step) p.rect(0, y, W, u);
        // Crossings are covered twice; fill with nonzero so they don't get darker.
      } else if (cfg.overlay === 'DOTS') {
        a = 0.22; const step = 14 * u;
        for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) { p.moveTo(x + u, y); p.arc(x, y, u, 0, Math.PI * 2); }
      } else if (cfg.overlay === 'HUD') {
        a = 0.25; p.rect(W / 2 - u / 2, 0, u, H); p.rect(0, H / 2 - u / 2, W, u);
      }
      ctx.fillStyle = rgba(lc, a); ctx.fill(p);
    }
  }

  // ── Card ──
  if (opts.card === false) return null;
  const [cw, ch] = unitSize(cfg);
  const place = cardPlacement(cfg, vp.w, vp.h); // shared with the clock/dock guides
  const cardW = place.width;
  const k = cardW / cw, cardH = ch * k;
  const cx = vp.x + place.cx, cy = vp.y + place.cy;
  const tlx = cx - cardW / 2, tly = cy - cardH / 2;

  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(cfg.tilt * Math.PI / 180); ctx.translate(-cx, -cy);
  if (cfg.cropMarks) {
    const g = 22 * k, l = 12 * k, p = new Path2D();
    const mark = (x, y, dx, dy) => { p.moveTo(x, y + dy * l); p.lineTo(x, y); p.lineTo(x + dx * l, y); };
    mark(tlx - g, tly - g, 1, 1); mark(tlx + cardW + g, tly - g, -1, 1);
    mark(tlx - g, tly + cardH + g, 1, -1); mark(tlx + cardW + g, tly + cardH + g, -1, -1);
    stroke(ctx, p, rgba(lc, 0.4), k);
  }
  // Soft drop shadow. Shadow sizes are in device pixels, so take the current scale into account.
  const m = ctx.getTransform(), dev = Math.hypot(m.a, m.b);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.32)'; ctx.shadowBlur = 25 * k * dev; ctx.shadowOffsetY = 16 * k * dev;
  ctx.translate(tlx, tly); ctx.scale(k, k);
  ctx.fillStyle = css(cfg.labelColor); ctx.fill(cardShape(cfg, cw, ch));
  ctx.restore();
  const info = drawCard(ctx, cfg, codes, tlx, tly, cardW);
  ctx.restore();
  return info;
}

/**
 * Where an iw×ih photo lands for [cfg]'s framing: it fills [vp] at zoom 1, and photoX/photoY slide
 * the screen across the slack the zoom leaves, so every framing stays covered edge to edge.
 * Same maths as photoRect in WallpaperRenderer.kt. Returns { x, y, w, h }.
 */
export function photoRect(cfg, iw, ih, vp) {
  const c = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const s = Math.max(vp.w / iw, vp.h / ih) * c(cfg.photoZoom, PHOTO_ZOOM_RANGE[0], PHOTO_ZOOM_RANGE[1], 1);
  const dw = iw * s, dh = ih * s;
  const sx = (dw - vp.w) / 2, sy = (dh - vp.h) / 2;
  return { x: vp.x - sx - c(cfg.photoX, -1, 1, 0) * sx, y: vp.y - sy - c(cfg.photoY, -1, 1, 0) * sy, w: dw, h: dh };
}

/** Card size in output px for an export, as the readout in the Export tab shows it. */
export function cardPx(cfg, W, H) { return cardPlacement(cfg, W, H).width; }
