// Optional backup/sync to the user's own Cloudflare R2 bucket (S3 API).
// This file is only I/O (signing, HTTP, listing, copying). Every decision about
// WHAT to copy lives in ./plan.ts. Credentials are never logged or put in errors.
//
// ponytail: this network layer has no automated test (no MinIO/docker daemon was
// available to run a real S3). Only ./plan.ts and parseList are covered; verify
// against a real bucket by hand before relying on it.
import { AwsClient } from 'aws4fetch';
import type { R2Config, Storage } from '../types';
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

// --- the bucket ---------------------------------------------------------------------
function bucket(cfg: R2Config) {
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto' });
  const base = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`;
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

  async function call(method: string, url: string, body?: Uint8Array): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(await client.sign(url, { method, body: body as BodyInit | undefined }));
    } catch {
      throw new Error(
        'Could not reach R2 (network error). Most likely the bucket has no CORS rule for this app. ' +
          'Add this in the R2 dashboard (bucket > Settings > CORS policy):\n' + describeCors(),
      );
    }
    if (!res.ok && res.status !== 404) {
      const hint = res.status === 403 ? ' (check the API token has Object Read & Write and the keys are right)' : '';
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
      const res = await call('GET', `${base}/${enc(path)}`);
      return res.status === 404 ? null : new Uint8Array(await res.arrayBuffer());
    },
    async put(path: string, data: Uint8Array): Promise<void> {
      await call('PUT', `${base}/${enc(path)}`, data);
    },
  };
}

// --- executor: snapshot both sides, ask the domain, copy ------------------------------
const FILE_PREFIXES = ['meta/', 'progress/', 'settings.json'];
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
  if (direction === 'push') {
    for (const p of plan.upload) {
      const data = await storage.read(p);
      if (data) await r2.put(p, data);
    }
    return plan.upload.length;
  }
  for (const p of plan.download) {
    const data = await r2.get(p);
    if (data) await storage.write(p, data);
  }
  return plan.download.length;
}

export async function pushToR2(cfg: R2Config, storage: Storage): Promise<{ uploaded: number }> {
  return { uploaded: await run('push', cfg, storage) };
}

export async function pullFromR2(cfg: R2Config, storage: Storage): Promise<{ downloaded: number }> {
  return { downloaded: await run('pull', cfg, storage) };
}
