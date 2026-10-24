// Rules for highlights, notes and bookmarks. Pure: no DOM, no storage, so sync and the CLI can reuse it.
import type { Annotation, AnnotationFile, AnnotationKind, HighlightColor } from '../types';
import { pageOfLocation } from '../reader/pdf-highlights';
import { collapse, compare, parse } from '../vendor/foliate-js/epubcfi.js';

export const COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
export const DEFAULT_COLOR: HighlightColor = 'yellow';
const KINDS: readonly AnnotationKind[] = ['highlight', 'note', 'bookmark'];

const colorOr = (c: unknown): HighlightColor => (COLORS.includes(c as HighlightColor) ? (c as HighlightColor) : DEFAULT_COLOR);

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8)); // getRandomValues also works on plain-http pages, randomUUID does not
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A highlight with a note is a note; a note without text is a highlight; a bookmark never has one. */
function withNote(a: Annotation, note: string | undefined): Annotation {
  const { note: _old, ...rest } = a;
  const text = note?.trim();
  if (a.kind === 'bookmark') return rest;
  return text ? { ...rest, kind: 'note', note: text } : { ...rest, kind: 'highlight' };
}

export interface NewAnnotation {
  bookId: string;
  kind: AnnotationKind;
  location: string;
  text: string;
  note?: string;
  color?: HighlightColor;
  chapter?: string;
}

export function createAnnotation(init: NewAnnotation, now: number): Annotation {
  const { note, color, chapter, ...rest } = init;
  const base: Annotation = {
    ...rest, id: randomId(), color: colorOr(color), createdAt: now, updatedAt: now,
    ...(chapter ? { chapter } : {}),
  };
  return withNote(base, note);
}

/** `updatedAt` only ever grows: an edit made on a slow clock must still beat the version it edited when devices merge. */
const tick = (a: Annotation, now: number) => Math.max(now, a.updatedAt + 1);

export function editAnnotation(a: Annotation, patch: { note?: string; color?: HighlightColor }, now: number): Annotation {
  let out = a;
  if ('note' in patch) out = withNote(out, patch.note);
  if (patch.color) out = { ...out, color: colorOr(patch.color) };
  return { ...out, updatedAt: tick(a, now) };
}

/** Highlight or annotate a place: marking where something is already marked edits that item (colour, note) instead of stacking a second one. */
export function upsertMark(items: Annotation[], init: NewAnnotation, now: number): Annotation[] {
  const at = items.find((a) => !a.deleted && a.kind !== 'bookmark' && a.location === init.location);
  if (!at) return [...items, createAnnotation(init, now)];
  return putAnnotation(items, editAnnotation(at, { ...(init.note !== undefined && { note: init.note }), ...(init.color && { color: init.color }) }, now));
}

/** Never deletes: the item stays as a tombstone so sync can tell "removed" from "never had". */
export function removeAnnotation(items: Annotation[], id: string, now: number): Annotation[] {
  return items.map((a) => (a.id === id && !a.deleted ? { ...a, deleted: true, updatedAt: tick(a, now) } : a));
}

export const putAnnotation = (items: Annotation[], a: Annotation): Annotation[] =>
  items.some((i) => i.id === a.id) ? items.map((i) => (i.id === a.id ? a : i)) : [...items, a];

// --- positions ---

const isPage = (s: string) => /^\d+$/.test(s);

function key(location: string): { page: number } | { cfi: string } | null {
  const page = pageOfLocation(location);
  if (page !== undefined) return { page };
  try {
    parse(location);
    return { cfi: location };
  } catch {
    return null;
  }
}

/** Reading order: PDF pages numerically (a highlight sorts with its page), EPUB CFIs by their spine and path (a plain string compare gets /6/10 before /6/4). */
function comparePosition(a: string, b: string): number {
  const x = key(a), y = key(b);
  if (!x || !y) return x ? -1 : y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  if ('page' in x && 'page' in y) return x.page - y.page;
  if ('page' in x || 'page' in y) return 'page' in x ? -1 : 1;
  return compare(x.cfi, y.cfi);
}

const byReadingOrder = (a: Annotation, b: Annotation) =>
  comparePosition(a.location, b.location) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What the user sees: no tombstones, in reading order; optionally only some kinds. */
export function listAnnotations(items: Annotation[], kinds: readonly AnnotationKind[] = KINDS): Annotation[] {
  return items.filter((a) => !a.deleted && kinds.includes(a.kind)).sort(byReadingOrder);
}

/**
 * The live bookmark on the page whose visible range is `page` (an EPUB range CFI or a PDF page number).
 * The range is half-open: a bookmark at the first position of a page is on it, one at the end belongs to the next page.
 */
export function bookmarkOn(items: Annotation[], page: string): Annotation | undefined {
  return items.find((a) => a.kind === 'bookmark' && !a.deleted && onPage(a.location, page));
}

function onPage(point: string, page: string): boolean {
  if (isPage(point) || isPage(page)) return point === page;
  try {
    const range = parse(page);
    if (!range.start) return compare(point, page) === 0;
    return compare(collapse(range), point) <= 0 && compare(point, collapse(range, true)) < 0;
  } catch {
    return false;
  }
}

// --- text ---

/** One line: whitespace collapsed, cut at a word boundary when one is near, with an ellipsis. Safe for emoji. */
export function previewText(text: string, max = 80): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  if (chars.length <= max) return chars.join('');
  let cut = chars.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > (max - 1) * 0.5 && chars[max - 1] !== ' ') cut = cut.slice(0, space);
  return cut.join('').trimEnd() + '…';
}

// --- files and merging ---

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function sanitize(raw: unknown, bookId: string): Annotation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.location !== 'string' || typeof r.text !== 'string') return null;
  if (!KINDS.includes(r.kind as AnnotationKind) || !finite(r.createdAt) || !finite(r.updatedAt)) return null;
  const { note, deleted, ...rest } = r;
  return {
    ...rest,
    bookId,
    color: colorOr(r.color),
    ...(typeof note === 'string' ? { note } : {}),
    ...(deleted === true ? { deleted: true } : {}),
  } as unknown as Annotation;
}

/** Whatever was on disk (maybe edited by hand, maybe damaged) as a usable file: bad items are dropped, not fatal. */
export function readAnnotationFile(raw: unknown, bookId: string): AnnotationFile {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : undefined;
  return { bookId, items: Array.isArray(items) ? items.map((i) => sanitize(i, bookId)).filter((a): a is Annotation => !!a) : [] };
}

const json = (a: Annotation) => JSON.stringify(a);

/** The newest version wins; on a tie a tombstone wins, then the larger JSON, so the result never depends on the argument order. */
function newer(a: Annotation, b: Annotation): Annotation {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return json(a) >= json(b) ? a : b;
}

/** Union by id, newest `updatedAt` wins, tombstones included. Commutative, associative, idempotent: sync can merge in any order. */
export function mergeAnnotationFiles(a: AnnotationFile, b: AnnotationFile): AnnotationFile {
  if (a.bookId !== b.bookId) throw new Error('Cannot merge annotations of different books');
  const byId = new Map<string, Annotation>();
  for (const item of [...a.items, ...b.items]) {
    const have = byId.get(item.id);
    byId.set(item.id, have ? newer(have, item) : item);
  }
  const items = [...byId.values()].sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { bookId: a.bookId, items };
}
