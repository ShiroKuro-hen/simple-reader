// The service worker. Built to dist/sw.js by the plugin in vite.config.ts, which fills in __PRECACHE__.
// Decisions (what to cache, what to leave alone) live in policy.ts; this file only moves bytes.
import { cachesToDelete, route } from './policy';

declare const __PRECACHE__: string; // JSON of { urls, version } from buildPrecache
const pre: { urls: string[]; version: string } = JSON.parse(__PRECACHE__);

// No "webworker" lib next to "DOM" in tsconfig, so describe the little of the worker scope we use.
interface FetchEventLike extends Event {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void;
}
const sw = self as unknown as {
  registration: { scope: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: string, fn: (e: any) => void): void;
};

const scope = sw.registration.scope;
const names = { precache: `simple-reader-shell-${pre.version}`, runtime: 'simple-reader-lazy-1' };
const precache = new Set(pre.urls);

sw.addEventListener('install', (e: ExtendableEventLike) => {
  // A new version waits (no skipWaiting here) until the page asks for it, so the user decides when to reload.
  e.waitUntil(
    caches.open(names.precache).then((c) => c.addAll(pre.urls.map((u) => new Request(new URL(u, scope).href, { cache: 'reload' })))),
  );
});

sw.addEventListener('activate', (e: ExtendableEventLike) => {
  e.waitUntil(
    caches
      .keys()
      .then((all) => Promise.all(cachesToDelete(all, names).map((n) => caches.delete(n))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('message', (e: MessageEvent) => {
  if (e.data === 'skip-waiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (e: FetchEventLike) => {
  const req = e.request;
  const how = route({ url: req.url, method: req.method, mode: req.mode, scope, precache });
  if (how === 'bypass' || how === 'network') return;
  e.respondWith(answer(how, req));
});

const lookup = { ignoreSearch: true, ignoreVary: true };

async function answer(how: 'shell' | 'precache' | 'runtime', req: Request): Promise<Response> {
  if (how === 'runtime') {
    const cache = await caches.open(names.runtime);
    const hit = await cache.match(req, lookup);
    if (hit) return hit;
    const res = await fetch(req);
    // Stored exactly as received (a host that sends .gz with Content-Encoding keeps doing so): the page copes with both.
    if (res.status === 200) await cache.put(req, res.clone());
    return res;
  }
  const cache = await caches.open(names.precache);
  const hit = await cache.match(how === 'shell' ? scope : req, lookup);
  return hit ?? fetch(req);
}
