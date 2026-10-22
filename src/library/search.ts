// Library search: pure, no DOM. Text is folded so "Señal", "SENAL", full-width Latin and katakana/hiragana all compare equal.
import type { BookMeta } from '../types';

/**
 * Case, accent, width and kana-script insensitive form of `s`.
 * Only the Latin combining marks (U+0300-036F) are stripped: Japanese dakuten (U+3099) must survive, or が would match か.
 */
export function fold(s: string): string {
  return s
    .normalize('NFKC') // full-width Latin, half-width katakana
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC') // puts か + dakuten back together as が
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // katakana -> hiragana
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every whitespace-separated word of `query` must appear somewhere in the title, author or tags. An empty query matches all. */
export function matches(book: BookMeta, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const haystack = fold([book.title, book.author ?? '', ...(book.tags ?? [])].join('\n'));
  return words.every((w) => haystack.includes(w));
}
