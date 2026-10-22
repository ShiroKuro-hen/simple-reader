import { previewText } from '../annotations/model';
import type { Annotation, HighlightColor, TextSelection } from '../types';
import { annotateRow } from './annotate-row';
import { h, iconButton } from './dom';
import { classifySelection, createLatest, describeResult, MESSAGES, settle } from './lookup-model';
import { placePopup, usesSheet } from './placement';

/** What the popup's annotate row can do; the reader view owns the annotations and carries these out. */
export interface PopupActions {
  highlight(sel: TextSelection, color: HighlightColor): void;
  note(sel: TextSelection, text: string): void;
  update(id: string, patch: { note?: string; color?: HighlightColor }): void;
  remove(id: string): void;
}

/** Word card next to a selection (bottom sheet on phones). Esc is handled by the reader view. */
export function createPopup(actions: PopupActions) {
  const card = h('div', { class: 'popup', role: 'dialog', 'aria-label': 'Word lookup', hidden: true });
  // The annotate row sits between the head and the lookup result and survives result updates, so a note being typed is never wiped.
  const headEl = h('div', { class: 'pop-head' });
  const toolsEl = h('div', { class: 'pop-tools' });
  const bodyEl = h('div', { class: 'pop-body' });
  card.append(headEl, toolsEl, bodyEl);
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
    headEl.replaceChildren(h('p', { class: 'pop-word' }, heading), iconButton('close', 'Close', hide, 'small'));
    bodyEl.replaceChildren(...body.filter((n): n is Node => n !== null));
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

  let shown = '';

  function show(sel: TextSelection) {
    const kind = classifySelection(sel.text);
    if (kind === 'ignore') return;
    const same = `${sel.location}|${sel.text}`;
    if (!card.hidden && shown === same) return; // the browser re-reports an unchanged selection when focus moves into the note box
    shown = same;
    rect = sel.rect;
    card.setAttribute('aria-label', 'Word lookup');
    toolsEl.replaceChildren(
      ...(sel.location
        ? [annotateRow({
            onColor: (c) => (hide(), actions.highlight(sel, c)),
            onNote: (text) => (hide(), actions.note(sel, text)),
          })]
        : []),
    );
    card.hidden = false;
    if (kind === 'too-long') {
      latest.cancel();
      fill('too-long', sel.text.slice(0, 60) + '...', h('p', { class: 'pop-note' }, MESSAGES.tooLong));
      return;
    }
    void run({ ...sel, text: sel.text.trim() }, kind);
  }

  /** Edit card for a highlight the reader tapped: colour, note, remove. */
  function showAnnotation(a: Annotation, at: TextSelection['rect']) {
    latest.cancel();
    shown = '';
    rect = at;
    card.setAttribute('aria-label', 'Highlight');
    toolsEl.replaceChildren(
      annotateRow({
        color: a.color,
        note: a.note,
        onColor: (color) => (hide(), actions.update(a.id, { color })),
        onNote: (note) => (hide(), actions.update(a.id, { note })),
        onRemove: () => (hide(), actions.remove(a.id)),
      }),
    );
    card.hidden = false;
    fill('annotation', previewText(a.text, 80), a.note ? h('p', { class: 'pop-annotation-note' }, a.note) : null);
  }

  function hide() {
    latest.cancel();
    card.hidden = true;
    shown = '';
  }

  return {
    show,
    showAnnotation,
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
