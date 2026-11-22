// Saved cards and backdrop photos live in IndexedDB on this device. Cards are one JSON record,
// written whole like the Android app's cards.json; photos are image blobs keyed by id.
// If IndexedDB is unavailable (some private modes) cards fall back to localStorage.

const DB = 'neopaper', VERSION = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}

const LS_KEY = 'neopaper.cards';

export async function loadCards() {
  try {
    const v = await tx('kv', 'readonly', (s) => s.get('cards'));
    if (Array.isArray(v)) return v;
  } catch {}
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (Array.isArray(v)) return v; } catch {}
  return [];
}

export async function saveCards(json) {
  try { await tx('kv', 'readwrite', (s) => s.put(json, 'cards')); return true; }
  catch {
    try { localStorage.setItem(LS_KEY, JSON.stringify(json)); return true; } catch { return false; }
  }
}

const memPhotos = new Map();
export async function putPhoto(id, blob) {
  try { await tx('photos', 'readwrite', (s) => s.put(blob, id)); } catch { memPhotos.set(id, blob); }
}
export async function getPhoto(id) {
  try { const b = await tx('photos', 'readonly', (s) => s.get(id)); if (b) return b; } catch {}
  return memPhotos.get(id) || null;
}
export async function deletePhoto(id) {
  memPhotos.delete(id);
  try { await tx('photos', 'readwrite', (s) => s.delete(id)); } catch {}
}
export async function photoIds() {
  try { return (await tx('photos', 'readonly', (s) => s.getAllKeys())) || []; } catch { return [...memPhotos.keys()]; }
}

/** Ask the browser not to evict our data under storage pressure (Safari drops it otherwise). */
export async function persist() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return !!(await navigator.storage?.persist?.());
  } catch { return false; }
}
export async function isPersisted() { try { return !!(await navigator.storage?.persisted?.()); } catch { return false; } }
