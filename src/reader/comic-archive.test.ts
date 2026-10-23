import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { storeRar5 } from './fixtures/store-rar';
import { storeZip } from './fixtures/store-zip';
import { openComicArchive, sniffArchive } from './comic-archive';
import { sortPageNames } from './manga-nav';

const bytes = (s: string) => new TextEncoder().encode(s);
const blobOf = (u: Uint8Array<ArrayBuffer>) => new Blob([u]);
const head = (...b: number[]) => Uint8Array.from(b);
const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array) =>
  haystack.findIndex((_, i) => needle.every((b, j) => haystack[i + j] === b));

describe('sniffArchive', () => {
  it('recognises every ZIP signature', () => {
    expect(sniffArchive(head(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe('zip'); // local file header
    expect(sniffArchive(head(0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0))).toBe('zip'); // empty archive
    expect(sniffArchive(head(0x50, 0x4b, 0x07, 0x08))).toBe('zip'); // spanned archive
  });

  it('recognises the RAR 4 and RAR 5 signatures', () => {
    expect(sniffArchive(head(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00))).toBe('rar');
    expect(sniffArchive(head(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00))).toBe('rar');
  });

  it('returns null for short, empty or unknown input', () => {
    expect(sniffArchive(new Uint8Array())).toBeNull();
    expect(sniffArchive(head(0x50, 0x4b, 0x03))).toBeNull(); // ZIP signature cut short
    expect(sniffArchive(head(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07))).toBeNull(); // RAR signature cut short
    expect(sniffArchive(head(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01))).toBeNull(); // RAR 5 needs its 8th byte
    expect(sniffArchive(head(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x05))).toBeNull();
    expect(sniffArchive(head(0x50, 0x4b, 0x03, 0x05))).toBeNull();
    expect(sniffArchive(bytes('%PDF-1.4'))).toBeNull();
  });
});

describe('openComicArchive: zip', () => {
  const zip = () =>
    blobOf(storeZip({ 'vol/': new Uint8Array(), 'vol/2.png': bytes('two'), 'vol/10.png': bytes('ten'), 'notes.txt': bytes('hi') }));

  it('lists the file entries in archive order, directories excluded', async () => {
    const archive = await openComicArchive(zip());
    expect(archive.kind).toBe('zip');
    expect(archive.names).toEqual(['vol/2.png', 'vol/10.png', 'notes.txt']);
    await archive.close();
  });

  it('reads one entry as a Blob typed by its image extension, with the exact bytes', async () => {
    const archive = await openComicArchive(zip());
    const page = await archive.read('vol/10.png');
    expect(page.type).toBe('image/png');
    expect(await page.text()).toBe('ten');
    await archive.close();
  });

  it('close can be called twice', async () => {
    const archive = await openComicArchive(zip());
    await archive.close();
    await expect(archive.close()).resolves.toBeUndefined();
  });
});

describe('openComicArchive: rar', () => {
  const files = { 'vol/': new Uint8Array(), 'vol/2.png': bytes('two'), 'vol/10.png': bytes('ten'), 'notes.txt': bytes('hi') };
  const rar = () => blobOf(storeRar5(files));

  it('lists the file entries in archive order, directories excluded', async () => {
    const archive = await openComicArchive(rar());
    expect(archive.kind).toBe('rar');
    expect(archive.names).toEqual(['vol/2.png', 'vol/10.png', 'notes.txt']);
    await archive.close();
  });

  it('reads back the same names and bytes that node-unrar-js extracts from the same archive', async () => {
    const { createExtractorFromData } = await import('node-unrar-js');
    const data = await rar().arrayBuffer();
    const extracted = [...(await createExtractorFromData({ data })).extract().files]
      .filter((f) => !f.fileHeader.flags.directory)
      .map((f) => [f.fileHeader.name, new TextDecoder().decode(f.extraction)]);
    expect(extracted).toEqual([
      ['vol/2.png', 'two'],
      ['vol/10.png', 'ten'],
      ['notes.txt', 'hi'],
    ]);
    const archive = await openComicArchive(rar());
    expect(archive.names).toEqual(['vol/2.png', 'vol/10.png', 'notes.txt']);
    await archive.close();
  });

  it('reads one entry as a Blob typed by its image extension, with the exact bytes', async () => {
    const archive = await openComicArchive(rar());
    const page = await archive.read('vol/2.png');
    expect(page.type).toBe('image/png');
    expect(await page.text()).toBe('two');
    expect(await (await archive.read('notes.txt')).text()).toBe('hi');
    await archive.close();
  });

  it('close can be called twice', async () => {
    const archive = await openComicArchive(rar());
    await archive.close();
    await expect(archive.close()).resolves.toBeUndefined();
  });

  it('turns backslashes in RAR entry names into slashes, and still reads the entry by the name as stored', async () => {
    // WinRAR on Windows can store paths with '\'; the page sorting and the image filter need '/'.
    const archive = await openComicArchive(blobOf(storeRar5({ 'vol\\2.png': bytes('two'), 'vol\\10.png': bytes('ten') })));
    expect(archive.names).toEqual(['vol/2.png', 'vol/10.png']);
    expect(await (await archive.read('vol/10.png')).text()).toBe('ten');
    expect(await (await archive.read('vol\\10.png')).text()).toBe('ten');
    await archive.close();
  });

  it('rejects an archive whose header is damaged, with a readable message', async () => {
    const damaged = storeRar5(files);
    damaged[13] = damaged[13]! ^ 0xff; // the main header's type byte: the header CRC no longer matches
    await expect(openComicArchive(blobOf(damaged))).rejects.toThrow(/^RAR archive could not be read: /);
  });

  it('rejects reading an entry whose data is damaged, and only that entry', async () => {
    const damaged = storeRar5(files);
    const at = indexOfBytes(damaged, bytes('two'));
    if (at < 0) throw new Error('the stored bytes of vol/2.png are not in the fixture');
    damaged[at] = damaged[at]! ^ 0xff; // the stored bytes of vol/2.png
    const archive = await openComicArchive(blobOf(damaged));
    await expect(archive.read('vol/2.png')).rejects.toThrow(/could not be read/);
    expect(await (await archive.read('vol/10.png')).text()).toBe('ten');
    await archive.close();
  });
});

describe('openComicArchive: not an archive', () => {
  it('rejects text, an empty file and a PDF by their bytes', async () => {
    await expect(openComicArchive(blobOf(bytes('plain text')))).rejects.toThrow(/^Not a ZIP or RAR archive/);
    await expect(openComicArchive(new Blob([]))).rejects.toThrow(/^Not a ZIP or RAR archive/);
    await expect(openComicArchive(blobOf(bytes('%PDF-1.4 ...')))).rejects.toThrow(/^Not a ZIP or RAR archive/);
  });
});

// Opt-in: point COMIC_RAR at a real .cbr/.rar file. Never committed, because comics are not ours to ship.
const comicRar = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.COMIC_RAR;
describe.skipIf(!comicRar)('openComicArchive: a real comic from COMIC_RAR', () => {
  it('lists pages and reads the first one as a non-empty image', async () => {
    const archive = await openComicArchive(blobOf(new Uint8Array(readFileSync(comicRar!))));
    const pages = sortPageNames(archive.names);
    expect(pages.length).toBeGreaterThan(0);
    const first = await archive.read(pages[0]!);
    expect(first.size).toBeGreaterThan(0);
    await archive.close();
  });
});
