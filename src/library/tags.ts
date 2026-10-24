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

/** The reserved category behind the star: an ordinary tag with a fixed name, so it syncs and filters like the rest. */
export const FAVORITES = 'favorites';

export const isFavorite = (b: Pick<BookMeta, 'tags'>): boolean => cleanTags(b.tags).includes(FAVORITES);

/** Adds or removes favorites; removing always works, adding can hit the limit like any other tag. */
export function toggleFavorite(tags: readonly string[] | undefined): AddResult {
  const current = cleanTags(tags);
  if (current.includes(FAVORITES)) return { ok: true, tags: current.filter((t) => t !== FAVORITES) };
  return addTag(current, FAVORITES);
}

/** Every tag in use with its number of books: favorites first, then most used, ties alphabetical. */
export function tagCounts(books: readonly BookMeta[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of books) for (const t of cleanTags(b.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const rank = (tag: string) => (tag === FAVORITES ? 0 : 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => rank(a.tag) - rank(b.tag) || b.count - a.count || collator.compare(a.tag, b.tag));
}

/** The selected categories that at least one book still carries: a category whose last book is gone leaves the selection. */
export function liveSelection(selected: readonly string[], books: readonly BookMeta[]): string[] {
  const inUse = new Set(tagCounts(books).map((c) => c.tag));
  return selected.filter((t) => inUse.has(t));
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
