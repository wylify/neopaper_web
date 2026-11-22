// Install prompt (Chrome, Edge, Android) and standalone detection.
import { toast } from './ui.js';

let deferred = null;
const listeners = new Set();
export const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); toast('NEOPAPER installed'); });

export const canInstall = () => !!deferred;
export const onInstallChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

export async function install() {
  if (!deferred) return false;
  const e = deferred; deferred = null;
  e.prompt();
  const r = await e.userChoice.catch(() => null);
  listeners.forEach((f) => f());
  return r?.outcome === 'accepted';
}
