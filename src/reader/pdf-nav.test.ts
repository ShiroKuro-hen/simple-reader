import { describe, expect, it } from 'vitest';
import { fractionOfPage, pageFromFraction, parsePage } from './pdf-nav';

describe('PDF page <-> fraction', () => {
  it('maps the ends and the middle', () => {
    expect(pageFromFraction(0, 6)).toBe(1);
    expect(pageFromFraction(1, 6)).toBe(6);
    expect(pageFromFraction(0.5, 6)).toBe(3);
  });
  it('clamps out-of-range fractions', () => {
    expect(pageFromFraction(-1, 6)).toBe(1);
    expect(pageFromFraction(7, 6)).toBe(6);
  });
  it('reports page/total as the fraction', () => {
    expect(fractionOfPage(3, 6)).toBe(0.5);
  });
  it('round-trips every page of every document size', () => {
    for (let total = 1; total <= 60; total++)
      for (let p = 1; p <= total; p++) expect(pageFromFraction(fractionOfPage(p, total), total)).toBe(p);
  });
});

describe('parsePage', () => {
  it('resumes a saved page, clamped to the document', () => {
    expect(parsePage('4', 6)).toBe(4);
    expect(parsePage('99', 6)).toBe(6);
    expect(parsePage('0', 6)).toBe(1);
  });
  it('starts at page 1 for a missing or foreign location (e.g. an EPUB CFI)', () => {
    expect(parsePage(undefined, 6)).toBe(1);
    expect(parsePage('epubcfi(/6/4!/4/2)', 6)).toBe(1);
  });
});
