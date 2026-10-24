import { describe, expect, it } from 'vitest';
import { pageLayout, type PageLayoutInput } from './page-layout';

const at = (width: number, height: number, over: Partial<PageLayoutInput> = {}) =>
  pageLayout({ width, height, layout: 'auto', fontSize: 100, vertical: false, topBar: 56, bottomBar: 88, ...over });

describe('pageLayout line length', () => {
  it('keeps a line to about 40 em at the default font size, whatever the window', () => {
    expect(at(1280, 800).maxInline).toBe(640);
    expect(at(1920, 1080).maxInline).toBe(640);
    expect(at(2560, 1440).maxInline).toBe(640);
    expect(at(1920, 1080, { layout: 'single' }).maxInline).toBe(640);
  });

  it('grows the line with the font size', () => {
    expect(at(1920, 1080, { fontSize: 150 }).maxInline).toBe(960);
    expect(at(1920, 1080, { fontSize: 60 }).maxInline).toBe(384);
  });
});

describe('pageLayout columns', () => {
  it('uses one column on portrait windows and in single-page mode', () => {
    expect(at(360, 740).maxColumns).toBe(1);
    expect(at(768, 1024).maxColumns).toBe(1);
    expect(at(1080, 1920).maxColumns).toBe(1);
    expect(at(2560, 1440, { layout: 'single' }).maxColumns).toBe(1);
  });

  it('gives a wide window more columns instead of longer lines, up to three', () => {
    expect(at(1280, 800).maxColumns).toBe(2);
    expect(at(1920, 1080).maxColumns).toBe(3);
    expect(at(2560, 1440).maxColumns).toBe(3);
  });

  it('never squeezes a column below about 30 em: a landscape phone stays at one', () => {
    expect(at(800, 360).maxColumns).toBe(1);
    expect(at(1920, 1080, { fontSize: 200 }).maxColumns).toBe(2);
  });
});

describe('pageLayout vertical text', () => {
  it('runs a vertical line down the whole page, in one band', () => {
    const g = at(1920, 1080, { vertical: true });
    expect(g.maxColumns).toBe(1);
    expect(g.maxInline).toBe(1080);
    expect(g.maxBlock).toBe(1920);
  });
});

describe('pageLayout block size', () => {
  it('never caps a horizontal page below the window height', () => {
    expect(at(3000, 2160).maxBlock).toBe(2160);
    expect(at(800, 360).maxBlock).toBe(1440);
  });
});

describe('pageLayout margin (rows for the toolbars)', () => {
  it('clears the taller toolbar plus 8 px on a tall stage', () => {
    expect(at(360, 740).margin).toBe(96);
    expect(at(1920, 1080).margin).toBe(96);
    expect(at(768, 1024, { bottomBar: 56 }).margin).toBe(64);
    expect(at(1920, 1080, { vertical: true }).margin).toBe(96);
  });

  it('never goes below foliate default of 48 px', () => {
    expect(at(1920, 1080, { topBar: 0, bottomBar: 0 }).margin).toBe(48);
    expect(at(1920, 1080, { topBar: 20, bottomBar: 10 }).margin).toBe(48);
  });

  it('keeps foliate default below a height of 560 so a landscape phone keeps its page', () => {
    expect(at(800, 360).margin).toBe(48);
    expect(at(640, 559).margin).toBe(48);
    expect(at(640, 560).margin).toBe(96);
  });
});

describe('pageLayout edge cases', () => {
  it('returns the defaults for zero or negative sizes, never NaN', () => {
    expect(at(0, 0)).toEqual({ maxInline: 720, maxBlock: 1440, maxColumns: 2, margin: 48 });
    expect(at(-100, 500)).toEqual({ maxInline: 720, maxBlock: 1440, maxColumns: 2, margin: 48 });
    expect(at(0, 0, { layout: 'single' }).maxColumns).toBe(1);
  });

  it('ignores sizes and font sizes that are not finite numbers', () => {
    const g = at(1920, 1080, { topBar: NaN, bottomBar: Infinity, fontSize: NaN });
    for (const v of Object.values(g)) expect(Number.isFinite(v)).toBe(true);
    expect(g.margin).toBe(48);
    expect(g.maxInline).toBe(640);
  });
});
