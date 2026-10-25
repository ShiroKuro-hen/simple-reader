import { createServer, type Server } from 'node:http';
import type { R2Config } from '../types';

// A REAL HTTP server (node:http on port 0) that speaks just enough of S3 path-style:
// ListObjectsV2 with pagination, GET and PUT of one object. Signatures are not checked.
// It decodes the request path exactly once, so a key the client double-encoded does not match.

export const BUCKET = 'shelf';
export const SECRET = 'secret-value-that-must-never-leak';

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface FakeOpts {
  pageSize?: number;
  /** keys that are listed but whose download answers 500 */
  failGet?: string[];
}

/** Runs `fn` against a fresh server holding `objects` (a PUT adds to it); the server is closed afterwards. */
export async function withS3<T>(objects: Record<string, Uint8Array>, opts: FakeOpts, fn: (cfg: R2Config) => Promise<T>): Promise<T> {
  const pageSize = opts.pageSize ?? 2;
  const failGet = new Set(opts.failGet ?? []);
  const srv: Server = createServer((req, res) => {
    const send = (status: number, type: string, body: string | Uint8Array) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'PUT') return send(405, 'text/plain', 'method not allowed');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, bucket, ...segments] = url.pathname.split('/');
    if (bucket !== BUCKET) return send(404, 'text/plain', 'no such bucket');

    if (segments.length === 0) {
      if (!url.searchParams.has('list-type')) return send(400, 'text/plain', 'expected list-type=2');
      const prefix = url.searchParams.get('prefix') ?? '';
      const matching = Object.keys(objects).sort().filter((k) => k.startsWith(prefix));
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
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        objects[key] = new Uint8Array(Buffer.concat(chunks));
        send(200, 'text/plain', '');
      });
      return;
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
