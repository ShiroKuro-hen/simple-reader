import { describe, expect, it } from 'vitest';
import { currentPage, DEFAULT_RATIO, pageHeights, pagesToDecode, pageTop, scrollStep } from './webtoon-nav';

describe('pageHeights', () => {
  it('scales each known page by the column width', () => {
    expect(pageHeights([0.5, 2], 400)).toEqual([200, 800]);
  });
  it('gives an unseen page the average of the seen ones', () => {
    expect(pageHeights([1, undefined, 2, undefined], 100)).toEqual([100, 150, 200, 150]);
  });
  it('falls back to the default ratio when no page is seen yet', () => {
    expect(pageHeights([undefined, undefined], 100)).toEqual([DEFAULT_RATIO * 100, DEFAULT_RATIO * 100]);
  });
  it('is empty for an empty book', () => {
    expect(pageHeights([], 100)).toEqual([]);
  });
});

describe('pageTop', () => {
  const heights = [100, 200, 50];
  it('is the sum of the heights above the page', () => {
    expect(pageTop(heights, 1)).toBe(0);
    expect(pageTop(heights, 2)).toBe(100);
    expect(pageTop(heights, 3)).toBe(300);
  });
  it('is the full strip just past the last page', () => {
    expect(pageTop(heights, 4)).toBe(350);
  });
  it('is 0 for a page before the first', () => {
    expect(pageTop(heights, 0)).toBe(0);
  });
});

describe('currentPage', () => {
  // Pages span [0,100), [100,300), [300,400).
  const heights = [100, 200, 100];
  it('is the page crossing the top third of the view', () => {
    // The top third of a 300 px view, from scroll 0, is the line at y=100: page 2 starts there.
    expect(currentPage(heights, 0, 300)).toBe(2);
    expect(currentPage(heights, 0, 299)).toBe(1);
    expect(currentPage(heights, 50, 300)).toBe(2);
  });
  it('is the page at the top edge when the view has no height', () => {
    expect(currentPage(heights, 0, 0)).toBe(1);
    expect(currentPage(heights, 99, 0)).toBe(1);
    expect(currentPage(heights, 100, 0)).toBe(2);
    expect(currentPage(heights, 300, 0)).toBe(3);
  });
  it('is the last page once the strip is scrolled past its end', () => {
    expect(currentPage(heights, 10_000, 300)).toBe(3);
  });
  it('is page 1 for an empty book', () => {
    expect(currentPage([], 0, 300)).toBe(1);
  });
});

describe('pagesToDecode', () => {
  // Ten pages of 100 px: page n spans [(n-1)*100, n*100).
  const heights = Array.from({ length: 10 }, () => 100);
  it('keeps the view and one view height above and below it', () => {
    // View 0..200: the window runs from -200 to 400, so pages 1 to 4 (page 4 starts at 300).
    expect(pagesToDecode(heights, 0, 200)).toEqual([1, 2, 3, 4]);
  });
  it('follows the view down the strip', () => {
    // View 500..700: the window runs from 300 to 900, so pages 4 to 9.
    expect(pagesToDecode(heights, 500, 200)).toEqual([4, 5, 6, 7, 8, 9]);
  });
  it('does not include a page that only touches the window edge', () => {
    // Window 300..900 does not include page 3 (200..300).
    expect(pagesToDecode(heights, 500, 200)).not.toContain(3);
  });
  it('stops at the last page', () => {
    expect(pagesToDecode(heights, 900, 200)).toEqual([8, 9, 10]);
  });
  it('is empty for an empty book', () => {
    expect(pagesToDecode([], 0, 200)).toEqual([]);
  });
});

describe('scrollStep', () => {
  it('moves about 90% of the view in each direction', () => {
    expect(scrollStep(0, 1000, 5000, 1)).toBe(900);
    expect(scrollStep(900, 1000, 5000, 1)).toBe(1800);
    expect(scrollStep(1800, 1000, 5000, -1)).toBe(900);
  });
  it('stops at the start and the end of the strip', () => {
    expect(scrollStep(200, 1000, 5000, -1)).toBe(0);
    expect(scrollStep(4500, 1000, 5000, 1)).toBe(5000);
  });
  it('does nothing at the very end or start', () => {
    expect(scrollStep(5000, 1000, 5000, 1)).toBe(5000);
    expect(scrollStep(0, 1000, 5000, -1)).toBe(0);
  });
});
