// PDF in-book search: a page's text and its matches as search hits. Pure; pdf.ts draws the matches on the page.
import type { SearchHit } from '../types';
import { matchesIn } from './search-results';

/** The text of a page the way the text layer shows its items: one space between items, none for empty ones. */
export function pageText(items: readonly string[]): string {
  return items.filter((s) => s !== '').join(' ');
}

/** The matches of `query` on a page. A hit's `cfi` is the page number, which is what goTo takes. */
export function pageHits(page: number, text: string, query: string): SearchHit[] {
  return matchesIn(text, query).map(({ pre, match, post }) => ({ chapter: `Page ${page}`, cfi: String(page), pre, match, post }));
}

/**
 * Where the match [start, end) of the joined page text falls in its pieces (the items, joined with one space): an offset
 * range inside each piece it touches. A match that runs across a join gives one span per piece.
 */
export function pieceSpans(lengths: readonly number[], start: number, end: number): { piece: number; from: number; to: number }[] {
  const spans: { piece: number; from: number; to: number }[] = [];
  let at = 0; // where this piece starts in the joined text
  lengths.forEach((length, piece) => {
    const from = Math.max(start, at);
    const to = Math.min(end, at + length);
    if (from < to) spans.push({ piece, from: from - at, to: to - at });
    at += length + 1;
  });
  return spans;
}
