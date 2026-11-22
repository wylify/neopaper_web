// Code scanner screen (ui/ScannerScreen.kt), using the same zxing-wasm decoder as NEOSCAN.
import { interpret, KEYS, display, action, titleCase, toVcard, hasContact } from './parse.js';
import { h, icon, I, iconButton, toast, copyText } from './ui.js';
import { openSheet } from './sheet.js';

const FORMATS = ['QRCode', 'Code128'];
const LIVE = { formats: FORMATS, tryHarder: false, maxNumberOfSymbols: 1 };
const LIVE_INV = { formats: ['Code128'], tryHarder: false, maxNumberOfSymbols: 1 };
const STILL = { formats: FORMATS, tryHarder: true, maxNumberOfSymbols: 8 };
const STILL_INV = { formats: ['Code128'], tryHarder: true, maxNumberOfSymbols: 4 };

let zxReady = null;
function zx() {
  if (!zxReady) {
    zxReady = new Promise((resolve, reject) => {
      if (window.ZXingWASM) { resolve(window.ZXingWASM); return; }
      const s = document.createElement('script');
      s.src = new URL('../vendor/zxing/zxing-reader.js', import.meta.url).href;
      s.onload = () => resolve(window.ZXingWASM);
      s.onerror = () => { zxReady = null; reject(new Error('decoder failed to load')); };
      document.head.append(s);
    }).then((ZX) => {
      // The decoder's .wasm is served from this site (and cached offline), never a CDN.
      ZX.prepareZXingModule({
        overrides: { locateFile: (p, prefix) => (p.endsWith('.wasm') ? new URL(`../vendor/zxing/${p}`, import.meta.url).href : prefix + p) },
        fireImmediately: true,
      }).catch(() => {});
      return ZX;
    });
  }
  return zxReady;
}

/**
 * Inverts ImageData in place. zxing reads light-on-dark QR codes but not light-on-dark 1D
 * barcodes, which a dark card with light ink produces, so those get a second, inverted pass.
 */
export function invert(img) {
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) { p[i] = 255 - p[i]; p[i + 1] = 255 - p[i + 1]; p[i + 2] = 255 - p[i + 2]; }
  return img;
}

async function decodeStill(ZX, data) {
  const a = await ZX.readBarcodes(data, STILL);
  const b = await ZX.readBarcodes(invert(data), STILL_INV);
  const all = [...a, ...b].filter((r) => r.text);
  return [...new Map(all.map((r) => [r.text, r])).values()];
}

async function imageData(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const f = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
    return x.getImageData(0, 0, c.width, c.height);
  } finally { URL.revokeObjectURL(url); }
}

// ── Screen ──────────────────────────────────────────────────────────────────────────────

/** Mounts the scanner. onClose leaves the screen. Returns { el, destroy }. */
export function scannerScreen(onClose) {
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true, 'aria-label': 'Camera preview' });
  video.muted = true;
  const finder = h('div', { class: 'finder idle', 'aria-hidden': 'true' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }), h('b', { class: 'sweep' }));
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const torchBtn = iconButton(I.torch, 'Turn torch on', () => setTorch(!torchOn));
  torchBtn.hidden = true; torchBtn.setAttribute('aria-pressed', 'false');
  const warnEl = h('p', { class: 'warn', role: 'status', 'aria-live': 'polite' });
  const panelTitle = h('h1'), panelText = h('p');
  const panelAllow = h('button', { class: 'btn primary', type: 'button', onclick: () => { want = true; start(); } });
  const panel = h('section', { class: 'scan-panel', hidden: true },
    icon(I.scan, { cls: 'panel-icon' }), panelTitle, panelText, panelAllow,
    h('button', { class: 'btn outline', type: 'button', onclick: () => fileInput.click() }, h('span', {}, 'Scan an image')));
  const hintEl = h('footer', { class: 'scan-hint' }, warnEl, h('p', { class: 'mono-label' }, 'POINT AT A QR CODE OR BARCODE'), h('p', { class: 'sub' }, 'Links never open on their own'));
  const el = h('main', { class: 'screen scanner' }, video, finder,
    h('header', { class: 'scan-top' }, iconButton(I.close, 'Close scanner', onClose), h('h1', { class: 'title' }, 'Scan'), h('span', { class: 'grow' }),
      torchBtn, iconButton(I.image, 'Scan a code from an image', () => fileInput.click()), fileInput),
    panel, hintEl);

  let stream = null, track = null, torchOn = false, want = true, loopId = 0, busy = false, alive = true, frame = 0, sheet = null;
  const grab = document.createElement('canvas');
  const gctx = grab.getContext('2d', { willReadFrequently: true });

  let warnTimer;
  const warn = (m) => { warnEl.textContent = m; warnEl.classList.add('show'); clearTimeout(warnTimer); warnTimer = setTimeout(() => warnEl.classList.remove('show'), 2500); };

  function showPanel(kind) {
    const copy = {
      denied: ['Camera is blocked', 'Allow the camera for this site in your browser settings, then try again. Nothing is recorded or sent. You can also scan a code from an image instead.', 'Try again'],
      none: ['No camera found', 'This device has no camera the browser can use. You can still scan a code from an image, or paste or drop one here.', 'Try again'],
      insecure: ['Camera unavailable', 'The camera only works over a secure (https) connection. You can still scan a code from an image.', null],
    }[kind];
    panelTitle.textContent = copy[0]; panelText.textContent = copy[1];
    panelAllow.hidden = !copy[2]; if (copy[2]) panelAllow.textContent = copy[2];
    panel.hidden = false; finder.hidden = true; hintEl.hidden = true;
  }
  const hidePanel = () => { panel.hidden = true; finder.hidden = false; hintEl.hidden = false; };

  async function start() {
    if (stream || !alive) return;
    if (!navigator.mediaDevices?.getUserMedia) { showPanel(window.isSecureContext ? 'none' : 'insecure'); return; }
    finder.classList.add('idle');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      stream = null;
      showPanel(e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'none' : 'denied');
      return;
    }
    if (!want || !alive) { stop(); return; }
    hidePanel();
    track = stream.getVideoTracks()[0];
    video.srcObject = stream;
    try { await video.play(); } catch {}
    const caps = track.getCapabilities?.() || {};
    torchBtn.hidden = !caps.torch;
    if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    if (torchOn && caps.torch) setTorch(true);
    finder.classList.remove('idle');
    loop();
  }
  function stop() {
    loopId++;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; track = null; video.srcObject = null;
  }
  function setTorch(on) {
    torchOn = on;
    torchBtn.setAttribute('aria-pressed', String(on));
    torchBtn.setAttribute('aria-label', on ? 'Turn torch off' : 'Turn torch on');
    track?.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
  }

  /** Reads frames until a code is found. Every third frame is inverted for light-on-dark barcodes. */
  async function loop() {
    const ZX = await zx().catch(() => null);
    if (!ZX) { warn('The decoder could not load'); return; }
    const id = ++loopId;
    const step = async () => {
      if (id !== loopId) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        try {
          const vw = video.videoWidth, vh = video.videoHeight, f = Math.min(1, 1024 / Math.max(vw, vh));
          const w = Math.round(vw * f), hh = Math.round(vh * f);
          if (grab.width !== w || grab.height !== hh) { grab.width = w; grab.height = hh; }
          gctx.drawImage(video, 0, 0, w, hh);
          const data = gctx.getImageData(0, 0, w, hh);
          const inv = ++frame % 3 === 0;
          const res = await ZX.readBarcodes(inv ? invert(data) : data, inv ? LIVE_INV : LIVE);
          const hit = res.find((r) => r.text);
          if (hit && id === loopId) { busy = false; found([hit]); return; }
        } catch (e) { console.warn(e); }
        busy = false;
      }
      setTimeout(() => requestAnimationFrame(step), 40);
    };
    step();
  }

  async function scanFile(file) {
    if (!file || !file.type.startsWith('image/')) { warn('That is not an image'); return; }
    const wasLive = !!stream; loopId++;
    try {
      const ZX = await zx();
      const res = await decodeStill(ZX, await imageData(file));
      if (res.length) { found(res); return; }
      warn('No code found in that image');
    } catch (e) { console.warn(e); warn('Could not read that image'); }
    if (wasLive && stream) loop();
  }

  function found(hits) {
    navigator.vibrate?.(40);
    finder.classList.add('locked');
    want = false; stop(); // release the camera while the result is open
    sheet = openSheet([...hits.map((r) => resultBlock(interpret(r.text, r.format))),
      h('button', { class: 'btn outline', type: 'button', onclick: () => sheet?.close() }, icon(I.scan), h('span', {}, 'Scan again'))],
    { label: 'Scan result', onClose: () => { sheet = null; finder.classList.remove('locked'); if (alive) { want = document.visibilityState === 'visible'; if (want && panel.hidden) start(); } } });
    sheet.body.querySelectorAll('.textbox').forEach(measureClamp);
  }

  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) scanFile(f); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); scanFile(f); } };
  const onDrop = (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) scanFile(f); };
  const onDragOver = (e) => e.preventDefault();
  const onVis = () => { if (document.visibilityState === 'hidden') stop(); else if (!sheet && panel.hidden) { want = true; start(); } };
  addEventListener('paste', onPaste); el.addEventListener('drop', onDrop); el.addEventListener('dragover', onDragOver);
  document.addEventListener('visibilitychange', onVis);
  zx().catch(() => {});
  start();

  return {
    el,
    destroy() {
      alive = false; stop();
      removeEventListener('paste', onPaste); document.removeEventListener('visibilitychange', onVis);
    },
  };
}

// ── Result blocks (same as NEOSCAN) ─────────────────────────────────────────────────────

const kindRow = (kind, format) => h('div', { class: 'kind' }, h('span', { class: 'badge mono-label' }, kind), h('span', { class: 'mono-small' }, format));
const ext = (href) => (/^https?:/.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {});

const lineLink = (d, text, href) => h('a', { class: 'line', href, ...ext(href) }, icon(d, { cls: 'lico' }),
  h('span', { class: 'txt' }, h('span', { class: 'val' }, text)), icon(I.chevron, { cls: 'end' }));

function npLine(k, v) {
  const href = action(k, v), text = display(k, v);
  const inner = [h('span', { class: 'code mono-label' }, k),
    h('span', { class: 'txt' }, h('span', { class: 'mono-small' }, KEYS[k].toUpperCase()), h('span', { class: 'val' }, text)),
    icon(href ? I.chevron : I.copy, { cls: 'end' })];
  return href
    ? h('a', { class: 'line', href, ...ext(href), 'aria-label': `${KEYS[k]}: ${text}` }, inner)
    : h('button', { class: 'line', type: 'button', onclick: () => copyText(['IBAN', 'PW', 'PIN', 'WIFI'].includes(k) ? v : text), 'aria-label': `Copy ${KEYS[k]}: ${text}` }, inner);
}

function textBox(text, withCopy) {
  const box = h('div', { class: 'textbox clamped' }, h('p', { class: 'body' }, text));
  const more = h('button', { class: 'more mono-label', type: 'button', hidden: true, onclick: () => {
    const open = box.classList.toggle('clamped');
    more.textContent = open ? `SHOW ALL · ${text.length} CHARACTERS` : 'SHOW LESS';
  } }, `SHOW ALL · ${text.length} CHARACTERS`);
  box._more = more;
  box.append(h('div', { class: 'tools' }, more, withCopy ? h('button', { class: 'copy mono-label', type: 'button', onclick: () => copyText(text) }, 'COPY') : null));
  return box;
}
function measureClamp(box) {
  requestAnimationFrame(() => {
    const body = box.querySelector('.body');
    const over = body.scrollHeight > body.clientHeight + 1;
    box._more.hidden = !over;
    if (!over && !box.querySelector('.copy')) box.querySelector('.tools').hidden = true;
  });
}

function saveContact(r) {
  const name = r.kind === 'contact' ? r.name : titleCase(r.fields.find(([k]) => k === 'N')?.[1] || '');
  const blob = new Blob([toVcard(r)], { type: 'text/vcard' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${(name || 'contact').replace(/[^\w\- ]+/g, '').trim() || 'contact'}.vcf` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Contact file saved');
}

function resultBlock(r) {
  const out = h('div', { class: 'result' });
  const copyBtn = (t) => h('button', { class: 'btn outline', type: 'button', onclick: () => copyText(t) }, icon(I.copy), h('span', {}, 'Copy'));
  if (r.kind === 'np1') {
    const name = r.fields.find(([k]) => k === 'N')?.[1];
    out.append(kindRow('NP1', r.format), h('h2', {}, name ? titleCase(name) : 'NEOPAPER code'));
    r.fields.forEach(([k, v]) => { if (k !== 'N' && k !== 'TXT') out.append(npLine(k, v)); });
    r.fields.filter(([k]) => k === 'TXT').forEach(([, v]) => out.append(h('div', {}, h('p', { class: 'mono-small field-title' }, 'FREE TEXT'), textBox(v, true))));
    out.append(h('div', { class: 'row' }, copyBtn(r.raw), hasContact(r) ? h('button', { class: 'btn primary wide', type: 'button', onclick: () => saveContact(r) }, 'Save contact') : null));
  } else if (r.kind === 'contact') {
    out.append(kindRow('CONTACT', r.format), h('h2', {}, r.name || 'Unnamed contact'));
    if (r.org) out.append(h('p', { class: 'org' }, r.org));
    r.phones.forEach((p) => out.append(lineLink(I.phone, p, `tel:${p}`)));
    r.emails.forEach((e) => out.append(lineLink(I.mail, e, `mailto:${e}`)));
    if (r.url) out.append(lineLink(I.link, r.url, /^https?:/i.test(r.url) ? r.url : `https://${r.url}`));
    out.append(h('div', { class: 'row' }, copyBtn(r.raw), h('button', { class: 'btn primary wide', type: 'button', onclick: () => saveContact(r) }, 'Save contact')));
  } else if (r.kind === 'link') {
    let host = '';
    try { host = new URL(r.url).hostname; } catch {}
    // The real host goes big and first (IDN shows as punycode), so a lookalike stands out.
    out.append(kindRow('LINK', r.format), h('h2', {}, host || r.url), h('p', { class: 'mono-small url' }, r.url));
    out.append(h('div', { class: 'row' }, copyBtn(r.url),
      h('a', { class: 'btn primary wide', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', {}, 'Open link'), icon(I.next))));
  } else {
    out.append(kindRow('TEXT', r.format), textBox(r.raw, false),
      h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(r.raw) }, icon(I.copy), h('span', {}, 'Copy text')));
  }
  return out;
}
