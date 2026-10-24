import type { HighlightColor, Theme } from '../types';

export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
  yellow: '#ffd54a',
  green: '#6fdc8c',
  blue: '#6cb6ff',
  pink: '#ff8fc2',
};

/** In-book search matches: orange, so they never look like a highlight the reader made. */
export const SEARCH_FILL = '#ff9f1c';

/**
 * How the overlay is composited over the page. Multiply keeps dark text dark on light paper; on a dark page
 * multiply would swallow the light text, so a plain translucent tint is used. paint.test.ts checks the contrast.
 */
export function highlightStyle(theme: Theme): { opacity: number; blend: 'multiply' | 'normal' } {
  return theme === 'dark' ? { opacity: 0.35, blend: 'normal' } : { opacity: 0.6, blend: 'multiply' };
}
