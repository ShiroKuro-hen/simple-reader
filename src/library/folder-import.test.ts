import { describe, expect, it } from 'vitest';
import type { BookFormat } from '../types';
import { chooseFormats, planFolderImport, seriesNameFor } from './folder-import';

const ALL = new Set<BookFormat>(['epub', 'pdf', 'cbz']);
const paths = (plan: ReturnType<typeof planFolderImport>) => plan.books.map((b) => b.path);

describe('planFolderImport', () => {
  it('takes the folder from the first path segment and keeps the original index of each book', () => {
    const input = ['Mi Serie/notes.txt', 'Mi Serie/Vol 1.epub', 'Mi Serie/Vol 2.pdf'];
    const plan = planFolderImport(input);
    expect(plan.folder).toBe('Mi Serie');
    expect(plan.books).toEqual([
      { index: 1, path: 'Mi Serie/Vol 1.epub', format: 'epub' },
      { index: 2, path: 'Mi Serie/Vol 2.pdf', format: 'pdf' },
    ]);
  });

  it('orders books naturally and case-insensitively on the full path: Vol 2 before Vol 10', () => {
    const plan = planFolderImport(['S/Vol 10.epub', 'S/Vol 2.epub', 'S/vol 1.epub']);
    expect(paths(plan)).toEqual(['S/vol 1.epub', 'S/Vol 2.epub', 'S/Vol 10.epub']);
  });

  it('orders nested files by their full path: a/2.cbz before a/10.cbz', () => {
    const plan = planFolderImport(['S/a/10.cbz', 'S/a/2.cbz']);
    expect(paths(plan)).toEqual(['S/a/2.cbz', 'S/a/10.cbz']);
  });

  it('counts each format and always reports all three keys', () => {
    const plan = planFolderImport(['S/a.epub', 'S/b.epub', 'S/c.cbz']);
    expect(plan.counts).toEqual({ epub: 2, pdf: 0, cbz: 1 });
  });

  it('counts extensions case-insensitively', () => {
    const plan = planFolderImport(['S/A.EPUB', 'S/b.Pdf', 'S/c.CBZ']);
    expect(plan.counts).toEqual({ epub: 1, pdf: 1, cbz: 1 });
    expect(plan.books.map((b) => b.format)).toEqual(['epub', 'pdf', 'cbz']);
  });

  it('ignores non-book files and counts them as ignored', () => {
    const plan = planFolderImport(['S/notes.txt', 'S/cover.jpg', 'S/Vol 1.epub', 'S/Vol 1']);
    expect(paths(plan)).toEqual(['S/Vol 1.epub']);
    expect(plan.ignored).toBe(3);
  });

  it('ignores dotfiles, dot folders and __MACOSX junk, and counts them as ignored', () => {
    const plan = planFolderImport([
      'S/.DS_Store',
      'S/._Vol 1.cbz',
      'S/.hidden/Vol 2.cbz',
      'S/__MACOSX/S/Vol 3.cbz',
      'S/Vol 4.cbz',
    ]);
    expect(paths(plan)).toEqual(['S/Vol 4.cbz']);
    expect(plan.ignored).toBe(4);
  });

  it('keeps unicode and spaces in names', () => {
    const plan = planFolderImport(['吾輩は猫である/第 1 巻 ü.epub', '吾輩は猫である/第 2 巻.cbz']);
    expect(plan.folder).toBe('吾輩は猫である');
    expect(paths(plan)).toEqual(['吾輩は猫である/第 1 巻 ü.epub', '吾輩は猫である/第 2 巻.cbz']);
  });

  it('flattens files at any depth into one plan', () => {
    const plan = planFolderImport(['S/x/y/z/deep.pdf', 'S/top.epub']);
    expect(plan.folder).toBe('S');
    expect(paths(plan)).toEqual(['S/top.epub', 'S/x/y/z/deep.pdf']);
    expect(plan.counts).toEqual({ epub: 1, pdf: 1, cbz: 0 });
  });

  it('returns an empty plan for empty input', () => {
    expect(planFolderImport([])).toEqual({ folder: '', books: [], counts: { epub: 0, pdf: 0, cbz: 0 }, ignored: 0 });
  });

  it('has no books when nothing is supported, but still reports every file as ignored', () => {
    const plan = planFolderImport(['S/a.txt', 'S/b.docx']);
    expect(plan.books).toEqual([]);
    expect(plan.counts).toEqual({ epub: 0, pdf: 0, cbz: 0 });
    expect(plan.ignored).toBe(2);
    expect(plan.folder).toBe('S');
  });
});

describe('chooseFormats', () => {
  const plan = planFolderImport(['S/a.epub', 'S/b.pdf', 'S/c.cbz', 'S/d.cbz']);

  it('returns nothing when no format is selected', () => {
    expect(chooseFormats(plan, new Set())).toEqual([]);
  });

  it('returns only the books of one selected format, in plan order', () => {
    expect(paths({ ...plan, books: chooseFormats(plan, new Set<BookFormat>(['cbz'])) })).toEqual(['S/c.cbz', 'S/d.cbz']);
  });

  it('returns every book when all formats are selected, keeping their indexes', () => {
    expect(chooseFormats(plan, ALL)).toEqual(plan.books);
  });

  it('does not mutate the plan', () => {
    const before = plan.books.length;
    chooseFormats(plan, new Set<BookFormat>(['epub']));
    expect(plan.books.length).toBe(before);
  });
});

describe('seriesNameFor', () => {
  it('uses the trimmed name the user typed', () => {
    expect(seriesNameFor('  Ao no Hako  ', 'Mi Serie')).toBe('Ao no Hako');
  });

  it('falls back to the trimmed folder name when the typed name is blank', () => {
    expect(seriesNameFor('   ', '  Mi Serie ')).toBe('Mi Serie');
    expect(seriesNameFor('', 'Mi Serie')).toBe('Mi Serie');
  });

  it('is undefined when both the name and the folder are blank', () => {
    expect(seriesNameFor(' ', '  ')).toBeUndefined();
    expect(seriesNameFor('', '')).toBeUndefined();
  });
});
