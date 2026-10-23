// What the service worker does with each request, and what it precaches. Pure: no DOM, no caches, no network.

export interface BuiltFile {
  /** Path inside the build output, forward slashes, no leading slash. */
  path: string;
  /** Any stable hash of the file's content. */
  digest: string;
}

/** Big files fetched on first use and then kept (cache-first): the Japanese dictionaries, PDF character maps and the RAR decoder (.cbr only). */
const LAZY = /^(dict\/|pdfjs\/cmaps\/|assets\/unrar-[^/]+\.wasm$)/;
const NOT_SHELL = /(^sw\.js$|\.map$)/;

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The app shell: every built file except the lazy ones, the worker and source maps. The version changes iff one of them does. */
export function buildPrecache(files: readonly BuiltFile[]): { urls: string[]; version: string } {
  const shell = files.filter((f) => !LAZY.test(f.path) && !NOT_SHELL.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    urls: ['./', ...shell.map((f) => f.path)],
    version: fnv1a(shell.map((f) => `${f.path}:${f.digest}`).join('\n')),
  };
}

export type Route =
  /** Do not call respondWith: the browser handles it (third parties, writes, other apps). */
  | 'bypass'
  /** A page load inside the scope: the cached index.html. */
  | 'shell'
  /** Cache-first from the versioned shell cache. */
  | 'precache'
  /** Cache-first, filled from the network on first use. */
  | 'runtime'
  /** Same-origin but unknown: plain network, nothing stored. */
  | 'network';

export interface RequestInfo {
  url: string;
  method: string;
  mode: string;
  /** The worker's registration scope, e.g. https://user.github.io/simple-reader/ */
  scope: string;
  /** Scope-relative paths from buildPrecache. */
  precache: ReadonlySet<string>;
}

export function route({ url, method, mode, scope, precache }: RequestInfo): Route {
  if (method !== 'GET') return 'bypass';
  const u = new URL(url);
  if (!u.href.startsWith(scope)) return 'bypass'; // other origin, or another app on this origin
  const rel = u.pathname.slice(new URL(scope).pathname.length);
  if (mode === 'navigate') return 'shell';
  if (rel === 'sw.js') return 'bypass';
  if (precache.has(rel)) return 'precache';
  if (LAZY.test(rel)) return 'runtime';
  return 'network';
}

export interface RegisterEnv {
  hasServiceWorker: boolean;
  /** `'__TAURI_INTERNALS__' in window`: in the native app the bundle ships with the app, a worker would only keep stale copies. */
  tauri: boolean;
  /** location.protocol */
  protocol: string;
  /** import.meta.env.DEV: no sw.js is built then. */
  dev: boolean;
}

export const shouldRegister = (e: RegisterEnv): boolean => e.hasServiceWorker && !e.tauri && !e.dev && /^https?:$/.test(e.protocol);

/** Our caches that are not the current ones. Caches of anything else on the same origin are never touched. */
export function cachesToDelete(existing: readonly string[], current: { precache: string; runtime: string }): string[] {
  return existing.filter((n) => n.startsWith('simple-reader-') && n !== current.precache && n !== current.runtime);
}
