// "Continue reading": the books opened most recently. Pure, no DOM.
import type { BookMeta } from '../types';

export const RECENT_LIMIT = 8;

/** `opened` maps a book id to when it was last opened. Newest first; ids without a book are ignored; ties go by id. */
export function recentBooks<T extends BookMeta>(books: readonly T[], opened: ReadonlyMap<string, number>, limit = RECENT_LIMIT): T[] {
  return books
    .filter((b) => opened.has(b.id))
    .sort((a, b) => opened.get(b.id)! - opened.get(a.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}
