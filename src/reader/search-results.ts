// Rules for the in-book search results. DOM-free.
import { search as foliateSearch } from '../vendor/foliate-js/search.js';
import type { SearchHit } from '../types';

/** More rows than this would build thousands of buttons for a common word. */
export const MAX_HITS = 300;
const EXCERPT_CHARS = 40;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const collapse = (text: string) => text.replace(/\s+/g, ' ');

/** The query to search for: trimmed, or '' when it is too short to search (one character that is not CJK). */
export function normalizeQuery(raw: string): string {
  const query = raw.trim();
  if ([...query].length === 1 && !CJK.test(query)) return '';
  return query;
}

/** The first `max` hits, in order, and whether there were more. */
export function capHits<T>(hits: readonly T[], max = MAX_HITS): { shown: T[]; truncated: boolean } {
  return { shown: hits.slice(0, max), truncated: hits.length > max };
}

export interface ChapterHits {
  chapter: string;
  hits: SearchHit[];
}

/** The hits under their chapter, chapters in the order they first appear. */
export function groupByChapter(hits: readonly SearchHit[]): ChapterHits[] {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const list = groups.get(hit.chapter);
    if (list) list.push(hit);
    else groups.set(hit.chapter, [hit]);
  }
  return [...groups].map(([chapter, list]) => ({ chapter, hits: list }));
}

/** The last characters before the match, starting at a word where the text has spaces. */
function beforeMatch(text: string): string {
  if (text.length <= EXCERPT_CHARS) return text.trimStart();
  const cut = text.slice(text.length - EXCERPT_CHARS);
  const atWordStart = text[text.length - EXCERPT_CHARS - 1] === ' ' || cut[0] === ' ';
  return '…' + (atWordStart ? cut.trimStart() : cut.slice(cut.indexOf(' ') + 1));
}

/** The first characters after the match, ending at a word where the text has spaces. */
function afterMatch(text: string): string {
  if (text.length <= EXCERPT_CHARS) return text.trimEnd();
  const cut = text.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(' ');
  const atWordEnd = text[EXCERPT_CHARS] === ' ' || cut.endsWith(' ');
  return (atWordEnd || space < 0 ? cut : cut.slice(0, space)).trimEnd() + '…';
}

/** One match in a text: `start` and `end` are its offsets into the text. */
export interface TextMatch {
  start: number;
  end: number;
  pre: string;
  match: string;
  post: string;
}

/**
 * The matches of `query` in `text`, in order. Case and accents do not matter. This is foliate's search, the one the EPUB
 * search runs, so a PDF finds what an EPUB would.
 */
export function matchesIn(text: string, query: string): TextMatch[] {
  const found: TextMatch[] = [];
  for (const { range, excerpt } of foliateSearch([text], query, { granularity: 'grapheme', sensitivity: 'base' })) {
    found.push({ start: range.startOffset, end: range.endOffset, ...excerpt });
  }
  return found;
}

/** The match with a short piece of text on each side. Whitespace is collapsed; the space next to the match is kept. */
export function excerptParts(hit: Pick<SearchHit, 'pre' | 'match' | 'post'>): { pre: string; match: string; post: string } {
  return {
    pre: beforeMatch(collapse(hit.pre)),
    match: collapse(hit.match),
    post: afterMatch(collapse(hit.post)),
  };
}
