import { exportFilename, exportMarkdown } from '../annotations/export';
import { listAnnotations } from '../annotations/model';
import { HIGHLIGHT_FILL } from '../annotations/paint';
import { describeAnnotation } from '../annotations/present';
import type { Annotation, BookMeta } from '../types';
import { noteEditor } from './annotate-row';
import { h, icon, iconButton, sheet, toast } from './dom';

export const EMPTY_MESSAGE = 'No highlights, notes or bookmarks yet. Select text to highlight it or add a note, or use the bookmark button.';

/** Hands a Markdown file to the browser's download. */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The Annotations side sheet: every highlight, note and bookmark of the book, with jump, edit, delete, export. */
export function createAnnotationsPanel(
  book: BookMeta,
  on: { jump(a: Annotation): void; setNote(id: string, note: string): void; remove(id: string): void },
) {
  const dlg = sheet('sheet-notes', 'Annotations');
  let items: Annotation[] = [];
  let editing: string | null = null; // id of the item whose note is open for editing

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown());
      toast('Copied as Markdown.');
    } catch {
      toast("Couldn't copy. Use Export instead.", 'error');
    }
  }

  const markdown = () => exportMarkdown(book, items, { exportedAt: Date.now() });

  function row(a: Annotation): HTMLElement {
    const d = describeAnnotation(a);
    const edit = editing === a.id;
    return h('li', { class: `ann ann-k-${a.kind}`, style: `--hl:${HIGHLIGHT_FILL[a.color]}` },
      h('button', { class: 'ann-main', type: 'button', 'aria-label': d.jump, onclick: () => on.jump(a) },
        h('span', { class: 'ann-meta' }, [d.label, d.where].filter(Boolean).join(' · ')),
        d.quote ? h('span', { class: 'ann-quote' }, d.quote) : null,
        d.note && !edit ? h('span', { class: 'ann-note' }, d.note) : null),
      edit
        ? noteEditor({ value: a.note, onSave: (text) => ((editing = null), on.setNote(a.id, text)), onCancel: () => ((editing = null), render(items)) })
        : null,
      h('div', { class: 'ann-actions' },
        a.kind === 'bookmark' ? null : iconButton('pencil', a.note ? 'Edit note' : 'Add note', () => ((editing = edit ? null : a.id), render(items)), 'small'),
        iconButton('trash', a.kind === 'bookmark' ? 'Remove bookmark' : 'Delete annotation', () => on.remove(a.id), 'small')));
  }

  function render(next: Annotation[]) {
    items = next;
    const live = listAnnotations(items);
    const none = live.length === 0;
    dlg.replaceChildren(
      h('div', { class: 'toc notes' },
        h('div', { class: 'set-head' }, h('h2', {}, 'Annotations'), iconButton('close', 'Close annotations', () => dlg.close())),
        h('div', { class: 'notes-tools' },
          h('button', { class: 'btn small', type: 'button', disabled: none, onclick: () => download(exportFilename(book), markdown()) }, icon('download'), 'Export'),
          h('button', {
            class: 'btn small', type: 'button', disabled: none,
            onclick: () => void copy(),
          }, icon('copy'), 'Copy')),
        none ? h('p', { class: 'notes-empty' }, EMPTY_MESSAGE) : h('ul', { class: 'ann-list', 'aria-label': 'Annotations' }, ...live.map(row))));
  }
  render([]);

  return { el: dlg, render, open: () => dlg.showModal(), close: () => dlg.close() };
}
