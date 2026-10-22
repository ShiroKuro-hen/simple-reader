import type { TextSelection } from '../types';
import { h, iconButton } from './dom';
import { classifySelection, createLatest, describeResult, MESSAGES, settle } from './lookup-model';
import { placePopup, usesSheet } from './placement';

/** Word card next to a selection (bottom sheet on phones). Esc is handled by the reader view. */
export function createPopup() {
  const card = h('div', { class: 'popup', role: 'dialog', 'aria-label': 'Word lookup', hidden: true });
  document.body.append(card);
  const latest = createLatest();
  let rect: TextSelection['rect'] | null = null;

  const ac = new AbortController();
  document.addEventListener('pointerdown', (e) => !card.hidden && !card.contains(e.target as Node) && hide(), {
    capture: true,
    signal: ac.signal,
  });

  function place() {
    if (!rect) return;
    if (usesSheet(innerWidth)) {
      card.style.left = card.style.top = '';
      return;
    }
    const { x, y } = placePopup(rect, { w: card.offsetWidth, h: card.offsetHeight }, { w: innerWidth, h: innerHeight });
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  function fill(state: string, heading: string, ...body: (Node | null)[]) {
    card.dataset.state = state;
    card.replaceChildren(
      h('div', { class: 'pop-head' }, h('p', { class: 'pop-word' }, heading), iconButton('close', 'Close', hide, 'small')),
      ...body.filter((n): n is Node => n !== null),
    );
    place();
  }

  async function run(sel: TextSelection, kind: 'word' | 'phrase') {
    fill('loading', sel.text, h('div', { class: 'skel w70' }), h('div', { class: 'skel' }), h('div', { class: 'skel w45' }));
    const out = await settle(latest, async () => (await import('../lookup/index')).lookup(sel.text, sel.context));
    if (out.status === 'stale') return;
    if (out.status === 'error') {
      fill('error', sel.text,
        h('p', { class: 'pop-note' }, MESSAGES.offline),
        h('button', { class: 'btn', type: 'button', onclick: () => void run(sel, kind) }, 'Try again'));
      return;
    }
    const c = describeResult(out.value, kind);
    fill('result', sel.text,
      c.reading ? h('p', { class: 'pop-reading', lang: 'ja' }, c.reading) : null,
      c.romaji ? h('p', { class: 'pop-romaji' }, c.romaji) : null,
      c.translation ? h('p', { class: 'pop-translation' }, c.translation) : null,
      c.definitions.length ? h('ol', { class: 'pop-defs' }, ...c.definitions.map((d) => h('li', {}, d))) : null,
      c.empty ? h('p', { class: 'pop-note' }, MESSAGES.empty) : null,
      h('p', { class: 'pop-source' }, c.source));
  }

  function show(sel: TextSelection) {
    const kind = classifySelection(sel.text);
    if (kind === 'ignore') return;
    rect = sel.rect;
    card.hidden = false;
    if (kind === 'too-long') {
      latest.cancel();
      fill('too-long', sel.text.slice(0, 60) + '...', h('p', { class: 'pop-note' }, MESSAGES.tooLong));
      return;
    }
    void run({ ...sel, text: sel.text.trim() }, kind);
  }

  function hide() {
    latest.cancel();
    card.hidden = true;
  }

  return {
    show,
    hide,
    get open() {
      return !card.hidden;
    },
    dispose() {
      ac.abort();
      card.remove();
    },
  };
}
