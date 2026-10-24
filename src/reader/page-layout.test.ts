import { describe, expect, it } from 'vitest';
import { pageLayout } from './page-layout';

const at = (width: number, height: number, layout: 'auto' | 'single' = 'auto', topBar = 56, bottomBar = 88) =>
  pageLayout({ width, height, layout, topBar, bottomBar });

describe('pageLayout columns', () => {
  it('uses one column on a portrait phone and a tablet held upright', () => {
    expect(at(360, 740).maxColumns).toBe(1);
    expect(at(768, 1024).maxColumns).toBe(1);
  });

  it('uses two columns on a landscape window (auto)', () => {
    expect(at(1280, 800).maxColumns).toBe(2);
    expect(at(1920, 1080).maxColumns).toBe(2);
  });

  it('adds a third column on very wide windows instead of stretching the lines', () => {
    expect(at(2560, 1440).maxColumns).toBe(3);
    expect(at(3440, 1440).maxColumns).toBe(3);
  });

  it('always uses one column when the layout is single', () => {
    expect(at(1920, 1080, 'single').maxColumns).toBe(1);
    expect(at(800, 360, 'single').maxColumns).toBe(1);
  });
});

describe('pageLayout measure (max inline size)', () => {
  it('splits the width between the columns, never past a comfortable line', () => {
    expect(at(1920, 1080).maxInline).toBe(900);
    expect(at(2560, 1440).maxInline).toBe(853);
    expect(at(3440, 1440).maxInline).toBe(900);
  });

  it('caps a single column too, so a line or an illustration never spans a huge window', () => {
    expect(at(1920, 1080, 'single').maxInline).toBe(900);
    expect(at(1080, 1920).maxInline).toBe(900);
  });

  it('keeps the old 720 px floor on a small window', () => {
    expect(at(800, 360).maxInline).toBe(720);
    expect(at(1280, 800, 'auto').maxInline).toBe(720);
    expect(at(360, 740).maxInline).toBe(720);
  });
});

describe('pageLayout block size', () => {
  it('never caps the page height below the window height', () => {
    expect(at(2560, 1440).maxBlock).toBeGreaterThanOrEqual(1440);
    expect(at(3000, 2160).maxBlock).toBe(2160);
  });

  it('keeps the old 1440 px default on a small window', () => {
    expect(at(800, 360).maxBlock).toBe(1440);
  });
});

describe('pageLayout margin (rows for the toolbars)', () => {
  it('clears the taller toolbar plus 8 px on a tall stage', () => {
    expect(at(360, 740, 'auto', 56, 88).margin).toBe(96);
    expect(at(1920, 1080, 'auto', 56, 88).margin).toBe(96);
    expect(at(768, 1024, 'auto', 56, 56).margin).toBe(64);
  });

  it('never goes below foliate default of 48 px', () => {
    expect(at(1920, 1080, 'auto', 0, 0).margin).toBe(48);
    expect(at(1920, 1080, 'auto', 20, 10).margin).toBe(48);
  });

  it('keeps foliate default on a landscape phone so the page keeps its height', () => {
    expect(at(800, 360, 'auto', 56, 88).margin).toBe(48);
    expect(at(640, 559, 'auto', 56, 88).margin).toBe(48);
  });

  it('applies the clearance from height 560 upward', () => {
    expect(at(640, 560, 'auto', 56, 88).margin).toBe(96);
  });
});

describe('pageLayout edge cases', () => {
  it('returns the defaults for zero or negative sizes, never NaN', () => {
    expect(at(0, 0)).toEqual({ maxInline: 720, maxBlock: 1440, maxColumns: 2, margin: 48 });
    expect(at(-100, 500)).toEqual({ maxInline: 720, maxBlock: 1440, maxColumns: 2, margin: 48 });
    expect(at(0, 0, 'single').maxColumns).toBe(1);
  });

  it('ignores bar heights that are not finite numbers', () => {
    const g = at(1920, 1080, 'auto', NaN, Infinity);
    for (const v of Object.values(g)) expect(Number.isFinite(v)).toBe(true);
    expect(g.margin).toBe(48);
  });
});
