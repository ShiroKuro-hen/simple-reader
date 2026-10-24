// Pure rules of the library: no OPFS, no DOM. Everything here is testable with plain values.
import type { BookFormat, BookMeta, FuriganaMode, PageLayout, ReaderSettings, Theme } from '../types';

export const DEFAULT_SETTINGS: ReaderSettings = { theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, webtoon: false };

/** A book's identity is the SHA-256 of its bytes, so the same file on two devices is one book. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatOf(filename: string): BookFormat | null {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  // A .cbr is one more name for a cbz book: the real container (zip or rar) is told apart from the bytes, not the name.
  if (ext === 'cbr') return 'cbz';
  return ext === 'epub' || ext === 'pdf' || ext === 'cbz' ? ext : null;
}

export const titleFromFilename = (filename: string) => filename.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();

export const newestFirst = (books: BookMeta[]) => [...books].sort((a, b) => b.addedAt - a.addedAt);

const THEMES: Theme[] = ['light', 'dark', 'sepia'];
const FURIGANA: FuriganaMode[] = ['off', 'furigana', 'romaji'];
const LAYOUTS: PageLayout[] = ['auto', 'single'];

/** Settings come from a file the user may have edited: keep what is valid, default the rest. */
export function mergeSettings(saved: unknown): ReaderSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const size = typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) ? s.fontSize : DEFAULT_SETTINGS.fontSize;
  return {
    theme: THEMES.includes(s.theme as Theme) ? (s.theme as Theme) : DEFAULT_SETTINGS.theme,
    fontSize: Math.min(300, Math.max(50, size)),
    furigana: FURIGANA.includes(s.furigana as FuriganaMode) ? (s.furigana as FuriganaMode) : DEFAULT_SETTINGS.furigana,
    layout: LAYOUTS.includes(s.layout as PageLayout) ? (s.layout as PageLayout) : DEFAULT_SETTINGS.layout,
    rtl: typeof s.rtl === 'boolean' ? s.rtl : DEFAULT_SETTINGS.rtl,
    webtoon: typeof s.webtoon === 'boolean' ? s.webtoon : DEFAULT_SETTINGS.webtoon,
  };
}
