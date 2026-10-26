import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/opfs';
import { createLibrary } from '../storage/library';
import type { BookMeta } from '../types';
import { withS3 } from './fake-s3';
import { downloadCloudBook, listCloudBooks } from './r2';

const enc = new TextEncoder();
const dec = new TextDecoder();
const meta = (id: string, extra: Partial<BookMeta> = {}): BookMeta => ({ id, title: `Book ${id}`, format: 'epub', size: 3, addedAt: 1, ...extra });
const json = (v: unknown) => enc.encode(JSON.stringify(v));
/** What the bucket holds for one uploaded book. */
const uploaded = (m: BookMeta, bytes = 'BOOK') => ({ [`meta/${m.id}.json`]: json(m), [`books/${m.id}.${m.format}`]: enc.encode(bytes) });

describe('listCloudBooks: the books in the bucket this device does not have', () => {
  it('lists the ones missing here, with their metadata, and skips the ones already here', async () => {
    const objects = { ...uploaded(meta('aaa')), ...uploaded(meta('bbb', { series: 'Saga', format: 'cbz' })) };
    const got = await withS3(objects, {}, (cfg) => listCloudBooks(cfg, new Set(['aaa'])));
    expect(got).toEqual([meta('bbb', { series: 'Saga', format: 'cbz' })]);
  });

  it('skips a book whose file is not in the bucket, and metadata that cannot be read', async () => {
    const objects = {
      ...uploaded(meta('ok')),
      'meta/nofile.json': json(meta('nofile')), // metadata uploaded, the book not (yet)
      ...uploaded(meta('bad')),
      'meta/bad.json': enc.encode('not json'),
      ...uploaded(meta('odd')),
      'meta/odd.json': json({ id: 'odd', title: 5, format: 'epub' }),
      ...uploaded(meta('evil')),
      'meta/evil.json': json({ ...meta('evil'), id: 'a/../b' }), // an id that would write outside its own paths
    };
    const got = await withS3(objects, {}, (cfg) => listCloudBooks(cfg, new Set()));
    expect(got.map((b) => b.id)).toEqual(['ok']);
  });

  it('is empty for an empty bucket', async () => {
    expect(await withS3({}, {}, (cfg) => listCloudBooks(cfg, new Set()))).toEqual([]);
  });
});

describe('downloadCloudBook: one book from the bucket into the library', () => {
  it('brings the file, the metadata, the position and the notes, and marks it as from the cloud', async () => {
    const m = meta('aaa');
    const objects = {
      ...uploaded(m, 'THE BOOK'),
      'progress/aaa.json': json({ bookId: 'aaa', location: '7', fraction: 0.5, updatedAt: 9 }),
      'annotations/aaa.json': json({ bookId: 'aaa', items: [] }),
      'books/other.epub': enc.encode('x'),
    };
    const fs = memoryStorage();
    await withS3(objects, {}, (cfg) => downloadCloudBook(cfg, fs, m));
    expect(dec.decode((await fs.read('books/aaa.epub'))!)).toBe('THE BOOK');
    expect(JSON.parse(dec.decode((await fs.read('meta/aaa.json'))!))).toEqual(m);
    expect(await fs.list('progress/')).toEqual(['progress/aaa.json']);
    expect(await fs.list('annotations/')).toEqual(['annotations/aaa.json']);
    expect([...(await createLibrary(fs).cloudIds())]).toEqual(['aaa']);
    expect((await createLibrary(fs).listBooks()).map((b) => b.id)).toEqual(['aaa']); // it is in the library now
    expect(await fs.list('books/')).toEqual(['books/aaa.epub']); // and nothing else came down
  });

  it('works for a book that has no position or notes yet', async () => {
    const m = meta('aaa');
    const fs = memoryStorage();
    await withS3(uploaded(m), {}, (cfg) => downloadCloudBook(cfg, fs, m));
    expect((await createLibrary(fs).listBooks()).length).toBe(1);
  });

  it('a book that is gone from the bucket is an error and leaves the library untouched', async () => {
    const m = meta('aaa');
    const fs = memoryStorage();
    await expect(withS3({ [`meta/aaa.json`]: json(m) }, {}, (cfg) => downloadCloudBook(cfg, fs, m))).rejects.toThrow(/no longer/i);
    expect(await fs.list('')).toEqual([]);
  });

  it('a failed download leaves no half-added book', async () => {
    const m = meta('aaa');
    const fs = memoryStorage();
    const objects = uploaded(m);
    await expect(withS3(objects, { failGet: ['progress/aaa.json'] }, (cfg) => downloadCloudBook(cfg, fs, m))).rejects.toThrow();
    expect((await createLibrary(fs).listBooks()).length).toBe(0);
  });
});
