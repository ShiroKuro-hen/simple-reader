// Library ordering: pure comparators, no DOM.
import type { BookMeta } from '../types';

export const SORT_KEYS = ['added', 'title', 'author', 'read'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const parseSortKey = (v: unknown): SortKey => (SORT_KEYS as readonly unknown[]).includes(v) ? (v as SortKey) : 'added';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byTitle = (a: BookMeta, b: BookMeta) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byAdded = (a: BookMeta, b: BookMeta) => b.addedAt - a.addedAt || byTitle(a, b);
const authorOf = (b: BookMeta) => b.author?.trim() ?? '';

/** `lastRead` maps a book id to the time it was last read (its progress `updatedAt`). Returns a new array. */
export function sortBooks<T extends BookMeta>(books: readonly T[], key: SortKey, lastRead: ReadonlyMap<string, number> = new Map()): T[] {
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    added: byAdded,
    title: byTitle,
    author: (a, b) => {
      const x = authorOf(a), y = authorOf(b);
      if (!x !== !y) return x ? -1 : 1; // books without an author go last
      return collator.compare(x, y) || byTitle(a, b);
    },
    read: (a, b) => {
      const x = lastRead.get(a.id), y = lastRead.get(b.id);
      if (x !== undefined && y !== undefined) return y - x || byAdded(a, b);
      if (x !== undefined || y !== undefined) return x !== undefined ? -1 : 1; // read books before unread ones
      return byAdded(a, b);
    },
  };
  return [...books].sort(cmp[key]);
}
