// QR + barcode for a card, turned into Path2D in module units (render/Codes.kt).
// Encoding is the only expensive step of drawing a card, so results are cached by content.
import { encodeQr, ECC } from './qr.js';
import { plan } from './capacity.js';
import { code128Widths } from './code128.js';

const cache = new Map();
const MAX = 48;

function qrPath(q) {
  const p = new Path2D(), n = q.size, m = q.modules;
  // One rect per horizontal run instead of per module.
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (m[y * n + x]) { const s = x; while (x < n && m[y * n + x]) x++; p.rect(s, y, x - s, 1); } else x++;
    }
  }
  return p;
}

export function barcode(text) {
  const widths = code128Widths(text);
  const p = new Path2D();
  let x = 0;
  widths.forEach((w, i) => { if (i % 2 === 0) p.rect(x, 0, w, 1); x += w; });
  return { modules: Math.max(1, x), path: p };
}

/**
 * { qrModules, qrPath, qrBytes, qrVersion, qrEcc, plan, barModules, barPath, qr }
 */
export function cardCodes(qrPayload, barcodeText) {
  const key = qrPayload + '\u0000' + barcodeText;
  let c = cache.get(key);
  if (c) { cache.delete(key); cache.set(key, c); return c; }
  const pl = plan(qrPayload);
  const text = qrPayload || ' ';
  // Planned version and ECC first; if the estimate is off, let the encoder pick from version 1.
  const q = encodeQr(text, { minVersion: Math.min(pl.version, 40), ecc: pl.ecc, boost: false })
    || encodeQr(text, { ecc: ECC.L }) || encodeQr('TOO LONG');
  const bar = barcode(barcodeText);
  c = {
    qr: q, qrModules: q.size, qrPath: qrPath(q), qrBytes: new TextEncoder().encode(qrPayload).length,
    qrVersion: q.version, qrEcc: ['L', 'M', 'Q', 'H'][q.ecc], plan: pl, barModules: bar.modules, barPath: bar.path,
  };
  cache.set(key, c);
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  return c;
}
