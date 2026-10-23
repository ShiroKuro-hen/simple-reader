import { describe, expect, it } from 'vitest';
import { displayOrder, isImageName, pagesToKeep, sortPageNames, spreadOf, stepPage } from './manga-nav';

describe('isImageName', () => {
  it('accepts image extensions in any case', () => {
    for (const name of ['1.jpg', 'a.JPEG', 'x.png', 'x.Webp', 'x.gif', 'x.AVIF', 'ch1/p1.JPG'])
      expect(isImageName(name)).toBe(true);
  });
  it('rejects directories (trailing slash)', () => {
    expect(isImageName('ch1/')).toBe(false);
    expect(isImageName('pages.jpg/')).toBe(false);
  });
  it('rejects dotfiles and anything inside a dot-directory', () => {
    expect(isImageName('.cover.jpg')).toBe(false);
    expect(isImageName('ch1/._p1.jpg')).toBe(false);
    expect(isImageName('ch1/.hidden/p1.jpg')).toBe(false);
  });
  it('rejects anything under __MACOSX/', () => {
    expect(isImageName('__MACOSX/p1.jpg')).toBe(false);
    expect(isImageName('book/__MACOSX/ch1/p1.jpg')).toBe(false);
  });
  it('rejects non-image files', () => {
    for (const name of ['Thumbs.db', '.DS_Store', 'info.txt', 'ComicInfo.xml', 'release.nfo', 'p1'])
      expect(isImageName(name)).toBe(false);
  });
});

describe('sortPageNames', () => {
  it('sorts numerically, not lexically', () => {
    expect(sortPageNames(['10.jpg', '2.jpg', '1.jpg'])).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });
  it('sorts by full path so chapter folders stay in order', () => {
    expect(sortPageNames(['ch10/p1.jpg', 'ch2/p1.jpg'])).toEqual(['ch2/p1.jpg', 'ch10/p1.jpg']);
  });
  it('ignores case when comparing', () => {
    expect(sortPageNames(['page 10.jpg', 'Page 9.jpg'])).toEqual(['Page 9.jpg', 'page 10.jpg']);
    expect(sortPageNames(['b.jpg', 'A.jpg', 'c.JPG'])).toEqual(['A.jpg', 'b.jpg', 'c.JPG']);
  });
  it('keeps only image names', () => {
    const names = ['info.txt', '01.jpg', 'cover.nfo', '02.PNG', '__MACOSX/x.jpg', 'Thumbs.db', '.hidden.jpg', 'ch1/'];
    expect(sortPageNames(names)).toEqual(['01.jpg', '02.PNG']);
  });
  it('does not mutate its input', () => {
    const names = ['10.jpg', 'notes.txt', '2.jpg'];
    const copy = [...names];
    sortPageNames(names);
    expect(names).toEqual(copy);
  });
  it('returns an empty list for empty input or no images', () => {
    expect(sortPageNames([])).toEqual([]);
    expect(sortPageNames(['readme.txt', 'ComicInfo.xml'])).toEqual([]);
  });
});

describe('spreadOf', () => {
  it('shows one page at a time in single mode', () => {
    expect(spreadOf(3, 5, false)).toEqual([3]);
    expect(spreadOf(1, 1, false)).toEqual([1]);
  });
  it('pairs pages after the cover in double mode', () => {
    expect(spreadOf(1, 5, true)).toEqual([1]);
    expect(spreadOf(2, 5, true)).toEqual([2, 3]);
    expect(spreadOf(3, 5, true)).toEqual([2, 3]);
    expect(spreadOf(4, 5, true)).toEqual([4, 5]);
    expect(spreadOf(5, 5, true)).toEqual([4, 5]);
  });
  it('leaves a final unpaired page alone in double mode', () => {
    expect(spreadOf(2, 2, true)).toEqual([2]);
    expect(spreadOf(4, 4, true)).toEqual([4]);
    expect(spreadOf(3, 4, true)).toEqual([2, 3]);
  });
  it('handles every total from 1 to 5 in both modes', () => {
    expect(spreadOf(1, 1, true)).toEqual([1]);
    expect(spreadOf(1, 2, true)).toEqual([1]);
    expect(spreadOf(2, 2, true)).toEqual([2]);
    expect(spreadOf(2, 3, true)).toEqual([2, 3]);
    expect(spreadOf(3, 3, true)).toEqual([2, 3]);
    expect(spreadOf(4, 4, true)).toEqual([4]);
    expect(spreadOf(5, 5, true)).toEqual([4, 5]);
    expect(spreadOf(2, 5, false)).toEqual([2]);
  });
  it('clamps an out-of-range page to the book', () => {
    expect(spreadOf(0, 5, false)).toEqual([1]);
    expect(spreadOf(99, 5, false)).toEqual([5]);
    expect(spreadOf(0, 5, true)).toEqual([1]);
    expect(spreadOf(99, 5, true)).toEqual([4, 5]);
    expect(spreadOf(99, 4, true)).toEqual([4]);
  });
  it('returns nothing for an empty book', () => {
    expect(spreadOf(1, 0, false)).toEqual([]);
    expect(spreadOf(1, 0, true)).toEqual([]);
  });
});

describe('stepPage', () => {
  it('moves to the first page of the neighbouring spread', () => {
    expect(stepPage(1, 5, true, 1)).toBe(2);
    expect(stepPage(3, 5, true, 1)).toBe(4);
    expect(stepPage(3, 5, true, -1)).toBe(1);
    expect(stepPage(4, 5, true, -1)).toBe(2);
  });
  it('moves by one page in single mode', () => {
    expect(stepPage(2, 5, false, 1)).toBe(3);
    expect(stepPage(2, 5, false, -1)).toBe(1);
  });
  it('treats a page inside a spread as that spread', () => {
    expect(stepPage(3, 5, true, -1)).toBe(1);
    expect(stepPage(3, 5, true, 1)).toBe(4);
  });
  it('stays on the first page of the current spread at either end', () => {
    expect(stepPage(1, 5, true, -1)).toBe(1);
    expect(stepPage(1, 5, false, -1)).toBe(1);
    expect(stepPage(5, 5, true, 1)).toBe(4);
    expect(stepPage(5, 5, false, 1)).toBe(5);
    expect(stepPage(4, 4, true, 1)).toBe(4);
  });
  it('clamps an out-of-range starting page', () => {
    expect(stepPage(0, 5, false, 1)).toBe(2);
    expect(stepPage(99, 5, false, 1)).toBe(5);
  });
  it('visits every spread exactly once, in order, both ways, for every book size', () => {
    for (const double of [false, true]) {
      for (let total = 1; total <= 40; total++) {
        // Expected spread starts: the cover alone, then pairs (2,3), (4,5)... with a lone last page.
        const starts: number[] = [];
        for (let p = 1; p <= total; p = p === 1 ? 2 : p + (double ? 2 : 1)) starts.push(p);
        const startOf = (p: number) => spreadOf(p, total, double)[0];

        let page = 1;
        const forward = [startOf(page)];
        for (let i = 1; i < starts.length; i++) {
          page = stepPage(page, total, double, 1);
          forward.push(startOf(page));
        }
        expect(forward, `forward, total ${total}, double ${double}`).toEqual(starts);

        // One more step forward stays on the last spread.
        expect(startOf(stepPage(page, total, double, 1)), `end, total ${total}`).toBe(starts[starts.length - 1]);

        const backward = [startOf(page)];
        for (let i = 1; i < starts.length; i++) {
          page = stepPage(page, total, double, -1);
          backward.push(startOf(page));
        }
        expect(backward, `backward, total ${total}, double ${double}`).toEqual([...starts].reverse());
        expect(page, `back at start, total ${total}`).toBe(1);
      }
    }
  });
  it('never leaves 1..total and always lands on the first page of a spread', () => {
    for (const double of [false, true])
      for (let total = 1; total <= 40; total++)
        for (let p = 1; p <= total; p++)
          for (const dir of [1, -1] as const) {
            const next = stepPage(p, total, double, dir);
            expect(next).toBeGreaterThanOrEqual(1);
            expect(next).toBeLessThanOrEqual(total);
            expect(spreadOf(next, total, double)[0]).toBe(next);
          }
  });
});

describe('displayOrder', () => {
  it('reverses a spread for right-to-left books', () => {
    expect(displayOrder([2, 3], true)).toEqual([3, 2]);
    expect(displayOrder([4, 5], true)).toEqual([5, 4]);
  });
  it('keeps left-to-right order otherwise', () => {
    expect(displayOrder([2, 3], false)).toEqual([2, 3]);
    expect(displayOrder([1], true)).toEqual([1]);
    expect(displayOrder([], true)).toEqual([]);
  });
  it('does not mutate its input', () => {
    const spread = [2, 3];
    displayOrder(spread, true);
    displayOrder(spread, false);
    expect(spread).toEqual([2, 3]);
  });
});

describe('pagesToKeep', () => {
  it('keeps the current page plus ahead and behind pages in single mode', () => {
    expect(pagesToKeep(5, 10, false, 2, 1)).toEqual([4, 5, 6, 7]);
  });
  it('does not go below page 1 at the start of the book', () => {
    expect(pagesToKeep(1, 10, false, 2, 3)).toEqual([1, 2, 3]);
  });
  it('does not go past the last page at the end of the book', () => {
    expect(pagesToKeep(10, 10, false, 2, 3)).toEqual([7, 8, 9, 10]);
  });
  it('keeps the whole current pair in double mode', () => {
    expect(pagesToKeep(3, 10, true, 0, 0)).toEqual([2, 3]);
    expect(pagesToKeep(4, 10, true, 0, 0)).toEqual([4, 5]);
  });
  it('counts ahead and behind in pages, not spreads', () => {
    // Current spread is [4, 5]; one page ahead is 6, one page behind is 3 (a page, not a whole spread).
    expect(pagesToKeep(4, 10, true, 1, 1)).toEqual([3, 4, 5, 6]);
  });
  it('returns just the spread when ahead and behind are 0', () => {
    expect(pagesToKeep(6, 10, false, 0, 0)).toEqual([6]);
    expect(pagesToKeep(6, 10, true, 0, 0)).toEqual([6, 7]);
  });
  it('handles a one-page book', () => {
    expect(pagesToKeep(1, 1, false, 3, 3)).toEqual([1]);
    expect(pagesToKeep(1, 1, true, 3, 3)).toEqual([1]);
  });
  it('returns nothing for an empty book', () => {
    expect(pagesToKeep(1, 0, false, 2, 2)).toEqual([]);
    expect(pagesToKeep(1, 0, true, 2, 2)).toEqual([]);
  });
  it('returns sorted unique pages', () => {
    const kept = pagesToKeep(4, 10, true, 5, 5);
    expect(kept).toEqual([...new Set(kept)].sort((a, b) => a - b));
  });
  it('never leaves 1..total for any page of books of 1 to 30 pages, in both modes', () => {
    for (const double of [false, true])
      for (let total = 1; total <= 30; total++)
        for (let page = 1; page <= total; page++) {
          const kept = pagesToKeep(page, total, double, 3, 3);
          expect(kept.length).toBeGreaterThan(0);
          for (const p of kept) {
            expect(p).toBeGreaterThanOrEqual(1);
            expect(p).toBeLessThanOrEqual(total);
          }
          expect(kept).toEqual(kept.slice().sort((a, b) => a - b));
        }
  });
});
