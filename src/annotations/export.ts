// Turns annotations into files the user keeps: a Markdown note (Obsidian-friendly) or JSON. Pure.
import type { Annotation, BookMeta, HighlightColor } from '../types';
import { listAnnotations, previewText } from './model';

const MARKER: Record<HighlightColor, string> = { yellow: '🟨', green: '🟩', blue: '🟦', pink: '🩷' };

/** Backslash-escape what Markdown would read as formatting. `lead` is false when something precedes the text on its line. */
function esc(line: string, lead = true): string {
  let out = line.replace(/[\\`*_[\]<~]/g, '\\$&').replace(/&(?=#?\w+;)/g, '\\&');
  if (lead) out = out.trimStart().replace(/^(\d+)([.)])/, '$1\\$2').replace(/^[#>+\-=]/, '\\$&');
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The same highlight can reach us under two ids (made twice, or on two devices): keep the newest. */
function unique(items: Annotation[]): Annotation[] {
  const seen = new Map<string, Annotation>();
  for (const a of items) {
    const k = [a.kind, a.location, a.text].join('\u0000');
    const have = seen.get(k);
    if (!have || a.updatedAt > have.updatedAt || (a.updatedAt === have.updatedAt && a.id > have.id)) seen.set(k, a);
  }
  return [...seen.values()];
}

const live = (book: BookMeta, items: Annotation[]) => listAnnotations(unique(items.filter((a) => a.bookId === book.id)));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function exportMarkdown(book: BookMeta, items: Annotation[], opts: { exportedAt?: number } = {}): string {
  const all = live(book, items);
  const marks = all.filter((a) => a.kind !== 'bookmark');
  const bookmarks = all.filter((a) => a.kind === 'bookmark');

  const out: string[] = [`# ${esc(oneLine(book.title), false)}`];
  if (book.author) out.push(`*${esc(oneLine(book.author), false)}*`);

  const noted = marks.filter((a) => a.note).length;
  const counts = [
    marks.length ? plural(marks.length, 'highlight') + (noted ? ` (${noted} with a note)` : '') : '',
    bookmarks.length ? plural(bookmarks.length, 'bookmark') : '',
  ].filter(Boolean);
  const when = opts.exportedAt === undefined ? '' : `Exported ${new Date(opts.exportedAt).toISOString().slice(0, 10)}`;
  out.push([when, counts.join(' · ') || 'No highlights, notes or bookmarks yet.'].filter(Boolean).join(' · '));

  const chapters = new Map<string, Annotation[]>();
  for (const a of marks) {
    const name = a.chapter?.trim() || 'Other';
    chapters.set(name, [...(chapters.get(name) ?? []), a]);
  }
  for (const [chapter, list] of chapters) {
    out.push(`## ${esc(oneLine(chapter), false)}`);
    for (const a of list) {
      const lines = a.text.trim().split(/\r?\n/).map((l) => l.trim());
      out.push(lines.map((l, i) => `> ${i === 0 ? `${MARKER[a.color]} ${esc(l, false)}` : l ? esc(l) : ''}`.trimEnd()).join('\n'));
      if (a.note) out.push(`**Note:** ${a.note.trim().split(/\r?\n/).map((l) => esc(l.trim(), false)).join('  \n')}`);
    }
  }

  if (bookmarks.length) {
    out.push('## Bookmarks');
    out.push(
      bookmarks
        .map((a) => {
          const where = a.chapter?.trim() ? esc(oneLine(a.chapter), false) : '';
          const quote = a.text.trim() ? `“${esc(previewText(a.text, 80), false)}”` : '';
          return `- ${[where, quote].filter(Boolean).join(': ') || 'Bookmark'}`;
        })
        .join('\n'),
    );
  }
  return out.join('\n\n') + '\n';
}

export function exportJson(book: BookMeta, items: Annotation[]): string {
  const { id, title, author, format } = book;
  return JSON.stringify({ book: { id, title, ...(author ? { author } : {}), format }, annotations: live(book, items) }, null, 2) + '\n';
}

/** "<title>-notes.md" with nothing a file system dislikes. */
export function exportFilename(book: BookMeta, ext: 'md' | 'json' = 'md'): string {
  const title = book.title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return `${title || 'book'}-notes.${ext}`;
}
