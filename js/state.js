// App state: saved cards, the card being edited, autosave and undo (NeoViewModel.kt).
import { newCard, cloneCard, toJson, fromJson, makeRow, ROW_KINDS, nextId } from './model.js';
import { loadCards, saveCards, putPhoto, deletePhoto, photoIds, persist } from './store.js';
import { loadPhoto, forgetPhoto } from './photo.js';
import { settings, defaultLandscape } from './settings.js';
import { fitBetweenGuides } from './placement.js';
import { deviceSize } from './export.js';

/**
 * sel: the part of the card selected on the Card tab ('header' | 'qr' | 'footer' | a body row id), kept
 * here so it survives a trip to row settings or the code screens and back (EditTarget.kt).
 */
export const S = { loaded: false, cards: [], draftId: null, homeTab: 0, builderTab: 0, sel: null, photo: null, saveFailed: false };

const listeners = new Set();
/** Subscribe to state changes: fn(kind) with kind 'draft' | 'cards' | 'photo' | 'sel' | 'undo'. Returns unsubscribe. */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (kind) => listeners.forEach((fn) => { try { fn(kind); } catch (e) { console.error(e); } });

export const draft = () => S.cards.find((c) => c.id === S.draftId) || null;

export async function init() {
  const raw = await loadCards();
  const cards = raw.map((o) => { try { return fromJson(o); } catch { return null; } }).filter(Boolean);
  S.cards = (cards.length ? cards : [newCard()]).sort((a, b) => b.updatedAt - a.updatedAt);
  S.loaded = true;
  if (!cards.length || takeRescue()) scheduleSave(0);
  cleanupPhotos();
}

// ── Saving ──────────────────────────────────────────────────────────────────────────────

let saveTimer = 0, saving = Promise.resolve(), asked = false;
/** Counts changes; savedSeq is the last one IndexedDB has. */
let seq = 0, savedSeq = 0;
const dirty = () => { seq++; };
export function scheduleSave(ms = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, ms);
}
export function flush() {
  clearTimeout(saveTimer);
  const json = S.cards.map(toJson), at = seq;
  saving = saving.then(() => saveCards(json)).then((ok) => {
    if (ok) { savedSeq = Math.max(savedSeq, at); if (at === seq) dropRescue(); }
    if (S.saveFailed !== !ok) { S.saveFailed = !ok; emit('cards'); }
    if (ok) channel?.postMessage('saved');
    // The first real save is a good moment to ask the browser to keep our data. Firefox would
    // show a permission prompt for it, so there it only happens from Settings.
    if (ok && !asked && !/firefox/i.test(navigator.userAgent)) { asked = true; persist(); }
  });
  return saving;
}
// Another tab or window saved: pick up its cards unless a card is open here (last save wins).
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('neopaper') : null;
let busyElsewhere = () => false;
/** The app tells state whether a card is open (then outside changes wait for the next start). */
export function setEditingCheck(fn) { busyElsewhere = fn; }
channel?.addEventListener('message', async (e) => {
  if (e.data !== 'saved' || busyElsewhere()) return;
  const raw = await loadCards();
  const cards = raw.map((o) => { try { return fromJson(o); } catch { return null; } }).filter(Boolean);
  if (cards.length) { S.cards = cards.sort((a, b) => b.updatedAt - a.updatedAt); emit('cards'); }
});

// Never lose the last keystrokes when the tab is hidden or closed. The IndexedDB write is async and
// may not finish before the page goes, so the open card is also copied to localStorage, which is
// synchronous, and picked up at the next start if it is newer than the saved one.
const RESCUE = 'neopaper.rescue';
function writeRescue() {
  const d = draft();
  if (!d || seq === savedSeq) return;
  try { localStorage.setItem(RESCUE, JSON.stringify(toJson(d))); } catch {}
}
function dropRescue() { try { localStorage.removeItem(RESCUE); } catch {} }
/** At start: puts back a card the last session left unsaved. True when it changed anything. */
function takeRescue() {
  let card = null;
  try { const o = JSON.parse(localStorage.getItem(RESCUE) || 'null'); if (o) card = fromJson(o); } catch {}
  dropRescue();
  if (!card) return false;
  const old = S.cards.find((c) => c.id === card.id);
  if (old && old.updatedAt >= card.updatedAt) return false;
  S.cards = old ? S.cards.map((c) => (c.id === card.id ? card : c)) : [card, ...S.cards];
  S.cards.sort((a, b) => b.updatedAt - a.updatedAt);
  return true;
}
const leaving = () => { writeRescue(); flush(); };
addEventListener('pagehide', leaving);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leaving(); });

// ── Cards ───────────────────────────────────────────────────────────────────────────────

function replace(card) { S.cards = S.cards.map((c) => (c.id === card.id ? card : c)); }

/**
 * Every edit goes through here: records undo, updates the draft and autosaves shortly after.
 * [key] groups edits into one undo step: the same key within a short pause (typing into one field)
 * counts once. Without a key, only edits in quick succession (a slider drag) are grouped.
 */
export function edit(fn, key = null) {
  const d = draft();
  if (!d) return;
  const out = fn(d);
  if (!out || out === d) return;
  record(d, key);
  apply({ ...out, updatedAt: Date.now() }, d);
}

function apply(next, prev) {
  replace(next);
  if (next.photoUri !== prev.photoUri) refreshPhoto();
  dirty();
  scheduleSave(500);
  emit('draft');
}

// ── Undo: the last 10 steps on the open card, kept while its editor is open ───────────────

const UNDO_MAX = 10;
const past = [], future = [];
let lastKey = null, lastAt = 0;
function record(before, key) {
  const now = Date.now(), k = key ?? 'auto';
  const merge = past.length && k === lastKey && now - lastAt < (key ? 1500 : 450);
  lastKey = k; lastAt = now;
  future.length = 0;
  if (merge) return;
  past.push({ card: before, sel: S.sel });
  if (past.length > UNDO_MAX) past.shift();
  emit('undo');
}
/** Forget the steps (a card opened or its editor closed). */
export function clearHistory() { past.length = future.length = 0; lastKey = null; emit('undo'); }
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
function travel(from, to) {
  const d = draft();
  if (!d || !from.length) return false;
  const step = from.pop();
  to.push({ card: d, sel: S.sel });
  lastKey = null;
  const c = step.card;
  apply({ ...c, updatedAt: Date.now() }, d);
  // Back to what was selected then, if it still exists.
  const t = step.sel;
  const ok = t == null || typeof t === 'string' || c.rows.some((r) => r.id === t) || c.headFill.some((r) => r.id === t);
  select(ok ? t : null);
  emit('undo');
  return true;
}
export const undo = () => travel(past, future);
export const redo = () => travel(future, past);

export function openCard(id) {
  S.draftId = id; S.builderTab = 0; S.sel = null;
  clearHistory();
  refreshPhoto();
}

/**
 * New card from [template], or a blank one in the default shape (Settings). New cards take the
 * export defaults and start clear of this screen's clock and dock; a [duplicate] stays an exact copy.
 */
export function createCard(template, duplicate = false) {
  const n = S.cards.length + 1;
  const src = template || newCard({ ratio: settings.ratio, landscape: defaultLandscape() });
  const code = src.code === 'KK-01' ? `KK-${String(n).padStart(2, '0')}` : src.code;
  const [dw, dh] = deviceSize();
  const copy = cloneCard(src, code);
  // Placed clear of the screen the guides follow (Home unless the user picked Lock).
  const card = duplicate ? copy : fitBetweenGuides(
    { ...copy, exportPreset: settings.exportPreset, exportScale: settings.exportScale, exportPng: settings.exportPng }, dw, dh, settings.guideScreen);
  while (S.cards.some((c) => c.id === card.id)) card.id++;
  S.cards = [card, ...S.cards];
  dirty();
  scheduleSave(0);
  emit('cards');
  return card;
}

let lastDeleted = null;
export function deleteCard(id) {
  const i = S.cards.findIndex((c) => c.id === id);
  if (i < 0) return;
  lastDeleted = { card: S.cards[i], index: i };
  S.cards = S.cards.filter((c) => c.id !== id);
  dirty();
  scheduleSave(0);
  emit('cards');
}
export function undoDelete() {
  if (!lastDeleted) return;
  const { card, index } = lastDeleted; lastDeleted = null;
  S.cards.splice(Math.min(index, S.cards.length), 0, card);
  S.cards = [...S.cards];
  dirty();
  scheduleSave(0);
  emit('cards');
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────

/** Adds a row at the end, in the header (fillers only), or right below body row [after]. */
export function addRow(kind, header, after = null) {
  const row = makeRow(kind);
  edit((c) => {
    if (header && ROW_KINDS[kind].filler) return { ...c, headFill: [...c.headFill, row] };
    const i = after == null ? -1 : c.rows.findIndex((r) => r.id === after);
    if (i < 0) return { ...c, rows: [...c.rows, row] };
    const rows = [...c.rows]; rows.splice(i + 1, 0, row);
    return { ...c, rows };
  });
  return row;
}

/** Copy of body row [id] right below it; returns the copy (or null). */
export function duplicateRow(id) {
  const d = draft(); if (!d) return null;
  const i = d.rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const copy = { ...structuredClone(d.rows[i]), id: nextId() };
  edit((c) => { const rows = [...c.rows]; rows.splice(i + 1, 0, copy); return { ...c, rows }; });
  return copy;
}

/** Selects a part of the card on the Card tab (null clears). */
export function select(t) {
  if (S.sel === t) return;
  S.sel = t;
  emit('sel');
}

export const findRow = (c, id) => c.rows.find((r) => r.id === id) || c.headFill.find((r) => r.id === id) || null;

export function updateRow(row, key = null) {
  edit((c) => ({ ...c, rows: c.rows.map((r) => (r.id === row.id ? row : r)), headFill: c.headFill.map((r) => (r.id === row.id ? row : r)) }), key);
}

let lastRemoved = null;
export function removeRow(id) {
  const d = draft(); if (!d) return;
  const i = d.rows.findIndex((r) => r.id === id), hi = d.headFill.findIndex((r) => r.id === id);
  if (i >= 0) lastRemoved = { row: d.rows[i], index: i, header: false };
  else if (hi >= 0) lastRemoved = { row: d.headFill[hi], index: hi, header: true };
  else return;
  edit((c) => ({ ...c, rows: c.rows.filter((r) => r.id !== id), headFill: c.headFill.filter((r) => r.id !== id) }), `remove:${id}`);
  lastRemoved.after = draft();
}
export function undoRemove() {
  if (!lastRemoved) return;
  // Nothing changed since the removal: step back in the history, so redo can bring the removal back.
  if (past.length && lastRemoved.after === draft()) { lastRemoved = null; undo(); return; }
  const { row, index, header } = lastRemoved; lastRemoved = null;
  edit((c) => {
    const list = [...(header ? c.headFill : c.rows)];
    list.splice(Math.min(index, list.length), 0, row);
    return header ? { ...c, headFill: list } : { ...c, rows: list };
  });
}

export function moveRow(from, to, header = false) {
  edit((c) => {
    const list = [...(header ? c.headFill : c.rows)];
    if (from < 0 || to < 0 || from >= list.length || to >= list.length) return c;
    list.splice(to, 0, list.splice(from, 1)[0]);
    return header ? { ...c, headFill: list } : { ...c, rows: list };
  });
}

// ── Photo ───────────────────────────────────────────────────────────────────────────────

let photoFor = null;
async function refreshPhoto() {
  const d = draft();
  const id = d?.photoUri?.startsWith('idb:') ? d.photoUri.slice(4) : null;
  if (id === photoFor) return;
  photoFor = id;
  S.photo = null; emit('photo');
  if (!id) return;
  const set = await loadPhoto(id);
  if (photoFor === id) { S.photo = set; emit('photo'); }
}

export async function setPhotoBlob(blob) {
  const id = `p${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await putPhoto(id, blob);
  edit((c) => ({ ...c, photoUri: `idb:${id}`, bgMode: 'PHOTO' }));
}

/** Photos no card refers to any more (deleted cards, replaced photos) are removed at start-up. */
async function cleanupPhotos() {
  try {
    const used = new Set(S.cards.map((c) => c.photoUri).filter((u) => u?.startsWith('idb:')).map((u) => u.slice(4)));
    // Skip photos added in the last day: another open tab may not have saved its card yet.
    const old = (id) => { const m = /^p([0-9a-z]+)_/.exec(id); return !m || Date.now() - parseInt(m[1], 36) > 86400000; };
    for (const id of await photoIds()) if (!used.has(id) && old(id)) { forgetPhoto(id); await deletePhoto(id); }
  } catch {}
}

export function notify(kind) { emit(kind); }
