import { describe, expect, it } from 'vitest';
import { decodeLocation, encodeLocation, hit, normalizeRects, pageOfLocation } from './pdf-highlights';

const PAGE = { x: 100, y: 50, width: 600, height: 800 }; // a page box in viewport pixels

describe('PDF highlight location', () => {
  it('encodes the page and one box per line, numbers as 4-decimal fractions', () => {
    const rects = [
      { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
      { x: 0.1, y: 0.26, w: 0.5, h: 0.05 },
    ];
    expect(encodeLocation(3, rects)).toBe('3@0.1000,0.2000,0.3000,0.0500;0.1000,0.2600,0.5000,0.0500');
  });

  it('round-trips through decodeLocation', () => {
    const rects = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, { x: 1 / 3, y: 0.5, w: 0.25, h: 0.02 }];
    const back = decodeLocation(encodeLocation(12, rects));
    expect(back).toEqual({ page: 12, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, { x: 0.3333, y: 0.5, w: 0.25, h: 0.02 }] });
  });

  it.each([
    ['a bare page number (a bookmark)', '3'],
    ['an EPUB CFI', 'epubcfi(/6/4!/4/2,/1:0,/1:5)'],
    ['an empty string', ''],
    ['no page', '@0.1,0.2,0.3,0.1'],
    ['no boxes', '3@'],
    ['a box with three numbers', '3@0.1,0.2,0.3'],
    ['an empty box after a separator', '3@0.1,0.2,0.3,0.1;'],
    ['page 0', '0@0.1,0.2,0.3,0.1'],
    ['a fraction above 1', '3@1.2,0,0.1,0.1'],
    ['a negative fraction', '3@-0.1,0,0.1,0.1'],
    ['a zero-height box', '3@0.1,0.2,0.3,0'],
    ['text that is not a number', '3@a,b,c,d'],
  ])('is null for %s', (_name, loc) => {
    expect(decodeLocation(loc)).toBeNull();
  });

  it('gives the page of a bookmark or a highlight, and undefined for anything else', () => {
    expect(pageOfLocation('3')).toBe(3);
    expect(pageOfLocation('3@0.1000,0.2000,0.3000,0.0500')).toBe(3);
    expect(pageOfLocation('3@garbage')).toBeUndefined();
    expect(pageOfLocation('epubcfi(/6/4!/4/2)')).toBeUndefined();
    expect(pageOfLocation(undefined)).toBeUndefined();
  });
});

describe('normalizeRects', () => {
  it('turns viewport boxes into fractions of the page box', () => {
    expect(normalizeRects([{ x: 130, y: 90, width: 300, height: 20 }], PAGE)).toEqual([{ x: 0.05, y: 0.05, w: 0.5, h: 0.025 }]);
  });

  it('clamps a box that hangs over the page edge', () => {
    expect(normalizeRects([{ x: 50, y: 60, width: 200, height: 20 }], PAGE)).toEqual([{ x: 0, y: 0.0125, w: 0.25, h: 0.025 }]);
  });

  it('drops boxes fully outside the page and zero-size boxes', () => {
    const outside = [
      { x: 800, y: 100, width: 50, height: 20 },
      { x: 130, y: 900, width: 50, height: 20 },
      { x: 130, y: 90, width: 0, height: 20 },
      { x: 130, y: 90, width: 50, height: 0 },
    ];
    expect(normalizeRects(outside, PAGE)).toEqual([]);
  });

  it('keeps the outer box of nested ones, so a span inside a span is not painted twice', () => {
    const outer = { x: 130, y: 90, width: 300, height: 20 };
    const inner = { x: 140, y: 92, width: 50, height: 16 };
    expect(normalizeRects([inner, outer], PAGE)).toEqual([{ x: 0.05, y: 0.05, w: 0.5, h: 0.025 }]);
  });

  it('keeps boxes that only overlap, and one of two identical boxes', () => {
    const a = { x: 130, y: 90, width: 300, height: 20 };
    const b = { x: 250, y: 90, width: 300, height: 20 };
    expect(normalizeRects([a, b], PAGE)).toHaveLength(2);
    expect(normalizeRects([a, { ...a }], PAGE)).toHaveLength(1);
  });

  it('returns nothing for no boxes or a page with no size', () => {
    expect(normalizeRects([], PAGE)).toEqual([]);
    expect(normalizeRects([{ x: 130, y: 90, width: 300, height: 20 }], { ...PAGE, width: 0 })).toEqual([]);
  });

  it('accepts a DOMRectList-like array', () => {
    const list = { length: 1, 0: { x: 130, y: 90, width: 300, height: 20 } };
    expect(normalizeRects(list, PAGE)).toHaveLength(1);
  });
});

describe('hit', () => {
  const boxes = [{ x: 0.1, y: 0.1, w: 0.4, h: 0.05 }, { x: 0.1, y: 0.2, w: 0.2, h: 0.05 }];

  it('returns the box under the point, including its edges', () => {
    expect(hit(boxes, 0.2, 0.12)).toBe(boxes[0]);
    expect(hit(boxes, 0.1, 0.1)).toBe(boxes[0]);
    expect(hit(boxes, 0.5, 0.15)).toBe(boxes[0]);
    expect(hit(boxes, 0.2, 0.22)).toBe(boxes[1]);
  });

  it('is undefined for a point outside every box', () => {
    expect(hit(boxes, 0.6, 0.12)).toBeUndefined();
    expect(hit(boxes, 0.2, 0.3)).toBeUndefined();
    expect(hit([], 0.2, 0.2)).toBeUndefined();
  });
});
