import { COLORS } from '../annotations/model';
import { HIGHLIGHT_FILL } from '../annotations/paint';
import type { HighlightColor } from '../types';
import { h, icon } from './dom';

/** A small inline note editor. Ctrl/Cmd+Enter saves, Esc cancels. */
export function noteEditor(o: { value?: string; onSave(text: string): void; onCancel(): void }): HTMLElement {
  const input = h('textarea', { class: 'note-input', rows: 3, 'aria-label': 'Note', placeholder: 'Write a note...' });
  input.value = o.value ?? '';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      o.onSave(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // closes the editor, not the whole popup or sheet
      o.onCancel();
    }
  });
  queueMicrotask(() => input.focus());
  return h('div', { class: 'note-editor' }, input,
    h('div', { class: 'note-actions' },
      h('span', { class: 'note-hint' }, 'Ctrl+Enter to save'),
      h('button', { class: 'btn small', type: 'button', onclick: o.onCancel }, 'Cancel'),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => o.onSave(input.value) }, 'Save note')));
}

/** Colour dots, a Note button, and (for an existing highlight) a remove button. `color` marks the current colour. */
export function annotateRow(o: {
  color?: HighlightColor;
  note?: string;
  onColor(c: HighlightColor): void;
  onNote(text: string): void;
  onRemove?(): void;
}): HTMLElement {
  const slot = h('div', { class: 'note-slot' });
  const noteBtn = h('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false' }, icon('pencil'), o.note ? 'Edit note' : 'Note');
  const close = () => {
    slot.replaceChildren();
    noteBtn.setAttribute('aria-expanded', 'false');
  };
  noteBtn.addEventListener('click', () => {
    if (slot.firstChild) return close();
    noteBtn.setAttribute('aria-expanded', 'true');
    slot.replaceChildren(noteEditor({ value: o.note, onSave: o.onNote, onCancel: close }));
  });
  return h('div', { class: 'annotate' },
    h('div', { class: 'annotate-row', role: 'group', 'aria-label': 'Highlight colour' },
      ...COLORS.map((c) =>
        h('button', {
          class: 'dot', type: 'button', style: `--hl:${HIGHLIGHT_FILL[c]}`, title: `Highlight ${c}`,
          'aria-label': `Highlight ${c}`, 'aria-pressed': o.color ? String(o.color === c) : null,
          onclick: () => o.onColor(c),
        })),
      noteBtn,
      o.onRemove && h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Remove highlight', title: 'Remove highlight', onclick: o.onRemove }, icon('trash'))),
    slot);
}
