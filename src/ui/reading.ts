// Reading-session rules: progress, theme, font size, keyboard. DOM-free.
import type { Theme } from '../types';

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** "43%"; stays at 99% until the book is really finished. */
export function progressLabel(fraction: number): string {
  const f = clamp01(fraction);
  return `${f < 1 ? Math.min(99, Math.round(f * 100)) : 100}%`;
}

export const SLIDER_MAX = 1000;
export const sliderPosition = (fraction: number) => Math.round(clamp01(fraction) * SLIDER_MAX);
export const fractionFromSlider = (position: number) => clamp01(position / SLIDER_MAX);

export const bookLabel = (title: string, fraction: number | null) =>
  fraction ? `Open ${title}, ${progressLabel(fraction)} read` : `Open ${title}`;

const THEMES: readonly string[] = ['light', 'dark', 'sepia'];

/** The user's pick wins; until they pick, follow the system. */
export function resolveTheme(stored: unknown, prefersDark: boolean): Theme {
  return typeof stored === 'string' && THEMES.includes(stored) ? (stored as Theme) : prefersDark ? 'dark' : 'light';
}

export const MIN_FONT = 60;
export const MAX_FONT = 220;
export const stepFontSize = (current: number, direction: 1 | -1) =>
  Math.min(MAX_FONT, Math.max(MIN_FONT, current + direction * 10));

export type KeyAction = 'prev' | 'next' | 'toggle-chrome' | 'show-chrome' | 'close-popup' | 'search';

export interface KeyInfo {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** tagName of the event target, upper-case. */
  targetTag?: string;
  dialogOpen?: boolean;
  popupOpen?: boolean;
  /** Right-to-left book: the arrows swap, so ArrowLeft turns forward. */
  rtl?: boolean;
  /** The book has an in-book search (EPUB): Ctrl+F opens it instead of the browser's find. */
  searchable?: boolean;
}

export function keyAction(e: KeyInfo): KeyAction | null {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') return e.searchable && !e.dialogOpen ? 'search' : null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.dialogOpen) return null;
  const tag = e.targetTag;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  switch (e.key) {
    case 'ArrowLeft':
      return e.rtl ? 'next' : 'prev';
    case 'ArrowRight':
      return e.rtl ? 'prev' : 'next';
    case 'PageUp':
      return 'prev';
    case 'PageDown':
      return 'next';
    case ' ':
      if (tag === 'BUTTON' || tag === 'A') return null; // Space activates the focused control
      return e.shiftKey ? 'prev' : 'next';
    case 'Escape':
      return e.popupOpen ? 'close-popup' : 'toggle-chrome';
    case 'Tab':
      return 'show-chrome';
    default:
      return null;
  }
}
