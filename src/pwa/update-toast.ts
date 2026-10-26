import { openExternal } from '../native/open-url';
import { h, toast as notify } from '../ui/dom';

/** A toast that stays until the user chooses: "Update available - Reload". `apply` activates the waiting version (the page then reloads). */
export function showUpdateToast(apply: () => void): void {
  if (document.querySelector('.update-toast')) return;
  const toast = h('div', { class: 'update-toast', role: 'status' },
    h('span', {}, 'Update available'),
    h('button', { class: 'btn primary', type: 'button', onclick: (e: Event) => { (e.currentTarget as HTMLButtonElement).disabled = true; apply(); } }, 'Reload'),
    h('button', { class: 'btn', type: 'button', onclick: () => toast.remove() }, 'Later'));
  document.body.append(toast);
}

/** What the release toast's main button does; `busy` is the message while `run` is working (an install that restarts the app). */
export interface ReleaseAction {
  label: string;
  busy?: string;
  run: () => void | Promise<void>;
}

/** The action for a release page the user opens themselves. */
export const openRelease = (url: string): ReleaseAction => ({ label: 'Download', run: () => openExternal(url) });

/** A toast for a newer release of the native app. It stays until the user chooses. */
export function showReleaseToast(version: string, action: ReleaseAction): void {
  if (document.querySelector('.release-toast')) return;
  const available = `Version ${version} is available`;
  const message = h('span', {}, available);
  const go = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    go.disabled = true;
    if (action.busy) message.textContent = action.busy;
    try {
      await action.run();
    } catch {
      message.textContent = available;
      go.disabled = false;
      notify("Couldn't update. Try again, or download it from the release page.", 'error');
    }
  } }, action.label);
  const toast = h('div', { class: 'release-toast', role: 'status' }, message, go,
    h('button', { class: 'btn', type: 'button', onclick: () => toast.remove() }, 'Later'));
  document.body.append(toast);
}
