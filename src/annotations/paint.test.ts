import { describe, expect, it } from 'vitest';
import { THEMES } from '../reader/theme';
import { COLORS } from './model';
import { HIGHLIGHT_FILL, SEARCH_FILL, highlightStyle } from './paint';

const FILLS = { ...HIGHLIGHT_FILL, search: SEARCH_FILL };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** The overlay is drawn above the page, so it tints both the glyphs and the paper under them (CSS compositing). */
function tinted(pixel: number[], fill: number[], { opacity, blend }: { opacity: number; blend: string }) {
  return pixel.map((v, i) => {
    const source = blend === 'multiply' ? (v * fill[i]!) / 255 : fill[i]!;
    return (1 - opacity) * v + opacity * source;
  });
}

describe('highlight paint', () => {
  it('has a distinct fill for every colour', () => {
    expect(Object.keys(HIGHLIGHT_FILL).sort()).toEqual([...COLORS].sort());
    expect(new Set(Object.values(HIGHLIGHT_FILL)).size).toBe(COLORS.length);
  });

  it.each(Object.entries(THEMES))('keeps text readable (WCAG AA, 4.5:1) in the %s theme for every colour and search matches', (name, { bg, fg }) => {
    const style = highlightStyle(name as keyof typeof THEMES);
    for (const [color, hex] of Object.entries(FILLS)) {
      const fill = rgb(hex);
      expect(contrast(tinted(rgb(fg), fill, style), tinted(rgb(bg), fill, style)), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(Object.entries(THEMES))('is clearly visible against the plain page in the %s theme', (name, { bg }) => {
    const style = highlightStyle(name as keyof typeof THEMES);
    for (const [color, hex] of Object.entries(FILLS))
      expect(contrast(tinted(rgb(bg), rgb(hex), style), rgb(bg)), color).toBeGreaterThanOrEqual(1.2);
  });
});
