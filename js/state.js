// App state: saved cards, the card being edited, autosave and undo (NeoViewModel.kt).
import { newCard, cloneCard, toJson, fromJson, makeRow, ROW_KINDS } from './model.js';
import { loadCards, saveCards, putPhoto, deletePhoto, photoIds, persist } from './store.js';
import { loadPhoto, forgetPhoto } from './photo.js';

export const S = { loaded: false, cards: [], draftId: null, homeTab: 0, builderTab: 0, photo: null, saveFailed: false };

const listeners = new Set();
/** Subscribe to state changes: fn(kind) with kind 'draft' | 'cards' | 'photo'. Returns unsubscribe. */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (kind) => listeners.forEach((fn) => { try { fn(kind); } catch (e) { console.error(e); } });

export const draft = () => S.cards.find((c) => c.id === S.draftId) || null;

export async function init() {
  const raw = await loadCards();
  const cards = raw.map((o) => { try { return fromJson(o); } catch { return null; } }).filter(Boolean);
  S.cards = (cards.length ? cards : [newCard()]).sort((a, b) => b.updatedAt - a.updatedAt);
  S.loaded = true;
  if (!cards.length) scheduleSave(0);
  cleanupPhotos();
}

// ── Saving ──────────────────────────────────────────────────────────────────────────────

let saveTimer = 0, saving = Promise.resolve(), asked = false;
export function scheduleSave(ms = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, ms);
}
export function flush() {
  clearTimeout(saveTimer);
  const json = S.cards.map(toJson);
  saving = saving.then(() => saveCards(json)).then((ok) => {
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

// Never lose the last keystrokes when the tab is hidden or closed.
addEventListener('pagehide', () => flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// ── Cards ───────────────────────────────────────────────────────────────────────────────

function replace(card) { S.cards = S.cards.map((c) => (c.id === card.id ? card : c)); }

/** Every edit goes through here: updates the draft and autosaves shortly after. */
export function edit(fn) {
  const d = draft();
  if (!d) return;
  const next = { ...fn(d), updatedAt: Date.now() };
  replace(next);
  if (next.photoUri !== d.photoUri) refreshPhoto();
  scheduleSave(500);
  emit('draft');
}

export function openCard(id) {
  S.draftId = id; S.builderTab = 0;
  refreshPhoto();
}

export function createCard(template) {
  const n = S.cards.length + 1;
  const src = template || newCard();
  const code = src.code === 'KK-01' ? `KK-${String(n).padStart(2, '0')}` : src.code;
  const card = cloneCard(src, code);
  while (S.cards.some((c) => c.id === card.id)) card.id++;
  S.cards = [card, ...S.cards];
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
  scheduleSave(0);
  emit('cards');
}
export function undoDelete() {
  if (!lastDeleted) return;
  const { card, index } = lastDeleted; lastDeleted = null;
  S.cards.splice(Math.min(index, S.cards.length), 0, card);
  S.cards = [...S.cards];
  scheduleSave(0);
  emit('cards');
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────

export function addRow(kind, header) {
  const row = makeRow(kind);
  edit((c) => (header && ROW_KINDS[kind].filler ? { ...c, headFill: [...c.headFill, row] } : { ...c, rows: [...c.rows, row] }));
  return row;
}

export const findRow = (c, id) => c.rows.find((r) => r.id === id) || c.headFill.find((r) => r.id === id) || null;

export function updateRow(row) {
  edit((c) => ({ ...c, rows: c.rows.map((r) => (r.id === row.id ? row : r)), headFill: c.headFill.map((r) => (r.id === row.id ? row : r)) }));
}

let lastRemoved = null;
export function removeRow(id) {
  const d = draft(); if (!d) return;
  const i = d.rows.findIndex((r) => r.id === id), hi = d.headFill.findIndex((r) => r.id === id);
  if (i >= 0) lastRemoved = { row: d.rows[i], index: i, header: false };
  else if (hi >= 0) lastRemoved = { row: d.headFill[hi], index: hi, header: true };
  else return;
  edit((c) => ({ ...c, rows: c.rows.filter((r) => r.id !== id), headFill: c.headFill.filter((r) => r.id !== id) }));
}
export function undoRemove() {
  if (!lastRemoved) return;
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
