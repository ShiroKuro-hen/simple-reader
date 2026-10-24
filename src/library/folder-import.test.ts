import { describe, expect, it } from 'vitest';
import type { BookFormat } from '../types';
import { openComicArchive } from '../reader/comic-archive';
import { readCbzInfo } from '../storage/cbz-info';
import { chooseFormats, pageName, packVolume, planFolderImport, seriesNameFor } from './folder-import';

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

  it('counts a .cbr comic as a cbz book: a folder with a.cbr and b.cbz has 2 comics', () => {
    const plan = planFolderImport(['S/a.cbr', 'S/b.cbz']);
    expect(plan.counts).toEqual({ epub: 0, pdf: 0, cbz: 2 });
    expect(plan.books.map((b) => b.format)).toEqual(['cbz', 'cbz']);
    expect(paths(plan)).toEqual(['S/a.cbr', 'S/b.cbz']);
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
    const plan = planFolderImport(['S/notes.txt', 'S/Vol 1.epub', 'S/Vol 1', 'S/readme.md']);
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
    expect(planFolderImport([])).toEqual({ folder: '', books: [], counts: { epub: 0, pdf: 0, cbz: 0 }, ignored: 0, volumes: [] });
  });

  it('has no books when nothing is supported, but still reports every file as ignored', () => {
    const plan = planFolderImport(['S/a.txt', 'S/b.docx']);
    expect(plan.books).toEqual([]);
    expect(plan.volumes).toEqual([]);
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

describe('planFolderImport: folders of page images', () => {
  const volumesOf = (input: string[]) => planFolderImport(input).volumes;
  const pagesOf = (v: { pages: { path: string }[] }) => v.pages.map((p) => p.path);

  it('makes the picked folder one volume when its images sit at the top', () => {
    expect(volumesOf(['Root/001.jpg', 'Root/002.png'])).toEqual([
      { name: 'Root', pages: [{ index: 0, path: 'Root/001.jpg' }, { index: 1, path: 'Root/002.png' }] },
    ]);
  });

  it('makes every directory that directly holds images one volume named after it, at any depth', () => {
    const plan = planFolderImport(['Root/Vol 1/a.jpg', 'Root/Vol 1/deep/x/b.jpg', 'Root/Vol 1/deep/c.jpg']);
    expect(plan.volumes.map((v) => v.name)).toEqual(['Vol 1', 'deep', 'x']);
    expect(plan.volumes.map((v) => pagesOf(v))).toEqual([['Root/Vol 1/a.jpg'], ['Root/Vol 1/deep/c.jpg'], ['Root/Vol 1/deep/x/b.jpg']]);
  });

  it('does not make a volume of a directory that only has images further down', () => {
    expect(volumesOf(['Root/x/y/a.jpg']).map((v) => v.name)).toEqual(['y']);
  });

  it('keeps the root images and each subfolder apart, with the input indexes of their files', () => {
    const plan = planFolderImport(['Root/cover.jpg', 'Root/Vol 1/1.png', 'Root/Vol 2/1.png']);
    expect(plan.volumes).toEqual([
      { name: 'Root', pages: [{ index: 0, path: 'Root/cover.jpg' }] },
      { name: 'Vol 1', pages: [{ index: 1, path: 'Root/Vol 1/1.png' }] },
      { name: 'Vol 2', pages: [{ index: 2, path: 'Root/Vol 2/1.png' }] },
    ]);
  });

  it('puts the pages of a volume in natural order of their path', () => {
    expect(pagesOf(volumesOf(['R/V/10.png', 'R/V/2.png', 'R/V/1.png'])[0]!)).toEqual(['R/V/1.png', 'R/V/2.png', 'R/V/10.png']);
  });

  it('accepts jpg, jpeg, png, webp, gif and avif in any case, and nothing else', () => {
    const plan = planFolderImport(['R/a.JPG', 'R/b.jpeg', 'R/c.png', 'R/d.webp', 'R/e.gif', 'R/f.avif', 'R/g.bmp', 'R/h.tif']);
    expect(plan.volumes[0]!.pages).toHaveLength(6);
    expect(plan.ignored).toBe(2);
  });

  it('ignores dotfiles and __MACOSX junk like it does for books', () => {
    const plan = planFolderImport(['R/.cover.jpg', 'R/__MACOSX/R/x.jpg', 'R/.hidden/y.jpg', 'R/z.jpg']);
    expect(plan.volumes).toEqual([{ name: 'R', pages: [{ index: 3, path: 'R/z.jpg' }] }]);
    expect(plan.ignored).toBe(3);
  });

  it('a folder of images alone has no books but has volumes', () => {
    const plan = planFolderImport(['Mangas/Vol 1/a.webp']);
    expect(plan.books).toEqual([]);
    expect(plan.volumes).toHaveLength(1);
  });

  it('keeps book files and image volumes of the same folder side by side', () => {
    const plan = planFolderImport(['S/Vol 1.epub', 'S/extra/a.jpg']);
    expect(paths(plan)).toEqual(['S/Vol 1.epub']);
    expect(plan.volumes.map((v) => v.name)).toEqual(['extra']);
    expect(plan.ignored).toBe(0);
  });
});

describe('pageName', () => {
  it('zero pads to four digits and keeps the lower-case extension', () => {
    expect(pageName(1, 12, 'R/a.JPG')).toBe('0001.jpg');
    expect(pageName(12, 12, 'R/x/b.png')).toBe('0012.png');
  });
  it('pads to the width of the page count when there are more than 9999 pages', () => {
    expect(pageName(1, 10000, 'a.webp')).toBe('00001.webp');
    expect(pageName(10000, 10000, 'a.webp')).toBe('10000.webp');
  });
});

describe('packVolume', () => {
  const bytes = (...xs: number[]) => new Uint8Array(xs);
  const files = [new File([bytes(1, 2, 3)], 'b.png'), new File([bytes(9, 8)], 'a.jpg')];
  const volume = { name: 'Vol 1', pages: [{ index: 0, path: 'R/Vol 1/b.png' }, { index: 1, path: 'R/Vol 1/a.jpg' }] };

  it('builds a real cbz named after the volume, its pages stored in order as 0001.png, 0002.jpg', async () => {
    const cbz = await packVolume(volume, files);
    expect(cbz.name).toBe('Vol 1.cbz');
    const archive = await openComicArchive(cbz);
    expect(archive.names).toEqual(['0001.png', '0002.jpg']);
    expect(new Uint8Array(await (await archive.read('0001.png')).arrayBuffer())).toEqual(bytes(1, 2, 3));
    expect(new Uint8Array(await (await archive.read('0002.jpg')).arrayBuffer())).toEqual(bytes(9, 8));
    await archive.close();
    expect((await readCbzInfo(cbz)).pages).toBe(2);
  });

  it('packs the same pages to the same bytes every time, so the book id does not change', async () => {
    const a = new Uint8Array(await (await packVolume(volume, files)).arrayBuffer());
    const b = new Uint8Array(await (await packVolume(volume, files)).arrayBuffer());
    expect(a).toEqual(b);
  });
});
