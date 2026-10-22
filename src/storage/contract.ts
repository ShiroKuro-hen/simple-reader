// The behaviour every Storage implementation must have. Framework-free on purpose:
// vitest runs it against memoryStorage (contract.test.ts) and the browser harness runs it
// against the real OPFS (src/reader/e2e), so both are held to the same cases.
import type { Storage } from '../types';

export function eq(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

const text = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const bytes = (b: Uint8Array | null) => (b ? Array.from(b) : null);

/** Each case gets a fresh `ns` folder so cases cannot see each other on a shared real store. */
export type ContractCase = (fs: Storage, ns: string) => Promise<void>;

export const storageContract: Record<string, ContractCase> = {
  'reads a missing file as null, also under a missing folder': async (fs, ns) => {
    eq(await fs.read(`${ns}/nope.json`), null);
    eq(await fs.read(`${ns}/no/such/dir/file.bin`), null);
  },

  'round-trips text written as a string or as bytes': async (fs, ns) => {
    await fs.write(`${ns}/a.txt`, 'héllo');
    await fs.write(`${ns}/b.txt`, text('héllo'));
    eq(str(await fs.read(`${ns}/a.txt`)), 'héllo');
    eq(bytes(await fs.read(`${ns}/a.txt`)), bytes(await fs.read(`${ns}/b.txt`)), 'string vs bytes');
  },

  'round-trips every byte value, and a few hundred KB': async (fs, ns) => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    await fs.write(`${ns}/all.bin`, all);
    eq(bytes(await fs.read(`${ns}/all.bin`)), Array.from(all), '256 byte values');
    const big = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 31) % 251);
    await fs.write(`${ns}/big.bin`, big);
    const back = (await fs.read(`${ns}/big.bin`))!;
    eq(back.length, big.length, 'big length');
    eq(back.every((v, i) => v === big[i]), true, 'big content');
  },

  'stores an empty file as empty, not as missing': async (fs, ns) => {
    await fs.write(`${ns}/empty`, new Uint8Array(0));
    eq(bytes(await fs.read(`${ns}/empty`)), []);
  },

  'overwrite replaces the whole content, even with something shorter': async (fs, ns) => {
    await fs.write(`${ns}/f`, 'a much longer first version');
    await fs.write(`${ns}/f`, 'short');
    eq(str(await fs.read(`${ns}/f`)), 'short');
  },

  'creates nested folders on write and lists them with full paths': async (fs, ns) => {
    await fs.write(`${ns}/a/b/c/d.json`, '{}');
    await fs.write(`${ns}/a/top.json`, '{}');
    eq(str(await fs.read(`${ns}/a/b/c/d.json`)), '{}');
    eq(await fs.list(`${ns}/a/`), [`${ns}/a/b/c/d.json`, `${ns}/a/top.json`]);
  },

  'list matches by plain string prefix: books/a vs books/ab vs books2': async (fs, ns) => {
    for (const p of ['books/a', 'books/ab', 'books/b', 'books2/a'] as const) await fs.write(`${ns}/${p}`, p);
    eq(await fs.list(`${ns}/books/ab`), [`${ns}/books/ab`], 'exact name');
    eq(await fs.list(`${ns}/books/a`), [`${ns}/books/a`, `${ns}/books/ab`], 'shared stem');
    eq(await fs.list(`${ns}/books/`), [`${ns}/books/a`, `${ns}/books/ab`, `${ns}/books/b`], 'folder, not books2');
    eq(await fs.list(`${ns}/books`), [`${ns}/books/a`, `${ns}/books/ab`, `${ns}/books/b`, `${ns}/books2/a`], 'no slash');
  },

  'list of an unknown prefix is empty': async (fs, ns) => {
    await fs.write(`${ns}/x/y`, '1');
    eq(await fs.list(`${ns}/nothing/`), []);
    eq(await fs.list(`${ns}/x/yy`), []);
  },

  'remove deletes one file and leaves its siblings': async (fs, ns) => {
    await fs.write(`${ns}/d/one`, '1');
    await fs.write(`${ns}/d/two`, '2');
    await fs.remove(`${ns}/d/one`);
    eq(await fs.read(`${ns}/d/one`), null);
    eq(str(await fs.read(`${ns}/d/two`)), '2');
    eq(await fs.list(`${ns}/d/`), [`${ns}/d/two`]);
  },

  'removing a missing file or a file in a missing folder is not an error': async (fs, ns) => {
    await fs.remove(`${ns}/ghost`);
    await fs.remove(`${ns}/no/such/folder/ghost`);
  },

  'accepts unicode and awkward characters in file names': async (fs, ns) => {
    const names = ['books/吾輩は猫である.epub', 'meta/émoji-😀.json', 'meta/with space #1.json'];
    for (const n of names) await fs.write(`${ns}/${n}`, n);
    for (const n of names) eq(str(await fs.read(`${ns}/${n}`)), n, n);
    eq((await fs.list(`${ns}/meta/`)).sort(), [`${ns}/meta/with space #1.json`, `${ns}/meta/émoji-😀.json`].sort());
  },

  'parallel writes into the same new folder all land': async (fs, ns) => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => fs.write(`${ns}/par/f${i}`, String(i))));
    eq((await fs.list(`${ns}/par/`)).length, 12);
    eq(str(await fs.read(`${ns}/par/f7`)), '7');
  },
};
