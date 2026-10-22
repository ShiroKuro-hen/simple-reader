// Tag rules: pure, no DOM. Tags are the user's own words, kept lowercase, trimmed, unique.
import type { BookMeta } from '../types';

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 20;

export type TagResult = { ok: true; tag: string } | { ok: false; reason: 'empty' | 'too-long' | 'invalid' };
export type AddResult = { ok: true; tags: string[] } | { ok: false; reason: 'empty' | 'too-long' | 'invalid' | 'duplicate' | 'too-many' };

export function normalizeTag(raw: string): TagResult {
  const tag = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!tag) return { ok: false, reason: 'empty' };
  if (/[\p{Cc},]/u.test(tag)) return { ok: false, reason: 'invalid' };
  if ([...tag].length > MAX_TAG_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, tag };
}

/** Whatever a file or a sync gave us, as a valid list: bad entries and duplicates dropped, order kept, capped. */
export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const t of raw) {
    const n = typeof t === 'string' ? normalizeTag(t) : undefined;
    if (n?.ok) out.add(n.tag);
  }
  return [...out].slice(0, MAX_TAGS);
}

export function addTag(tags: readonly string[] | undefined, raw: string): AddResult {
  const n = normalizeTag(raw);
  if (!n.ok) return n;
  const current = cleanTags(tags);
  if (current.includes(n.tag)) return { ok: false, reason: 'duplicate' };
  if (current.length >= MAX_TAGS) return { ok: false, reason: 'too-many' };
  return { ok: true, tags: [...current, n.tag] };
}

export function removeTag(tags: readonly string[] | undefined, raw: string): string[] {
  const n = normalizeTag(raw);
  return cleanTags(tags).filter((t) => !n.ok || t !== n.tag);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Every tag in use with its number of books: most used first, ties alphabetical. */
export function tagCounts(books: readonly BookMeta[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of books) for (const t of cleanTags(b.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
}

/** Books carrying all of `selected` (AND). No selection keeps everything. */
export function filterByTags<T extends BookMeta>(books: readonly T[], selected: readonly string[]): T[] {
  const wanted = cleanTags(selected);
  if (!wanted.length) return [...books];
  return books.filter((b) => {
    const have = cleanTags(b.tags);
    return wanted.every((t) => have.includes(t));
  });
}
