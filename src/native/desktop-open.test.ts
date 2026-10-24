import { describe, expect, it } from 'vitest';
import { planOpened } from './desktop-open';

describe('planOpened', () => {
  it('keeps the books and names each by its file, not its folder', () => {
    expect(planOpened(['C:\\Users\\me\\Books\\Vol 1.epub', 'D:\\scan.PDF', '/home/me/issue.cbz'])).toEqual([
      { path: 'C:\\Users\\me\\Books\\Vol 1.epub', fileName: 'Vol 1.epub' },
      { path: 'D:\\scan.PDF', fileName: 'scan.PDF' },
      { path: '/home/me/issue.cbz', fileName: 'issue.cbz' },
    ]);
  });

  it('drops what is not a book', () => {
    expect(planOpened(['notes.txt', 'C:\\x\\setup.exe', '', 'book.epub.zip'])).toEqual([]);
  });

  it('accepts comics in RAR', () => {
    expect(planOpened(['Tomo 01.cbr'])).toEqual([{ path: 'Tomo 01.cbr', fileName: 'Tomo 01.cbr' }]);
  });

  it('is empty for no paths', () => {
    expect(planOpened([])).toEqual([]);
  });
});
