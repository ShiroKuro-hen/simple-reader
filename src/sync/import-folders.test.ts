import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fixtureBytes } from '../reader/fixtures/load';
import { storeZip } from '../reader/fixtures/store-zip';
import { memoryStorage } from '../storage/opfs';
import { createLibrary } from '../storage/library';
import type { R2Config } from '../types';
import { importSeriesFolders, listSeriesFolders } from './r2';

// A REAL HTTP server (node:http on port 0) that speaks just enough of S3 path-style:
// ListObjectsV2 with pagination, and GET of one object. Signatures are not checked.
// It decodes the request path exactly once, so a key the client double-encoded does not match.

const BUCKET = 'shelf';
const SECRET = 'secret-value-that-must-never-leak';
const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);
const cbz = (tag: string) => storeZip({ '1.jpg': bytes(tag) });

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

interface FakeOpts {
  pageSize?: number;
  /** keys that are listed but whose download answers 500 */
  failGet?: string[];
}

/** Runs `fn` against a fresh server holding `objects`; the server is closed afterwards. */
async function withS3<T>(objects: Record<string, Uint8Array>, opts: FakeOpts, fn: (cfg: R2Config) => Promise<T>): Promise<T> {
  const pageSize = opts.pageSize ?? 2;
  const keys = Object.keys(objects).sort();
  const failGet = new Set(opts.failGet ?? []);
  const srv: Server = createServer((req, res) => {
    const send = (status: number, type: string, body: string | Uint8Array) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (req.method !== 'GET') return send(405, 'text/plain', 'method not allowed');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, bucket, ...segments] = url.pathname.split('/');
    if (bucket !== BUCKET) return send(404, 'text/plain', 'no such bucket');

    if (segments.length === 0) {
      if (!url.searchParams.has('list-type')) return send(400, 'text/plain', 'expected list-type=2');
      const prefix = url.searchParams.get('prefix') ?? '';
      const matching = keys.filter((k) => k.startsWith(prefix));
      const start = Number(url.searchParams.get('continuation-token') ?? 0);
      const page = matching.slice(start, start + pageSize);
      const more = start + pageSize < matching.length;
      const contents = page.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${objects[k]!.length}</Size></Contents>`).join('');
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
        `<Name>${BUCKET}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys>` +
        `<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : ''}` +
        `${contents}</ListBucketResult>`;
      return send(200, 'application/xml', xml);
    }

    let key: string;
    try {
      key = segments.map((s) => decodeURIComponent(s)).join('/');
    } catch {
      return send(400, 'text/plain', 'bad path');
    }
    if (failGet.has(key)) return send(500, 'text/plain', 'boom');
    const data = objects[key];
    return data ? send(200, 'application/octet-stream', data) : send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  try {
    return await fn({ endpoint: `http://127.0.0.1:${port}`, accountId: 'acc', bucket: BUCKET, accessKeyId: 'AKIA_TEST_ID', secretAccessKey: SECRET });
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
}

/** A library over a fresh in-memory store, as the `add` callback of an import. */
function library() {
  const fs = memoryStorage();
  let t = 1000;
  const lib = createLibrary(fs, () => t++);
  return { fs, lib, add: (file: File, series: string) => lib.addBook(file, { series }) };
}

describe('listSeriesFolders: which bucket keys are series books', () => {
  it('groups by the first folder, skips app data, root files and non-books, and sorts naturally', async () => {
    const objects = {
      'Lord of the Mysteries/Vol 10.cbz': cbz('10'),
      'Lord of the Mysteries/Vol 2.cbz': cbz('2'),
      'Lord of the Mysteries/Vol 1.cbz': cbz('1'),
      'Lord of the Mysteries/notes.txt': bytes('not a book'),
      'Other/Only.epub': fixtureBytes('book-en.epub'),
      'Sub/Deep/Vol 3.epub': fixtureBytes('book-ja.epub'),
      'root.epub': fixtureBytes('book-en.epub'),
      'settings.json': bytes('{}'),
      'books/abc.epub': fixtureBytes('book-en.epub'),
      'meta/abc.json': bytes('{}'),
      'progress/abc.json': bytes('{}'),
      'annotations/abc.json': bytes('{}'),
    };
    const got = await withS3(objects, {}, (cfg) => listSeriesFolders(cfg));
    expect(got).toEqual([
      { series: 'Lord of the Mysteries', keys: ['Lord of the Mysteries/Vol 1.cbz', 'Lord of the Mysteries/Vol 2.cbz', 'Lord of the Mysteries/Vol 10.cbz'] },
      { series: 'Other', keys: ['Other/Only.epub'] },
      { series: 'Sub', keys: ['Sub/Deep/Vol 3.epub'] },
    ]);
  });

  it('folder names keep their exact spelling: two spellings are two series', async () => {
    const objects = { 'Naruto/1.cbz': cbz('a'), 'naruto/1.cbz': cbz('b') };
    const got = await withS3(objects, {}, (cfg) => listSeriesFolders(cfg));
    expect(got.map((s) => s.series).sort()).toEqual(['Naruto', 'naruto']);
  });

  it('an empty bucket has no series', async () => {
    expect(await withS3({}, {}, (cfg) => listSeriesFolders(cfg))).toEqual([]);
  });
});

describe('importSeriesFolders: download each book and add it under its folder', () => {
  it('imports only the volumes, each with the folder name as its series', async () => {
    const objects = {
      'Lord of the Mysteries/Vol 01.cbz': cbz('one'),
      'Lord of the Mysteries/Vol 02.cbz': cbz('two'),
      'Lord of the Mysteries/Vol 03.epub': fixtureBytes('book-en.epub'),
      'Lord of the Mysteries/notes.txt': bytes('not a book'),
      'Root.epub': fixtureBytes('book-ja.epub'),
      'settings.json': bytes('{}'),
      'books/app.epub': fixtureBytes('book-ja.epub'),
    };
    const { lib, add } = library();
    const result = await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add));
    expect(result).toEqual({ books: 3, series: 1, failed: [] });
    const books = await lib.listBooks();
    expect(books).toHaveLength(3);
    expect(books.map((b) => b.series)).toEqual(['Lord of the Mysteries', 'Lord of the Mysteries', 'Lord of the Mysteries']);
  });

  it('two folders make two series', async () => {
    const objects = { 'Alpha/1.cbz': cbz('a1'), 'Alpha/2.cbz': cbz('a2'), 'Beta/1.epub': fixtureBytes('book-en.epub') };
    const { lib, add } = library();
    const result = await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add));
    expect(result).toEqual({ books: 3, series: 2, failed: [] });
    expect((await lib.listBooks()).map((b) => b.series).sort()).toEqual(['Alpha', 'Alpha', 'Beta']);
  });

  it('importing twice adds nothing new and keeps the series', async () => {
    const objects = { 'Alpha/1.cbz': cbz('a1'), 'Alpha/2.cbz': cbz('a2') };
    const { lib, add } = library();
    await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add));
    const before = await lib.listBooks();
    const again = await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add));
    expect(again.failed).toEqual([]);
    const after = await lib.listBooks();
    expect(after.map((b) => b.id).sort()).toEqual(before.map((b) => b.id).sort());
    expect(after.every((b) => b.series === 'Alpha')).toBe(true);
  });

  it('a book added earlier without a series gets the folder as its series', async () => {
    const { lib, add } = library();
    await lib.addBook(new File([fixtureBytes('book-en.epub')], 'loose.epub'));
    await withS3({ 'Beta/Vol 3.epub': fixtureBytes('book-en.epub') }, {}, (cfg) => importSeriesFolders(cfg, add));
    expect((await lib.listBooks()).map((b) => b.series)).toEqual(['Beta']);
  });

  it('a corrupt book is listed in failed by its key and the rest still import', async () => {
    const objects = { 'Broken/Vol 1.epub': fixtureBytes('corrupt.epub'), 'Broken/Vol 2.cbz': cbz('ok') };
    const { lib, add } = library();
    const result = await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add));
    expect(result).toEqual({ books: 1, series: 1, failed: ['Broken/Vol 1.epub'] });
    expect((await lib.listBooks()).map((b) => b.series)).toEqual(['Broken']);
  });

  it('a failed download is recorded by key without the credentials, and the rest still import', async () => {
    const objects = { 'Flaky/Vol 1.cbz': cbz('1'), 'Flaky/Vol 2.cbz': cbz('2') };
    const { add } = library();
    const result = await withS3(objects, { failGet: ['Flaky/Vol 1.cbz'] }, (cfg) => importSeriesFolders(cfg, add));
    expect(result).toEqual({ books: 1, series: 1, failed: ['Flaky/Vol 1.cbz'] });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('reports progress once per finished book, ending at the total', async () => {
    const objects = {
      'P/1.cbz': cbz('1'),
      'P/2.cbz': cbz('2'),
      'P/3.cbz': cbz('3'),
      'Q/1.epub': fixtureBytes('book-en.epub'),
    };
    const { add } = library();
    const calls: [number, number][] = [];
    await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add, (done, total) => calls.push([done, total])));
    expect(calls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it('reads every page of a long bucket', async () => {
    const objects: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 7; i++) objects[`Long/Vol ${i}.cbz`] = cbz(`v${i}`);
    objects['Other/x.cbz'] = cbz('x');
    const { lib, add } = library();
    const result = await withS3(objects, { pageSize: 2 }, (cfg) => importSeriesFolders(cfg, add));
    expect(result).toEqual({ books: 8, series: 2, failed: [] });
    expect(await lib.listBooks()).toHaveLength(8);
  });

  it('keys with spaces, unicode, #, &, +, %, and parentheses are requested exactly once encoded', async () => {
    const objects = {
      'Tom & Jerry #2 + 日本語/Vol 1 (x) #3 & 4+5.cbz': cbz('a'),
      'Tom & Jerry #2 + 日本語/第 2 巻 ＆ %.cbz': cbz('b'),
      '100% Pure/Vol 1 ñandú.cbz': cbz('c'),
    };
    const { lib, add } = library();
    const result = await withS3(objects, {}, (cfg) => importSeriesFolders(cfg, add));
    expect(result).toEqual({ books: 3, series: 2, failed: [] });
    expect((await lib.listBooks()).map((b) => b.series).sort()).toEqual(['100% Pure', 'Tom & Jerry #2 + 日本語', 'Tom & Jerry #2 + 日本語'].sort());
  });

  it('an empty bucket imports nothing', async () => {
    const { add } = library();
    expect(await withS3({}, {}, (cfg) => importSeriesFolders(cfg, add))).toEqual({ books: 0, series: 0, failed: [] });
  });
});
