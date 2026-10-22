// What the popup says, decided without touching the DOM.
import type { LookupResult } from '../types';

export const MAX_LOOKUP_CHARS = 200;
const PHRASE_CHARS = 40;
const PHRASE_WORDS = 4;
const JA_PHRASE_CHARS = 12; // Japanese packs a sentence into few characters
const JAPANESE = /[぀-ヿ一-鿿]/;
const MAX_DEFINITIONS = 3;

export const MESSAGES = {
  offline: "Couldn't look this up - check your connection.",
  tooLong: 'That is a long passage. Select a single word or a short phrase to look it up.',
  empty: 'No results for this selection.',
};

export type SelectionKind = 'ignore' | 'word' | 'phrase' | 'too-long';

export function classifySelection(raw: string): SelectionKind {
  const text = raw.trim();
  if (!text) return 'ignore';
  if (text.length > MAX_LOOKUP_CHARS) return 'too-long';
  const long = text.length > (JAPANESE.test(text) ? JA_PHRASE_CHARS : PHRASE_CHARS);
  return long || text.split(/\s+/).length > PHRASE_WORDS ? 'phrase' : 'word';
}

export interface PopupContent {
  heading: string;
  reading?: string;
  romaji?: string;
  translation?: string;
  definitions: string[];
  source: string;
  /** Nothing useful came back. */
  empty: boolean;
}

export function describeResult(r: LookupResult, kind: 'word' | 'phrase'): PopupContent {
  const ja = r.lang === 'ja';
  const reading = ja && r.reading && r.reading !== r.word ? r.reading : undefined;
  const romaji = ja && r.romaji ? r.romaji : undefined;
  const translation = r.translation?.trim() || undefined;
  const clean = [...new Set(r.definitions.map((d) => d.trim()).filter(Boolean))].slice(0, MAX_DEFINITIONS);
  // A sentence's definitions are noise when we have its translation.
  const definitions = kind === 'phrase' && translation ? [] : clean;
  return {
    heading: r.word,
    reading,
    romaji,
    translation,
    definitions,
    source: r.source,
    empty: !translation && !clean.length && !reading && !romaji,
  };
}

/** Hands out ids so only the newest request may update the UI. */
export function createLatest() {
  let n = 0;
  return { next: () => ++n, isCurrent: (id: number) => id === n, cancel: () => void ++n };
}

export type Settled<T> = { status: 'ok'; value: T } | { status: 'error' } | { status: 'stale' };

/** Run `task`; the outcome is 'stale' if a newer task started or `cancel()` was called meanwhile. */
export async function settle<T>(latest: ReturnType<typeof createLatest>, task: () => Promise<T>): Promise<Settled<T>> {
  const id = latest.next();
  try {
    const value = await task();
    return latest.isCurrent(id) ? { status: 'ok', value } : { status: 'stale' };
  } catch {
    return latest.isCurrent(id) ? { status: 'error' } : { status: 'stale' };
  }
}
