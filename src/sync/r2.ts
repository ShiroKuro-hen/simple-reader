// Optional backup/sync to the user's own Cloudflare R2 bucket (S3 API).
// This file is only I/O (signing, HTTP, listing, copying). Every decision about
// WHAT to copy lives in ./plan.ts. Credentials are never logged or put in errors.
//
// The network layer is tested against a REAL S3 server: see r2.s3.test.ts.
import { AwsClient } from 'aws4fetch';
import type { R2Config, Storage } from '../types';
import { seriesFromKey } from '../library/series';
import { planSync, type Direction, type Snapshot } from './plan';

/** The CORS rule the user must paste in the R2 dashboard (Bucket > Settings > CORS policy). */
export function describeCors(origin?: string): string {
  const o = origin ?? (globalThis as { location?: { origin?: string } }).location?.origin ?? 'https://YOUR-APP-ORIGIN';
  return JSON.stringify(
    [{ AllowedOrigins: [o], AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }],
    null,
    2,
  );
}

// --- ListObjectsV2 response parsing (no DOMParser: must also run in node) -------
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  for (let i = xml.indexOf(open); i >= 0; i = xml.indexOf(open, i)) {
    const end = xml.indexOf(close, i);
    if (end < 0) break;
    out.push(xml.slice(i + open.length, end));
    i = end + close.length;
  }
  return out;
}
const unescapeXml = (s: string) =>
  s.split('&lt;').join('<').split('&gt;').join('>').split('&quot;').join('"').split('&apos;').join("'").split('&amp;').join('&');
const text = (xml: string, tag: string) => {
  const b = blocks(xml, tag)[0];
  return b === undefined ? undefined : unescapeXml(b);
};

export function parseList(xml: string): { keys: string[]; next?: string } {
  const keys = blocks(xml, 'Contents').map((c) => text(c, 'Key') ?? '').filter(Boolean);
  return { keys, next: text(xml, 'IsTruncated') === 'true' ? text(xml, 'NextContinuationToken') : undefined };
}

/** Path-style bucket URL: the custom endpoint when set (tests, other S3 servers), else R2's. */
export function bucketUrl(cfg: R2Config): string {
  const host = cfg.endpoint ? cfg.endpoint.replace(/\/+$/, '') : `https://${cfg.accountId}.r2.cloudflarestorage.com`;
  return `${host}/${cfg.bucket}`;
}

// --- the bucket ---------------------------------------------------------------------
function bucket(cfg: R2Config) {
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto' });
  const base = bucketUrl(cfg);
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

  async function call(method: string, url: string, body?: Uint8Array, notFoundOk = false): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(await client.sign(url, { method, body: body as BodyInit | undefined }));
    } catch {
      throw new Error(
        'Could not reach R2 (network error). Most likely the bucket has no CORS rule for this app. ' +
          'Add this in the R2 dashboard (bucket > Settings > CORS policy):\n' + describeCors(),
      );
    }
    if (!res.ok && !(res.status === 404 && notFoundOk)) {
      const hint =
        res.status === 403 ? ' (check the API token has Object Read & Write and the keys are right)' : res.status === 404 ? ' (bucket not found: check the bucket name)' : '';
      throw new Error(`R2 ${method} failed: HTTP ${res.status}${hint}`);
    }
    return res;
  }

  return {
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const q = `list-type=2&prefix=${encodeURIComponent(prefix)}` + (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
        const page = parseList(await (await call('GET', `${base}?${q}`)).text());
        keys.push(...page.keys);
        token = page.next;
      } while (token);
      return keys;
    },
    async get(path: string): Promise<Uint8Array | null> {
      const res = await call('GET', `${base}/${enc(path)}`, undefined, true);
      return res.status === 404 ? null : new Uint8Array(await res.arrayBuffer());
    },
    async put(path: string, data: Uint8Array): Promise<void> {
      await call('PUT', `${base}/${enc(path)}`, data);
    },
  };
}

// --- executor: snapshot both sides, ask the domain, copy ------------------------------
const FILE_PREFIXES = ['meta/', 'progress/', 'annotations/', 'settings.json'];
const utf8 = new TextEncoder();

/** Run `fn` over `items`, a few at a time (books are many and the round trips dominate). */
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}
const PARALLEL = 6;
/** `books/<id>.<ext>` -> `<id>`. */
const bookIdOf = (path: string) => path.slice('books/'.length).replace(/\.[^.]*$/, '');
const dec = new TextDecoder();

interface Side {
  list(prefix: string): Promise<string[]>;
  get(path: string): Promise<Uint8Array | null>;
}

async function snapshot(side: Side): Promise<Snapshot> {
  const books = await side.list('books/');
  const files: Record<string, string> = {};
  for (const prefix of FILE_PREFIXES) {
    for (const p of await side.list(prefix)) {
      if (prefix === 'settings.json' && p !== prefix) continue;
      const data = await side.get(p);
      if (data) files[p] = dec.decode(data);
    }
  }
  return { books, files };
}

async function run(direction: Direction, cfg: R2Config, storage: Storage): Promise<number> {
  const r2 = bucket(cfg);
  const local: Side = { list: (p) => storage.list(p), get: (p) => storage.read(p) };
  const plan = planSync(direction, await snapshot(local), await snapshot(r2));
  // annotations are merged two-way whatever the direction; the count is what this call wrote to the side it syncs TO
  const writes = plan.merge.filter((m) => (direction === 'push' ? m.remote : m.local));
  await pool(plan.merge, PARALLEL, async (m) => {
    if (m.remote) await r2.put(m.path, utf8.encode(m.text));
    if (m.local) await storage.write(m.path, m.text);
  });
  if (direction === 'push') {
    await pool(plan.upload, PARALLEL, async (p) => {
      const data = await storage.read(p);
      if (data) await r2.put(p, data);
    });
    return plan.upload.length + writes.length;
  }
  await pool(plan.download, PARALLEL, async (p) => {
    const data = await r2.get(p);
    if (!data) return;
    await storage.write(p, data);
    // The library shows where each book came from (see cloudIds in storage/library.ts).
    if (p.startsWith('books/')) await storage.write(`origin/${bookIdOf(p)}`, '');
  });
  return plan.download.length + writes.length;
}

export async function pushToR2(cfg: R2Config, storage: Storage): Promise<{ uploaded: number }> {
  return { uploaded: await run('push', cfg, storage) };
}

export async function pullFromR2(cfg: R2Config, storage: Storage): Promise<{ downloaded: number }> {
  return { downloaded: await run('pull', cfg, storage) };
}

// --- folders of plain files in the bucket, imported as series ---------------------------
const naturalOrder = new Intl.Collator(undefined, { numeric: true });
const IMPORT_PARALLEL = 3;

/** Every series book in the bucket (all pages), grouped by folder, in natural order. */
async function seriesGroups(r2: ReturnType<typeof bucket>): Promise<{ series: string; keys: string[] }[]> {
  const groups = new Map<string, string[]>();
  for (const key of await r2.list('')) {
    const hit = seriesFromKey(key);
    if (hit) groups.set(hit.series, [...(groups.get(hit.series) ?? []), key]);
  }
  return [...groups]
    .sort(([a], [b]) => naturalOrder.compare(a, b))
    .map(([series, keys]) => ({ series, keys: keys.sort(naturalOrder.compare) }));
}

export async function listSeriesFolders(cfg: R2Config): Promise<{ series: string; keys: string[] }[]> {
  return seriesGroups(bucket(cfg));
}

/**
 * Downloads each series book and hands it to `add`. A book that fails (download or add) is listed
 * by its key in `failed` and does not stop the others. Errors are not copied into the result,
 * so no credential can end up there.
 */
export async function importSeriesFolders(
  cfg: R2Config,
  add: (file: File, series: string) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ books: number; series: number; failed: string[] }> {
  const r2 = bucket(cfg);
  const items = (await seriesGroups(r2)).flatMap(({ series, keys }) => keys.map((key) => ({ key, series })));
  const imported = new Array<boolean>(items.length);
  let done = 0;
  await pool(
    items.map((item, index) => ({ ...item, index })),
    IMPORT_PARALLEL,
    async ({ key, series, index }) => {
      try {
        const data = await r2.get(key);
        if (!data) throw new Error('missing');
        await add(new File([data as BlobPart], key.slice(key.lastIndexOf('/') + 1)), series);
        imported[index] = true;
      } catch {
        imported[index] = false;
      }
      onProgress?.(++done, items.length);
    },
  );
  const ok = items.filter((_, i) => imported[i]);
  return {
    books: ok.length,
    series: new Set(ok.map((i) => i.series)).size,
    failed: items.filter((_, i) => !imported[i]).map((i) => i.key),
  };
}
