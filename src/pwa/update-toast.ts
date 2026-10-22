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
