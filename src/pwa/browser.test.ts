// The installable, offline app in a real Chromium: a real production build (service worker included), served by Vite's
// preview server under a sub-path like GitHub Pages, real OPFS, real EPUB fixtures, the network really switched off
// with the browser context's offline mode. Nothing is mocked. Skipped (not failed) when Playwright is not found.
// Slow on purpose (two production builds); REAL_EPUB is not needed here.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as support from '../../e2e/support.mjs';

const pw: any = await support.loadPlaywright();
const FIX = fileURLToPath(new URL('../reader/fixtures/', import.meta.url));
const BASE = '/simple-reader/';
const SHELL = /^simple-reader-shell-/;

describe.skipIf(!pw)('installable offline app in a real browser', { timeout: 120_000 }, () => {
  let tmp = '';
  let dist1 = '';
  let dist2 = '';
  let server: { url: string; close(): Promise<void> };
  let context: any;
  let page: any;
  const errors: string[] = [];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sr-pwa-'));
    dist1 = join(tmp, 'v1');
    dist2 = join(tmp, 'v2');
    await support.buildApp(dist1);
    // "The next deployment": a real second build in which one shell file differs.
    await support.buildApp(dist2, { plugins: [{ name: 'v2-marker', transformIndexHtml: (html: string) => html.replace('</title>', '</title><!-- v2 -->') }] });
    server = await support.servePreview(dist1, BASE);
    context = await support.launchPersistent(pw, join(tmp, 'profile'), { viewport: { width: 1000, height: 760 } });
    page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e: Error) => errors.push(String(e)));
  }, 240_000);

  afterAll(async () => {
    await context?.close();
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  const cacheNames = (): Promise<string[]> => page.evaluate(() => caches.keys());
  const cachedUrls = (name: string): Promise<string[]> =>
    page.evaluate(async (n: string) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
  const waitControlled = () => page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });
  const cards = () => page.locator('.card');
  const installVisible = () => page.getByRole('button', { name: 'Install app' }).isVisible();

  /** Selects `text` inside the rendered book page, as a user drag would. */
  async function selectInBook(text: string) {
    await expect
      .poll(
        async () => {
          for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            const hit = await f
              .evaluate((t: string) => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
                  const i = n.data.indexOf(t);
                  if (i < 0) continue;
                  const r = document.createRange();
                  r.setStart(n, i);
                  r.setEnd(n, i + t.length);
                  const s = getSelection()!;
                  s.removeAllRanges();
                  s.addRange(r);
                  return true;
                }
                return false;
              }, text)
              .catch(() => false);
            if (hit) return true;
          }
          return false;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  }

  async function openBook(title: string) {
    await page.locator(`button.card-open[aria-label^="Open ${title}"]`).click();
    await page.locator('.reader').waitFor();
    await expect.poll(async () => (await page.locator('.chapter').first().textContent())?.trim(), { timeout: 20_000 }).toBeTruthy();
  }
  const backToLibrary = async () => {
    await page.evaluate(() => (location.hash = ''));
    await cards().first().waitFor();
  };

  /** Selects 猫 and returns the lookup popup once it has settled. */
  async function lookupNeko() {
    await selectInBook('猫');
    await page.locator('.popup:not([hidden])').waitFor({ timeout: 10_000 });
    await expect.poll(() => page.locator('.popup').getAttribute('data-state'), { timeout: 30_000 }).not.toBe('loading');
    return {
      state: await page.locator('.popup').getAttribute('data-state'),
      reading: await page.locator('.pop-reading').first().textContent().catch(() => null),
      romaji: await page.locator('.pop-romaji').first().textContent().catch(() => null),
      defs: await page.locator('.pop-defs li').allTextContents().catch(() => []),
    };
  }

  it('installs a service worker under a sub-path that takes control of the page and precaches the shell', async () => {
    await page.goto(server.url);
    await waitControlled();
    const reg = await page.evaluate(async () => {
      const r = (await navigator.serviceWorker.getRegistration())!;
      return { scope: r.scope, script: r.active?.scriptURL };
    });
    expect(reg).toEqual({ scope: server.url, script: `${server.url}sw.js` });

    const shell = (await cacheNames()).filter((n) => SHELL.test(n));
    expect(shell).toHaveLength(1);
    const urls = (await cachedUrls(shell[0]!)).map((u) => u.slice(server.url.length));
    expect(urls).toEqual(expect.arrayContaining(['', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/maskable-512.png']));
    expect(urls.some((u) => /^assets\/index-.*\.js$/.test(u))).toBe(true);
    expect(urls.some((u) => /^assets\/pdf\.worker/.test(u))).toBe(true);
    expect(urls.filter((u) => /^(dict|pdfjs\/cmaps)\//.test(u)), 'big lazy files are not precached').toEqual([]);
  });

  it('meets the installability criteria according to Chromium itself', async () => {
    const cdp = await context.newCDPSession(page);
    const { url, data, errors: manifestErrors } = await cdp.send('Page.getAppManifest');
    expect(manifestErrors).toEqual([]);
    expect(url).toBe(`${server.url}manifest.webmanifest`);
    const manifest = JSON.parse(data);
    for (const icon of manifest.icons) {
      const res = await context.request.get(new URL(icon.src, url).href);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type'], icon.src).toContain(icon.type.replace('image/svg+xml', 'svg'));
    }
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
  });

  // Headless Chromium on Linux (GitHub runners) never raises beforeinstallprompt; desktop Chromium does.
  it.skipIf(!!(globalThis as any).process.env.CI)('shows "Install app" when Chromium itself reports the app installable, and hides it once installed', async () => {
    // A real profile (not incognito) on a page with this manifest and worker: Chromium fires the real beforeinstallprompt.
    await expect.poll(installVisible, { timeout: 20_000 }).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect.poll(installVisible).toBe(false);
  });

  it('shows "Install app" on a beforeinstallprompt event, suppresses the browser infobar, and prompts only once', async () => {
    // The browser's own event (dispatched by hand, since a real prompt would open a native window).
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as any;
      (window as any).prompted = 0;
      e.prompt = async () => void ((window as any).prompted += 1);
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
      return e.defaultPrevented; // the browser's own mini-infobar is suppressed
    });
    expect(prevented).toBe(true);
    await expect.poll(installVisible).toBe(true);
    await page.getByRole('button', { name: 'Install app' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).prompted)).toBe(1);
    await expect.poll(installVisible).toBe(false); // the event is single-use
  });

  it('imports books, then looks a Japanese word up online (this is what fills the offline dictionary cache)', async () => {
    await page.setInputFiles('input[type=file]', [`${FIX}book-en.epub`, `${FIX}book-ja.epub`]);
    await expect.poll(() => cards().count(), { timeout: 20_000 }).toBe(2);
    await openBook('吾輩は猫である');
    const r = await lookupNeko();
    expect(r.state).toBe('result');
    expect(r.reading).toBe('ねこ');
    expect(r.romaji).toBe('neko');
    await backToLibrary();

    const lazy = await cachedUrls('simple-reader-lazy-1');
    const rel = lazy.map((u) => u.slice(server.url.length));
    expect(rel).toEqual(expect.arrayContaining(['dict/jmdict.json.gz', 'dict/base.dat.gz', 'dict/check.dat.gz']));
  }, 90_000);

  it('never stores third-party answers (translation / dictionary APIs) as app files', async () => {
    for (const name of await cacheNames())
      for (const u of await cachedUrls(name)) expect(new URL(u).origin, `${name}: ${u}`).toBe(new URL(server.url).origin);
  });

  it('offline: the app shell loads, the imported library is there and a book opens and turns pages', async () => {
    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => cards().count(), { timeout: 20_000 }).toBe(2);
    await openBook('The Lighthouse');
    const pct = () => page.locator('.pct').first().textContent();
    const first = await pct();
    let turned = false;
    for (let i = 0; i < 12 && !turned; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
      turned = (await pct()) !== first;
    }
    expect(turned, `page did not turn offline, still at ${first}`).toBe(true);
    await backToLibrary();
  }, 90_000);

  it('offline: a Japanese lookup still gives reading, romaji and a JMdict gloss (dictionary from the cache)', async () => {
    await openBook('吾輩は猫である');
    const r = await lookupNeko();
    expect(r.state).toBe('result');
    expect(r.reading).toBe('ねこ');
    expect(r.romaji).toBe('neko');
    expect(r.defs.length).toBeGreaterThan(0);
    await backToLibrary();
  }, 90_000);

  it('offline: the gzipped dictionary comes out of the cache byte for byte as it is on disk', async () => {
    const disk = createHash('sha256').update(gunzipSync(readFileSync(join(fileURLToPath(new URL('../../public/dict/', import.meta.url)), 'jmdict.json.gz')))).digest('hex');
    const fromCache = await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('dict/jmdict.json.gz')).arrayBuffer());
      // A host that adds Content-Encoding: gzip hands us the decoded bytes; one that does not hands us the gzip: accept both.
      const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : bytes;
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), (b) => b.toString(16).padStart(2, '0')).join('');
    });
    expect(fromCache).toBe(disk);
    await context.setOffline(false);
  });

  it('a new deployment installs in the background, waits, and the toast "Update available - Reload" applies it', async () => {
    await page.goto(server.url);
    await waitControlled();
    const before = (await cacheNames()).filter((n) => SHELL.test(n));
    expect(before).toHaveLength(1);

    support.deploy(dist2, dist1); // the new build goes live on the server
    await page.evaluate(async () => void (await (await navigator.serviceWorker.getRegistration())!.update()));
    const toast = page.locator('.update-toast');
    await toast.waitFor({ timeout: 20_000 });
    expect(await toast.textContent()).toContain('Update available');

    // Waiting, not applied: the old shell is still what the page gets, and both versions are on disk for a moment.
    const mid = await page.evaluate(async () => ({
      waiting: !!(await navigator.serviceWorker.getRegistration())!.waiting,
      index: await (await fetch('index.html')).text(),
    }));
    expect(mid.waiting).toBe(true);
    expect(mid.index).not.toContain('<!-- v2 -->');
    expect((await cacheNames()).filter((n) => SHELL.test(n))).toHaveLength(2);

    await Promise.all([page.waitForEvent('load'), toast.getByRole('button', { name: 'Reload' }).click()]);
    await waitControlled();
    await expect.poll(async () => (await cacheNames()).filter((n) => SHELL.test(n)).length).toBe(1);
    const after = (await cacheNames()).filter((n) => SHELL.test(n));
    expect(after[0]).not.toBe(before[0]);
    expect(await page.evaluate(async () => (await fetch('index.html')).text())).toContain('<!-- v2 -->');
    expect(await page.locator('.update-toast').count()).toBe(0);
    // The big dictionary cache is not tied to the app version and survives.
    expect(await cacheNames()).toContain('simple-reader-lazy-1');
    expect(await cards().count()).toBe(2);
  }, 90_000);

  it('raised no uncaught page errors', () => expect(errors).toEqual([]));
});
