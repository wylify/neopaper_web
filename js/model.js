// Card model: a port of NEOPAPER's model/Models.kt. Cards serialise to the same JSON as the
// Android app (data/CardRepository.kt), so a backup moves between the two unchanged.

import { NP_KEYS, encodeNp1, nextId } from './np1.js';
export { nextId };
export { NP_KEYS, NP_GROUPS } from './np1.js';

/** Every row a card can hold. Fillers carry no data and are also allowed in the header. */
export const ROW_KINDS = {
  owner:    { title: 'Owner',        filler: false, def: 20, min: 18, max: 40 },
  contact:  { title: 'Contact',      filler: false, def: 20, min: 18, max: 40 },
  date:     { title: 'Date',         filler: false, def: 20, min: 18, max: 40 },
  checks:   { title: 'Checkboxes',   filler: false, def: 10, min: 10, max: 24 },
  custom:   { title: 'Custom field', filler: false, def: 20, min: 18, max: 40 },
  warning:  { title: 'Warning',      filler: false, def: 14, min: 14, max: 28 },
  micro:    { title: 'Serial print', filler: true,  def: 9,  min: 8,  max: 20 },
  hazard:   { title: 'Slanted lines', filler: true, def: 12, min: 4,  max: 48 },
  x:        { title: 'X marks',      filler: true,  def: 14, min: 4,  max: 48 },
  dots:     { title: 'Dot grid',     filler: true,  def: 14, min: 4,  max: 48 },
  scan:     { title: 'Scanlines',    filler: true,  def: 12, min: 4,  max: 48 },
  glitch:   { title: 'Glitch bars',  filler: true,  def: 12, min: 4,  max: 48 },
  chevrons: { title: 'Chevrons',     filler: true,  def: 12, min: 4,  max: 48 },
  ticks:    { title: 'Ruler ticks',  filler: true,  def: 12, min: 4,  max: 48 },
  circuit:  { title: 'Circuit trace', filler: true, def: 16, min: 4,  max: 48 },
  hanzi:    { title: '警告 Chinese',  filler: true,  def: 14, min: 10, max: 32 },
  kana:     { title: '危険 Japanese', filler: true,  def: 14, min: 10, max: 32 },
  cyrillic: { title: 'ВНИМАНИЕ Russian', filler: true, def: 14, min: 10, max: 32 },
  hangul:   { title: '경고 Korean',   filler: true,  def: 14, min: 10, max: 32 },
  rule:     { title: 'Thin rule',    filler: true,  def: 1,  min: 1,  max: 3 },
  thick:    { title: 'Thick rule',   filler: true,  def: 4,  min: 2,  max: 12 },
  space:    { title: 'Spacer',       filler: true,  def: 8,  min: 2,  max: 64 },
};
export const INFO_KINDS = ['owner', 'contact', 'date', 'checks', 'warning', 'micro'];
export const FILLER_KINDS = ['hazard', 'x', 'dots', 'scan', 'glitch', 'chevrons', 'ticks', 'circuit', 'hanzi', 'kana', 'cyrillic', 'hangul', 'rule', 'thick', 'space'];
export const kindOf = (k) => ROW_KINDS[k] ? k : 'space';
export const isField = (k) => k === 'owner' || k === 'contact' || k === 'date' || k === 'custom';
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const rowHeight = (r) => clamp(r.height ?? ROW_KINDS[r.kind].def, ROW_KINDS[r.kind].min, ROW_KINDS[r.kind].max);

/** Stroke icons for custom fields, as 24×24 SVG path data. */
export const FIELD_ICONS = {
  none: 'M5 5l14 14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  phone: 'M7 2h10v20H7zM11 18h2',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  pin: 'M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  medical: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  key: 'M8 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM11.5 11.5 21 21M17 17l2.5-2.5M19.5 19.5 21 18',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

/** Solid symbols for the barcode caption and subline. */
export const SYMBOLS = {
  arrow: 'M4 3 L21 10.5 L13 12.6 L9.6 20.5 Z',
  star: 'M12 1.5 L14.6 9.4 L22.5 12 L14.6 14.6 L12 22.5 L9.4 14.6 L1.5 12 L9.4 9.4 Z',
  bolt: 'M13.5 1.5 L4 13.5 H11 L9.5 22.5 L20 9.5 H13 Z',
  plus: 'M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z',
  circle: 'M12 2.5a9.5 9.5 0 1 0 0.001 0z',
  dome: 'M2.5 19.5a9.5 9.5 0 0 1 19 0z',
  triangle: 'M12 2.5 L22.5 20.5 H1.5 Z',
};
export const symbolOf = (k) => SYMBOLS[k] ? k : 'arrow';

export const SUB_GRAPHICS = { NONE: 'None', CHEVRONS: 'Chevrons', HAZARD: 'Slanted', DOTS: 'Dots', BARS: 'Bars', SYMBOL: 'Symbol' };
export const isPattern = (g) => g !== 'NONE' && g !== 'SYMBOL';
export const SUB_WIDTH = [12, 96];
export const SUB_REPEAT = [1, 6];

export const RATIOS = { R3_4: [3, 4], R2_3: [2, 3], R9_16: [9, 16], R1_1: [1, 1] };
export const ratioLabel = (r) => RATIOS[r].join(':');
export const CORNERS = ['CUT', 'ROUNDED', 'SQUARE'];
export const QR_TYPES = { FIELDS: 'Fields', CONTACT: 'vCard', LINK: 'Link', TEXT: 'Text' };
export const BG_MODES = ['COLOR', 'PHOTO'];
export const PHOTO_EFFECTS = { NONE: 'None', MONO: 'Mono', BLUR: 'Blur' };
export const OVERLAYS = { NONE: 'None', SCANLINES: 'Scan', GRID: 'Grid', DOTS: 'Dots', HUD: 'HUD' };
/** Photo framing zoom, over the fill-the-screen size. */
export const PHOTO_ZOOM_RANGE = [1, 5];

/** NEOSCAN, the installable web reader for these cards. */
export const READER_LINK = 'wylify.github.io/neoscan';
export const READER_CAPTION = 'CODE SCANNER';
const LEGACY_READER_LINK = 'example.com/reader';
const LEGACY_READER_CAPTION = 'READER APP';

// Colours are stored as signed 32-bit ARGB ints, exactly like the Android app.
export const argb = (hex) => (0xFF000000 | hex) | 0;
export const css = (c) => '#' + (c & 0xFFFFFF).toString(16).padStart(6, '0');
export const hex6 = (c) => (c & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');


export const npField = (key, value = '') => ({ id: nextId(), key, value });

// ── Rows, QR content, cards ─────────────────────────────────────────────────────────────

export function makeRow(kind, extra = {}) {
  const base = { id: nextId(), kind, label: '', value: '', icon: 'none', checks: [], height: null };
  switch (kind) {
    case 'owner': Object.assign(base, { label: 'OWNER', value: 'Your Name' }); break;
    case 'contact': Object.assign(base, { label: 'CONTACT', value: 'hello@yourdomain.com' }); break;
    case 'date': Object.assign(base, { label: 'ISSUED', value: '21 / 11 / 2026' }); break;
    case 'custom': Object.assign(base, { label: 'WEB', value: 'yourdomain.com', icon: 'globe' }); break;
    case 'checks': base.checks = [{ label: 'WORK', checked: false }, { label: 'PERSONAL', checked: true }, { label: 'LOANER', checked: false }]; break;
    case 'warning': base.value = 'DO NOT DETACH'; break;
  }
  return Object.assign(base, extra);
}

export const defaultFields = () => [
  npField('N', 'Your Name'), npField('T', '+00 000 000 000'), npField('E', 'hello@yourdomain.com'), npField('TXT', 'If found, please return.'),
];

export const defaultQr = () => ({
  type: 'FIELDS', fields: defaultFields(),
  name: 'Your Name', phone: '+00 000 000 000', email: 'hello@yourdomain.com', link: 'https://yourdomain.com', text: 'If found, please return.',
});

export const defaultRows = () => ['owner', 'contact', 'hazard', 'checks', 'date', 'micro'].map((k) => makeRow(k));

export const DEVICE = 'device';
export const CUSTOM = 'custom';
/** A foldable's open-screen picture with the closed screen's wallpaper at its centre. */
export const FOLD = 'fold';
export const DEVICE_PRESETS = [
  { id: 'iphone16pro', name: 'iPhone 16 Pro', w: 1206, h: 2622 },
  { id: 'pixel9', name: 'Pixel 9', w: 1080, h: 2424 },
  { id: 'ipadpro11', name: 'iPad Pro 11″', w: 1668, h: 2420 },
  { id: 'qhd', name: 'QHD desktop', w: 2560, h: 1440 },
  { id: 'uhd', name: '4K UHD', w: 3840, h: 2160 },
];

export function newCard(over = {}) {
  const now = Date.now();
  return {
    id: now, code: 'KK-01', subText: 'PERSONAL DEVICE', subGraphic: 'CHEVRONS', subWidth: 28, subSymbol: 'arrow', subRepeat: 1,
    symbol: 'arrow', qrRight: true, qr: defaultQr(), barcodeLink: READER_LINK, barcodeCaption: READER_CAPTION,
    headFill: [makeRow('hazard')], rows: defaultRows(),
    ratio: 'R3_4', landscape: false, corner: 'CUT', cornerMarks: true,
    labelColor: argb(0xFF6A13), ink: argb(0x141414),
    bgMode: 'COLOR', bgColor: argb(0xE7E6E2), photoUri: null, photoDim: 0.25, photoEffect: 'NONE', overlay: 'NONE',
    // Photo framing: zoom over the fill-the-screen size and where the screen sits in the slack
    // that leaves, -1 (left/top edge) … 1 (right/bottom edge).
    photoZoom: 1, photoX: 0, photoY: 0,
    cardSize: 0.74, nudge: 0, tilt: 0, cropMarks: true,
    exportPreset: DEVICE, customW: 1080, customH: 2400, exportScale: 1, exportPng: true,
    // Dual wallpaper: the card on the lock screen, the bare backdrop on home (with the overlay or not).
    dual: false, homeOverlay: true,
    appliedTo: null, updatedAt: now,
    ...over,
  };
}

export const photoFramed = (c) => c.photoZoom !== 1 || c.photoX !== 0 || c.photoY !== 0;
export const resetFraming = (c) => ({ ...c, photoZoom: 1, photoX: 0, photoY: 0 });
/** The card-less home half of a dual pair. */
export const homeOnly = (c) => (c.homeOverlay ? c : { ...c, overlay: 'NONE' });

/** Card size in layout units. Every ratio keeps the same area so text size never changes. */
export function unitSize(cfg) {
  const [a, b] = RATIOS[cfg.ratio];
  let w = Math.round(Math.sqrt(120000 * a / b));
  let h = Math.round(120000 / w);
  if (cfg.landscape && w !== h) [w, h] = [h, w];
  return [w, h];
}

export const COLOR_PRESETS = [
  ['Safety', 0xFF6A13, 0x141414], ['Acid', 0xDDFF3D, 0x141414], ['Ghost', 0xF2F1EC, 0x141414],
  ['Chrome', 0xC9CCD1, 0x141414], ['Pulse', 0xFF77A8, 0x141414], ['Night', 0x141414, 0xDDFF3D],
].map(([name, card, ink]) => ({ name, card: argb(card), ink: argb(ink) }));

export const BACKGROUND_COLORS = [0xE7E6E2, 0x121216, 0xC9D3D9, 0x2A1B3D, 0x1B2B22, 0xF1D9C7].map(argb);

/** Ready-made starting points ("Templates" tab). */
export function templates() {
  const r = makeRow;
  return [
    ['Shipping label', newCard()],
    ['Minimal', newCard({ rows: [], headFill: [], code: 'KK-01' })],
    ['Field unit', newCard({
      code: 'NX-07', subText: 'FIELD UNIT', subGraphic: 'HAZARD', symbol: 'bolt', qrRight: false,
      headFill: [r('dots'), r('chevrons')],
      rows: [r('glitch'), r('owner'), r('custom'), r('dots'), r('checks'), r('warning'), r('micro')],
      ratio: 'R2_3', labelColor: argb(0xDDFF3D), bgMode: 'COLOR', bgColor: argb(0x121216), overlay: 'SCANLINES', tilt: -3, cardSize: 0.6,
    })],
    ['Workstation', newCard({
      subText: 'WORKSTATION', subGraphic: 'BARS', headFill: [r('chevrons')],
      rows: [r('owner'), r('custom', { label: 'CONTACT', value: 'hello@yourdomain.com', icon: 'mail' }),
        r('custom', { label: 'BASE', value: 'Your City', icon: 'pin' }), r('x')],
      landscape: true, bgColor: argb(0x121216), overlay: 'GRID',
    })],
    ['Night shift', newCard({
      code: '0xA1', subText: 'AFTER HOURS', subGraphic: 'SYMBOL', subSymbol: 'star', subRepeat: 3, symbol: 'star',
      headFill: [r('scan')], rows: [r('owner'), r('circuit'), r('contact'), r('ticks')],
      labelColor: argb(0x141414), ink: argb(0xDDFF3D), bgColor: argb(0x2A1B3D), overlay: 'DOTS',
    })],
    ['Ghost', newCard({
      code: 'R-9', subText: '', subGraphic: 'NONE', corner: 'SQUARE', headFill: [],
      rows: [r('owner'), r('rule'), r('date')], labelColor: argb(0xF2F1EC), bgColor: argb(0xC9D3D9), overlay: 'HUD',
    })],
  ];
}

/** A fresh copy of a card or template: new ids everywhere, so edits never touch the source. */
export function cloneCard(src, code) {
  const now = Date.now();
  const c = structuredClone(src);
  c.id = now + Math.floor(Math.random() * 1000);
  c.headFill = c.headFill.map((x) => ({ ...x, id: nextId() }));
  c.rows = c.rows.map((x) => ({ ...x, id: nextId() }));
  c.qr.fields = c.qr.fields.map((f) => ({ ...f, id: nextId() }));
  c.code = code ?? c.code;
  c.appliedTo = null; c.updatedAt = now;
  return c;
}

// ── QR payload (QrContent.payload) ──────────────────────────────────────────────────────

/** What actually goes into the QR. vCard 3.0 is read by every phone camera. */
export function payload(qr) {
  switch (qr.type) {
    case 'FIELDS': return encodeNp1(qr.fields);
    case 'CONTACT': {
      let s = 'BEGIN:VCARD\nVERSION:3.0\n';
      if (qr.name.trim()) s += `FN:${qr.name.trim()}\n`;
      if (qr.phone.trim()) s += `TEL:${qr.phone.trim()}\n`;
      if (qr.email.trim()) s += `EMAIL:${qr.email.trim()}\n`;
      return s + 'END:VCARD';
    }
    case 'LINK': return qr.link.trim();
    default: return qr.text.trim();
  }
}

export function qrSummary(qr) {
  switch (qr.type) {
    case 'FIELDS': { const n = qr.fields.filter((f) => f.value.trim()).length; return `${n} field${n === 1 ? '' : 's'}`; }
    case 'CONTACT': return 'Contact card';
    case 'LINK': return 'Link';
    default: return 'Text';
  }
}

// ── JSON (same schema as the Android app) ───────────────────────────────────────────────

const rowToJson = (r) => {
  const o = { id: r.id, kind: r.kind, label: r.label, value: r.value, icon: r.icon, checks: r.checks.map((c) => ({ l: c.label, c: c.checked })) };
  if (r.height != null) o.h = r.height;
  return o;
};

export function toJson(c) {
  return {
    id: c.id, code: c.code, subText: c.subText, subGraphic: c.subGraphic, subWidth: c.subWidth, subSymbol: c.subSymbol, subRepeat: c.subRepeat,
    symbol: c.symbol, qrRight: c.qrRight,
    qr: { type: c.qr.type, name: c.qr.name, phone: c.qr.phone, email: c.qr.email, link: c.qr.link, text: c.qr.text,
      fields: c.qr.fields.map((f) => ({ k: f.key, v: f.value })) },
    barcodeLink: c.barcodeLink, barcodeCaption: c.barcodeCaption,
    headFill: c.headFill.map(rowToJson), rows: c.rows.map(rowToJson),
    ratio: c.ratio, landscape: c.landscape, corner: c.corner, cornerMarks: c.cornerMarks,
    labelColor: c.labelColor, ink: c.ink,
    bgMode: c.bgMode, bgColor: c.bgColor, photoUri: c.photoUri ?? null,
    photoDim: c.photoDim, photoEffect: c.photoEffect, overlay: c.overlay,
    photoZoom: c.photoZoom, photoX: c.photoX, photoY: c.photoY,
    cardSize: c.cardSize, nudge: c.nudge, tilt: c.tilt, cropMarks: c.cropMarks,
    exportPreset: c.exportPreset, customW: c.customW, customH: c.customH,
    exportScale: c.exportScale, exportPng: c.exportPng, dual: c.dual, homeOverlay: c.homeOverlay, appliedTo: c.appliedTo ?? null, updatedAt: c.updatedAt,
  };
}

const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const int = (v, d) => (Number.isInteger(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);

function rowFromJson(o) {
  const kind = kindOf(str(o?.kind));
  const k = ROW_KINDS[kind];
  return {
    id: int(o?.id, nextId()), kind, label: str(o?.label), value: str(o?.value),
    icon: FIELD_ICONS[o?.icon] ? o.icon : 'none',
    checks: Array.isArray(o?.checks) ? o.checks.map((c) => ({ label: str(c?.l), checked: !!c?.c })) : [],
    height: Number.isInteger(o?.h) ? clamp(o.h, k.min, k.max) : null,
  };
}

/** Reads a stored or imported card. Anything missing or invalid falls back to the defaults. */
export function fromJson(o) {
  const d = newCard();
  const q = o?.qr && typeof o.qr === 'object' ? o.qr : {};
  const rows = (k) => (Array.isArray(o?.[k]) ? o[k].map(rowFromJson) : []);
  const fields = Array.isArray(q.fields)
    ? q.fields.filter((f) => f && NP_KEYS[f.k]).map((f) => npField(f.k, str(f.v)))
    : defaultFields();
  const link = str(o?.barcodeLink, d.barcodeLink);
  const cap = str(o?.barcodeCaption, d.barcodeCaption);
  return {
    id: num(o?.id, d.id), code: str(o?.code, d.code), subText: str(o?.subText, d.subText),
    subGraphic: pick(o?.subGraphic, Object.keys(SUB_GRAPHICS), d.subGraphic),
    subWidth: clamp(int(o?.subWidth, d.subWidth), SUB_WIDTH[0], SUB_WIDTH[1]),
    // Cards saved before the subline had its own symbol used the caption symbol.
    subSymbol: symbolOf(o?.subSymbol ?? o?.symbol), subRepeat: clamp(int(o?.subRepeat, d.subRepeat), SUB_REPEAT[0], SUB_REPEAT[1]),
    symbol: symbolOf(o?.symbol), qrRight: bool(o?.qrRight, true),
    qr: {
      type: pick(q.type, Object.keys(QR_TYPES), 'CONTACT'),
      name: str(q.name), phone: str(q.phone), email: str(q.email), link: str(q.link), text: str(q.text), fields,
    },
    barcodeLink: link === LEGACY_READER_LINK ? READER_LINK : link,
    barcodeCaption: cap === LEGACY_READER_CAPTION ? READER_CAPTION : cap,
    headFill: rows('headFill'), rows: rows('rows'),
    ratio: pick(o?.ratio, Object.keys(RATIOS), 'R3_4'), landscape: bool(o?.landscape, false),
    corner: pick(o?.corner, CORNERS, 'CUT'), cornerMarks: bool(o?.cornerMarks, true),
    labelColor: int(o?.labelColor, d.labelColor) | 0, ink: int(o?.ink, d.ink) | 0,
    bgMode: pick(o?.bgMode, BG_MODES, 'COLOR'), bgColor: int(o?.bgColor, d.bgColor) | 0,
    photoUri: typeof o?.photoUri === 'string' && o.photoUri ? o.photoUri : null,
    photoDim: clamp(num(o?.photoDim, 0.25), 0, 0.9), photoEffect: pick(o?.photoEffect, Object.keys(PHOTO_EFFECTS), 'NONE'),
    overlay: pick(o?.overlay, Object.keys(OVERLAYS), 'NONE'),
    photoZoom: clamp(num(o?.photoZoom, 1), PHOTO_ZOOM_RANGE[0], PHOTO_ZOOM_RANGE[1]),
    photoX: clamp(num(o?.photoX, 0), -1, 1), photoY: clamp(num(o?.photoY, 0), -1, 1),
    cardSize: clamp(num(o?.cardSize, 0.74), 0.3, 0.95), nudge: clamp(num(o?.nudge, 0), -0.25, 0.25), tilt: clamp(num(o?.tilt, 0), -8, 8),
    cropMarks: bool(o?.cropMarks, true),
    exportPreset: str(o?.exportPreset, d.exportPreset), customW: int(o?.customW, d.customW), customH: int(o?.customH, d.customH),
    exportScale: clamp(int(o?.exportScale, 1), 1, 3), exportPng: bool(o?.exportPng, true),
    dual: bool(o?.dual, false), homeOverlay: bool(o?.homeOverlay, true),
    appliedTo: typeof o?.appliedTo === 'string' && o.appliedTo ? o.appliedTo : null,
    updatedAt: num(o?.updatedAt, d.updatedAt),
  };
}
