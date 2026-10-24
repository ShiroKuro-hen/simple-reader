import type { Theme, ViewSettings } from '../types';

export const THEMES: Record<Theme, { bg: string; fg: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#121212', fg: '#e6e6e6' },
  sepia: { bg: '#f4ecd8', fg: '#433422' },
};

/** CSS injected into every EPUB section document. */
export function epubCss({ theme, fontSize, writing }: ViewSettings): string {
  const { bg, fg } = THEMES[theme];
  // 'horizontal' overrides the book's vertical layout. The override must reach every element, because
  // a book can set writing-mode on its own descendants (e.g. ruby or headings) and those would stay vertical.
  const horizontal = writing === 'horizontal'
    ? `html { writing-mode: horizontal-tb !important; -webkit-writing-mode: horizontal-tb !important; direction: ltr !important; text-orientation: mixed !important; }
       body { writing-mode: horizontal-tb !important; -webkit-writing-mode: horizontal-tb !important; direction: ltr !important; text-orientation: mixed !important; }
       body * { writing-mode: horizontal-tb !important; -webkit-writing-mode: horizontal-tb !important; text-orientation: mixed !important; }`
    : '';
  // Light keeps the book's own colours; the other themes override them or dark books stay unreadable.
  const force =
    theme === 'light'
      ? ''
      : `body *:not(a) { color: inherit !important; background-color: transparent !important; }
         a { color: ${theme === 'dark' ? '#8ab4f8' : '#7a4a1d'} !important; }`;
  return `
    html { background: ${bg} !important; color: ${fg} !important; ${fontSize === 100 ? '' : `font-size: ${fontSize}% !important;`} }
    body { background: transparent !important; color: ${fg} !important; }
    ${force}${horizontal}
    ::selection { background: ${theme === 'dark' ? '#3b5b8a' : '#b3d4fc'}; color: inherit; }
    rt, rp { user-select: none !important; -webkit-user-select: none !important; }
  `;
}
