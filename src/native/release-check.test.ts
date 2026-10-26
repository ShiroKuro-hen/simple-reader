import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkForUpdate, isNewer, newestRelease, parseVersion } from './release-check';

describe('parseVersion', () => {
  it('accepts v0.2.0 and 0.2.0', () => {
    expect(parseVersion('v0.2.0')).toEqual([0, 2, 0]);
    expect(parseVersion('10.0.31')).toEqual([10, 0, 31]);
  });
  it.each(['v1', 'v1.2', 'v1.2.3-rc.1', 'latest', '', '1.2.3.4', 'v1.x.0'])('rejects %j', (tag) => {
    expect(parseVersion(tag)).toBeNull();
  });
});

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('0.9.0', '0.10.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.0')).toBe(false);
  });
  it('is false for equal versions', () => expect(isNewer('0.2.0', 'v0.2.0')).toBe(false));
  it('is false when either side does not parse', () => {
    expect(isNewer('dev', '0.2.0')).toBe(false);
    expect(isNewer('0.1.0', 'latest')).toBe(false);
  });
});

describe('newestRelease', () => {
  const rel = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `https://example.test/${tag}`, ...extra });

  it('picks the highest version and strips the leading v', () => {
    expect(newestRelease([rel('v0.2.0'), rel('v0.10.0'), rel('v0.9.1')], '0.2.0')).toEqual({
      version: '0.10.0',
      url: 'https://example.test/v0.10.0',
    });
  });
  it('counts pre-releases, which this project publishes', () => {
    expect(newestRelease([rel('v0.3.0', { prerelease: true })], '0.2.0')?.version).toBe('0.3.0');
  });
  it('hands over the Android APK of the release when it has one, so the phone can download it straight away', () => {
    const assets = [
      { name: 'latest.json', browser_download_url: 'https://example.test/latest.json' },
      { name: 'simple-reader-v0.3.0-android-debug.apk', browser_download_url: 'https://example.test/v0.3.0.apk' },
    ];
    expect(newestRelease([rel('v0.3.0', { assets })], '0.2.0')).toEqual({ version: '0.3.0', url: 'https://example.test/v0.3.0', apk: 'https://example.test/v0.3.0.apk' });
  });

  it('ignores drafts and tags that are not three numeric parts', () => {
    expect(newestRelease([rel('v9.0.0', { draft: true }), rel('v8'), rel('latest'), rel('v0.2.1')], '0.2.0')?.version).toBe('0.2.1');
  });
  it('returns null when nothing is newer than current', () => {
    expect(newestRelease([rel('v0.2.0'), rel('v0.1.0')], '0.2.0')).toBeNull();
  });
  it('returns null for non-array input', () => {
    expect(newestRelease({ tag_name: 'v9.0.0' } as unknown as never[], '0.2.0')).toBeNull();
  });
});

describe('checkForUpdate against a real local server', () => {
  let server: Server;
  let endpoint: string;
  // Each test sets what the fake GitHub answers.
  let answer: { status: number; body: string };

  beforeEach(async () => {
    answer = { status: 200, body: '[]' };
    server = createServer((_req, res) => {
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(answer.body);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases`;
  });

  afterEach(async () => {
    await new Promise((done) => server.close(done));
  });

  const releases = (...tags: string[]) => JSON.stringify(tags.map((tag) => ({ tag_name: tag, html_url: `https://example.test/${tag}` })));

  it('finds a newer release', async () => {
    answer.body = releases('v0.2.0', 'v0.3.0');
    expect(await checkForUpdate('0.2.0', endpoint)).toEqual({ version: '0.3.0', url: 'https://example.test/v0.3.0' });
  });
  it('returns null for the same version', async () => {
    answer.body = releases('v0.2.0');
    expect(await checkForUpdate('0.2.0', endpoint)).toBeNull();
  });
  it('returns null when only older releases exist', async () => {
    answer.body = releases('v0.1.0');
    expect(await checkForUpdate('0.2.0', endpoint)).toBeNull();
  });
  it('returns null on a rate limit (403)', async () => {
    answer = { status: 403, body: releases('v9.0.0') };
    expect(await checkForUpdate('0.2.0', endpoint)).toBeNull();
  });
  it('returns null on invalid JSON', async () => {
    answer.body = '<html>not json</html>';
    expect(await checkForUpdate('0.2.0', endpoint)).toBeNull();
  });
  it('ignores a newer draft', async () => {
    answer.body = JSON.stringify([{ tag_name: 'v9.0.0', html_url: 'https://example.test/draft', draft: true }]);
    expect(await checkForUpdate('0.2.0', endpoint)).toBeNull();
  });
  it('returns null when nothing is listening', async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((done) => closed.close(done));
    expect(await checkForUpdate('0.2.0', `http://127.0.0.1:${port}/releases`)).toBeNull();
  });
});
