// What a scanned code means. A port of NEOPAPER's Np1.kt and ScanParser (scan/Scanner.kt):
// keep the two in sync when the NP1 format changes.

/**
 * NP1: "KEY:VALUE" text that reads fine in any scanner.
 *   NP1 N:JANA NOVAKOVA T:+421905123456 E:JANA@NOVAK.SK IG:JANA.NOVAK TXT:Call after 18:00!
 * - Starts with "NP1". A field starts with a space, a known key and ':'.
 * - Only known keys split fields, so ':' inside a value is fine.
 * - TXT is always last and swallows everything after it literally.
 */
export const KEYS = {
  N: 'Name', ORG: 'Company', JOB: 'Job title', BD: 'Birthday',
  T: 'Phone', E: 'Email', A: 'Address', W: 'Website', GEO: 'Coordinates',
  IG: 'Instagram', X: 'X.com', FB: 'Facebook', LI: 'LinkedIn', TT: 'TikTok',
  YT: 'YouTube', GH: 'GitHub', TG: 'Telegram', WA: 'WhatsApp', SIG: 'Signal',
  WIFI: 'Wi-Fi network', PW: 'Password', PIN: 'PIN', IBAN: 'IBAN', TXT: 'Free text',
};

const HEADER = 'NP1';
// Longest code first so "SIG" wins over shorter prefixes.
const alternation = Object.keys(KEYS).sort((a, b) => b.length - a.length).join('|');
const fieldStart = () => new RegExp(`(?:^| )(${alternation}):`, 'g');

export function isNp1(text) {
  const t = text.trimStart();
  return t === HEADER || t.startsWith(HEADER + ' ');
}

/** Fields in order, as [key, value]. Text before the first known key comes back as TXT. */
export function parseNp1(text) {
  const body = text.trimStart().slice(HEADER.length);
  const re = fieldStart();
  const find = (from) => { re.lastIndex = from; return re.exec(body); };
  const out = [];
  let m = find(0);
  const lead = body.slice(0, m ? m.index : body.length).trim();
  if (lead) out.push(['TXT', lead]);
  while (m) {
    const key = m[1];
    const start = m.index + m[0].length;
    if (key === 'TXT') { out.push([key, body.slice(start)]); break; }
    const next = find(start);
    const v = body.slice(start, next ? next.index : body.length).trim();
    if (v) out.push([key, v]);
    m = next;
  }
  return out;
}

// ── Display ──────────────────────────────────────────────────────────────────────────

export const titleCase = (s) => s.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const LOWER = new Set(['E', 'W', 'IG', 'X', 'FB', 'LI', 'TT', 'YT', 'GH', 'TG']);

/** CAPS only keep the QR small; show case-insensitive values the usual way. */
export function display(k, v) {
  if (LOWER.has(k)) {
    const slash = v.indexOf('/');
    // A website path may be case-sensitive, so only its host is lowered.
    return k === 'W' && slash >= 0 ? v.slice(0, slash).toLowerCase() + v.slice(slash) : v.toLowerCase();
  }
  if (k === 'A') return v.split('/').map((p) => titleCase(p.trim())).join('\n');
  if (k === 'ORG' || k === 'JOB' || k === 'N') return titleCase(v);
  if (k === 'BD' && /^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}`;
  return v;
}

/** Where tapping a field goes, or null when the only useful thing is copying it. */
export function action(k, v) {
  const h = encodeURIComponent(v.toLowerCase());
  const digits = v.replace(/\D/g, '');
  switch (k) {
    case 'T': return `tel:${v}`;
    case 'E': return `mailto:${v.toLowerCase()}`;
    case 'W': return 'https://' + display(k, v);
    case 'A': return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.replace(/\//g, ', '));
    case 'GEO': {
      const p = v.trim().split(/[ ,]+/);
      return p.length === 2 && p.every((n) => !isNaN(parseFloat(n))) ? `https://www.google.com/maps/search/?api=1&query=${p[0]},${p[1]}` : null;
    }
    case 'IG': return `https://instagram.com/${h}`;
    case 'X': return `https://x.com/${h}`;
    case 'FB': return `https://facebook.com/${h}`;
    case 'LI': return `https://linkedin.com/in/${h}`;
    case 'TT': return `https://tiktok.com/@${h}`;
    case 'YT': return `https://youtube.com/@${h}`;
    case 'GH': return `https://github.com/${h}`;
    case 'TG': return `https://t.me/${h}`;
    case 'WA': return digits ? `https://wa.me/${digits}` : null;
    case 'SIG': return /[a-z]/i.test(v) ? null : (digits ? `https://signal.me/#p/+${digits}` : null);
    default: return null;
  }
}

// ── Other formats ───────────────────────────────────────────────────────────────────

const domainLike = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\/\S*)?$/;

export function formatName(f) {
  if (f === 'QRCode') return 'QR';
  if (f === 'Code128') return 'CODE 128';
  return String(f || '').toUpperCase();
}

/**
 * kind: 'np1'      → { fields }
 *       'contact'  → { name, phones, emails, org, url }
 *       'link'     → { url }
 *       'text'
 */
export function interpret(text, format) {
  const f = formatName(format);
  const t = text.trim();
  if (isNp1(t)) return { kind: 'np1', fields: parseNp1(t), raw: t, format: f };
  if (/^BEGIN:VCARD/i.test(t)) return vcard(t, f);
  if (/^MECARD:/i.test(t)) return mecard(t, f);
  if (/^https?:\/\//i.test(t)) return { kind: 'link', url: t, raw: t, format: f };
  // Barcodes on NEOPAPER cards hold bare links like "wylify.github.io/neoscan".
  if (domainLike.test(t)) return { kind: 'link', url: 'https://' + t, raw: t, format: f };
  return { kind: 'text', raw: t, format: f };
}

const unescapeV = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function vcard(t, f) {
  let name = '', org = null, url = null;
  const phones = [], emails = [];
  // Unfold continuation lines (RFC 6350 §3.2), then read "KEY;PARAMS:value".
  t.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(':');
    if (i <= 0) return;
    const key = line.slice(0, i).split(';')[0].toUpperCase().replace(/^ITEM\d+\./, '');
    const v = line.slice(i + 1).trim();
    switch (key) {
      case 'FN': name = unescapeV(v); break;
      case 'N': if (!name) { const p = v.split(';'); name = [p[1], p[0]].filter(Boolean).join(' ').trim(); } break;
      case 'TEL': if (v) phones.push(v.replace(/^tel:/i, '')); break;
      case 'EMAIL': if (v) emails.push(v); break;
      case 'ORG': org = unescapeV(v).replace(/;/g, ' ').trim() || null; break;
      case 'URL': url = unescapeV(v) || null; break;
    }
  });
  return { kind: 'contact', name, phones, emails, org, url, raw: t, format: f };
}

function mecard(t, f) {
  const body = t.slice(t.indexOf(':') + 1);
  const fields = body.split(';').map((p) => { const i = p.indexOf(':'); return i > 0 ? [p.slice(0, i).toUpperCase(), p.slice(i + 1)] : null; }).filter(Boolean);
  const all = (k) => fields.filter((x) => x[0] === k).map((x) => x[1]).filter((x) => x.trim());
  const n = all('N')[0];
  const name = n ? n.split(',').reverse().join(' ').trim() : '';
  return { kind: 'contact', name, phones: all('TEL'), emails: all('EMAIL'), org: all('ORG')[0] || null, url: all('URL')[0] || null, raw: t, format: f };
}

// ── Save as contact ─────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** A vCard 3.0 file for the system contacts app; needs no permission. */
export function toVcard(r) {
  const L = ['BEGIN:VCARD', 'VERSION:3.0'];
  if (r.kind === 'contact') {
    L.push(`FN:${esc(r.name || 'Unnamed contact')}`, `N:;${esc(r.name || '')};;;`);
    if (r.org) L.push(`ORG:${esc(r.org)}`);
    r.phones.forEach((p) => L.push(`TEL:${esc(p)}`));
    r.emails.forEach((e) => L.push(`EMAIL:${esc(e)}`));
    if (r.url) L.push(`URL:${esc(r.url)}`);
  } else {
    const get = (k) => r.fields.filter((x) => x[0] === k).map((x) => x[1]);
    const name = get('N')[0] ? titleCase(get('N')[0]) : '';
    const parts = name.split(' ');
    const last = parts.length > 1 ? parts.pop() : '';
    L.push(`FN:${esc(name || 'Unnamed contact')}`, `N:${esc(last)};${esc(parts.join(' '))};;;`);
    get('ORG').forEach((v) => L.push(`ORG:${esc(titleCase(v))}`));
    get('JOB').forEach((v) => L.push(`TITLE:${esc(titleCase(v))}`));
    get('T').forEach((v) => L.push(`TEL;TYPE=CELL:${esc(v)}`));
    get('E').forEach((v) => L.push(`EMAIL:${esc(v.toLowerCase())}`));
    get('W').forEach((v) => L.push(`URL:${esc('https://' + display('W', v))}`));
    get('A').forEach((v) => L.push(`ADR:;;${esc(display('A', v).replace(/\n/g, ', '))};;;;`));
    get('BD').forEach((v) => { if (/^\d{8}$/.test(v)) L.push(`BDAY:${display('BD', v)}`); });
    const social = ['IG', 'X', 'FB', 'LI', 'TT', 'YT', 'GH', 'TG'];
    r.fields.filter((x) => social.includes(x[0])).forEach(([k, v]) => { const u = action(k, v); if (u) L.push(`URL:${esc(u)}`); });
    get('TXT').forEach((v) => L.push(`NOTE:${esc(v)}`));
  }
  L.push('END:VCARD');
  return L.join('\r\n') + '\r\n';
}

export function hasContact(r) {
  if (r.kind === 'contact') return true;
  return r.kind === 'np1' && r.fields.some(([k]) => k === 'N' || k === 'T' || k === 'E');
}
