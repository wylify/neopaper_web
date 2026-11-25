// Home: saved cards, templates and settings (ui/HomeScreen.kt), plus backup and install on the web.
import { vibrate, settings, setSettings, validSettings, ORIENTATIONS, CARD_EDITORS, screenIsSmallSquarish, guides, setGuides } from './settings.js';
import { pushLayer, pop, isTop } from './nav.js';
import { h, icon, I, outline, primary, sectionLabel, tag, toast, segmented, switchRow } from './ui.js';
import { S, subscribe, createCard, deleteCard, undoDelete, flush } from './state.js';
import { templates, ratioLabel, css, toJson, fromJson, cloneCard, RATIOS, DEVICE, DEVICE_PRESETS } from './model.js';
import { deviceSize } from './export.js';
import { cardCanvas } from './previews.js';
import { openSheet } from './sheet.js';
import { putPhoto, isPersisted, persist } from './store.js';
import { isIos, download } from './export.js';
import { install, canInstall, standalone } from './install.js';
import { APP_VERSION, READER_URL } from './config.js';

const TITLES = ['Your cards', 'Templates', 'Settings'];

export function homeScreen(nav) {
  const title = h('h1', { class: 'display' }, TITLES[S.homeTab]);
  const count = h('span', { class: 'mono-small count' });
  const content = h('div', { class: 'home-content' });
  const tabs = [['Cards', I.cards], ['Templates', I.templates], ['Settings', I.settings]].map(([label, d], i) =>
    h('button', { type: 'button', class: 'nav-item', 'aria-current': String(S.homeTab === i), onclick: () => setTab(i) },
      h('span', { class: 'pill' }, icon(d, { size: 22 })), h('span', {}, label)));
  const fab = h('button', { type: 'button', class: 'fab', onclick: () => nav.openNew() }, icon(I.plus, { stroke: 2.4 }), h('span', { class: 'fab-text' }, 'New card'));

  const el = h('main', { class: 'screen home' },
    h('header', { class: 'home-head' },
      h('div', { class: 'home-top' }, h('p', { class: 'mono-label muted grow' }, 'LBL/SYS · NEOPAPER'),
        h('button', { type: 'button', class: 'scan-chip', onclick: () => nav.openScanner(), 'aria-label': 'Open the code scanner' }, icon(I.scan, { size: 20, color: 'var(--lime)' }), h('span', {}, 'Scan'))),
      h('div', { class: 'home-title' }, title, count)),
    content, fab,
    h('nav', { class: 'bottom-nav', 'aria-label': 'Sections' }, tabs));

  let thumbs = [];
  function disposeThumbs() { thumbs.forEach((c) => c.dispose()); thumbs = []; }

  // Back (gesture, button or Escape) on Templates or Settings goes to Your cards first; from
  // Cards it leaves the app. One history entry stands for "not on Cards".
  let tabLayer = null;
  function setTab(i) {
    if (S.homeTab !== i) {
      S.homeTab = i;
      tabs.forEach((t, j) => t.setAttribute('aria-current', String(i === j)));
      render();
      content.scrollTop = 0;
    }
    if (i !== 0 && !tabLayer) tabLayer = pushLayer(() => { tabLayer = null; if (S.homeTab !== 0) setTab(0); }, 'home-tab');
    else if (i === 0 && tabLayer && isTop(tabLayer)) pop();
  }

  function render() {
    title.textContent = TITLES[S.homeTab];
    count.textContent = S.homeTab === 0 ? `${String(S.cards.length).padStart(2, '0')} SAVED` : '';
    fab.hidden = S.homeTab !== 0;
    disposeThumbs();
    content.replaceChildren(S.homeTab === 0 ? cardsGrid() : S.homeTab === 1 ? templatesGrid() : settingsList());
  }

  function cardsGrid() {
    const grid = h('div', { class: 'grid' });
    for (const card of S.cards) {
      const cv = cardCanvas(() => S.cards.find((c) => c.id === card.id), null, 'thumb-canvas');
      thumbs.push(cv);
      const menuBtn = h('button', { type: 'button', class: 'icon-btn tile-menu', 'aria-label': `More options for ${card.code || 'card'}`, onclick: (e) => { e.stopPropagation(); cardMenu(card); } }, icon(I.more));
      const tile = h('div', { class: 'tile cut', role: 'button', tabindex: '0', 'aria-label': `Edit ${card.code || 'Untitled'}` },
        h('div', { class: 'stage dots' }, cv),
        h('div', { class: 'tile-foot' },
          h('div', { class: 'grow' }, h('p', { class: 'tile-title' }, card.code.trim() || 'Untitled'),
            h('p', { class: 'mono-small' }, `${ratioLabel(card.ratio)} · ${card.landscape ? 'LANDSCAPE' : 'PORTRAIT'}`)),
          menuBtn));
      const open = () => nav.openCard(card.id);
      tile.addEventListener('click', open);
      tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      tile.addEventListener('contextmenu', (e) => { e.preventDefault(); cardMenu(card); });
      longPress(tile, () => { vibrate(20); cardMenu(card); });
      grid.append(tile);
    }
    grid.append(h('button', { type: 'button', class: 'tile tile-ghost', onclick: () => setTab(1) },
      icon(I.templates, { size: 28, color: 'var(--muted)' }), h('p', { class: 'tile-title' }, 'Start from a template'),
      h('p', { class: 'mono-small' }, `${String(templates().length).padStart(2, '0')} PRESETS`)));
    return grid;
  }

  function cardMenu(card) {
    const s = openSheet([
      h('h2', { class: 'sheet-title' }, card.code.trim() || 'Untitled'),
      h('button', { type: 'button', class: 'menu-item', onclick: async () => { await s.close(); const c = createCard(card, true); nav.openCard(c.id); } }, icon(I.copy, { size: 20 }), 'Duplicate'),
      h('button', { type: 'button', class: 'menu-item danger', onclick: async () => {
        await s.close(); deleteCard(card.id);
        toast('Card deleted', { label: 'Undo', run: undoDelete });
      } }, icon(I.trash, { size: 20 }), 'Delete'),
    ], { label: 'Card options' });
  }

  function templatesGrid() {
    const wrap = h('div', {}, h('p', { class: 'lead' }, 'Pick a starting point. Everything stays editable.'));
    const grid = h('div', { class: 'grid' });
    templates().forEach(([name, cfg]) => {
      const cv = cardCanvas(() => cfg, null, 'thumb-canvas');
      thumbs.push(cv);
      grid.append(h('button', { type: 'button', class: 'tile cut', 'aria-label': `Use template ${name}`, onclick: () => nav.openNew(cfg) },
        h('div', { class: 'stage', style: { background: css(cfg.bgColor) } }, cv),
        h('div', { class: 'tile-foot' }, h('p', { class: 'tile-title' }, name))));
    });
    wrap.append(grid);
    return wrap;
  }

  function settingsList() {
    const persistLine = h('p', { class: 'body muted' }, 'Checking…');
    const persistBtn = outline('Keep my cards safe', async () => { const ok = await persist(); updatePersist(ok); if (!ok) toast('The browser decides this; installing the app helps'); });
    const updatePersist = (ok) => {
      persistLine.textContent = ok
        ? 'Stored persistently: the browser will not clear your cards to free space.'
        : isIos && !standalone ? 'Safari may delete site data after 7 days without a visit. Add NEOPAPER to your Home Screen, and keep a backup.'
          : 'The browser may clear site data when space runs low. Keep a backup.';
      persistBtn.hidden = ok;
    };
    isPersisted().then(updatePersist);
    const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { const f = importInput.files[0]; importInput.value = ''; if (f) importBackup(f).then(render); } });

    const installBlock = standalone ? null : canInstall() ? h('div', { class: 'panel-box' },
      h('p', { class: 'title' }, 'Install NEOPAPER'), h('p', { class: 'body muted' }, 'Opens like an app, works offline, and keeps your cards safer.'),
      primary('Install app', () => install(), { icon: I.download }))
      : isIos ? h('div', { class: 'panel-box' }, h('p', { class: 'title' }, 'Install on iPhone or iPad'),
        h('ol', { class: 'steps' }, h('li', {}, 'Tap the Share button in Safari.'), h('li', {}, 'Choose “Add to Home Screen”.'), h('li', {}, 'Tap Add.'))) : null;

    // New cards: shape and orientation.
    const orientNote = h('p', { class: 'body muted' });
    const paintOrient = () => {
      orientNote.textContent = (settings.orientation === 'AUTO'
        ? `Landscape on small, squarish screens, portrait elsewhere. This screen: ${screenIsSmallSquarish() ? 'landscape' : 'portrait'}.`
        : settings.orientation === 'PORTRAIT' ? 'New cards start upright.' : 'New cards start on their side.') + ' Templates keep their own shape.';
    };
    paintOrient();
    const shape = segmented(Object.keys(RATIOS), settings.ratio, ratioLabel, (v) => setSettings({ ratio: v }));
    const orient = segmented(Object.keys(ORIENTATIONS), settings.orientation, (v) => ORIENTATIONS[v], (v) => { setSettings({ orientation: v }); paintOrient(); });
    // Saved image defaults for new cards.
    const [dw, dh] = deviceSize();
    const presets = [{ id: DEVICE, name: 'This device', w: dw, h: dh }, ...DEVICE_PRESETS];
    const list = h('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Image size for new cards' }, presets.map((p) => h('button', {
      type: 'button', role: 'radio', class: 'radio-item', 'aria-checked': String(settings.exportPreset === p.id),
      onclick: () => { setSettings({ exportPreset: p.id }); list.querySelectorAll('.radio-item').forEach((b, i) => b.setAttribute('aria-checked', String(presets[i].id === p.id))); },
    }, h('i', { class: 'radio-dot' }), h('span', { class: 'grow title' }, p.name), h('span', { class: 'mono-small' }, `${p.w} × ${p.h}`))));
    const scale = segmented([1, 2, 3], settings.exportScale, (v) => `${v}×`, (v) => setSettings({ exportScale: v }));
    const fmt = segmented([true, false], settings.exportPng, (v) => (v ? 'PNG' : 'JPG'), (v) => setSettings({ exportPng: v }));

    return h('div', { class: 'settings' },
      sectionLabel('New cards'),
      h('p', { class: 'title' }, 'Shape'), shape, orient, orientNote,
      sectionLabel('Saved image · new cards'),
      list, h('div', { class: 'row' }, scale, fmt),
      h('p', { class: 'body muted' }, 'Each card can still change these on its Export tab.'),
      sectionLabel('Editing'),
      h('p', { class: 'title' }, 'Card tab'),
      segmented(Object.keys(CARD_EDITORS), settings.cardEditor, (v) => CARD_EDITORS[v], (v) => setSettings({ cardEditor: v })),
      h('p', { class: 'body muted' }, 'On the card: tap a part of the card to edit it, tap a text again to type on it. Row list: every row in a list with drag to sort, easier with a screen reader. Also switchable on the Card tab.'),
      h('p', { class: 'title' }, 'Clock and dock guides'),
      guidesPicker(),
      h('p', { class: 'body muted' }, 'Mark where the home screen (status bar, At a Glance, dock) or the lock screen (large clock, shortcuts) draws over the wallpaper preview. Off by default; also on the card’s Backdrop tab.'),
      switchRow('Haptics', 'Vibrate when dragging, reordering and scanning (where the browser supports it)', settings.haptics, (v) => setSettings({ haptics: v })),
      installBlock,
      sectionLabel('Storage'),
      h('div', { class: 'panel-box' }, persistLine, persistBtn,
        h('div', { class: 'row' }, outline('Back up', () => exportBackup(), { icon: I.download }), outline('Restore', () => importInput.click(), { icon: I.upload })), importInput,
        h('p', { class: 'mono-small' }, 'BACKUP = ONE .JSON FILE WITH CARDS AND SETTINGS, ALSO READ BY THE ANDROID APP. BACKGROUND PHOTOS STAY ON THIS DEVICE: THOSE CARDS COME BACK WITH A COLOUR. RESTORE ADDS ITS CARDS TO THESE.')),
      sectionLabel('Reader app'),
      h('a', { class: 'panel-box link-box', href: READER_URL, target: '_blank', rel: 'noopener' },
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'NEOSCAN'), h('span', { class: 'body muted' }, 'The scanner your card’s barcode points to. Anyone can open it to read your QR.')),
        icon(I.external, { size: 20, color: 'var(--muted)' })),
      sectionLabel('About'),
      h('div', { class: 'panel-box' }, h('p', { class: 'title' }, `NEOPAPER web ${APP_VERSION}`),
        h('p', { class: 'body muted' }, 'Device-label wallpapers with your contact QR and a reader-app barcode. Everything stays on this device: nothing is uploaded.')),
      sectionLabel('Open source'),
      h('div', { class: 'panel-box' },
        h('p', { class: 'body' }, 'Space Grotesk, JetBrains Mono — SIL Open Font License 1.1'),
        h('p', { class: 'body' }, 'zxing-wasm (code reading) — MIT'),
        h('p', { class: 'body' }, 'QR encoder modelled on Project Nayuki’s QR Code generator — MIT')));
  }

  const unsub = subscribe((k) => { if (k === 'cards' && S.homeTab === 0) render(); });
  render();
  return {
    el, destroy() { unsub(); disposeThumbs(); }, refresh: render,
    /** History entries Home itself holds (Templates/Settings), which opening a card keeps. */
    baseDepth: () => (tabLayer ? 1 : 0),
    /** Ctrl/⌘ + N: new card. */
    shortcut(key) { if (key === 'n') { nav.openNew(); return true; } return false; },
  };
}

/** Guides off, or following the home or lock screen. Used in Settings and on the Backdrop tab. */
export function guidesPicker() {
  return segmented([null, 'HOME', 'LOCK'], guides(), (v) => (v == null ? 'Off' : v === 'HOME' ? 'Home' : 'Lock'), setGuides);
}

/** Press and hold on touch screens; a small move cancels it. */
function longPress(el, fn) {
  let t = 0, x = 0, y = 0, fired = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    fired = false; x = e.clientX; y = e.clientY;
    t = setTimeout(() => { fired = true; fn(); }, 500);
  });
  const cancel = () => clearTimeout(t);
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel(); });
  el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}

// ── Backup ──────────────────────────────────────────────────────────────────────────────
// Same file as the Android app (data/Backup.kt): cards and settings, no background photos.
// { app: 'NEOPAPER', format: 2, exportedAt, cards: [card…], settings: {…} }

const BACKUP_SETTINGS = ['ratio', 'orientation', 'exportPreset', 'exportScale', 'exportPng', 'guidesOn', 'guideScreen', 'haptics', 'cardEditor'];
/** The user's own photos stay on this device: such cards come back with their colour background. */
const withoutPhoto = (o) => (o.photoUri == null && o.bgMode === 'COLOR' ? o : { ...o, photoUri: null, bgMode: 'COLOR' });

async function exportBackup() {
  await flush();
  const data = {
    app: 'NEOPAPER', format: 2, exportedAt: new Date().toISOString(),
    cards: S.cards.map((c) => withoutPhoto(toJson(c))),
    settings: Object.fromEntries(BACKUP_SETTINGS.map((k) => [k, settings[k]])),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  download(blob, `neopaper-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Backup saved');
}


async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    // A backup from either app, or a bare card array (the Android app's cards.json).
    const list = Array.isArray(data) ? data : Array.isArray(data?.cards) ? data.cards : null;
    if (!list || (data.app != null && data.app !== 'NEOPAPER')) throw new Error('not a backup');
    // Format-1 web backups carried photos; those still come back.
    const photos = data.photos && typeof data.photos === 'object' ? data.photos : {};
    let added = 0;
    for (const o of [...list].reverse()) {
      if (!o || typeof o !== 'object') continue;
      const card = cloneCard(fromJson(o));
      card.updatedAt = typeof o.updatedAt === 'number' ? o.updatedAt : Date.now();
      card.appliedTo = null;
      const pid = card.photoUri?.startsWith('idb:') ? card.photoUri.slice(4) : null;
      if (pid && typeof photos[pid] === 'string' && photos[pid].startsWith('data:image/')) {
        await putPhoto(pid, await (await fetch(photos[pid])).blob());
      } else if (card.photoUri || card.bgMode === 'PHOTO') Object.assign(card, { photoUri: null, bgMode: 'COLOR' });
      while (S.cards.some((c) => c.id === card.id)) card.id++;
      S.cards.unshift(card); added++;
    }
    S.cards.sort((a, b) => b.updatedAt - a.updatedAt);
    if (data.settings && typeof data.settings === 'object') setSettings(validSettings(data.settings));
    await flush();
    toast(`${added} card${added === 1 ? '' : 's'} restored`);
  } catch (e) {
    console.warn(e);
    toast('That file is not a NEOPAPER backup');
  }
}
