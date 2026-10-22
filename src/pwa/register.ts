// Registers the service worker and tells the app when a newer version is waiting.
import { shouldRegister } from './policy';

/**
 * `onUpdate(apply)` is called when a new version has installed and is waiting; `apply()` activates it and the page reloads once.
 * Does nothing where shouldRegister says no (dev, Tauri, non-http(s), no service worker support).
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  const hasServiceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const tauri = '__TAURI_INTERNALS__' in window;
  if (!shouldRegister({ hasServiceWorker, tauri, protocol: location.protocol, dev: import.meta.env.DEV })) return;
  const sw = navigator.serviceWorker;

  const hadController = !!sw.controller; // false on the very first visit: then claim() is not an update, do not reload
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const waiting = (w: ServiceWorker) => onUpdate(() => w.postMessage('skip-waiting'));
  sw.register(`${import.meta.env.BASE_URL}sw.js`).then(
    (reg) => {
      if (reg.waiting && sw.controller) waiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => w.state === 'installed' && sw.controller && waiting(w));
      });
      // An installed app can stay open for days: look for a new version whenever it comes back to the foreground.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => {}));
    },
    () => {}, // no worker just means no offline support
  );
}
