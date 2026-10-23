// Real-browser tests: the Storage contract on OPFS, the library on OPFS, and openBook with real EPUB/PDF files.
//   node src/reader/e2e/run.mjs
// Needs the `playwright` devDependency (PLAYWRIGHT_DIR or the npx cache are fallbacks).
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

// The installed devDependency first; the npx-cache / PLAYWRIGHT_DIR copy only as a fallback.
const { chromium } = await import('playwright').catch(() => import(pathToFileURL(join(findPlaywright(), 'index.mjs')).href));
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
let wasmSeen = []; // the unrar .wasm requests made by the current test's page
const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  page = await context.newPage();
  wasmSeen = [];
  // Only the real download: Vite's dev server also requests the .wasm as a module (?import&url), which production never does.
  page.on('request', (r) => /\.wasm$/.test(r.url()) && wasmSeen.push(r.url()));
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
const THEME = (theme, fontSize = 100, layout = 'auto') => ({ theme, fontSize, furigana: 'off', layout, rtl: true, writing: 'book' });

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

// ---- Annotations in the reader --------------------------------------------------------------------------------
const note = (location, text, over = {}) => ({
  id: 'id-' + text, bookId: 'b', kind: 'highlight', location, text, color: 'yellow', createdAt: 1, updatedAt: 1, ...over,
});
/** What the foliate overlay currently draws: one entry per annotation with its colour and its boxes in the host viewport. */
const painted = () =>
  ev(() =>
    window.gs().map((g) => ({
      fill: g.getAttribute('fill'),
      boxes: [...g.querySelectorAll('rect')].map((r) => {
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }),
    })),
  );
const paintedAround = (boxes, rect) => boxes.some((b) => Math.abs(b.x - rect.x) < 3 && Math.abs(b.width - rect.width) < 6 && b.y < rect.y + rect.height && b.y + b.height > rect.y);
const setAnnotations = (items) => ev((items) => session.handle.setAnnotations(items), items);
const waitPainted = (n) => ev((n) => sr.waitFor(() => window.gs().length === n, `${n} painted`), n);

await test('epub: a selection carries its CFI range, and an annotation at that location is painted exactly on the word, in its colour', async () => {
  await open('book-en.epub');
  const { sel } = await selectWord('keeper');
  assert.match(sel.location, /^epubcfi\(\/6\/\d+!.+,.+,.+\)$/, 'a range CFI');
  await setAnnotations([note(sel.location, 'keeper', { color: 'green' })]);
  await waitPainted(1);
  const [one, ...rest] = await painted();
  assert.equal(rest.length, 0);
  assert.equal(one.fill, '#6fdc8c');
  assert.ok(paintedAround(one.boxes, await ev(() => sr.rectOf(session, 'keeper'))), JSON.stringify(one.boxes));
});

await test('epub: setAnnotations repaints a changed colour, erases removed and deleted items, and never paints bookmarks', async () => {
  await open('book-en.epub');
  const { sel } = await selectWord('keeper');
  await setAnnotations([note(sel.location, 'keeper')]);
  await waitPainted(1);
  await setAnnotations([note(sel.location, 'keeper', { color: 'pink', updatedAt: 2 })]);
  await ev(() => sr.waitFor(() => window.gs()[0]?.getAttribute('fill') === '#ff8fc2', 'pink'));
  assert.equal((await painted()).length, 1, 'repaint replaces, never stacks');
  await setAnnotations([note(sel.location, 'keeper', { kind: 'bookmark' })]);
  await waitPainted(0);
  await setAnnotations([note(sel.location, 'keeper')]);
  await waitPainted(1);
  await setAnnotations([note(sel.location, 'keeper', { deleted: true, updatedAt: 3 })]);
  await waitPainted(0);
  await setAnnotations([note(sel.location, 'keeper')]);
  await waitPainted(1);
  await setAnnotations([]);
  await waitPainted(0);
});

await test('epub: a highlight in another chapter is painted when that chapter loads, also in a freshly opened book', async () => {
  await open('book-en.epub');
  const toc = await ev(() => session.handle.toc);
  await nav('goTo', toc[1].href);
  const { sel } = await selectWord('storm');
  await ev(() => session.handle.destroy());
  await ev(() => document.getElementById('host').replaceChildren());
  await open('book-en.epub'); // back on chapter one
  await setAnnotations([note(sel.location, 'storm', { color: 'blue' })]);
  await page.waitForTimeout(300);
  assert.deepEqual(await painted(), [], 'nothing painted on a page that does not contain it');
  await nav('goTo', toc[1].href);
  await waitPainted(1);
  const [one] = await painted();
  assert.equal(one.fill, '#6cb6ff');
  assert.ok(paintedAround(one.boxes, await ev(() => sr.rectOf(session, 'storm'))));
});

await test('epub: tapping a highlight reports its id and box; tapping plain text does not', async () => {
  await open('book-en.epub');
  const { sel } = await selectWord('keeper');
  await ev(() => {
    window.clicks = [];
    session.handle.onAnnotationClick((id, rect) => clicks.push({ id, rect }));
  });
  await setAnnotations([note(sel.location, 'keeper', { id: 'hl-1' })]);
  await waitPainted(1);
  await ev(() => session.docs.at(-1).getSelection().removeAllRanges());
  const other = await ev(() => sr.rectOf(session, 'spiral'));
  await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);
  await page.waitForTimeout(400);
  assert.equal(await ev(() => clicks.length), 0);
  const r = await ev(() => sr.rectOf(session, 'keeper'));
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await ev(() => sr.waitFor(() => clicks.length > 0, 'an annotation click'));
  const [c] = await ev(() => clicks);
  assert.equal(c.id, 'hl-1');
  assert.ok(Math.abs(c.rect.x - r.x) < 3 && Math.abs(c.rect.width - r.width) < 6 && c.rect.y > 30, JSON.stringify([c.rect, r]));
});

await test('epub: here() is a point on the current page that the bookmark rules find on that page only', async () => {
  await open('book-en.epub');
  const page1 = await last();
  const here = await ev(() => session.handle.here());
  assert.match(here.location, /^epubcfi\([^,]+\)$/, 'a point, not a range');
  assert.match(here.text, /^Chapter One The lighthouse keeper climbed/);
  assert.equal(here.label, 'Chapter One');
  const bm = note(here.location, here.text, { kind: 'bookmark' });
  const on = (loc) => ev(([bm, loc]) => !!sr.annotations.bookmarkOn([bm], loc), [bm, loc]);
  assert.equal(await on(page1.location), true, 'found on its own page');
  const page2 = await nav('next');
  assert.equal(await on(page2.location), false, 'not on the next page');
  assert.equal(await on((await nav('prev')).location), true, 'found again when coming back');
  await nav('goToFraction', 0.99);
  assert.equal(await on((await last()).location), false, 'not in another chapter');
  await nav('goTo', here.location);
  assert.equal(await on((await last()).location), true, 'goTo(bookmark) lands on its page');
});

await test('epub: highlights are tinted for the theme: multiply on paper, a plain tint on the dark page', async () => {
  await open('book-en.epub');
  const { sel } = await selectWord('keeper');
  await setAnnotations([note(sel.location, 'keeper')]);
  await waitPainted(1);
  const look = () =>
    ev(() => {
      const c = getComputedStyle(window.gs()[0]);
      return [c.mixBlendMode, c.opacity];
    });
  assert.deepEqual(await look(), ['multiply', '0.6']);
  await ev((s) => session.handle.setSettings(s), THEME('dark'));
  assert.deepEqual(await look(), ['normal', '0.35']);
  await ev((s) => session.handle.setSettings(s), THEME('sepia'));
  assert.deepEqual(await look(), ['multiply', '0.6']);
});

await test('pdf: here() names the page and its first words; selections have no location; setAnnotations is harmless', async () => {
  await open('sample.pdf', { location: '3' });
  const here = await ev(() => session.handle.here());
  assert.equal(here.location, '3');
  assert.equal(here.label, 'Page 3');
  assert.match(here.text, /^Page 3 heading/);
  const { sel } = await selectWord('harbour');
  assert.equal(sel.location, undefined);
  await setAnnotations([note('3', 'harbour')]);
  await ev(() => session.handle.onAnnotationClick(() => {}));
  assert.equal(await ev(() => document.querySelectorAll('.sr-pdf svg').length), 0);
});

// ---- Manga (cbz) reader ----------------------------------------------------------------------------------------
// manga.cbz stores its pages as 1,2,3,10,11,4. Reading order is 1,2,3,4,10,11, so page 4 is 4.png (cyan), not 10.png.
const ORDER = ['1.png', '2.png', '3.png', '4.png', '10.png', '11.png'];
const COLOUR = {
  '1.png': [220, 40, 40], '2.png': [40, 180, 60], '3.png': [40, 80, 220],
  '4.png': [30, 200, 220], '10.png': [240, 220, 30], '11.png': [200, 40, 200],
};
const MANGA = (layout = 'auto', rtl = true, fontSize = 100, theme = 'light') => ({ theme, fontSize, furigana: 'off', layout, rtl, writing: 'book' });
const isColour = (rgb, file, what) =>
  assert.ok(COLOUR[file].every((v, i) => Math.abs(v - rgb[i]) <= 8), `${what}: got rgb(${rgb}), want ${file} ${COLOUR[file]}`);
/** The page images on screen, left to right: page number, x position, and the colour at the centre of the image. */
const shownPages = () =>
  ev(() =>
    [...document.querySelectorAll('.sr-manga img')]
      .map((img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const [r, gr, b] = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        return { page: Number(img.alt.replace('Page ', '')), x: img.getBoundingClientRect().x, colour: [r, gr, b] };
      })
      .sort((a, b) => a.x - b.x),
  );
const pageNumbers = async () => (await shownPages()).map((p) => p.page);

await test('cbz: opens on page 1 of 6, and the first relocation says so', async () => {
  await open('manga.cbz', { settings: MANGA() });
  assert.deepEqual(await last(), { location: '1', fraction: 1 / 6, label: '1 / 6' });
  assert.deepEqual(await pageNumbers(), [1], 'the cover is alone');
  isColour((await shownPages())[0].colour, '1.png', 'page 1');
});

await test('cbz: pages follow natural order, so the fourth page is 4.png and not 10.png', async () => {
  await open('manga.cbz', { settings: MANGA('single') });
  for (let n = 1; n <= 6; n++) {
    if (n > 1) await nav('next');
    const [p] = await shownPages();
    assert.equal(p.page, n);
    isColour(p.colour, ORDER[n - 1], `page ${n}`);
  }
});

await test('cbz: next and prev turn one page and stop at both ends', async () => {
  await open('manga.cbz', { settings: MANGA('single') });
  const count = () => ev(() => session.relocs.length);
  await ev(() => session.handle.prev());
  await page.waitForTimeout(300);
  assert.equal(await count(), 1, 'no relocation before the first page');
  for (let n = 2; n <= 6; n++) assert.equal((await nav('next')).label, `${n} / 6`);
  await ev(() => session.handle.next());
  await page.waitForTimeout(300);
  assert.equal(await count(), 6, 'no relocation past the last page');
  await ev(() => session.handle.goTo('99')); // clamps to page 6, which is where we are
  await page.waitForTimeout(300);
  assert.equal(await count(), 6, 'goTo past the end is already the last page');
  assert.equal((await nav('prev')).label, '5 / 6');
  assert.equal((await nav('goTo', '99')).label, '6 / 6', 'goTo clamps to the last page');
  assert.equal((await nav('goTo', '0')).label, '1 / 6', 'goTo clamps to the first page');
});

await test('cbz: auto layout shows two pages side by side; right to left puts the later page on the right', async () => {
  await open('manga.cbz', { settings: MANGA('auto', true) });
  await nav('next');
  let s = await shownPages();
  assert.deepEqual(s.map((p) => p.page), [3, 2], 'spread 2-3, displayed right to left');
  isColour(s[0].colour, '3.png', 'left of the spread');
  isColour(s[1].colour, '2.png', 'right of the spread');
  assert.equal((await last()).label, '2 / 6');
  await nav('next');
  s = await shownPages();
  assert.deepEqual(s.map((p) => p.page), [5, 4], 'spread 4-5');
  isColour(s[1].colour, '4.png', 'page 4 on the right');
  await nav('next');
  assert.deepEqual(await pageNumbers(), [6], 'the last page is alone');
  assert.equal((await last()).label, '6 / 6');
});

await test('cbz: left to right shows the earlier page on the left, and the setting flips the order live', async () => {
  await open('manga.cbz', { settings: MANGA('auto', false) });
  await nav('next');
  assert.deepEqual(await pageNumbers(), [2, 3]);
  const before = await ev(() => session.relocs.length);
  await ev((s) => session.handle.setSettings(s), MANGA('auto', true));
  await ev((n) => sr.waitFor(() => session.relocs.length > n, 'relocate after the rtl change'), before);
  assert.deepEqual(await pageNumbers(), [3, 2]);
});

await test('cbz: a saved location resumes on its page, a spread resumes on its first page, a location past the end clamps', async () => {
  await open('manga.cbz', { settings: MANGA('auto', true), location: '4' });
  assert.deepEqual(await last(), { location: '4', fraction: 4 / 6, label: '4 / 6' });
  assert.deepEqual(await pageNumbers(), [5, 4]);
  await ev(() => session.handle.destroy());
  await ev(() => document.getElementById('host').replaceChildren());
  await open('manga.cbz', { settings: MANGA('auto', true), location: '5' });
  assert.equal((await last()).location, '4', 'page 5 sits in the spread that starts at 4');
  await ev(() => session.handle.destroy());
  await ev(() => document.getElementById('host').replaceChildren());
  await open('manga.cbz', { settings: MANGA('auto', true), location: '99' });
  assert.equal((await last()).location, '6');
});

await test('cbz: goToFraction lands on the page that fraction names', async () => {
  await open('manga.cbz', { settings: MANGA('single') });
  const half = await nav('goToFraction', 0.5);
  assert.equal(half.label, '3 / 6');
  assert.equal(half.location, '3');
  assert.deepEqual(await pageNumbers(), [3]);
  isColour((await shownPages())[0].colour, '3.png', 'page 3');
  assert.equal((await nav('goToFraction', 0)).label, '1 / 6');
  assert.equal((await nav('goToFraction', 1)).label, '6 / 6');
});

await test('cbz: only the pages around the current one are decoded, and destroy revokes them all', async () => {
  const baseline = await ev(() => __liveBlobUrls());
  await open('manga.cbz', { settings: MANGA('auto', true) });
  const check = async () => {
    const loc = (await last()).location;
    const keep = await ev((p) => sr.mangaNav.pagesToKeep(p, 6, true, 3, 1).length, Number(loc));
    assert.equal((await ev(() => __liveBlobUrls())) - baseline, keep, `object URLs while on page ${loc}`);
  };
  await check();
  for (let i = 0; i < 3; i++) {
    await nav('next');
    await check();
  }
  for (let i = 0; i < 3; i++) {
    await nav('prev');
    await check();
  }
  await ev(() => session.handle.destroy());
  assert.equal(await ev(() => __liveBlobUrls()), baseline);
  assert.equal(await ev(() => document.getElementById('host').children.length), 0);
});

await test('cbz: a zip with no images, or a damaged one, fails to open and leaves the container clean', async () => {
  for (const [name, why] of [['no-pages.cbz', /no pages/], ['corrupt.cbz', /./]]) {
    const msg = await ev(async (n) => {
      try {
        await sr.openFixture(n);
        return null;
      } catch (e) {
        return String(e);
      }
    }, name);
    assert.match(msg ?? '', why, `${name} should reject for its own reason`);
    assert.equal(await ev(() => document.getElementById('host').children.length), 0, name);
  }
});

await test('cbz: a larger font size zooms and scrolls, a page turn returns to the top-left, dark does not invert the pages', async () => {
  await open('manga.cbz', { settings: MANGA('single', true, 200) });
  const scrolls = () => ev(() => { const r = document.querySelector('.sr-manga'); return r.scrollHeight > r.clientHeight; });
  assert.equal(await scrolls(), true, 'zoomed past the viewport');
  await ev(() => { document.querySelector('.sr-manga').scrollTop = 80; });
  await nav('next');
  assert.deepEqual(await ev(() => { const r = document.querySelector('.sr-manga'); return [r.scrollTop, r.scrollLeft]; }), [0, 0]);
  await ev((s) => session.handle.setSettings(s), MANGA('single', true, 200, 'dark'));
  const look = await ev(() => ({
    bg: getComputedStyle(document.querySelector('.sr-manga')).backgroundColor,
    filter: getComputedStyle(document.querySelector('.sr-manga img')).filter,
  }));
  assert.deepEqual(look, { bg: 'rgb(18, 18, 18)', filter: 'none' });
});

// ---- Comic RAR (cbr) reader ------------------------------------------------------------------------------------
// The same six pages as manga.cbz, packed into a RAR (store-rar.ts). Which container a file is comes from its bytes.
const openBuilt = (recipe, name, settings) => ev(([r, n, s]) => sr.openBuilt(r, n, { settings: s }).then(() => 0), [recipe, name, settings]);
const openAs = (name, asName, settings) => ev(([n, a, s]) => sr.openFixtureAs(n, a, { settings: s }).then(() => 0), [name, asName, settings]);
const failureOf = (recipe, name) =>
  ev(async ([r, n]) => {
    try {
      await sr.openBuilt(r, n);
      return null;
    } catch (e) {
      return String(e);
    }
  }, [recipe, name]);

await test('cbr: a RAR named .cbr opens on page 1 of 6, and the first relocation says so', async () => {
  await openBuilt('manga-rar', 'manga.cbr', MANGA());
  assert.deepEqual(await last(), { location: '1', fraction: 1 / 6, label: '1 / 6' });
  assert.deepEqual(await pageNumbers(), [1], 'the cover is alone');
  isColour((await shownPages())[0].colour, '1.png', 'page 1');
});

await test('cbr: pages follow natural order, so the fourth page is 4.png and not 10.png', async () => {
  await openBuilt('manga-rar', 'manga.cbr', MANGA('single'));
  for (let n = 1; n <= 6; n++) {
    if (n > 1) await nav('next');
    const [p] = await shownPages();
    assert.equal(p.page, n);
    isColour(p.colour, ORDER[n - 1], `page ${n}`);
  }
});

await test('cbr: auto layout shows the spreads right to left, and next, prev and the ends behave as for a cbz', async () => {
  await openBuilt('manga-rar', 'manga.cbr', MANGA('auto', true));
  assert.deepEqual(await pageNumbers(), [1]);
  await nav('next');
  assert.deepEqual(await pageNumbers(), [3, 2], 'spread 2-3, displayed right to left');
  assert.equal((await last()).label, '2 / 6');
  await nav('next');
  assert.deepEqual(await pageNumbers(), [5, 4], 'spread 4-5');
  await nav('next');
  assert.deepEqual(await pageNumbers(), [6], 'the last page is alone');
  const count = () => ev(() => session.relocs.length);
  const before = await count();
  await ev(() => session.handle.next());
  await page.waitForTimeout(300);
  assert.equal(await count(), before, 'no relocation past the last page');
  assert.deepEqual(await pageNumbers(), [6]);
  await nav('prev');
  assert.deepEqual(await pageNumbers(), [5, 4], 'back to spread 4-5');
  assert.equal((await last()).label, '4 / 6');
});

await test('cbr: destroy revokes every object URL and empties the container', async () => {
  const baseline = await ev(() => __liveBlobUrls());
  await openBuilt('manga-rar', 'manga.cbr', MANGA('auto', true));
  await nav('next');
  assert.ok((await ev(() => __liveBlobUrls())) > baseline, 'pages are decoded while open');
  await ev(() => session.handle.destroy());
  assert.equal(await ev(() => __liveBlobUrls()), baseline);
  assert.equal(await ev(() => document.getElementById('host').children.length), 0);
});

await test('cbr: a zip named .cbr opens as a comic, because the bytes say zip', async () => {
  await openAs('manga.cbz', 'manga.cbr', MANGA('single'));
  assert.deepEqual(await last(), { location: '1', fraction: 1 / 6, label: '1 / 6' });
  isColour((await shownPages())[0].colour, '1.png', 'page 1');
  assert.equal((await nav('goTo', '99')).label, '6 / 6');
});

await test('cbr: a RAR named .cbz opens as a comic, because the bytes say RAR', async () => {
  await openBuilt('manga-rar', 'manga.cbz', MANGA('single'));
  assert.deepEqual(await last(), { location: '1', fraction: 1 / 6, label: '1 / 6' });
  assert.equal((await nav('goTo', '99')).label, '6 / 6');
  isColour((await shownPages())[0].colour, ORDER[5], 'page 6 is 11.png in reading order');
});

await test('cbr: a RAR with no images, or a damaged one, fails to open and leaves the container clean', async () => {
  for (const [recipe, why] of [
    ['rar-no-images', /no pages/],
    ['rar-damaged', /RAR archive could not be read: /],
  ]) {
    const msg = await failureOf(recipe, `${recipe}.cbr`);
    assert.match(msg ?? '', why, `${recipe} should reject for its own reason`);
    assert.equal(await ev(() => document.getElementById('host').children.length), 0, recipe);
  }
});

await test('wasm: opening a zip never downloads the unrar wasm, whatever its name', async () => {
  await open('manga.cbz', { settings: MANGA('single') });
  assert.equal((await nav('next')).label, '2 / 6');
  assert.deepEqual(wasmSeen, [], 'a zip has no need of the decoder');
});

await test('wasm: a zip named .cbr does not download it either', async () => {
  await openAs('manga.cbz', 'manga.cbr', MANGA('single'));
  assert.deepEqual(wasmSeen, [], 'the bytes are zip, so the decoder is not needed');
});

await test('wasm: opening a RAR downloads the unrar wasm exactly once, and turning pages does not fetch it again', async () => {
  await openBuilt('manga-rar', 'manga.cbr', MANGA('single'));
  assert.equal(wasmSeen.length, 1, `wasm requests: ${wasmSeen.join(', ')}`);
  await nav('next');
  await nav('next');
  assert.equal(wasmSeen.length, 1, 'one request per page load');
});

// ---- Text direction: a vertical Japanese EPUB, the 'writing' setting and rtl() ------------------------------------
const WRITING = (writing, theme = 'light') => ({ theme, fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, writing });
const writingModeOfSection = () => ev(() => getComputedStyle(session.docs.at(-1).body).writingMode);
const rtlNow = () => ev(() => session.handle.rtl());
/** Changes the setting and waits until the section is re-loaded in that direction (the reload is asynchronous). */
const setWriting = (writing) =>
  ev((s) => {
    const want = s.writing === 'book' ? 'vertical-rl' : 'horizontal-tb';
    const old = session.docs.at(-1); // the new CSS reaches the old document at once, so wait for a newly loaded one
    session.handle.setSettings(s);
    return sr.waitFor(() => {
      const d = session.docs.at(-1);
      return d !== old && !!d.defaultView && getComputedStyle(d.body).writingMode === want && session.handle.rtl() === (want === 'vertical-rl');
    }, `the section re-loaded as ${want}`);
  }, WRITING(writing));
const visibleWordRect = (word) => ev((w) => sr.rectOf(session, w), word);
const VIEWPORT_W = 1000;

await test('vertical epub: in book mode the section keeps vertical-rl and rtl() is true', async () => {
  await open('book-ja-vertical.epub', { settings: WRITING('book') });
  assert.equal(await writingModeOfSection(), 'vertical-rl');
  assert.equal(await rtlNow(), true);
});

await test('vertical epub: in horizontal mode the section is horizontal-tb and rtl() is false', async () => {
  await open('book-ja-vertical.epub', { settings: WRITING('horizontal') });
  assert.equal(await writingModeOfSection(), 'horizontal-tb');
  assert.equal(await rtlNow(), false);
});

for (const at of [0.2, 0.5, 0.8]) await test(`vertical epub: switching book -> horizontal -> book at ${at} keeps the same text on screen and does not throw`, async () => {
  await open('book-ja-vertical.epub', { settings: WRITING('book') });
  // Mid-book, so that a switch which lost the place would show different text (the first page would hide that).
  await nav('goToFraction', at);
  // A number-led phrase in plain text ("11つ目の"): ruby readings would split a phrase over several text nodes.
  const first = await ev(() => {
    const d = session.docs.at(-1);
    const f = d.defaultView?.frameElement?.getBoundingClientRect();
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = /\d+つ目の/.exec(n.data);
      if (!m || n.parentElement.closest('rt, rp')) continue;
      const r = d.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const b = r.getBoundingClientRect();
      const x = b.x + (f?.left ?? 0), y = b.y + (f?.top ?? 0);
      if (x >= 0 && x + b.width <= innerWidth && y >= 0 && y + b.height <= innerHeight) return m[0];
    }
    return null;
  });
  assert.ok(first, 'a phrase is on screen');
  const onScreen = (rect) => rect && rect.x >= 0 && rect.x + rect.width <= VIEWPORT_W && rect.y >= 0;
  assert.ok(onScreen(await visibleWordRect(first)), `"${first}" is on screen before the switch`);

  await setWriting('horizontal');
  assert.equal(await writingModeOfSection(), 'horizontal-tb');
  assert.equal(await rtlNow(), false);
  assert.ok(onScreen(await visibleWordRect(first)), `"${first}" is still on screen after the switch to horizontal`);

  await setWriting('book');
  assert.equal(await writingModeOfSection(), 'vertical-rl');
  assert.equal(await rtlNow(), true);
  assert.ok(onScreen(await visibleWordRect(first)), `"${first}" is on screen again in vertical mode`);
});

await test('vertical epub: a page turn right after a switch moves one page on, not back or to the end', async () => {
  await open('book-ja-vertical.epub', { settings: WRITING('book') });
  await nav('goToFraction', 0.2);
  const before = (await last()).fraction;
  const n = await ev(() => session.relocs.length);
  await ev((s) => {
    session.handle.setSettings(s); // no waiting: the key comes straight after the setting
    return session.handle.next();
  }, WRITING('horizontal'));
  await page.waitForTimeout(1200);
  // Foliate re-scrolls after a re-load, so the relocations in between are noisy: the end is what matters.
  const seq = await ev((n) => session.relocs.slice(n).map((r) => r.fraction), n);
  const end = seq.at(-1);
  assert.ok(end > before - 0.05 && end < 0.5, `after the switch and a turn: ${before} -> ${seq.join(' -> ')}`);
});

for (const writing of ['book', 'horizontal']) {
  await test(`vertical epub, ${writing}: next advances and prev returns, with the fraction moving the same way`, async () => {
    await open('book-ja-vertical.epub', { settings: WRITING(writing) });
    const start = await last();
    const a = await nav('next');
    assert.ok(a.fraction > start.fraction, `next: ${start.fraction} -> ${a.fraction}`);
    const b = await nav('next');
    assert.ok(b.fraction > a.fraction, `next again: ${a.fraction} -> ${b.fraction}`);
    const back = await nav('prev');
    assert.ok(back.fraction < b.fraction, `prev: ${b.fraction} -> ${back.fraction}`);
    near((await nav('prev')).fraction, start.fraction, 0.01, 'prev returns to the start');
  });
}

await test('plain horizontal epub: book and horizontal modes render the same text, writing mode and rtl() unchanged', async () => {
  await open('book-en.epub', { settings: WRITING('book') });
  assert.equal(await writingModeOfSection(), 'horizontal-tb');
  assert.equal(await rtlNow(), false);
  const bookText = await ev(() => session.handle.here().text);
  await open('book-en.epub', { settings: WRITING('horizontal') });
  assert.equal(await writingModeOfSection(), 'horizontal-tb');
  assert.equal(await rtlNow(), false);
  assert.equal(await ev(() => session.handle.here().text), bookText, 'the same first page in both modes');
  const f0 = (await last()).fraction;
  assert.ok((await nav('next')).fraction > f0, 'next still advances');
});

await test('pdf and cbz: rtl() is false for a pdf and follows the setting for a comic', async () => {
  await open('sample.pdf');
  assert.equal(await rtlNow(), false);
  await open('manga.cbz', { settings: MANGA('single', true) });
  assert.equal(await rtlNow(), true);
  await open('manga.cbz', { settings: MANGA('single', false) });
  assert.equal(await rtlNow(), false);
});

// Opt-in: COMIC_RAR=/path/to/real.cbr runs against a real comic (never committed). The file goes in through the page's file input.
if (process.env.COMIC_RAR) {
  await test('cbr real file (COMIC_RAR): page 1 renders, next works, and the page count is reported', async () => {
    await page.setInputFiles('#pick', process.env.COMIC_RAR);
    const t0 = Date.now();
    await ev((s) => sr.openPicked({ settings: s }).then(() => 0), MANGA('single'));
    const ms = Date.now() - t0;
    const first = await ev(() => { const i = document.querySelector('.sr-manga img'); return { alt: i?.alt, width: i?.naturalWidth }; });
    assert.equal(first.alt, 'Page 1');
    assert.ok(first.width > 0, 'page 1 decoded to pixels');
    const pages = Number((await last()).label.split(' / ')[1]);
    assert.ok(pages > 1, `a real comic has more than one page (${pages})`);
    assert.equal((await nav('next')).label, `2 / ${pages}`);
    assert.ok((await ev(() => document.querySelector('.sr-manga img').naturalWidth)) > 0, 'page 2 decoded');
    console.log(`      real cbr: ${pages} pages, page 1 shown after ${ms} ms (the open, which includes reading the archive listing)`);
  });
}

await browser.close();
await server.close();
const failed = results.filter(([, e]) => e);
console.log(`\n${results.length - failed.length}/${results.length} browser tests passed`);
process.exit(failed.length ? 1 : 0);
