import { describe, expect, it } from 'vitest';
import { shouldRegister } from './policy';

describe('shouldRegister', () => {
  const web = { hasServiceWorker: true, tauri: false, protocol: 'https:', dev: false };

  it.each([
    ['https site (GitHub Pages)', web, true],
    ['plain http on localhost (preview)', { ...web, protocol: 'http:' }, true],
    ['inside Tauri: a worker would keep stale bundles across native updates', { ...web, tauri: true }, false],
    ['Tauri on a custom protocol', { ...web, tauri: true, protocol: 'tauri:' }, false],
    ['Tauri even over http (Android/Windows webview origin)', { ...web, tauri: true, protocol: 'http:' }, false],
    ['browser without service workers', { ...web, hasServiceWorker: false }, false],
    ['file: page', { ...web, protocol: 'file:' }, false],
    ['dev server (no worker is built)', { ...web, dev: true, protocol: 'http:' }, false],
  ])('%s -> %s', (_name, env, expected) => expect(shouldRegister(env)).toBe(expected));
});
