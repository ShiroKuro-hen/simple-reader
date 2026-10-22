// Real-browser tests: the Storage contract on OPFS, the library on OPFS, and openBook with real EPUB/PDF files.
//   node src/reader/e2e/run.mjs
// Needs Playwright (not a repo dependency). Point PLAYWRIGHT_DIR at an install of the `playwright` package;
// it falls back to the copy in the npx cache that the Playwright MCP server uses.
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

function findPlaywright() {
  if (process.env.PLAYWRIGHT_DIR) return process.env.PLAYWRIGHT_DIR;
  const npx = join(homedir(), 'AppData/Local/npm-cache/_npx');
  for (const d of existsSync(npx) ? readdirSync(npx) : [])
    if (existsSync(join(npx, d, 'node_modules/playwright/index.mjs'))) return join(npx, d, 'node_modules/playwright');
  throw new Error('Playwright not found: set PLAYWRIGHT_DIR');
}

const { chromium } = await import(pathToFileURL(join(findPlaywright(), 'index.mjs')).href);
const { createServer } = await import(pathToFileURL(join(repo, 'node_modules/vite/dist/node/index.js')).href);

const server = await createServer({ root: repo, logLevel: 'error', optimizeDeps: { include: ['pdfjs-dist'] } });
await server.listen();
const base = server.resolvedUrls.local[0];
// Use whichever Chromium is already in Playwright's cache if the bundled revision is not installed.
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), 'AppData/Local/ms-playwright');
  const dirs = (existsSync(cache) ? readdirSync(cache) : []).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  return dirs.map((d) => join(cache, d, 'chrome-win64/chrome.exe')).find(existsSync);
}
const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : findChromium() });
const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });

// Observation only: remember which blob: URLs are alive and how many document/window listeners exist.
await context.addInitScript(() => {
  const live = new Set();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => (live.add(create(b)), [...live].at(-1));
  URL.revokeObjectURL = (u) => (live.delete(u), revoke(u));
  window.__liveBlobUrls = () => live.size;
  const counts = {};
  const key = (t, type) => (t === document ? 'document:' : t === window ? 'window:' : null) + type;
  for (const [m, d] of [['addEventListener', 1], ['removeEventListener', -1]]) {
    const orig = EventTarget.prototype[m];
    EventTarget.prototype[m] = function (type, ...rest) {
      const k = key(this, type);
      if (!k.startsWith('null')) counts[k] = (counts[k] ?? 0) + d;
      return orig.call(this, type, ...rest);
    };
  }
  window.__listeners = () => Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== 0));
});

let page;
const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  page = await context.newPage();
  const errors = [];
  page.on('console', (m) => process.env.DEBUG && console.log('      [console]', m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}src/reader/e2e/harness.html`);
    await page.waitForFunction(() => window.srReady, null, { timeout: 30000 });
    await fn();
    assert.deepEqual(errors, [], 'uncaught page errors');
    results.push([name, null]);
    console.log(`ok    ${name}`);
  } catch (e) {
    results.push([name, e]);
    console.log(`FAIL  ${name}\n      ${String(e.message ?? e).split('\n').join('\n      ')}`);
  } finally {
    await page.close();
  }
}

const ev = (fn, arg) => page.evaluate(fn, arg);
const open = (name, o) => ev(([n, o]) => sr.openFixture(n, o).then(() => 0), [name, o]);
const last = () => ev(() => session.relocs.at(-1));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);
/** Runs a navigation and waits for the relocation it causes. */
const step = (op) =>
  ev(async (op) => {
    const n = session.relocs.length;
    await session.handle[op.name](...op.args);
    await sr.waitFor(() => session.relocs.length > n, `relocate after ${op.name}`);
    return session.relocs.at(-1);
  }, op);
const nav = (name, ...args) => step({ name, args });
async function selectWord(word) {
  const r = await ev((w) => sr.rectOf(session, w), word);
  assert.ok(r, `"${word}" is not on screen`);
  await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);
  await ev(() => sr.waitFor(() => session.selects.length > 0, 'a TextSelection'));
  return { sel: await ev(() => session.selects.at(-1)), click: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
}
const THEME = (theme, fontSize = 100, layout = 'auto') => ({ theme, fontSize, furigana: 'off', layout });

// ---- Storage contract on the real OPFS ----------------------------------------------------------------------
const contractNames = await (async () => {
  const p = await context.newPage();
  await p.goto(`${base}src/reader/e2e/harness.html`);
  await p.waitForFunction(() => window.srReady, null, { timeout: 30000 });
  const names = await p.evaluate(() => sr.contractNames);
  await p.close();
  return names;
})();
for (const [i, name] of contractNames.entries())
  await test(`OPFS contract: ${name}`, () => ev(([n, ns]) => sr.runContractCase(n, ns), [name, `ns${i}-${Date.now()}`]));

await test('OPFS contract: files survive a page reload', async () => {
  const ns = `reload-${Date.now()}`;
  await ev((ns) => sr.opfsStorage().write(`${ns}/keep.bin`, new Uint8Array([0, 255, 7])), ns);
  await page.reload();
  await page.waitForFunction(() => window.srReady);
  assert.deepEqual(await ev((ns) => sr.opfsStorage().read(`${ns}/keep.bin`).then((b) => [...b]), ns), [0, 255, 7]);
});

// ---- Library on the real OPFS --------------------------------------------------------------------------------
await test('library: imports EPUB and PDF with real metadata and covers, dedupes, removes', async () => {
  const out = await ev(async () => {
    const lib = sr.createLibrary(sr.opfsStorage());
    for (const b of await lib.listBooks()) await lib.removeBook(b.id);
    const en = await lib.addBook(await sr.fixture('book-en.epub'));
    const again = await lib.addBook(await sr.fixture('book-en-copy.epub'));
    const ja = await lib.addBook(await sr.fixture('book-ja.epub'));
    const pdf = await lib.addBook(await sr.fixture('sample.pdf'));
    const broken = await lib.addBook(await sr.fixture('corrupt.pdf'));
    const blobBytes = new Uint8Array(await (await lib.getBookBlob(pdf.id)).arrayBuffer());
    const sizes = [(await lib.listBooks()).length];
    await lib.removeBook(en.id);
    sizes.push((await lib.listBooks()).length);
    return { en, sameId: again.id === en.id, ja, pdf, broken, head: String.fromCharCode(...blobBytes.slice(0, 5)), sizes,
             order: (await lib.listBooks()).map((b) => b.title) };
  });
  assert.equal(out.en.title, 'The Lighthouse & the Sea');
  assert.match(out.en.cover, /^data:image\/jpeg;base64,/);
  assert.equal(out.sameId, true);
  assert.equal(out.ja.title, '吾輩は猫である');
  assert.equal(out.ja.cover, undefined);
  assert.deepEqual([out.pdf.title, out.pdf.author], ['Sample PDF Manual', 'Pat Doe']);
  assert.match(out.pdf.cover, /^data:image\/jpeg;base64,/);
  assert.equal(out.broken.title, 'corrupt');
  assert.equal(out.head, '%PDF-');
  assert.deepEqual(out.sizes, [4, 3]);
  assert.deepEqual(out.order, ['corrupt', 'Sample PDF Manual', '吾輩は猫である']);
});

// ---- EPUB reader -------------------------------------------------------------------------------------------
await test('epub: renders real text, reports a CFI location and the chapter label', async () => {
  await open('book-en.epub');
  const text = await ev(() => session.docs.at(-1).body.textContent);
  assert.match(text, /The lighthouse keeper climbed the spiral stairs/);
  const r = await last();
  assert.match(r.location, /^epubcfi\(/);
  assert.ok(r.fraction >= 0 && r.fraction < 0.2, `fraction ${r.fraction}`);
  assert.equal(r.label, 'Chapter One');
});

await test('epub: next moves forward, prev returns to the same place, ends do not wrap', async () => {
  await open('book-en.epub');
  const start = await last();
  const a = await nav('next');
  assert.notEqual(a.location, start.location);
  assert.ok(a.fraction > start.fraction);
  const b = await nav('next');
  assert.ok(b.fraction > a.fraction);
  assert.equal((await nav('prev')).location, a.location);
  assert.equal((await nav('prev')).location, start.location);
});

await test('epub: toc has the three chapters and goTo(href) opens that chapter', async () => {
  await open('book-en.epub');
  const toc = await ev(() => session.handle.toc);
  assert.deepEqual(toc.map((t) => t.label), ['Chapter One', 'Chapter Two', 'Chapter Three']);
  const r = await nav('goTo', toc[1].href);
  assert.equal(r.label, 'Chapter Two');
  assert.match(await ev(() => session.docs.at(-1).body.textContent), /A storm arrived without warning/);
  assert.equal(await ev(() => session.docs.length), 2, 'onDocLoad fired for each rendered section');
});

await test('epub: goToFraction lands near that part of the book', async () => {
  await open('book-en.epub');
  near((await nav('goToFraction', 0.5)).fraction, 0.5, 0.2, 'fraction');
  const end = await nav('goToFraction', 0.99);
  assert.equal(end.label, 'Chapter Three');
});

await test('epub: reopening with a saved location resumes on the same page', async () => {
  await open('book-en.epub');
  await nav('next');
  await nav('next');
  const saved = await nav('next');
  const savedText = await ev(() => session.docs.at(-1).body.textContent.length);
  await ev(() => session.handle.destroy());
  await ev(() => document.getElementById('host').replaceChildren());
  await open('book-en.epub', { location: saved.location });
  const resumed = await last();
  assert.equal(resumed.location, saved.location);
  near(resumed.fraction, saved.fraction, 0.001, 'fraction');
  assert.equal(await ev(() => session.docs.at(-1).body.textContent.length), savedText);
});

await test('epub: resuming in a later chapter opens that chapter, not the first page', async () => {
  await open('book-en.epub');
  const ch2 = await nav('goTo', await ev(() => session.handle.toc[2].href));
  await ev(() => session.handle.destroy());
  await open('book-en.epub', { location: ch2.location });
  assert.equal((await last()).label, 'Chapter Three');
});

await test('epub: selecting a word emits text, surrounding sentence and a rect around the pointer', async () => {
  await open('book-en.epub');
  const { sel, click } = await selectWord('keeper');
  assert.equal(sel.text, 'keeper');
  assert.equal(sel.context, 'The lighthouse keeper climbed the spiral stairs every evening.');
  assert.ok(sel.rect.width > 20 && sel.rect.width < 120 && sel.rect.height > 8 && sel.rect.height < 60, JSON.stringify(sel.rect));
  assert.ok(click.x >= sel.rect.x && click.x <= sel.rect.x + sel.rect.width, 'x inside rect');
  assert.ok(click.y >= sel.rect.y && click.y <= sel.rect.y + sel.rect.height, 'y inside rect');
  assert.ok(sel.rect.x > 40 && sel.rect.y > 30, 'rect is in host coordinates, past the container offset');
});

await test('epub: dragging over Japanese text emits the characters and their sentence', async () => {
  await open('book-ja.epub');
  const r = await ev(() => sr.rectOf(session, '名前'));
  await page.mouse.move(r.x + 1, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width - 1, r.y + r.height / 2, { steps: 4 });
  await page.mouse.up();
  await ev(() => sr.waitFor(() => session.selects.length > 0, 'a TextSelection'));
  const sel = await ev(() => session.selects.at(-1));
  assert.equal(sel.text, '名前');
  assert.equal(sel.context, '名前はまだ無い。');
  assert.ok(sel.rect.width > 10 && sel.rect.x > 40);
});

await test('epub: a single click, which selects nothing, emits nothing', async () => {
  await open('book-en.epub');
  const r = await ev(() => sr.rectOf(session, 'keeper'));
  await page.mouse.click(r.x + 5, r.y + 5);
  await page.waitForTimeout(600);
  assert.equal(await ev(() => session.selects.length), 0);
});

await test('epub: theme and font size restyle the rendered text live, and chapters opened later too', async () => {
  await open('book-en.epub');
  const look = () =>
    ev(() => {
      const d = session.docs.at(-1);
      const c = d.defaultView.getComputedStyle.bind(d.defaultView);
      const p = d.querySelector('p');
      return { bg: c(d.documentElement).backgroundColor, fg: c(p).color, size: c(p).fontSize };
    });
  const light = await look();
  assert.deepEqual([light.bg, light.size], ['rgb(255, 255, 255)', '16px']);
  await ev((s) => session.handle.setSettings(s), THEME('dark', 150));
  assert.deepEqual(await look(), { bg: 'rgb(18, 18, 18)', fg: 'rgb(230, 230, 230)', size: '24px' });
  await ev((s) => session.handle.setSettings(s), THEME('sepia', 100));
  const sepia = await look();
  assert.deepEqual([sepia.bg, sepia.fg], ['rgb(244, 236, 216)', 'rgb(67, 52, 34)']);
  await nav('goTo', await ev(() => session.handle.toc[1].href));
  assert.equal((await look()).bg, 'rgb(244, 236, 216)');
});

await test('epub: font size changes pagination (bigger text means more pages)', async () => {
  await open('book-en.epub');
  const before = (await nav('next')).fraction;
  await ev((s) => session.handle.setSettings(s), THEME('light', 200));
  await ev(() => session.handle.goToFraction(0));
  const after = (await nav('next')).fraction;
  assert.ok(after < before, `one page covers less of the book at 200% (${after} vs ${before})`);
});

await test('epub: single-page layout shows one page where auto shows two side by side', async () => {
  // the default 800px host is too narrow for a spread: foliate needs ~2x720px of text width
  await ev(() => { document.getElementById('host').style.width = '1500px'; });
  await open('book-en.epub');
  const twoUp = (await nav('next')).fraction;
  await ev((s) => session.handle.setSettings(s), THEME('light', 100, 'single'));
  await ev(() => session.handle.goToFraction(0));
  const one = (await nav('next')).fraction;
  assert.ok(one < twoUp, `a single page covers less of the book than a spread (${one} vs ${twoUp})`);
  await ev((s) => session.handle.setSettings(s), THEME('light', 100, 'auto'));
  await ev(() => session.handle.goToFraction(0));
  assert.ok(Math.abs((await nav('next')).fraction - twoUp) < 1e-6, 'back to auto restores the spread');
  await ev(() => { document.getElementById('host').style.width = '800px'; });
});

await test('epub: opening with the dark setting is dark from the first page', async () => {
  await open('book-en.epub', { settings: THEME('dark') });
  assert.equal(await ev(() => session.docs[0].defaultView.getComputedStyle(session.docs[0].documentElement).backgroundColor), 'rgb(18, 18, 18)');
});

await test('epub: destroy removes the view, revokes every object URL and stops events', async () => {
  const baseline = await ev(() => ({ urls: __liveBlobUrls(), listeners: __listeners() }));
  await open('book-en.epub');
  await nav('next');
  await nav('goTo', await ev(() => session.handle.toc[1].href));
  assert.ok((await ev(() => __liveBlobUrls())) > baseline.urls, 'object URLs were in use');
  await ev(() => session.handle.destroy());
  assert.equal(await ev(() => document.getElementById('host').children.length), 0);
  assert.equal(await ev(() => __liveBlobUrls()), baseline.urls);
  assert.deepEqual(await ev(() => __listeners()), baseline.listeners);
});

await test('epub: corrupt and empty files fail to open and leave the container clean', async () => {
  for (const name of ['corrupt.epub', 'empty.epub']) {
    const msg = await ev(async (n) => {
      try {
        await sr.openFixture(n);
        return null;
      } catch (e) {
        return String(e);
      }
    }, name);
    assert.ok(msg, `${name} should reject`);
    assert.equal(await ev(() => document.getElementById('host').children.length), 0, name);
  }
});

// ---- PDF reader ----------------------------------------------------------------------------------------------
await test('pdf: renders a non-blank page fitted to the container width, with a selectable text layer', async () => {
  await open('sample.pdf');
  const info = await ev(() => {
    const canvas = document.querySelector('.sr-pdf canvas');
    const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 100) dark++;
    return { dark, cssWidth: canvas.getBoundingClientRect().width, text: document.querySelector('.textLayer').textContent,
             host: document.querySelector('.sr-pdf').clientWidth };
  });
  assert.ok(info.dark > 200, `drawn glyph pixels: ${info.dark}`);
  near(info.cssWidth, info.host - 32, 1, 'fit-to-width');
  assert.match(info.text, /Page 1 heading\./);
  assert.deepEqual(await last(), { location: '1', fraction: 1 / 6, label: '1 / 6' });
});

await test('pdf: next/prev/goToFraction move by page and stop at the ends', async () => {
  await open('sample.pdf');
  assert.equal((await nav('next')).location, '2');
  assert.match(await ev(() => document.querySelector('.textLayer').textContent), /Page 2 heading/);
  assert.equal((await nav('goToFraction', 1)).location, '6');
  const n = await ev(() => session.relocs.length);
  await ev(() => session.handle.next());
  assert.equal(await ev(() => session.relocs.length), n, 'no relocation past the last page');
  assert.equal((await nav('goToFraction', 0)).location, '1');
  assert.equal((await nav('goTo', '5')).location, '5');
  assert.equal((await nav('prev')).location, '4');
});

await test('pdf: toc comes from the outline with page hrefs and goTo follows it', async () => {
  await open('sample.pdf');
  const toc = await ev(() => session.handle.toc);
  assert.deepEqual(toc, [{ label: 'Start', href: '1' }, { label: 'Second half', href: '4' }]);
  assert.equal((await nav('goTo', toc[1].href)).location, '4');
  assert.match(await ev(() => document.querySelector('.textLayer').textContent), /Page 4 heading/);
});

await test('pdf: resumes at a saved page and clamps a location past the end', async () => {
  await open('sample.pdf', { location: '4' });
  assert.equal((await last()).location, '4');
  assert.match(await ev(() => document.querySelector('.textLayer').textContent), /Page 4 heading/);
  await ev(() => session.handle.destroy());
  await open('sample.pdf', { location: '99' });
  assert.equal((await last()).location, '6');
});

await test('pdf: selecting a word emits text, sentence and a rect around the pointer', async () => {
  await open('sample.pdf', { location: '3' });
  const { sel, click } = await selectWord('harbour');
  assert.equal(sel.text, 'harbour');
  assert.equal(sel.context, 'The harbour master counted 3 ships and wrote the number down.'); // the sentence spans two PDF text lines
  assert.ok(click.x >= sel.rect.x && click.x <= sel.rect.x + sel.rect.width && click.y >= sel.rect.y && click.y <= sel.rect.y + sel.rect.height);
  assert.ok(sel.rect.x > 40 && sel.rect.y > 30);
});

await test('pdf: theme sets the surround, dark inverts only the page bitmap, zoom follows font size', async () => {
  await open('sample.pdf');
  const look = () =>
    ev(() => {
      const s = document.querySelector('.sr-pdf');
      const c = s.querySelector('canvas');
      return { bg: getComputedStyle(s).backgroundColor, filter: getComputedStyle(c).filter, width: c.getBoundingClientRect().width,
               textFilter: getComputedStyle(document.querySelector('.textLayer')).filter };
    });
  const light = await look();
  assert.deepEqual([light.bg, light.filter], ['rgb(255, 255, 255)', 'none']);
  await ev((s) => session.handle.setSettings(s), THEME('dark'));
  const dark = await look();
  assert.equal(dark.bg, 'rgb(18, 18, 18)');
  assert.match(dark.filter, /invert/);
  assert.equal(dark.textFilter, 'none');
  await ev((s) => session.handle.setSettings(s), THEME('sepia', 150));
  await page.waitForTimeout(500);
  const sepia = await look();
  assert.deepEqual([sepia.bg, sepia.filter], ['rgb(244, 236, 216)', 'none']);
  near(sepia.width, light.width * 1.5, 2, 'zoom');
  await nav('next');
  await ev((s) => session.handle.setSettings(s), THEME('dark', 150));
  assert.match((await look()).filter, /invert/, 'the page rendered after a change is styled too');
});

await test('pdf: re-fits the page to the container when it is resized', async () => {
  await open('sample.pdf');
  const width = () => ev(() => document.querySelector('.sr-pdf canvas').getBoundingClientRect().width);
  const before = await width();
  await ev(() => (document.getElementById('host').style.width = '500px'));
  await page.waitForFunction((w) => document.querySelector('.sr-pdf canvas').getBoundingClientRect().width < w, before, { timeout: 5000 });
  near(await width(), 500 - 15 - 32, 1, 'fit-to-width after resize');
});

await test('pdf: destroy removes the view and every document listener it added', async () => {
  const baseline = await ev(() => __listeners());
  await open('sample.pdf');
  await ev(() => session.handle.destroy());
  assert.equal(await ev(() => document.getElementById('host').children.length), 0);
  assert.deepEqual(await ev(() => __listeners()), baseline);
  // And a selection made afterwards reaches nobody.
  await ev(() => {
    const p = document.body.appendChild(document.createElement('p'));
    p.textContent = 'plain text after destroy';
    getSelection().selectAllChildren(p);
  });
  await page.waitForTimeout(600);
  assert.equal(await ev(() => session.selects.length), 0);
});

await test('pdf: a corrupt file fails to open and leaves the container clean', async () => {
  const msg = await ev(() => sr.openFixture('corrupt.pdf').then(() => null, (e) => String(e)));
  assert.ok(msg);
  assert.equal(await ev(() => document.getElementById('host').children.length), 0);
});

await browser.close();
await server.close();
const failed = results.filter(([, e]) => e);
console.log(`\n${results.length - failed.length}/${results.length} browser tests passed`);
process.exit(failed.length ? 1 : 0);
