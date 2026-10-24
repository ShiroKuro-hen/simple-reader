// Searching the text of many books at once: the matches per book, ranked, and the scan that finds them. DOM-free.
import { matchesIn, type TextMatch } from '../reader/search-results';
import type { BookMeta } from '../types';

/** Matches counted per book; a book with more is shown as "50+". */
export const MAX_MATCHES = 50;
const EXCERPTS = 2;

export interface BookHit {
  book: BookMeta;
  /** The matches counted: at most MAX_MATCHES. */
  count: number;
  /** The book has more matches than `count`. */
  capped: boolean;
  excerpts: TextMatch[];
}

export interface ScanStep {
  /** Books read so far, out of `total`. */
  done: number;
  total: number;
  /** The books that matched so far, in library order (rankHits sorts them). */
  hits: BookHit[];
  /** Books whose text could not be read. */
  unreadable: number;
}

/** Lower case with the accents of Latin letters and the voicing of kana taken off, one character for one, so offsets still point into the original. */
const fold = (s: string) => s.replace(/[À-ɏぁ-ヿ]/g, (c) => c.normalize('NFD')[0]!).toLowerCase();
const CONTEXT = 50;
const squash = (s: string) => s.replace(/\s+/g, ' ');

/** The match at `start` with 50 characters of context each side, as the in-book search shows it. */
function excerptAt(text: string, start: number, end: number): TextMatch {
  const pre = squash(text.slice(Math.max(0, start - 4 * CONTEXT), start)).trimStart();
  const post = squash(text.slice(end, end + 4 * CONTEXT)).trimEnd();
  return {
    start, end, match: text.slice(start, end),
    pre: `${pre.length < CONTEXT ? '' : '…'}${pre.slice(-CONTEXT)}`,
    post: `${post.slice(0, CONTEXT)}${post.length < CONTEXT ? '' : '…'}`,
  };
}

/**
 * The matches of `query` in `text`: a plain search over the folded text, which is what makes a library of long books
 * answer in a second. Where folding changes the length (ligatures, a dotted capital I) the offsets would drift, so the
 * exact search answers instead, slowly but right.
 */
function findMatches(text: string, query: string, limit: number): TextMatch[] {
  const hay = fold(text), needle = fold(query);
  if (hay.length !== text.length || needle.length !== query.length) return matchesIn(text, query);
  const found: TextMatch[] = [];
  for (let at = hay.indexOf(needle); at !== -1 && found.length <= limit; at = hay.indexOf(needle, at + needle.length)) {
    found.push(excerptAt(text, at, at + needle.length));
  }
  return found;
}

/** The hit for `query` in one book's `text`, or null when the text does not contain it. */
export function bookHit(book: BookMeta, text: string, query: string): BookHit | null {
  const found = findMatches(text, query, MAX_MATCHES);
  if (!found.length) return null;
  return { book, count: Math.min(found.length, MAX_MATCHES), capped: found.length > MAX_MATCHES, excerpts: found.slice(0, EXCERPTS) };
}

/** The books with the most matches first, then by title. */
export function rankHits(hits: readonly BookHit[]): BookHit[] {
  return [...hits].sort((a, b) => b.count - a.count || a.book.title.localeCompare(b.book.title));
}

/**
 * Searches the books one after another, reporting before the first and after each. Stopping the loop stops the scan:
 * no further book is read, so a newer query is not kept waiting behind this one.
 */
export async function* scanBooks(
  books: readonly BookMeta[],
  query: string,
  textOf: (book: BookMeta) => Promise<string>,
): AsyncGenerator<ScanStep> {
  const hits: BookHit[] = [];
  let unreadable = 0;
  yield { done: 0, total: books.length, hits: [...hits], unreadable };
  for (const [i, book] of books.entries()) {
    await new Promise((resolve) => setTimeout(resolve)); // lets the page take input between books
    const text = await textOf(book).catch(() => null);
    if (text === null) unreadable++;
    else {
      const hit = bookHit(book, text, query);
      if (hit) hits.push(hit);
    }
    yield { done: i + 1, total: books.length, hits: [...hits], unreadable };
  }
}
