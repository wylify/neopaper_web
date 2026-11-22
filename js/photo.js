// Backdrop photos: decoded once, downscaled, plus a blurred and a mono copy for the effects.
import { getPhoto } from './store.js';

/** Long side cap: bounds memory and keeps exports fast. */
const MAX_SIDE = 2560;

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

/**
 * Turns a picked file into a stored-size JPEG. Decoding goes through <img>, so anything the
 * browser can show works (HEIC on iPhone too) and EXIF rotation is applied.
 */
export async function prepareFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const f = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvas(Math.round(img.naturalWidth * f), Math.round(img.naturalHeight * f));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

async function decode(blob) {
  if ('createImageBitmap' in self) { try { return await createImageBitmap(blob); } catch {} }
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}

/** { full, blurred, mono() }: the mono copy is only made when the effect is first used. */
export function photoSet(full) {
  const w = full.width, h = full.height;
  // Two-step downscale, drawn back up with smoothing = a cheap, smooth blur.
  const tiny = canvas(Math.max(2, Math.round(w / 32)), Math.max(2, Math.round(h / 32)));
  tiny.getContext('2d').drawImage(full, 0, 0, tiny.width, tiny.height);
  const soft = canvas(Math.max(2, Math.round(w / 8)), Math.max(2, Math.round(h / 8)));
  const sx = soft.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(tiny, 0, 0, soft.width, soft.height);
  let mono = null;
  return {
    full, blurred: soft,
    mono() {
      if (!mono) {
        mono = canvas(w, h);
        const x = mono.getContext('2d', { willReadFrequently: true });
        x.drawImage(full, 0, 0);
        const d = x.getImageData(0, 0, w, h), p = d.data;
        // Saturation 0, as Compose's ColorMatrix.setToSaturation(0f).
        for (let i = 0; i < p.length; i += 4) { const l = 0.213 * p[i] + 0.715 * p[i + 1] + 0.072 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = l; }
        x.putImageData(d, 0, 0);
      }
      return mono;
    },
  };
}

const sets = new Map();
/** Photo set for a stored photo id, decoded once per session. */
export async function loadPhoto(id) {
  if (!id) return null;
  if (sets.has(id)) return sets.get(id);
  const p = (async () => {
    const blob = await getPhoto(id);
    if (!blob) return null;
    return photoSet(await decode(blob));
  })().catch(() => null);
  sets.set(id, p);
  const v = await p;
  if (!v) sets.delete(id);
  return v;
}
export function forgetPhoto(id) { sets.delete(id); }
