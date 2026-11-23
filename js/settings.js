// App preferences (data/SettingsRepository.kt), kept in localStorage: a handful of small values.
import { DEVICE, DEVICE_PRESETS, RATIOS } from './model.js';
import { isSmallSquarish } from './placement.js';

const KEY = 'neopaper.settings';
export const ORIENTATIONS = { AUTO: 'Auto', PORTRAIT: 'Portrait', LANDSCAPE: 'Landscape' };
const DEFAULTS = {
  ratio: 'R3_4', orientation: 'AUTO', exportPreset: DEVICE, exportScale: 1, exportPng: true,
  showGuides: true, haptics: true,
  /** Short screens: the builder's tab bar stays folded away between visits. */
  tabsHidden: false,
};

function load() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const s = { ...DEFAULTS };
  if (o.ratio in RATIOS) s.ratio = o.ratio;
  if (o.orientation in ORIENTATIONS) s.orientation = o.orientation;
  if (o.exportPreset === DEVICE || DEVICE_PRESETS.some((p) => p.id === o.exportPreset)) s.exportPreset = o.exportPreset;
  if ([1, 2, 3].includes(o.exportScale)) s.exportScale = o.exportScale;
  for (const k of ['exportPng', 'showGuides', 'haptics', 'tabsHidden']) if (typeof o[k] === 'boolean') s[k] = o[k];
  return s;
}

export const settings = load();
const listeners = new Set();
export const onSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setSettings(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  listeners.forEach((fn) => fn(settings));
}

/** This screen is phone-sized and nearly square (a 9:10 phone, a foldable's outer screen). */
export const screenIsSmallSquarish = () => isSmallSquarish(screen.width, screen.height);

/** Landscape for a new blank card, following the setting. */
export function defaultLandscape() {
  return settings.orientation === 'AUTO' ? screenIsSmallSquarish() : settings.orientation === 'LANDSCAPE';
}

/** Vibrate unless Settings › Haptics is off. */
export function vibrate(ms) { if (settings.haptics) navigator.vibrate?.(ms); }
