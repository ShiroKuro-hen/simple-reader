// Real Chromium (Playwright) against a real Vite dev server and a real EPUB-style XHTML chapter.
// Needs the `playwright` dev dependency and a Chromium; skipped (not failed) when playwright is missing.
// PLAYWRIGHT_DIR / CHROMIUM_PATH override discovery; LIVE=1 also hits the real translation services;
// REAL_EPUB=<path to your own .epub> adds checks on a real book (read in place, never copied).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { largestChapter } from './real-epub';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = (globalThis as any).process.env as Record<string, string | undefined>;
const LIVE = !!env.LIVE;
const REAL_EPUB = env.REAL_EPUB;
const node = (name: string): Promise<any> => import(/* @vite-ignore */ `node:${name}`);

/** The installed playwright devDependency, else PLAYWRIGHT_DIR, else the copy in the npx cache the Playwright MCP uses. */
async function findPlaywright(): Promise<any> {
  const { existsSync, readdirSync } = await node('fs');
  const { homedir } = await node('os');
  const { join } = await node('path');
  const { pathToFileURL } = await node('url');
  try {
    return await import('playwright'); // the installed devDependency
  } catch {
    /* fall back to PLAYWRIGHT_DIR / the npx cache */
  }
  const dirs: string[] = [];
  if (env.PLAYWRIGHT_DIR) dirs.push(env.PLAYWRIGHT_DIR);
  const npx = join(homedir(), 'AppData/Local/npm-cache/_npx');
  for (const d of existsSync(npx) ? readdirSync(npx) : []) dirs.push(join(npx, d, 'node_modules/playwright'));
  const dir = dirs.find((d) => existsSync(join(d, 'index.mjs')));
  return dir ? import(/* @vite-ignore */ pathToFileURL(join(dir, 'index.mjs')).href) : undefined;
}

/** Any Chromium already in Playwright's cache when the revision it wants is not installed (or CHROMIUM_PATH). */
async function findChromium(chromium: any): Promise<string | undefined> {
  const { existsSync, readdirSync } = await node('fs');
  const { homedir } = await node('os');
  const { join } = await node('path');
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = join(homedir(), 'AppData/Local/ms-playwright');
  const found: string[] = (existsSync(cache) ? readdirSync(cache) : []).filter((d: string) => /^chromium-[0-9]+$/.test(d)).sort().reverse();
  return found.map((d) => join(cache, d, 'chrome-win64/chrome.exe')).find(existsSync);
}

const playwright: any = await findPlaywright();

const chapter = new TextDecoder().decode(readFileSync(fileURLToPath(new URL('./browser/chapter.xhtml', import.meta.url))));

describe.skipIf(!playwright)('in a real browser', () => {
  let server: any;
  let browser: any;
  let context: any;
  let page: any;
  let url: string;

  const load = async () => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('window.srReady === true');
  };
  /** Opens the chapter in the iframe, as the reader does, and remembers its document as window.doc. */
  const openChapter = (xhtml = chapter) =>
    page.evaluate(async (x: string) => {
      (window as any).doc = await (window as any).sr.openChapter(x);
      return (window as any).doc.body.innerHTML as string;
    }, xhtml);
  const html = () => page.evaluate('window.doc.body.innerHTML') as Promise<string>;
  const apply = (mode: string) => page.evaluate(`window.sr.applyFurigana(window.doc, ${JSON.stringify(mode)})`);
  const stripRuby = (s: string) => s.replace(/<rt>.*?<\/rt>/g, '').replace(/<\/?ruby>/g, '');

  beforeAll(async () => {
    const { createServer } = await import('vite');
    server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL('../../', import.meta.url)),
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      // pre-bundle the CommonJS kuromoji stack up front so Vite doesn't reload the page mid-test
      optimizeDeps: { include: ['kuroshiro', 'kuroshiro-analyzer-kuromoji', 'kuromoji'] },
    });
    await server.listen();
    url = `${server.resolvedUrls.local[0]}src/lookup/browser/harness.html`;
    browser = await playwright.chromium.launch({ executablePath: await findChromium(playwright.chromium) });
    context = await browser.newContext();
    page = await context.newPage();
    await load();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  describe('applyFurigana on an XHTML chapter in an iframe', () => {
    it('adds ruby to kanji text, leaving links, emphasis and attributes exactly as they were', async () => {
      const original = await openChapter();
      await apply('furigana');
      const after = await html();

      expect(after).toContain('<ruby>猫<rt>ねこ</rt></ruby>');
      expect(after).toContain('<ruby>吾輩<rt>わがはい</rt></ruby>');
      // markup and attributes survive
      expect(after).toContain('<em>ニャーニャー</em>');
      expect(after).toContain('href="notes.xhtml#n1"');
      expect(after).toContain('epub:type="noteref"');
      expect(after).toContain('href="https://example.org/?a=1&amp;b=2"');
      expect(after).toContain('title="書生"');
      expect(after).toContain('alt="猫の絵"');
      // the link text itself got ruby, inside the anchor
      expect(await page.evaluate("window.doc.querySelector('a.ext').querySelector('ruby') !== null")).toBe(true);
      expect(await page.evaluate("window.doc.querySelectorAll('a').length")).toBe(2);
      // visible text apart from annotations is unchanged
      expect(await page.evaluate("[...window.doc.body.querySelectorAll('rt')].reduce((n, rt) => n + rt.textContent.length, 0)")).toBeGreaterThan(20);
      expect(stripRuby(after.replace(/<span [^>]*>/g, '').replace(/<\/span>/g, ''))).toBe(stripRuby(original));
    });

    it('does not touch script, style, pre-existing ruby, textarea or text without kanji', async () => {
      await openChapter();
      await apply('furigana');
      const after = await html();
      expect(after).toContain('<ruby>漢字<rt>かんじ</rt></ruby>'); // untouched, not wrapped again
      expect(after).not.toMatch(/<ruby>(?:(?!<\/ruby>).)*<ruby>/s);
      expect(await page.evaluate("window.doc.querySelector('textarea').innerHTML")).toBe('入力 漢字');
      expect(after).toContain('Only latin and ひらがなとカタカナ here, no kanji at all.');
      expect(await page.evaluate("window.doc.head.querySelector('script').textContent")).toBe("window.__chapterScript = '漢字は触らない';");
      expect(await page.evaluate("window.doc.head.querySelector('style').textContent")).toContain('注: 漢字');
      expect(await page.evaluate("window.doc.querySelector('pre ruby')")).not.toBeNull(); // <pre> is ordinary text
      expect(after).toContain('Hello, world &amp; 1 &lt; 2 の');
    });

    it('is idempotent: applying the same mode twice changes nothing the second time', async () => {
      await openChapter();
      await apply('furigana');
      const once = await html();
      await apply('furigana');
      expect(await html()).toBe(once);
    });

    it("'off' restores the exact original markup", async () => {
      const original = await openChapter();
      await apply('furigana');
      await apply('off');
      expect(await html()).toBe(original);
      await apply('off'); // already off: still fine
      expect(await html()).toBe(original);
    });

    it('switches between furigana and romaji without stacking annotations', async () => {
      const original = await openChapter();
      await apply('furigana');
      expect(await html()).toContain('<rt>ねこ</rt>');
      await apply('romaji');
      const romaji = await html();
      expect(romaji).toContain('<ruby>猫<rt>neko</rt></ruby>');
      expect(romaji).not.toContain('<rt>ねこ</rt>');
      expect(romaji).toContain('<ruby>漢字<rt>かんじ</rt></ruby>'); // the book's own ruby is never rewritten
      await apply('furigana');
      expect(await html()).toContain('<ruby>猫<rt>ねこ</rt></ruby>');
      await apply('off');
      expect(await html()).toBe(original);
    });

    it('when two calls overlap the last one wins', async () => {
      const original = await openChapter();
      await page.evaluate("Promise.all([window.sr.applyFurigana(window.doc, 'furigana'), window.sr.applyFurigana(window.doc, 'romaji')])");
      const after = await html();
      expect(after).toContain('<rt>neko</rt>');
      expect(after).not.toContain('<rt>ねこ</rt>');
      await apply('off');
      expect(await html()).toBe(original);
    });

    it('keeps the page responsive on a long chapter', async () => {
      const paragraph = '<p>吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。</p>\n';
      const long = chapter.replace('<ul>', paragraph.repeat(1500) + '<ul>'); // ~100k characters
      const original = await openChapter(long);
      const { worstGap, ms, rubies } = await page.evaluate(async () => {
        let worst = 0;
        let last = performance.now();
        const timer = setInterval(() => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
        }, 5);
        const start = performance.now();
        await (window as any).sr.applyFurigana((window as any).doc, 'furigana');
        clearInterval(timer);
        return { worstGap: worst, ms: performance.now() - start, rubies: (window as any).doc.querySelectorAll('ruby').length };
      });
      console.info(`long chapter: ${Math.round(ms)} ms, worst main-thread gap ${Math.round(worstGap)} ms, ${rubies} ruby`);
      expect(rubies).toBeGreaterThan(1500 * 4);
      expect(worstGap).toBeLessThan(200);
      await apply('off');
      expect(await html()).toBe(original);
    }, 120_000);
  });

  describe.skipIf(!REAL_EPUB)('on a real book (REAL_EPUB, read in place)', () => {
    it('applyFurigana on a long chapter without kanji is a cheap no-op that leaves the markup alone', async () => {
      const original = await openChapter(await largestChapter(REAL_EPUB!));
      const { ms, spans } = await page.evaluate(async () => {
        const start = performance.now();
        await (window as any).sr.applyFurigana((window as any).doc, 'furigana');
        return { ms: performance.now() - start, spans: (window as any).doc.querySelectorAll('[data-sr-furi], ruby').length };
      });
      console.info(`real chapter: ${original.length} chars of markup, furigana pass ${Math.round(ms)} ms`);
      expect(spans).toBe(0);
      expect(await html()).toBe(original);
      expect(ms).toBeLessThan(1000);
    }, 60_000);

    it.skipIf(!LIVE)('LIVE: looks up words taken from the chapter, with their paragraph as context', async () => {
      await openChapter(await largestChapter(REAL_EPUB!));
      // a handful of mid-length words from the middle of the chapter; only words are used, nothing is stored
      const picks: { word: string; context: string }[] = await page.evaluate(() => {
        // one paragraph = one context; the page DOM is the only place the book text is held
        const paragraphs: string[] = [...(window as any).doc.querySelectorAll('p')]
          .map((p: any) => p.textContent as string)
          .filter((t) => t.length > 40 && t.length < 300);
        const out: { word: string; context: string }[] = [];
        for (let i = Math.floor(paragraphs.length / 2); out.length < 4 && i < paragraphs.length; i += 10) {
          const word = paragraphs[i]!.split(' ').find((w) => /^[a-z]{6,10}$/.test(w));
          if (word) out.push({ word, context: paragraphs[i]! });
        }
        return out;
      });
      expect(picks.length).toBeGreaterThan(0);
      for (const { word, context } of picks) {
        const { ok, error } = await page.evaluate(([w, c]: string[]) => (window as any).sr.lookup(w, c), [word, context]);
        expect(error).toBeUndefined();
        expect(['en', 'es']).toContain(ok.lang); // the book's language decides; a Spanish edition is looked up in Spanish
        if (ok.lang === 'en') expect(ok.translation).toBeTruthy();
        else expect(ok.definitions.length).toBeGreaterThan(0);
        console.info(`lookup ${word} -> ${ok.translation} (${ok.definitions.length} definitions, ${ok.source})`);
      }
    }, 120_000);
  });

  describe('lookup in the browser', () => {
    it('reads and defines a Japanese word offline: kuromoji and JMdict load from ./dict', async () => {
      await context.setOffline(false);
      const { ok } = await page.evaluate("window.sr.lookup('猫')");
      expect(ok).toMatchObject({ word: '猫', lang: 'ja', reading: 'ねこ', romaji: 'neko', translation: 'gato', source: 'JMdict (es)' });
      expect(ok.definitions[0]).toBe('gato');
    }, 60_000);

    it('keeps results across a reload through localStorage', async () => {
      await load();
      const cached = await page.evaluate("window.sr.cacheGet('猫')");
      expect(cached).toMatchObject({ reading: 'ねこ' });
    });

    it('caps the stored cache and drops the oldest entries', async () => {
      await page.evaluate(() => {
        for (let i = 0; i < 320; i++) (window as any).sr.cacheSet(`word${i}`, { word: `word${i}`, lang: 'en', definitions: [], source: 't' });
      });
      await load();
      expect(await page.evaluate("window.sr.cacheGet('word0')")).toBeUndefined();
      expect(await page.evaluate("window.sr.cacheGet('word319')")).toMatchObject({ word: 'word319' });
      expect(await page.evaluate("JSON.parse(localStorage.getItem('sr.lookup.v1')).word300.word")).toBe('word300');
      expect(await page.evaluate("Object.keys(JSON.parse(localStorage.getItem('sr.lookup.v1'))).length")).toBe(300);
    });

    it('survives blocked or corrupt localStorage', async () => {
      await page.evaluate("localStorage.setItem('sr.lookup.v1', '{not json')");
      await load();
      expect(await page.evaluate("window.sr.cacheGet('猫')")).toBeUndefined();
      expect(await page.evaluate("window.sr.cacheSet('x', { word: 'x', lang: 'en', definitions: [], source: 't' }); window.sr.cacheGet('x').word")).toBe('x');
    });

    it('answers with a typed offline error when there is no connection and nothing local to say', async () => {
      await context.setOffline(true);
      try {
        const { error } = await page.evaluate("window.sr.lookup('lighthouse', 'The lighthouse was on the hill.')");
        expect(error).toMatchObject({ code: 'offline' });
      } finally {
        await context.setOffline(false);
      }
    }, 60_000);

    it('still reads Japanese offline once the dictionaries are loaded, and says honestly that the translation is missing', async () => {
      await page.evaluate("window.sr.lookup('猫')"); // loads kuromoji and JMdict (the page was reloaded by earlier tests)
      await context.setOffline(true);
      try {
        const { ok } = await page.evaluate("window.sr.lookup('吾輩は猫である')");
        expect(ok).toMatchObject({ lang: 'ja', reading: 'わがはいはねこである', romaji: 'wagahaiwanekodearu' });
        expect(ok.translation).toBeUndefined();
        expect(ok.definitions.length).toBe(1);
      } finally {
        await context.setOffline(false);
      }
    }, 60_000);

    it('rejects an empty selection', async () => {
      expect((await page.evaluate("window.sr.lookup('  “ ”  ')")).error).toMatchObject({ code: 'empty' });
    });

    it.skipIf(!LIVE)('LIVE: English word -> Spanish translation and Spanish definitions', async () => {
      const { ok } = await page.evaluate("window.sr.lookup('house', 'They bought a house by the sea.')");
      expect(ok).toMatchObject({ lang: 'en', translation: 'casa' });
      expect(ok.definitions.length).toBeGreaterThan(0);
      expect(ok.source).toContain('wiktionary');
    }, 60_000);

    it.skipIf(!LIVE)('LIVE: Spanish word -> Spanish definition', async () => {
      const { ok } = await page.evaluate("window.sr.lookup('casa', 'La casa de mi abuela es muy grande.')");
      expect(ok).toMatchObject({ lang: 'es', source: 'es.wiktionary.org' });
      expect(ok.definitions[0]).toBe('Edificación destinada a vivienda.');
    }, 60_000);

    it.skipIf(!LIVE)('LIVE: Japanese word without Spanish gloss -> translated English glosses; sentence -> translation', async () => {
      const sentence = (await page.evaluate("window.sr.lookup('吾輩は猫である')")).ok;
      expect(sentence.translation.toLowerCase()).toContain('gato');
      const word = (await page.evaluate("window.sr.lookup('薄暗い')")).ok;
      expect(word).toMatchObject({ lang: 'ja', reading: 'うすぐらい' });
      expect(word.translation).toBeTruthy();
    }, 60_000);
  });
});
