import type { ReaderSettings, Theme } from '../types';

export const THEMES: Record<Theme, { bg: string; fg: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#121212', fg: '#e6e6e6' },
  sepia: { bg: '#f4ecd8', fg: '#433422' },
};

/** CSS injected into every EPUB section document. */
export function epubCss({ theme, fontSize }: ReaderSettings): string {
  const { bg, fg } = THEMES[theme];
  // Light keeps the book's own colours; the other themes override them or dark books stay unreadable.
  const force =
    theme === 'light'
      ? ''
      : `body *:not(a) { color: inherit !important; background-color: transparent !important; }
         a { color: ${theme === 'dark' ? '#8ab4f8' : '#7a4a1d'} !important; }`;
  return `
    html { background: ${bg} !important; color: ${fg} !important; ${fontSize === 100 ? '' : `font-size: ${fontSize}% !important;`} }
    body { background: transparent !important; color: ${fg} !important; }
    ${force}
    ::selection { background: ${theme === 'dark' ? '#3b5b8a' : '#b3d4fc'}; color: inherit; }
  `;
}
