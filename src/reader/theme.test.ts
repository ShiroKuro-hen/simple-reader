import { describe, expect, it } from 'vitest';
import type { Theme, ViewSettings } from '../types';
import { epubCss, THEMES } from './theme';

const base: ViewSettings = { theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, writing: 'book' };
const with_ = (over: Partial<ViewSettings>) => ({ ...base, ...over });
const THEME_NAMES = Object.keys(THEMES) as Theme[];
// Readings (<rt>, <rp>) can never start, end or sit inside a selection, in any theme or writing mode.
const READING_RULE = 'rt, rp { user-select: none !important; -webkit-user-select: none !important; }';

describe('epubCss, book text direction', () => {
  it('leaves the writing mode to the book', () => {
    for (const theme of THEME_NAMES) {
      const css = epubCss(with_({ theme }));
      expect(css).not.toMatch(/writing-mode/);
      expect(css).not.toMatch(/direction:\s*ltr/);
      expect(css).not.toMatch(/text-orientation/);
    }
  });

  it('is identical to the output before the setting existed, plus exactly the reading rule', () => {
    expect(epubCss(base)).toBe(`
    html { background: #ffffff !important; color: #1a1a1a !important;  }
    body { background: transparent !important; color: #1a1a1a !important; }
    
    ::selection { background: #b3d4fc; color: inherit; }
    ${READING_RULE}
  `);
  });
});

describe('epubCss, horizontal text direction', () => {
  const horizontal = with_({ writing: 'horizontal' });

  it('forces horizontal-tb left to right on html and body', () => {
    const css = epubCss(horizontal);
    expect(css).toMatch(/html\s*\{[^}]*writing-mode:\s*horizontal-tb\s*!important/);
    expect(css).toMatch(/body\s*\{[^}]*writing-mode:\s*horizontal-tb\s*!important/);
    expect(css).toMatch(/html\s*\{[^}]*direction:\s*ltr\s*!important/);
    expect(css).toMatch(/body\s*\{[^}]*direction:\s*ltr\s*!important/);
  });

  it('sets the -webkit- writing mode too', () => {
    expect(epubCss(horizontal)).toMatch(/-webkit-writing-mode:\s*horizontal-tb\s*!important/);
  });

  it('resets text orientation and overrides writing mode of descendants', () => {
    const css = epubCss(horizontal);
    expect(css).toMatch(/text-orientation:\s*mixed\s*!important/);
    expect(css).toMatch(/body \*\s*\{[^}]*writing-mode:\s*horizontal-tb\s*!important/);
  });

  it('keeps the theme colours and font size of the other settings', () => {
    const css = epubCss(with_({ writing: 'horizontal', theme: 'dark', fontSize: 120 }));
    expect(css).toContain('font-size: 120% !important;');
    expect(css).toContain('background: #121212 !important');
    expect(css).toContain('color: inherit !important');
  });

  it('is the book output plus the direction rules only', () => {
    for (const theme of THEME_NAMES) {
      const book = epubCss(with_({ theme }));
      const forced = epubCss(with_({ theme, writing: 'horizontal' }));
      expect(forced.length).toBeGreaterThan(book.length);
      for (const line of book.split('\n')) if (line.trim()) expect(forced).toContain(line.trim());
    }
  });
});

describe('epubCss, every theme', () => {
  it('styles light, dark and sepia with their own colours in both modes', () => {
    for (const theme of THEME_NAMES) {
      for (const writing of ['book', 'horizontal'] as const) {
        const css = epubCss(with_({ theme, writing }));
        expect(css).toContain(`background: ${THEMES[theme].bg} !important`);
        expect(css).toContain(`color: ${THEMES[theme].fg} !important`);
      }
    }
  });
});

describe('epubCss, furigana readings are not selectable', () => {
  it('adds the reading rule in every theme and writing mode', () => {
    for (const theme of THEME_NAMES) {
      for (const writing of ['book', 'horizontal'] as const) {
        expect(epubCss(with_({ theme, writing }))).toContain(READING_RULE);
      }
    }
  });

  it('adds it exactly once', () => {
    for (const theme of THEME_NAMES) {
      expect(epubCss(with_({ theme, writing: 'horizontal' })).split(READING_RULE).length).toBe(2);
    }
  });
});
