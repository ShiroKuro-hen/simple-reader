import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage';
import type { R2Config } from '../types';
import { bucketUrl, pushToR2 } from './r2';

const cfg = (over: Partial<R2Config> = {}): R2Config => ({
  accountId: 'acc123',
  bucket: 'my-bucket',
  accessKeyId: 'AKIA_VISIBLE_ID',
  secretAccessKey: 'super-secret-value',
  ...over,
});

describe('bucketUrl: where the bucket lives', () => {
  it.each([
    ['R2 by default, built from the account id', cfg(), 'https://acc123.r2.cloudflarestorage.com/my-bucket'],
    ['custom endpoint, path-style', cfg({ endpoint: 'http://127.0.0.1:9000' }), 'http://127.0.0.1:9000/my-bucket'],
    ['trailing slashes on the endpoint are ignored', cfg({ endpoint: 'https://s3.example.com//' }), 'https://s3.example.com/my-bucket'],
    ['an empty endpoint (blank form field) means R2', cfg({ endpoint: '' }), 'https://acc123.r2.cloudflarestorage.com/my-bucket'],
  ])('%s', (_n, c, want) => expect(bucketUrl(c)).toBe(want));
});

/** A port nobody listens on: bind to :0, read the number, close. */
async function closedPort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  await new Promise((ok) => srv.close(ok));
  return port;
}

describe('network failure (a closed port, real connection refusal)', () => {
  it('explains the likely CORS cause with the rule to paste, and never leaks the credentials', async () => {
    const storage = memoryStorage();
    await storage.write('settings.json', '{}');
    const c = cfg({ endpoint: `http://127.0.0.1:${await closedPort()}` });
    const err = await pushToR2(c, storage).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err?.message).toContain('Could not reach R2');
    expect(err?.message).toContain('AllowedOrigins');
    expect(err?.message).not.toContain(c.secretAccessKey);
    expect(err?.message).not.toContain(c.accessKeyId);
    expect(String(err?.cause ?? '')).not.toContain(c.secretAccessKey);
  });
});
