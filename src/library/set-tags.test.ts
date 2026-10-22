// setTags on a real library over the in-memory Storage (the same Storage contract as OPFS), with real EPUB fixtures.
import { describe, expect, it } from 'vitest';
import { fixtureFile } from '../reader/fixtures/load';
import { createLibrary, setTags } from '../storage/library';
import { memoryStorage } from '../storage/opfs';

async function setup() {
  const fs = memoryStorage();
  const lib = createLibrary(fs, () => 1000);
  const en = await lib.addBook(fixtureFile('book-en.epub'));
  const ja = await lib.addBook(fixtureFile('book-ja.epub'));
  return { fs, lib, en, ja };
}

describe('setTags', () => {
  it('stores the tags and stamps updatedAt, leaving the rest of the metadata alone', async () => {
    const { fs, lib, en } = await setup();
    const out = await setTags(en.id, ['novela', 'sci fi'], fs, () => 5000);
    expect(out).toEqual({ ...en, tags: ['novela', 'sci fi'], updatedAt: 5000 });
    expect((await lib.listBooks()).find((b) => b.id === en.id)).toEqual(out);
  });

  it('only touches the book it was given', async () => {
    const { fs, lib, en, ja } = await setup();
    await setTags(en.id, ['a'], fs, () => 5000);
    expect((await lib.listBooks()).find((b) => b.id === ja.id)).toEqual(ja);
  });

  it('cleans what it is given: lowercase, trimmed, no duplicates, no junk', async () => {
    const { fs, en } = await setup();
    expect((await setTags(en.id, [' Ficción ', 'ficción', '', 'x,y', '古典'], fs, () => 1)).tags).toEqual(['ficción', '古典']);
  });

  it('removing every tag leaves an empty list and still counts as an edit', async () => {
    const { fs, en } = await setup();
    await setTags(en.id, ['a'], fs, () => 2000);
    expect(await setTags(en.id, [], fs, () => 3000)).toMatchObject({ tags: [], updatedAt: 3000 });
  });

  it('refuses a book that is not in the library', async () => {
    const { fs } = await setup();
    await expect(setTags('nope', ['a'], fs)).rejects.toThrow(/Unknown book/);
  });

  it('a damaged metadata file is an error, not silently overwritten', async () => {
    const { fs, en } = await setup();
    await fs.write(`meta/${en.id}.json`, '{not json');
    await expect(setTags(en.id, ['a'], fs)).rejects.toThrow();
    expect(new TextDecoder().decode((await fs.read(`meta/${en.id}.json`))!)).toBe('{not json');
  });
});
