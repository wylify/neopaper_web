// How a payload packs into a QR code: a port of NEOPAPER's render/QrCapacity.kt.
import { ECC, dataBits, segmentBits, isAlnum } from './qr.js';

/** Up to here the code scans easily off a phone screen at wallpaper size. */
export const RECOMMENDED_VERSION = 10;
/** Beyond this the modules get too small for a reliable scan from a screen. */
export const MAX_VERSION = 15;
/** Warn once this share of the recommended capacity is used. */
export const NEAR_RATIO = 0.85;

export const ECC_NAME = ['L', 'M', 'Q', 'H'];

/** Data bits for [text] at a version's count widths. */
export const bits = (text, version) => (text ? segmentBits(text, version) : 0);

/**
 * { version, ecc, usedBits, budgetBits, status: OK|NEAR|DENSE|TOO_LONG, byteChars,
 *   freeBits, moreCaps, moreOther, fill, modules }
 */
export function plan(payload) {
  const text = payload || ' ';
  const budget = dataBits(RECOMMENDED_VERSION, ECC.L);
  const byteChars = [...text].filter((c) => !isAlnum(c)).length;
  const usedAtRec = bits(text, RECOMMENDED_VERSION);
  let version = 40, ecc = ECC.L, status = 'TOO_LONG';
  for (let v = 1; v <= 40; v++) {
    const used = bits(text, v);
    if (used > dataBits(v, ECC.L)) continue;
    // Free robustness: the strongest ECC that still fits in this same version.
    ecc = [ECC.H, ECC.Q, ECC.M, ECC.L].find((e) => used <= dataBits(v, e));
    version = v;
    status = v > MAX_VERSION ? 'TOO_LONG' : v > RECOMMENDED_VERSION ? 'DENSE' : usedAtRec > budget * NEAR_RATIO ? 'NEAR' : 'OK';
    break;
  }
  const freeBits = Math.max(0, budget - usedAtRec);
  return {
    version, ecc, usedBits: usedAtRec, budgetBits: budget, status, byteChars, freeBits,
    moreCaps: Math.floor(freeBits / 5.5), moreOther: Math.floor(freeBits / 8),
    fill: usedAtRec / budget, modules: 17 + 4 * version,
  };
}
