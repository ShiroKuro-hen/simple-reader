import { describe, expect, it } from 'vitest';
import { fixtureFile } from '../reader/fixtures/load';
import { storeZip } from '../reader/fixtures/store-zip';
import { readCbzInfo } from './cbz-info';

// Image bytes are stand-ins: the reader never decodes them, it only names and counts them.
const bytes = (s: string) => new TextEncoder().encode(s);
const comic = (files: Record<string, string>) => new Blob([storeZip(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)])))]);

describe('readCbzInfo', () => {
  it('counts the pages and takes the first in natural order as the cover', async () => {
    const info = await readCbzInfo(comic({ '10.jpg': 'ten', '2.jpg': 'two', '3.jpg': 'three' }));
    expect(info.pages).toBe(3);
    expect(await info.cover!.text()).toBe('two'); // 2.jpg comes before 10.jpg, as a reader would list them
    expect(info.cover!.type).toBe('image/jpeg');
  });

  it('ignores macOS resource forks, dotfiles and non-image files', async () => {
    const info = await readCbzInfo(
      comic({ '__MACOSX/1.png': 'junk', '__MACOSX/._1.png': 'junk', 'ch/.DS_Store': 'x', 'readme.txt': 'hi', '1.png': 'page one', '2.png': 'page two' }),
    );
    expect(info.pages).toBe(2);
    expect(await info.cover!.text()).toBe('page one');
    expect(info.cover!.type).toBe('image/png');
  });

  it('reads pages from subfolders in natural order', async () => {
    const info = await readCbzInfo(comic({ 'vol/10.webp': 'ten', 'vol/9.webp': 'nine' }));
    expect(info.pages).toBe(2);
    expect(await info.cover!.text()).toBe('nine');
    expect(info.cover!.type).toBe('image/webp');
  });

  it('gives each image extension its MIME type', async () => {
    const types = await Promise.all(
      ['a.gif', 'b.jpeg', 'c.avif'].map(async (name) => (await readCbzInfo(comic({ [name]: 'x' }))).cover!.type),
    );
    expect(types).toEqual(['image/gif', 'image/jpeg', 'image/avif']);
  });

  it('rejects a zip with no images', async () => {
    await expect(readCbzInfo(comic({ 'readme.txt': 'nothing to see' }))).rejects.toThrow(/no pages/);
  });

  it('rejects bytes that are not a zip, an empty file, and a PDF', async () => {
    await expect(readCbzInfo(new Blob([bytes('plain text, not an archive')]))).rejects.toThrow();
    await expect(readCbzInfo(new Blob([]))).rejects.toThrow();
    await expect(readCbzInfo(fixtureFile('sample.pdf'))).rejects.toThrow();
  });
});
