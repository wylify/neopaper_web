// NP1 encoding: a port of NEOPAPER's model/Np1.kt. Parsing lives in parse.js (shared with NEOSCAN).
//
//   NP1 N:JANA NOVAKOVA T:+421905123456 E:JANA@NOVAK.SK IG:JANA.NOVAK TXT:Call after 18:00!
//
// - Starts with "NP1". A field starts with a space, a known key and ':'.
// - Only known keys split fields, so ':' inside a value is fine.
// - TXT is always last and swallows everything after it literally.
// - Case-insensitive values are written in CAPS so the QR stays in alphanumeric mode,
//   which fits ~45% more than byte mode.

let seq = Date.now() * 1000;
/** Unique ids for rows and fields (stay below 2^53, like the Android app's Longs). */
export const nextId = () => ++seq;



export const NP_GROUPS = { IDENTITY: 'Identity', CONTACT: 'Contact', SOCIAL: 'Social', SECRET: 'Secrets & misc' };

/** code → definition. input: text | phone | email | url | number | multiline. */
export const NP_KEYS = {};
[
  ['N', 'Name', 'IDENTITY', 'Jana Novakova', { max: 48 }],
  ['ORG', 'Company', 'IDENTITY', 'Neopaper', { max: 48 }],
  ['JOB', 'Job title', 'IDENTITY', 'Designer', { max: 40 }],
  ['BD', 'Birthday', 'IDENTITY', '19900315', { input: 'number', max: 10 }],
  ['T', 'Phone', 'CONTACT', '+421 905 123 456', { input: 'phone', max: 24, repeat: true }],
  ['E', 'Email', 'CONTACT', 'jana@novak.sk', { input: 'email', repeat: true }],
  ['A', 'Address', 'CONTACT', 'Hlavna 12 / 81101 Bratislava / SK', { input: 'multiline', max: 120 }],
  ['W', 'Website', 'CONTACT', 'novak.sk', { input: 'url', max: 100, repeat: true }],
  ['GEO', 'Coordinates', 'CONTACT', '48.1486 17.1077', { max: 24 }],
  ['IG', 'Instagram', 'SOCIAL', 'jana.novak', { max: 30 }],
  ['X', 'X.com', 'SOCIAL', 'jananovak', { max: 30 }],
  ['FB', 'Facebook', 'SOCIAL', 'jana.novak', { max: 50 }],
  ['LI', 'LinkedIn', 'SOCIAL', 'jananovak', { max: 60 }],
  ['TT', 'TikTok', 'SOCIAL', 'jananovak', { max: 30 }],
  ['YT', 'YouTube', 'SOCIAL', 'jananovak', { max: 40 }],
  ['GH', 'GitHub', 'SOCIAL', 'jananovak', { max: 40 }],
  ['TG', 'Telegram', 'SOCIAL', 'jananovak', { max: 32 }],
  ['WA', 'WhatsApp', 'SOCIAL', '+421905123456', { input: 'phone', max: 20 }],
  ['SIG', 'Signal', 'SOCIAL', '+421905123456', { input: 'phone', max: 32 }],
  ['WIFI', 'Wi-Fi network', 'SECRET', 'HOME-5G', { max: 32, keepCase: true }],
  ['PW', 'Password', 'SECRET', 'guest wifi only', { keepCase: true, max: 63 }],
  ['PIN', 'PIN', 'SECRET', '1234', { input: 'number', max: 12 }],
  ['IBAN', 'IBAN', 'SECRET', 'SK31 1200 0000 1987 4263 7541', { max: 42 }],
  ['TXT', 'Free text', 'SECRET', 'If found, please call me.', { input: 'multiline', keepCase: true, max: 300 }],
].forEach(([code, title, group, hint, o]) => {
  NP_KEYS[code] = { code, title, group, hint, input: o.input || 'text', keepCase: !!o.keepCase, max: o.max || 64, repeat: !!o.repeat };
});

export const HEADER = 'NP1';

const alternation = Object.keys(NP_KEYS).sort((a, b) => b.length - a.length).join('|');
const innerKey = new RegExp(` (${alternation}):`);

const digitsPlus = (v) => [...v].filter((c) => /\p{Nd}/u.test(c) || c === '+').join('');
const stripUrl = (v) => v.replace(/ /g, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

/** Accepts "@name", "name" or a profile URL and keeps the bare handle. */
function handle(v) {
  let h = stripUrl(v);
  if (h.includes('/')) h = h.slice(h.lastIndexOf('/') + 1) || h;
  return h.replace(/^@/, '').replace(/ /g, '');
}

const SOCIAL = new Set(['IG', 'X', 'FB', 'LI', 'TT', 'YT', 'GH', 'TG']);

/** How a value is written into the code. Empty result = field skipped. */
export function normalize(key, raw) {
  const v = String(raw).replace(/[\r\n]+/g, key === 'A' ? '/' : ' ').trim();
  let out;
  if (key === 'T' || key === 'WA') out = digitsPlus(v);
  else if (key === 'SIG') out = /\p{L}/u.test(v) ? v.replace(/^@/, '').replace(/ /g, '') : digitsPlus(v);
  else if (key === 'BD' || key === 'PIN') out = [...v].filter((c) => /\p{Nd}/u.test(c) || c === '-').join('');
  else if (key === 'IBAN') out = v.replace(/ /g, '');
  else if (key === 'E') out = v.replace(/ /g, '').replace(/^mailto:/, '');
  else if (key === 'W') out = stripUrl(v);
  else if (SOCIAL.has(key)) out = handle(v);
  else if (key === 'A') out = v.replace(/\s*\/\s*/g, '/').replace(/,\s*/g, '/').replace(/ {2,}/g, ' ');
  else out = v.replace(/ {2,}/g, ' ');

  if (NP_KEYS[key].keepCase) return out;
  if (key === 'W') {
    // Domain is case-insensitive; a path may not be, so only the host goes CAPS.
    const slash = out.indexOf('/');
    return slash < 0 ? out.toUpperCase() : out.slice(0, slash).toUpperCase() + out.slice(slash);
  }
  return out.toUpperCase();
}

/** fields: [{ key, value }] in the user's order. */
export function encodeNp1(fields) {
  const parts = fields.map((f) => [f.key, normalize(f.key, f.value)]).filter(([, v]) => v);
  const txt = parts.find(([k]) => k === 'TXT');
  let s = HEADER;
  for (const [k, v] of parts) if (k !== 'TXT') s += ` ${k}:${v}`;
  // Only one TXT survives and it always goes last: it may contain anything.
  if (txt) s += ` TXT:${txt[1]}`;
  return s;
}

/** A non-TXT value that contains " KEY:" would be split by the parser. */
export const collides = (key, value) => key !== 'TXT' && innerKey.test(normalize(key, value));
