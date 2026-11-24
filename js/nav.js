// Screens and overlays form one stack mirrored in browser history, so the Android back button,
// a mouse back button and Escape all close the top layer, and a reload starts at home.

const layers = []; // { close(), kind: 'screen' | 'overlay' }
let popping = null;

export function initHistory() {
  history.replaceState({ np: 0 }, '');
  addEventListener('popstate', (e) => {
    const depth = e.state?.np ?? 0;
    while (layers.length > depth) {
      const top = layers.pop();
      try { top.close(); } catch (err) { console.error(err); }
    }
    // Forward navigation after a back can't restore a closed layer; stay where we are.
    if (layers.length < depth) history.replaceState({ np: layers.length }, '');
    const done = popping; popping = null; done?.();
  });
}

/** Adds a layer; [close] runs when it is popped by back, Escape or [pop]. */
export function pushLayer(close, kind = 'overlay') {
  const layer = { close, kind };
  layers.push(layer);
  history.pushState({ np: layers.length }, '');
  return layer;
}

/** [layer] (from pushLayer) is the top one, so pop() would close it. */
export const isTop = (layer) => layers[layers.length - 1] === layer;

/** Pops the top layer (like pressing back). Resolves once it is closed. */
export function pop() {
  if (!layers.length) return Promise.resolve();
  return new Promise((resolve) => {
    const prev = popping;
    popping = () => { prev?.(); resolve(); };
    history.back();
  });
}

/** Pops until only [n] layers are left. */
export async function popTo(n) {
  while (layers.length > n) await pop();
}

export const depth = () => layers.length;
export const topKind = () => layers[layers.length - 1]?.kind ?? null;

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !layers.length) return;
  const t = e.target;
  // Escape inside a text field first leaves the field.
  // (In a sheet, Escape closes the sheet.)
  if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && document.activeElement === t && layers[layers.length - 1].kind !== 'overlay') { t.blur(); return; }
  e.preventDefault();
  pop();
});
