// App preferences (data/SettingsRepository.kt), kept in localStorage: a handful of small values.
import { DEVICE, DEVICE_PRESETS, RATIOS } from './model.js';
import { isSmallSquarish, GUIDE_SCREENS } from './placement.js';

const KEY = 'neopaper.settings';
export const ORIENTATIONS = { AUTO: 'Auto', PORTRAIT: 'Portrait', LANDSCAPE: 'Landscape' };
/** How the builder's Card tab edits: on the card itself (like the Android app) or as a row list. */
export const CARD_EDITORS = { CARD: 'On the card', LIST: 'Row list' };
const DEFAULTS = {
  ratio: 'R3_4', orientation: 'AUTO', exportPreset: DEVICE, exportScale: 1, exportPng: true,
  /** Clock and dock guides on the wallpaper preview: off until turned on (new key, so old installs start off too). */
  guidesOn: false,
  /** Which screen the guides, and the placement of new cards, follow. */
  guideScreen: 'HOME',
  haptics: true,
  /** The builder's tab bar stays folded away between visits. */
  tabsHidden: false,
  cardEditor: 'CARD',
};

function load() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const s = { ...DEFAULTS };
  if (o.ratio in RATIOS) s.ratio = o.ratio;
  if (o.orientation in ORIENTATIONS) s.orientation = o.orientation;
  if (o.exportPreset === DEVICE || DEVICE_PRESETS.some((p) => p.id === o.exportPreset)) s.exportPreset = o.exportPreset;
  if ([1, 2, 3].includes(o.exportScale)) s.exportScale = o.exportScale;
  if (o.guideScreen in GUIDE_SCREENS) s.guideScreen = o.guideScreen;
  if (o.cardEditor in CARD_EDITORS) s.cardEditor = o.cardEditor;
  for (const k of ['exportPng', 'guidesOn', 'haptics', 'tabsHidden']) if (typeof o[k] === 'boolean') s[k] = o[k];
  return s;
}

export const settings = load();
const listeners = new Set();
export const onSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setSettings(patch) {
  Object.assign(settings, patch);
  const { showGuides, ...keep } = settings; // dropped in 1.5: guides are Off · Home · Lock now
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch {}
  listeners.forEach((fn) => { try { fn(settings); } catch (e) { console.error(e); } });
}

/** The screen the guides follow ('HOME' | 'LOCK'), or null while they are off. */
export const guides = () => (settings.guidesOn ? settings.guideScreen : null);
/** Guides off (null) or following the home or lock screen. Same setting in Settings and on the Backdrop tab. */
export const setGuides = (screen) => setSettings(screen ? { guidesOn: true, guideScreen: screen } : { guidesOn: false });

/** This screen is phone-sized and nearly square (a 9:10 phone, a foldable's outer screen). */
export const screenIsSmallSquarish = () => isSmallSquarish(screen.width, screen.height);

/** Landscape for a new blank card, following the setting. */
export function defaultLandscape() {
  return settings.orientation === 'AUTO' ? screenIsSmallSquarish() : settings.orientation === 'LANDSCAPE';
}

/** Vibrate unless Settings › Haptics is off. */
export function vibrate(ms) { if (settings.haptics) navigator.vibrate?.(ms); }
