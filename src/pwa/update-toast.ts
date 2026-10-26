import { openExternal } from '../native/open-url';
import { h } from '../ui/dom';

/** A toast that stays until the user chooses: "Update available - Reload". `apply` activates the waiting version (the page then reloads). */
export function showUpdateToast(apply: () => void): void {
  if (document.querySelector('.update-toast')) return;
  const toast = h('div', { class: 'update-toast', role: 'status' },
    h('span', {}, 'Update available'),
    h('button', { class: 'btn primary', type: 'button', onclick: (e: Event) => { (e.currentTarget as HTMLButtonElement).disabled = true; apply(); } }, 'Reload'),
    h('button', { class: 'btn', type: 'button', onclick: () => toast.remove() }, 'Later'));
  document.body.append(toast);
}

/** A toast for a newer release of the native app: the user downloads it themselves, nothing is installed in place. */
export function showReleaseToast(version: string, url: string): void {
  if (document.querySelector('.release-toast')) return;
  const toast = h('div', { class: 'release-toast', role: 'status' },
    h('span', {}, `Version ${version} is available`),
    h('button', { class: 'btn primary', type: 'button', onclick: () => openExternal(url) }, 'Download'),
    h('button', { class: 'btn', type: 'button', onclick: () => toast.remove() }, 'Later'));
  document.body.append(toast);
}
