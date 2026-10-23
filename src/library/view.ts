// What the library screen shows for a query, a tag selection and a sort order: pure, no DOM.
import type { BookMeta } from '../types';
import { matches } from './search';
import { type SortKey, sortBooks } from './sort';
import { type Entry, groupBySeries } from './series';
import { filterByTags } from './tags';

export interface ViewOptions {
  query: string;
  tags: string[];
  sort: SortKey;
}

export interface LibraryView {
  books: BookMeta[];
  /** `books` with each series collapsed into one entry, in the same order. */
  entries: Entry[];
  shown: number;
  total: number;
  /** 'empty-library' = nothing imported yet; 'no-results' = books exist but the search/tags hide them all. */
  state: 'empty-library' | 'no-results' | 'results';
}

export function libraryView(all: readonly BookMeta[], { query, tags, sort }: ViewOptions, lastRead?: ReadonlyMap<string, number>): LibraryView {
  const books = sortBooks(filterByTags(all, tags).filter((b) => matches(b, query)), sort, lastRead);
  const state = !all.length ? 'empty-library' : !books.length ? 'no-results' : 'results';
  return { books, entries: groupBySeries(books), shown: books.length, total: all.length, state };
}

export function countLabel(shown: number, total: number): string {
  const noun = `book${total === 1 ? '' : 's'}`;
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
