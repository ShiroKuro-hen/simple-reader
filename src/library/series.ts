// Series: a folder of volumes imported together, shown as one library entry. Pure, no DOM.
import type { BookMeta } from '../types';
import { formatOf } from '../storage/domain';

/** Top-level folders the app uses for its own data: a book key under them is never a series folder. */
const APP_FOLDERS = new Set(['books', 'meta', 'progress', 'annotations']);

/** The series and file name of a bucket key like `Lord of the Mysteries/Vol 01.epub`; null for keys that are not series books. */
export function seriesFromKey(key: string): { series: string; file: string } | null {
  const parts = key.split('/');
  if (parts.length < 2) return null; // root-level file, or the settings file
  const [series, file] = [parts[0], parts[parts.length - 1]];
  if (!series || APP_FOLDERS.has(series) || !file || !formatOf(file)) return null; // a trailing '/' leaves an empty file name
  return { series, file };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Volumes in reading order: natural title order ("Vol 2" before "Vol 10"), then the older import first. Returns a new array. */
export function volumeOrder(books: readonly BookMeta[]): BookMeta[] {
  return [...books].sort((a, b) => collator.compare(a.title, b.title) || a.addedAt - b.addedAt);
}

export type Entry = { kind: 'book'; book: BookMeta } | { kind: 'series'; name: string; books: BookMeta[] };

/**
 * One entry per book, except that books sharing a series name collapse into one series entry.
 * The entry sits where its first member appears; the other entries keep their input order.
 */
export function groupBySeries(books: readonly BookMeta[]): Entry[] {
  const entries: Entry[] = [];
  const seriesByKey = new Map<string, { kind: 'series'; name: string; books: BookMeta[] }>();
  for (const book of books) {
    const name = book.series?.trim();
    if (!name) {
      entries.push({ kind: 'book', book });
      continue;
    }
    const key = name.toLowerCase();
    let entry = seriesByKey.get(key);
    if (!entry) {
      entry = { kind: 'series', name, books: [] };
      seriesByKey.set(key, entry);
      entries.push(entry);
    }
    entry.books.push(book);
  }
  for (const entry of seriesByKey.values()) entry.books = volumeOrder(entry.books);
  return entries;
}
