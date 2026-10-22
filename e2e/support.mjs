// Shared by the real-browser specs and tools: find Playwright and a Chromium without installing anything new.
// PLAYWRIGHT_DIR / CHROMIUM_PATH override discovery (same convention as src/lookup/browser.test.ts).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The playwright module, or undefined when none can be found (specs then skip instead of failing). */
export async function loadPlaywright() {
  const dirs = [];
  if (process.env.PLAYWRIGHT_DIR) dirs.push(process.env.PLAYWRIGHT_DIR);
  const npx = join(homedir(), 'AppData/Local/npm-cache/_npx');
  for (const d of existsSync(npx) ? readdirSync(npx) : []) dirs.push(join(npx, d, 'node_modules/playwright'));
  try {
    return await import('playwright');
  } catch {
    const dir = dirs.find((d) => existsSync(join(d, 'index.mjs')));
    return dir ? import(pathToFileURL(join(dir, 'index.mjs')).href) : undefined;
  }
}

function chromiumPath(pw) {
  const { chromium } = pw;
  let executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath && !existsSync(chromium.executablePath())) {
    const cache = join(homedir(), 'AppData/Local/ms-playwright');
    const dirs = (existsSync(cache) ? readdirSync(cache) : []).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    executablePath = dirs.map((d) => join(cache, d, 'chrome-win64/chrome.exe')).find(existsSync);
  }
  return executablePath;
}

/** Launches Chromium; falls back to any Chromium in Playwright's cache when the revision it wants is not installed. */
export const launchChromium = (pw, options = {}) => pw.chromium.launch({ executablePath: chromiumPath(pw), ...options });

/** A persistent profile in : unlike browser.newContext() it is not incognito, which Chromium's installability check requires. */
export const launchPersistent = (pw, userDataDir, options = {}) =>
  pw.chromium.launchPersistentContext(userDataDir, { executablePath: chromiumPath(pw), ...options });

// ---- build + serve the real app (shared by the PWA and library specs) --------------------------------------------
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));

/** A real production build of the app (vite.config.ts, service worker included) into `outDir`. */
export async function buildApp(outDir, extra = {}) {
  const { build } = await import('vite');
  // Under vitest NODE_ENV is "test", which would make import.meta.env.DEV true in the bundle (no worker registration).
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root: repoRoot, logLevel: 'silent', mode: 'production', ...extra, build: { outDir, emptyOutDir: true, ...extra.build } });
  } finally {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
  }
}

/** Vite's own static preview server over `outDir`, mounted at `base` ("/" or e.g. "/simple-reader/"). */
export async function servePreview(outDir, base = '/') {
  const { preview } = await import('vite');
  const server = await preview({ root: repoRoot, configFile: false, logLevel: 'silent', base, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
  return { url: new URL(base, new URL(server.resolvedUrls.local[0]).origin).href, close: () => new Promise((r) => server.httpServer.close(r)) };
}

/** Overwrites the served files with another build, like deploying a new version. */
export const deploy = (from, to) => cpSync(from, to, { recursive: true, force: true });
