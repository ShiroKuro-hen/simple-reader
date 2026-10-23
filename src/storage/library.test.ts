import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixtureBytes, fixtureFile } from '../reader/fixtures/load';
import { storeZip } from '../reader/fixtures/store-zip';
import { memoryStorage } from './opfs';
import { createLibrary } from './library';

/** A library over a fresh in-memory store with a clock that ticks once per call. */
function setup() {
  const fs = memoryStorage();
  let t = 1000;
  return { fs, lib: createLibrary(fs, () => t++) };
}

describe('addBook', () => {
  it('identifies a book by the SHA-256 of its content and reads its metadata', async () => {
    const { lib } = setup();
    const meta = await lib.addBook(fixtureFile('book-en.epub'));
    expect(meta.id).toBe(createHash('sha256').update(fixtureBytes('book-en.epub')).digest('hex'));
    expect(meta).toMatchObject({ title: 'The Lighthouse & the Sea', author: 'Ada Marlowe', format: 'epub' });
    expect(meta.size).toBe(fixtureBytes('book-en.epub').length);
  });

  it('keeps Japanese titles and authors intact', async () => {
    const { lib } = setup();
    const meta = await lib.addBook(fixtureFile('book-ja.epub'));
    expect(meta).toMatchObject({ title: '吾輩は猫である', author: '夏目漱石' });
    expect(meta.cover).toBeUndefined();
  });

  it('adding the same bytes under another name returns the same book and stores it once', async () => {
    const { fs, lib } = setup();
    const first = await lib.addBook(fixtureFile('book-en.epub'));
    const again = await lib.addBook(fixtureFile('book-en-copy.epub'));
    expect(again).toEqual(first);
    expect((await lib.listBooks()).length).toBe(1);
    expect(await fs.list('books/')).toEqual([`books/${first.id}.epub`]);
  });

  it('stores the exact bytes and returns them as a Blob', async () => {
    const { lib } = setup();
    const { id } = await lib.addBook(fixtureFile('book-en.epub'));
    const back = new Uint8Array(await (await lib.getBookBlob(id)).arrayBuffer());
    expect(Array.from(back)).toEqual(Array.from(fixtureBytes('book-en.epub')));
  });

  it('takes a PDF without readable metadata and titles it from the file name', async () => {
    const { lib } = setup();
    const meta = await lib.addBook(fixtureFile('corrupt.pdf', '日本語_の本.pdf'));
    expect(meta).toMatchObject({ title: '日本語 の本', format: 'pdf' });
  });

  it('refuses files that cannot be books and stores nothing for them', async () => {
    const { fs, lib } = setup();
    await expect(lib.addBook(fixtureFile('corrupt.epub'))).rejects.toThrow(/epub/i);
    await expect(lib.addBook(fixtureFile('empty.epub'))).rejects.toThrow(/empty/i);
    await expect(lib.addBook(new File(['hi'], 'notes.txt'))).rejects.toThrow(/unsupported/i);
    expect(await fs.list('')).toEqual([]);
  });
});

describe('listBooks', () => {
  it('lists the most recently added first', async () => {
    const { lib } = setup();
    await lib.addBook(fixtureFile('book-ja.epub'));
    await lib.addBook(fixtureFile('book-en.epub'));
    await lib.addBook(fixtureFile('corrupt.pdf', 'third.pdf'));
    expect((await lib.listBooks()).map((b) => b.title)).toEqual(['third', 'The Lighthouse & the Sea', '吾輩は猫である']);
  });

  it('skips a damaged metadata file instead of failing the whole library', async () => {
    const { fs, lib } = setup();
    const { id } = await lib.addBook(fixtureFile('book-en.epub'));
    await fs.write('meta/broken.json', '{not json');
    expect((await lib.listBooks()).map((b) => b.id)).toEqual([id]);
  });
});

describe('removeBook', () => {
  it('deletes the file, metadata and progress of that book only', async () => {
    const { fs, lib } = setup();
    const en = await lib.addBook(fixtureFile('book-en.epub'));
    const ja = await lib.addBook(fixtureFile('book-ja.epub'));
    await lib.saveProgress({ bookId: en.id, location: 'x', fraction: 0.1, updatedAt: 1 });
    await lib.saveProgress({ bookId: ja.id, location: 'y', fraction: 0.2, updatedAt: 1 });
    await lib.removeBook(en.id);
    expect((await lib.listBooks()).map((b) => b.id)).toEqual([ja.id]);
    expect(await lib.getProgress(en.id)).toBeNull();
    expect(await lib.getProgress(ja.id)).not.toBeNull();
    expect((await fs.list('')).every((p) => !p.includes(en.id))).toBe(true);
    await expect(lib.getBookBlob(en.id)).rejects.toThrow();
  });

  it('is a no-op for an unknown id', async () => {
    const { lib } = setup();
    await lib.removeBook('f'.repeat(64));
  });
});

describe('progress', () => {
  it('round-trips and keeps the latest save', async () => {
    const { lib } = setup();
    const p = { bookId: 'abc', location: 'epubcfi(/6/4!/4/2/1:0)', fraction: 0.42, updatedAt: 5 };
    expect(await lib.getProgress('abc')).toBeNull();
    await lib.saveProgress(p);
    expect(await lib.getProgress('abc')).toEqual(p);
    await lib.saveProgress({ ...p, fraction: 0.5, updatedAt: 6 });
    expect((await lib.getProgress('abc'))?.fraction).toBe(0.5);
  });

  it('reads a damaged progress file as no progress', async () => {
    const { fs, lib } = setup();
    await fs.write('progress/abc.json', '');
    expect(await lib.getProgress('abc')).toBeNull();
  });
});

describe('comics (cbz)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const comic = () => storeZip({ '2.jpg': bytes('two'), '10.jpg': bytes('ten'), '__MACOSX/2.jpg': bytes('junk') });

  it('adds a comic as format cbz under its file name, keeping the exact bytes', async () => {
    const { fs, lib } = setup();
    const data = comic();
    const meta = await lib.addBook(new File([data], 'Vol_1.cbz'));
    expect(meta).toMatchObject({ title: 'Vol 1', format: 'cbz', size: data.length });
    expect(await fs.list('books/')).toEqual([`books/${meta.id}.cbz`]);
    const blob = await lib.getBookBlob(meta.id);
    expect(blob.type).toBe('application/vnd.comicbook+zip');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(data));
  });

  it('adding the same comic under another name returns the same book', async () => {
    const { fs, lib } = setup();
    const first = await lib.addBook(new File([comic()], 'Vol_1.cbz'));
    const again = await lib.addBook(new File([comic()], 'Vol_1 (copy).cbz'));
    expect(again).toEqual(first);
    expect(await fs.list('books/')).toEqual([`books/${first.id}.cbz`]);
  });

  it('refuses a zip without pages and a file that is not a zip, storing nothing', async () => {
    const { fs, lib } = setup();
    await expect(lib.addBook(new File([storeZip({ 'readme.txt': bytes('x') })], 'empty.cbz'))).rejects.toThrow(/Not a valid CBZ/);
    await expect(lib.addBook(new File([bytes('plain text')], 'fake.cbz'))).rejects.toThrow(/Not a valid CBZ/);
    expect(await fs.list('')).toEqual([]);
  });

  it('removing a comic deletes its file and metadata', async () => {
    const { fs, lib } = setup();
    const meta = await lib.addBook(new File([comic()], 'Vol_1.cbz'));
    await lib.removeBook(meta.id);
    expect(await fs.list('')).toEqual([]);
    await expect(lib.getBookBlob(meta.id)).rejects.toThrow();
  });
});

describe('settings', () => {
  it('defaults to a light theme at 100% with furigana off and the automatic page layout', async () => {
    expect(await setup().lib.getSettings()).toEqual({ theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true });
  });

  it('round-trips what was saved', async () => {
    const { lib } = setup();
    await lib.saveSettings({ theme: 'sepia', fontSize: 120, furigana: 'romaji', layout: 'single', rtl: false });
    expect(await lib.getSettings()).toEqual({ theme: 'sepia', fontSize: 120, furigana: 'romaji', layout: 'single', rtl: false });
  });

  it('survives a corrupt settings file', async () => {
    const { fs, lib } = setup();
    await fs.write('settings.json', 'oops');
    expect((await lib.getSettings()).theme).toBe('light');
  });
});

describe('annotations', () => {
  const note = (over = {}) => ({
    id: 'n1', bookId: 'abc', kind: 'note' as const, location: 'epubcfi(/6/4!/4/2,/1:0,/1:5)', text: 'héllo 😀',
    note: 'a note', color: 'blue' as const, createdAt: 1, updatedAt: 2, ...over,
  });

  it('round-trips as annotations/<bookId>.json, tombstones included', async () => {
    const { fs, lib } = setup();
    expect(await lib.getAnnotations('abc')).toEqual({ bookId: 'abc', items: [] });
    const file = { bookId: 'abc', items: [note(), note({ id: 'n2', deleted: true })] };
    await lib.saveAnnotations(file);
    expect(await lib.getAnnotations('abc')).toEqual(file);
    expect(await fs.list('annotations/')).toEqual(['annotations/abc.json']);
  });

  it('keeps books apart', async () => {
    const { lib } = setup();
    await lib.saveAnnotations({ bookId: 'abc', items: [note()] });
    expect((await lib.getAnnotations('other')).items).toEqual([]);
  });

  it.each(['', '{not json', 'null', '[]', '{"items": 7}'])('reads a damaged file (%j) as empty', async (content) => {
    const { fs, lib } = setup();
    await fs.write('annotations/abc.json', content);
    expect(await lib.getAnnotations('abc')).toEqual({ bookId: 'abc', items: [] });
  });

  it('removing a book removes its annotations and no one else\'s', async () => {
    const { fs, lib } = setup();
    const en = await lib.addBook(fixtureFile('book-en.epub'));
    await lib.saveAnnotations({ bookId: en.id, items: [note({ bookId: en.id })] });
    await lib.saveAnnotations({ bookId: 'other', items: [note({ bookId: 'other' })] });
    await lib.removeBook(en.id);
    expect(await fs.list('annotations/')).toEqual(['annotations/other.json']);
  });
});
