import { describe, expect, it } from 'vitest';
import { pageHits, pageText, pieceSpans } from './pdf-search';

describe('pageText', () => {
  it('joins the items of a page with one space, as the text layer shows them', () => {
    expect(pageText(['Page 3 heading.', 'The harbour master', 'counted 3 ships'])).toBe('Page 3 heading. The harbour master counted 3 ships');
  });

  it('leaves out empty items', () => {
    expect(pageText(['', 'one', '', 'two'])).toBe('one two');
  });
});

describe('pageHits', () => {
  it('reports every match on a page under that page number', () => {
    const hits = pageHits(3, 'The harbour master counted harbour boats', 'harbour');
    expect(hits).toEqual([
      { chapter: 'Page 3', cfi: '3', pre: 'The ', match: 'harbour', post: ' master counted harbour boats' },
      { chapter: 'Page 3', cfi: '3', pre: 'The harbour master counted ', match: 'harbour', post: ' boats' },
    ]);
  });

  it('finds nothing on a page without the query', () => {
    expect(pageHits(1, 'Page 1 heading.', 'harbour')).toEqual([]);
  });
});

describe('pieceSpans', () => {
  // Two pieces, "harbour" and "master", joined as "harbour master": the second starts at offset 8.
  const lengths = [7, 6];

  it('gives one span when the match is inside one piece', () => {
    expect(pieceSpans(lengths, 1, 4)).toEqual([{ piece: 0, from: 1, to: 4 }]);
    expect(pieceSpans(lengths, 9, 11)).toEqual([{ piece: 1, from: 1, to: 3 }]);
  });

  it('gives a span in each piece when the match runs across the join', () => {
    expect(pieceSpans(lengths, 5, 10)).toEqual([
      { piece: 0, from: 5, to: 7 },
      { piece: 1, from: 0, to: 2 },
    ]);
  });

  it('gives nothing for the space between two pieces', () => {
    expect(pieceSpans(lengths, 7, 8)).toEqual([]);
  });
});
