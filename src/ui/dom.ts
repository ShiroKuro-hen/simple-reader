// Tiny DOM helpers shared by the views. Decisions live in the DOM-free modules next to this file.

type Child = Node | string | null | false | undefined;

/** Create an element. `onclick`-style keys add listeners; everything else is an attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = v as string;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids.filter((c): c is Node | string => c != null && c !== false));
  return el;
}

const ICONS = {
  back: 'M15 18l-6-6 6-6',
  next: 'M9 6l6 6-6 6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6L6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM19 19v2H6M9 7h6',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  pencil: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
} as const;

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

export function iconButton(name: keyof typeof ICONS, label: string, onclick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

/** A native <dialog>: focus trap, Esc and ::backdrop for free. Clicking the backdrop closes it. */
export function sheet(cls: string, label: string): HTMLDialogElement {
  const d = h('dialog', { class: `sheet ${cls}`, 'aria-label': label });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  return d;
}

let toastHost: HTMLElement | undefined;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${kind}` }, message);
  toastHost.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}
