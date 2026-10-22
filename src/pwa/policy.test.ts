import { describe, expect, it } from 'vitest';
import { buildPrecache, cachesToDelete, route } from './policy';

const built = [
  { path: 'index.html', digest: 'a1' },
  { path: 'manifest.webmanifest', digest: 'm1' },
  { path: 'icon.svg', digest: 'i1' },
  { path: 'icons/icon-192.png', digest: 'p1' },
  { path: 'assets/index-Bg-qIjMp.js', digest: 'j1' },
  { path: 'assets/pdf.worker.min-CjEcRF4W.mjs', digest: 'w1' },
  { path: 'assets/index-Bg-qIjMp.js.map', digest: 'x1' },
  { path: 'sw.js', digest: 's1' },
  { path: 'dict/base.dat.gz', digest: 'd1' },
  { path: 'dict/jmdict.json.gz', digest: 'd2' },
  { path: 'pdfjs/cmaps/78-H.bcmap', digest: 'c1' },
];

describe('buildPrecache', () => {
  const { urls, version } = buildPrecache(built);

  it('precaches the app shell, hashed assets and icons, plus the scope itself for navigations', () => {
    expect(urls).toEqual([
      './',
      'assets/index-Bg-qIjMp.js',
      'assets/pdf.worker.min-CjEcRF4W.mjs',
      'icon.svg',
      'icons/icon-192.png',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('leaves out what is big and lazy (dictionaries, cmaps), the worker itself and source maps', () => {
    for (const skipped of ['sw.js', 'dict/base.dat.gz', 'dict/jmdict.json.gz', 'pdfjs/cmaps/78-H.bcmap', 'assets/index-Bg-qIjMp.js.map'])
      expect(urls).not.toContain(skipped);
  });

  it('has a version that does not depend on file order', () => {
    expect(buildPrecache([...built].reverse()).version).toBe(version);
  });

  it('changes the version when any shell file changes, so old caches get replaced', () => {
    const edit = (path: string, digest: string) => built.map((f) => (f.path === path ? { ...f, digest } : f));
    for (const path of ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'assets/index-Bg-qIjMp.js'])
      expect(buildPrecache(edit(path, 'changed')).version, path).not.toBe(version);
    expect(buildPrecache([...built, { path: 'assets/new-123.js', digest: 'n' }]).version).not.toBe(version);
  });

  it('keeps the version when only lazily cached files change, so a dictionary tweak does not force an app update', () => {
    const edit = (path: string) => built.map((f) => (f.path === path ? { ...f, digest: 'changed' } : f));
    expect(buildPrecache(edit('dict/jmdict.json.gz')).version).toBe(version);
    expect(buildPrecache(edit('sw.js')).version).toBe(version);
  });
});

describe('route', () => {
  const precache = new Set(buildPrecache(built).urls);
  const bases = ['https://shirokuro-hen.github.io/simple-reader/', 'http://localhost:4173/', 'http://127.0.0.1:8080/some/deep/base/'];

  describe.each(bases)('served from %s', (scope) => {
    const r = (rel: string, extra: { method?: string; mode?: string } = {}) =>
      route({ url: new URL(rel, scope).href, method: extra.method ?? 'GET', mode: extra.mode ?? 'cors', scope, precache });
    const origin = new URL(scope).origin;

    it.each([
      ['assets/index-Bg-qIjMp.js', 'precache'],
      ['assets/index-Bg-qIjMp.js?v=2', 'precache'], // query strings do not change what the file is
      ['manifest.webmanifest', 'precache'],
      ['icons/icon-192.png', 'precache'],
      ['dict/base.dat.gz', 'runtime'],
      ['dict/jmdict.json.gz', 'runtime'],
      ['pdfjs/cmaps/78-H.bcmap', 'runtime'],
      ['assets/never-heard-of-it.js', 'network'], // unknown same-origin files are not cached behind the user's back
      ['sw.js', 'bypass'], // the browser updates the worker itself
    ])('%s -> %s', (rel, expected) => expect(r(rel)).toBe(expected));

    it('answers every navigation inside the scope with the cached shell, whatever the path', () => {
      expect(r('', { mode: 'navigate' })).toBe('shell');
      expect(r('?utm=1', { mode: 'navigate' })).toBe('shell');
      expect(r('index.html', { mode: 'navigate' })).toBe('shell');
    });

    it.each(['POST', 'PUT', 'DELETE', 'HEAD'])('never touches %s', (method) => expect(r('assets/index-Bg-qIjMp.js', { method })).toBe('bypass'));

    it('leaves third-party APIs to the network: translation and dictionary lookups are not app files', () => {
      for (const url of [
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=es&dt=t&q=%E7%8C%AB',
        'https://api.mymemory.translated.net/get?q=cat&langpair=en|es',
        'https://es.wiktionary.org/w/api.php?action=query&titles=gato',
        'https://acct.r2.cloudflarestorage.com/bucket/books/x.epub',
      ])
        expect(route({ url, method: 'GET', mode: 'cors', scope, precache }), url).toBe('bypass');
    });

    it('leaves a third-party file with a lookalike path alone', () => {
      expect(route({ url: 'https://cdn.example.com/dict/jmdict.json.gz', method: 'GET', mode: 'cors', scope, precache })).toBe('bypass');
    });

    it('never answers for another app on the same origin', () => {
      expect(route({ url: `${origin}/other-app/dict/jmdict.json.gz`, method: 'GET', mode: 'cors', scope, precache })).toBe(
        scope === `${origin}/` ? 'network' : 'bypass',
      );
      expect(route({ url: `${origin}/other-app/`, method: 'GET', mode: 'navigate', scope, precache })).toBe(scope === `${origin}/` ? 'shell' : 'bypass');
    });
  });
});

describe('cachesToDelete', () => {
  const current = { precache: 'simple-reader-shell-abc', runtime: 'simple-reader-lazy-1' };

  it('deletes older versions of our caches only', () => {
    expect(
      cachesToDelete(
        ['simple-reader-shell-old', 'simple-reader-shell-abc', 'simple-reader-lazy-1', 'simple-reader-lazy-0', 'other-app-cache', 'workbox-precache-v2'],
        current,
      ),
    ).toEqual(['simple-reader-shell-old', 'simple-reader-lazy-0']);
  });
  it('deletes nothing when everything is current', () => expect(cachesToDelete(Object.values(current), current)).toEqual([]));
  it('copes with no caches', () => expect(cachesToDelete([], current)).toEqual([]));
});
