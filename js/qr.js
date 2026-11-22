// QR Code encoder (ISO/IEC 18004), modelled on Project Nayuki's QR Code generator (MIT).
// Like ZXing's minimal encoder in the Android app, it splits text into numeric / alphanumeric /
// byte segments so CAPS text packs tight, and adds a UTF-8 ECI when the text is not ASCII.

export const ECC = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = [1, 0, 3, 2]; // L M Q H

const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** Data bits a version holds at an error correction level. */
export function dataBits(ver, ecc) {
  return (Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver] * BLOCKS[ecc][ver]) * 8;
}

// ── Segments ────────────────────────────────────────────────────────────────────────────

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
export const isAlnum = (c) => c.length === 1 && ALNUM.includes(c);
const isNum = (c) => c >= '0' && c <= '9' && c.length === 1;
const NUMERIC = 0, ALPHA = 1, BYTE = 2;
const MODE_BITS = [0x1, 0x2, 0x4];
const COUNT_BITS = [[10, 12, 14], [9, 11, 13], [8, 16, 16]];
const versionClass = (v) => (v <= 9 ? 0 : v <= 26 ? 1 : 2);
export const countBits = (mode, ver) => COUNT_BITS[mode][versionClass(ver)];

const enc = new TextEncoder();
const utf8Len = (ch) => enc.encode(ch).length;

/**
 * Cheapest split of [text] into segments for one version class (dynamic programming over the
 * three modes, costs in sixths of a bit: numeric 10/3, alphanumeric 11/2, byte 8 per UTF-8 byte).
 * Returns [{ mode, chars: string }].
 */
const segCache = new Map();
export function segment(text, ver) {
  // Only the count-field widths depend on the version, and they come in three classes.
  const key = versionClass(ver) + '|' + text;
  let segs = segCache.get(key);
  if (!segs) {
    segs = segmentUncached(text, ver);
    if (segCache.size > 64) segCache.delete(segCache.keys().next().value);
    segCache.set(key, segs);
  }
  return segs;
}

function segmentUncached(text, ver) {
  const chars = [...text];
  if (!chars.length) return [];
  const INF = 1e15;
  const head = [0, 1, 2].map((m) => (4 + countBits(m, ver)) * 6);
  const n = chars.length;
  // cost[i][m] = cheapest encoding of chars[0..i] that ends in mode m; from[i][m] = mode at i-1.
  const cost = new Array(n), from = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = chars[i];
    const per = [isNum(c) ? 20 : INF, isAlnum(c) ? 33 : INF, 48 * utf8Len(c)];
    cost[i] = [INF, INF, INF]; from[i] = [-1, -1, -1];
    for (let m = 0; m < 3; m++) {
      if (per[m] >= INF) continue;
      if (i === 0) { cost[i][m] = head[m] + per[m]; continue; }
      const prev = cost[i - 1];
      let best = prev[m], bestFrom = m; // stay in m
      for (let p = 0; p < 3; p++) {
        if (p !== m && prev[p] + head[m] < best) { best = prev[p] + head[m]; bestFrom = p; }
      }
      cost[i][m] = best + per[m]; from[i][m] = bestFrom;
    }
  }
  let m = cost[n - 1].indexOf(Math.min(...cost[n - 1]));
  const modes = new Array(n);
  for (let i = n - 1; i >= 0; i--) { modes[i] = m; m = from[i][m]; }
  const segs = [];
  for (let i = 0; i < n; i++) {
    const last = segs[segs.length - 1];
    if (last && last.mode === modes[i]) last.chars += chars[i];
    else segs.push({ mode: modes[i], chars: chars[i] });
  }
  return segs;
}

const nonAscii = (text) => /[^\x00-\x7F]/.test(text);

/** Exact data bits for the segments (plus the UTF-8 ECI header when needed). */
export function segmentBits(text, ver, segs = segment(text, ver)) {
  let bits = nonAscii(text) ? 12 : 0;
  for (const s of segs) {
    const len = [...s.chars].length;
    bits += 4 + countBits(s.mode, ver);
    if (s.mode === NUMERIC) bits += Math.floor(len / 3) * 10 + [0, 4, 7][len % 3];
    else if (s.mode === ALPHA) bits += Math.floor(len / 2) * 11 + (len % 2) * 6;
    else bits += enc.encode(s.chars).length * 8;
  }
  return bits;
}

class Bits {
  constructor() { this.a = []; }
  push(val, len) { for (let i = len - 1; i >= 0; i--) this.a.push((val >>> i) & 1); }
}

function writeSegments(bb, text, ver, segs) {
  if (nonAscii(text)) { bb.push(0x7, 4); bb.push(26, 8); } // ECI 26 = UTF-8
  for (const s of segs) {
    bb.push(MODE_BITS[s.mode], 4);
    if (s.mode === BYTE) {
      const bytes = enc.encode(s.chars);
      bb.push(bytes.length, countBits(BYTE, ver));
      for (const b of bytes) bb.push(b, 8);
    } else if (s.mode === NUMERIC) {
      const d = s.chars;
      bb.push(d.length, countBits(NUMERIC, ver));
      for (let i = 0; i < d.length; i += 3) { const g = d.slice(i, i + 3); bb.push(parseInt(g, 10), g.length * 3 + 1); }
    } else {
      const d = s.chars;
      bb.push(d.length, countBits(ALPHA, ver));
      for (let i = 0; i + 1 < d.length; i += 2) bb.push(ALNUM.indexOf(d[i]) * 45 + ALNUM.indexOf(d[i + 1]), 11);
      if (d.length % 2) bb.push(ALNUM.indexOf(d[d.length - 1]), 6);
    }
  }
}

// ── Reed–Solomon ────────────────────────────────────────────────────────────────────────

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
const divisors = new Map();
function rsDivisor(degree) {
  let d = divisors.get(degree);
  if (d) return d;
  d = new Array(degree).fill(0); d[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { d[j] = gfMul(d[j], root); if (j + 1 < degree) d[j] ^= d[j + 1]; }
    root = gfMul(root, 0x02);
  }
  divisors.set(degree, d);
  return d;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    for (let i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
  }
  return r;
}

// ── Matrix ──────────────────────────────────────────────────────────────────────────────

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function build(ver, ecc, codewords) {
  const size = ver * 4 + 17;
  const mod = new Uint8Array(size * size), fn = new Uint8Array(size * size);
  const set = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignmentPositions(ver), na = al.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask) => {
    const data = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, bit); set(c, a, bit);
    }
  }

  // Data in the zig-zag order, two columns at a time, skipping the vertical timing column.
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y * size + x] && i < total) { mod[y * size + x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    const f = MASKS[m];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && f(x, y)) mod[y * size + x] ^= 1;
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const s = penalty(mod, size);
    if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m); // XOR again undoes it
  }
  applyMask(best); drawFormat(best);
  return { size, modules: mod };
}

/** ISO 18004 mask penalty: runs, 2×2 blocks, finder-like patterns and dark/light balance. */
function penalty(m, n) {
  let score = 0, dark = 0;
  const line = new Uint8Array(n);
  // 1:1:3:1:1 dark pattern with 4 light modules on one side (outside the symbol counts as light).
  const scanLine = () => {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (line[i] === line[i - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
    }
    for (let i = 0; i + 7 <= n; i++) {
      if (line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6]) {
        let before = true, after = true;
        for (let k = 1; k <= 4; k++) { if (i - k >= 0 && line[i - k]) before = false; if (i + 6 + k < n && line[i + 6 + k]) after = false; }
        if (before || after) score += 40;
      }
    }
  };
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) line[x] = m[y * n + x]; scanLine(); }
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) line[y] = m[y * n + x]; scanLine(); }
  for (let y = 0; y + 1 < n; y++) {
    const r0 = y * n, r1 = r0 + n;
    for (let x = 0; x + 1 < n; x++) {
      const c = m[r0 + x];
      if (c === m[r0 + x + 1] && c === m[r1 + x] && c === m[r1 + x + 1]) score += 3;
    }
  }
  for (let i = 0; i < n * n; i++) dark += m[i];
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * 10;
}

/**
 * Encodes [text] at the smallest version ≥ [minVersion] that holds it at [ecc], then raises
 * error correction for free as far as that version allows (like the Android plan).
 * Returns { version, ecc, size, modules: Uint8Array (row-major, 1 = dark) } or null if too long.
 */
export function encodeQr(text, { minVersion = 1, ecc = ECC.L, boost = true } = {}) {
  let ver = minVersion, segs, used;
  for (; ver <= 40; ver++) {
    segs = segment(text, ver);
    used = segmentBits(text, ver, segs);
    if (used <= dataBits(ver, ecc)) break;
  }
  if (ver > 40) return null;
  if (boost) for (const e of [ECC.H, ECC.Q, ECC.M]) if (e > ecc && used <= dataBits(ver, e)) { ecc = e; break; }

  const cap = dataBits(ver, ecc);
  const bb = new Bits();
  writeSegments(bb, text, ver, segs);
  bb.push(0, Math.min(4, cap - bb.a.length));
  bb.push(0, (8 - (bb.a.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bb.a.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bb.a[i + j]; data.push(b); }
  for (let pad = 0xEC; data.length < cap / 8; pad ^= 0xEC ^ 0x11) data.push(pad);

  // Split into blocks, add error correction, interleave.
  const nb = BLOCKS[ecc][ver], eccLen = ECC_PER_BLOCK[ecc][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortCount = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    if (i < shortCount) dat.push(0);
    blocks.push(dat.concat(e));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) if (i !== shortLen - eccLen || j >= shortCount) out.push(blocks[j][i]);
  }
  return { version: ver, ecc, ...build(ver, ecc, out) };
}
