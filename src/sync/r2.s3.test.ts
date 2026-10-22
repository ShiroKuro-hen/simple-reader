// Integration test of the network layer against a REAL S3 server (MinIO or any S3-compatible one).
// Nothing is mocked: real HTTP, real SigV4 verification, real ListObjectsV2 pagination.
//
//   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_BUCKET=sr-test \
//   S3_TEST_ACCESS_KEY=... S3_TEST_SECRET_KEY=... npm test -- src/sync/r2.s3
//
// Each test creates its own bucket "<S3_TEST_BUCKET>-<random>" so runs never see each other's data.
// Skipped (so `npm test` stays green and offline) when S3_TEST_ENDPOINT is unset.
import { AwsClient } from 'aws4fetch';
import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage';
import type { Annotation, R2Config, Storage } from '../types';
import { pullFromR2, pushToR2 } from './r2';

const env = process.env;
const ENDPOINT = env.S3_TEST_ENDPOINT;
const BASE_BUCKET = env.S3_TEST_BUCKET ?? 'sr-test';
const ACCESS = env.S3_TEST_ACCESS_KEY ?? '';
const SECRET = env.S3_TEST_SECRET_KEY ?? '';

const enc = new TextEncoder();
const dec = new TextDecoder();
const j = (o: object) => JSON.stringify(o);

async function freshBucket(): Promise<R2Config> {
  const bucket = `${BASE_BUCKET}-${Math.random().toString(16).slice(2, 10)}`.toLowerCase();
  const res = await new AwsClient({ accessKeyId: ACCESS, secretAccessKey: SECRET, service: 's3', region: 'auto' }).fetch(
    `${ENDPOINT!.replace(/\/+$/, '')}/${bucket}`,
    { method: 'PUT' },
  );
  if (!res.ok) throw new Error(`could not create test bucket: HTTP ${res.status}`);
  return { endpoint: ENDPOINT, accountId: 'unused-with-endpoint', bucket, accessKeyId: ACCESS, secretAccessKey: SECRET };
}

const bytesOf = (seed: number, n = 64) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 256);
const text = async (s: Storage, p: string) => {
  const b = await s.read(p);
  return b ? dec.decode(b) : null;
};

describe.skipIf(!ENDPOINT)('R2 sync against a real S3 server (skipped unless S3_TEST_ENDPOINT is set)', () => {
  it('signs requests: the right keys work, a wrong secret fails with a clear 403 that never prints the keys', async () => {
    const cfg = await freshBucket();
    const dev = memoryStorage();
    await dev.write('settings.json', j({ theme: 'dark' }));
    expect(await pushToR2(cfg, dev)).toEqual({ uploaded: 1 });

    const bad = { ...cfg, secretAccessKey: `${cfg.secretAccessKey}-wrong` };
    for (const op of [() => pushToR2(bad, dev), () => pullFromR2(bad, memoryStorage())]) {
      const err = await op().then(() => undefined, (e: Error) => e);
      expect(err?.message).toMatch(/HTTP 403/);
      expect(err?.message).toMatch(/keys/i);
      for (const secret of [bad.secretAccessKey, cfg.secretAccessKey, cfg.accessKeyId]) expect(err?.message).not.toContain(secret);
    }
  });

  it('a wrong bucket is a clear error, not a silent empty sync', async () => {
    const cfg = { ...(await freshBucket()), bucket: 'sr-does-not-exist-bucket' };
    const err = await pullFromR2(cfg, memoryStorage()).then(() => undefined, (e: Error) => e);
    expect(err?.message).toMatch(/HTTP 404/);
  });

  it('lists past the 1000-key page: 1001 books go up, come down, and a second push uploads nothing', { timeout: 120_000 }, async () => {
    const cfg = await freshBucket();
    const a = memoryStorage();
    const N = 1001;
    for (let i = 0; i < N; i++) await a.write(`books/${String(i).padStart(4, '0')}.epub`, bytesOf(i, 8));

    expect(await pushToR2(cfg, a)).toEqual({ uploaded: N });
    expect(await pushToR2(cfg, a)).toEqual({ uploaded: 0 }); // would re-upload the 1001st if page 2 were never read

    const b = memoryStorage();
    expect(await pullFromR2(cfg, b)).toEqual({ downloaded: N });
    expect(await b.list('books/')).toHaveLength(N);
    expect(Array.from((await b.read('books/1000.epub'))!)).toEqual(Array.from(bytesOf(1000, 8)));
  });

  it('keys with spaces, &, quotes, parentheses, unicode and a plus sign round-trip byte for byte', async () => {
    const cfg = await freshBucket();
    const paths = [
      'books/Tom & Jerry (1) !*\'.epub',
      'books/吾輩は猫である 夏目漱石.epub',
      'books/a+b c%20d.pdf',
      'books/ñandú ★ 𝄞.epub',
    ];
    const a = memoryStorage();
    for (const [i, p] of paths.entries()) await a.write(p, bytesOf(i + 1, 300));
    expect(await pushToR2(cfg, a)).toEqual({ uploaded: paths.length });

    const b = memoryStorage();
    expect(await pullFromR2(cfg, b)).toEqual({ downloaded: paths.length });
    expect((await b.list('books/')).sort()).toEqual([...paths].sort());
    for (const [i, p] of paths.entries()) expect(Array.from((await b.read(p))!)).toEqual(Array.from(bytesOf(i + 1, 300)));
  });

  it('books are copied once: a book already in the bucket is not uploaded or downloaded again', async () => {
    const cfg = await freshBucket();
    const a = memoryStorage();
    await a.write('books/aaa.epub', bytesOf(1, 5000));
    expect(await pushToR2(cfg, a)).toEqual({ uploaded: 1 });
    expect(await pushToR2(cfg, a)).toEqual({ uploaded: 0 });

    const b = memoryStorage();
    await b.write('books/bbb.pdf', bytesOf(2, 5000));
    expect(await pullFromR2(cfg, b)).toEqual({ downloaded: 1 }); // only aaa
    expect(await pullFromR2(cfg, b)).toEqual({ downloaded: 0 });
    expect(await pushToR2(cfg, b)).toEqual({ uploaded: 1 }); // only bbb
    expect(await pullFromR2(cfg, a)).toEqual({ downloaded: 1 });
    expect((await a.list('books/')).sort()).toEqual(['books/aaa.epub', 'books/bbb.pdf']);
  });

  it('meta and progress: the newest edit wins across two devices, in either direction, and settings travel with the push', async () => {
    const cfg = await freshBucket();
    const A = memoryStorage();
    const B = memoryStorage();
    const progress = (fraction: number, updatedAt: number) => j({ bookId: 'x', location: `l${fraction}`, fraction, updatedAt });
    const meta = (addedAt: number, updatedAt?: number, tags?: string[]) => j({ id: 'x', title: 'T', format: 'epub', size: 1, addedAt, updatedAt, tags });

    // A reads to 30%, tags the book; B (older progress, untagged copy with a NEWER addedAt) syncs second.
    await A.write('progress/x.json', progress(0.3, 100));
    await A.write('meta/x.json', meta(10, 100, ['fantasy']));
    await A.write('settings.json', j({ theme: 'sepia' }));
    await B.write('progress/x.json', progress(0.1, 50));
    await B.write('meta/x.json', meta(40));
    expect(await pushToR2(cfg, A)).toEqual({ uploaded: 3 });
    expect(await pushToR2(cfg, B)).toEqual({ uploaded: 0 }); // B is stale on both files: nothing overwrites A's data
    expect(await pullFromR2(cfg, B)).toEqual({ downloaded: 3 }); // B takes progress, tagged meta and settings
    expect(await text(B, 'progress/x.json')).toBe(progress(0.3, 100));
    expect(await text(B, 'meta/x.json')).toBe(meta(10, 100, ['fantasy']));

    // B reads on to 80%; A pulls it, and A's stale copy never goes back up.
    await B.write('progress/x.json', progress(0.8, 200));
    expect(await pushToR2(cfg, B)).toEqual({ uploaded: 1 }); // progress only: meta and settings are identical
    expect(await pullFromR2(cfg, A)).toEqual({ downloaded: 1 });
    expect(await text(A, 'progress/x.json')).toBe(progress(0.8, 200));
    expect(await pushToR2(cfg, A)).toEqual({ uploaded: 0 });
  });

  it('annotations are merged per annotation across two devices: edits, additions and a deletion all survive, nothing resurrects', async () => {
    const cfg = await freshBucket();
    const A = memoryStorage();
    const B = memoryStorage();
    const P = 'annotations/book1.json';
    const ann = (id: string, updatedAt: number, over: Partial<Annotation> = {}): Annotation => ({
      id, bookId: 'book1', kind: 'highlight', location: 'epubcfi(/6/4)', text: 'こんにちは & "quotes"', color: 'yellow', createdAt: 1, updatedAt, ...over,
    });
    const file = (...items: Annotation[]) => j({ bookId: 'book1', items });
    const items = async (s: Storage) => (JSON.parse((await text(s, P))!) as { items: Annotation[] }).items;

    // both devices start from the same x and y
    await A.write(P, file(ann('x', 1), ann('y', 1)));
    expect(await pushToR2(cfg, A)).toEqual({ uploaded: 1 });
    expect(await pullFromR2(cfg, B)).toEqual({ downloaded: 1 });

    // offline: A edits x and adds z; B deletes x (later), and edits y
    await A.write(P, file(ann('x', 5, { note: 'A edit' }), ann('y', 1), ann('z', 6)));
    await B.write(P, file(ann('x', 9, { deleted: true }), ann('y', 8, { color: 'pink' })));

    // B syncs first (push uploads the merge, local B already has it), then A
    expect(await pushToR2(cfg, B)).toEqual({ uploaded: 1 });
    expect(await pushToR2(cfg, A)).toEqual({ uploaded: 1 });
    expect(await pullFromR2(cfg, B)).toEqual({ downloaded: 1 });

    for (const dev of [A, B]) {
      const got = await items(dev);
      expect(got.map((i) => [i.id, !!i.deleted, i.color, i.note])).toEqual([
        ['x', true, 'yellow', undefined], // deletion at t=9 beats A's edit at t=5; the tombstone is kept
        ['y', false, 'pink', undefined], // B's later edit
        ['z', false, 'yellow', undefined], // A's addition
      ]);
    }
    // converged: nothing left to do in either direction, from either device
    for (const dev of [A, B]) {
      expect(await pushToR2(cfg, dev)).toEqual({ uploaded: 0 });
      expect(await pullFromR2(cfg, dev)).toEqual({ downloaded: 0 });
    }
  });
});
