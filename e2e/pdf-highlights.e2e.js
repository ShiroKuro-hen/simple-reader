// Highlights and notes in PDFs through the real app in a real Chromium (pdf.js text layer, real OPFS; nothing mocked).
//   node e2e/run-annotations.mjs            # runs this file with the other specs
// or call the function yourself with a Playwright `page` and `{ BASE, ROOT }`.
// A painted highlight is a .sr-highlight box the reader lays over the page (.sr-highlight-note when it has a note).
async (page, env = {}) => {
  const BASE = env.BASE ?? 'http://localhost:5199/';
  const FIX = String(env.ROOT).split('\\').join('/').replace(/\/*$/, '/') + 'src/reader/fixtures/';
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  const step = async (name, fn) => {
    try { results.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { results.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
  };
  const until = async (fn, what, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  };

  // ---- helpers ----
  const chrome = async () => { await page.mouse.move(640, 20); await page.mouse.move(600, 24); };
  const top = async (name) => { await chrome(); return page.locator('.bar-top').getByRole('button', { name }); };
  const chapter = async () => (await page.locator('.chapter').first().textContent()).trim();
  async function openPdf() {
    await page.getByRole('button', { name: /^Open Sample PDF/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => (await chapter()) === '1 / 6', 'the first page', 20000);
    await until(async () => (await page.locator('.textLayer span').count()) > 0, 'the text layer', 10000);
  }
  async function backToLibrary() {
    await (await top('Back to library')).click();
    await page.locator('.lib').waitFor();
  }
  async function resetApp() {
    await page.goto(BASE);
    await page.evaluate(async () => {
      localStorage.clear();
      const d = await navigator.storage.getDirectory();
      for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true });
    });
    await page.goto(BASE + '#');
    await page.reload();
    await page.locator('.lib').waitFor();
  }
  /** Painted highlight boxes on the current page, in the host viewport. */
  const boxes = () => page.evaluate(() => [...document.querySelectorAll('.sr-highlight')].map((el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: b.x, y: b.y, width: b.width, height: b.height, note: el.classList.contains('sr-highlight-note'), bg: cs.backgroundColor, opacity: cs.opacity, blend: cs.mixBlendMode };
  }));
  const waitBoxes = (n) => until(async () => (await boxes()).length === n, `${n} painted box(es)`);
  /** A word of the text layer that is on screen, away from the bars. `want` picks one by its text. */
  const pageWord = (skip = [], want) => until(() => page.evaluate(({ skip, want }) => {
    for (const span of document.querySelectorAll('.textLayer span')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== 3) continue;
      for (const m of node.textContent.matchAll(/[A-Za-z]{5,}/g)) {
        if (skip.includes(m[0]) || (want && m[0] !== want)) continue;
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (b.x > 0 && b.right < innerWidth && b.y > 100 && b.bottom < innerHeight - 60) {
          return { word: m[0], x: b.x, y: b.y, width: b.width, height: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        }
      }
    }
    return null;
  }, { skip, want }), 'a word on screen');
  async function selectWord(skip, want) {
    const w = await pageWord(skip, want);
    await page.mouse.dblclick(w.cx, w.cy);
    await page.locator('.popup:not([hidden]) .annotate').waitFor({ timeout: 8000 });
    return w;
  }
  const dot = (color) => page.locator('.popup').getByRole('button', { name: `Highlight ${color}` });
  const covers = (b, w) => b.x <= w.cx && w.cx <= b.x + b.width && b.y <= w.cy && w.cy <= b.y + b.height;
  const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  /** The annotations file of the open book, read from the real OPFS. */
  const file = () => page.evaluate(async () => {
    const d = await navigator.storage.getDirectory();
    try {
      const dir = await d.getDirectoryHandle('annotations');
      for await (const [name, h] of dir.entries()) return JSON.parse(await (await h.getFile()).text());
    } catch { /* none yet */ }
    return null;
  });
  const saved = (pred, what) => until(async () => { const f = await file(); return f && pred(f.items) && f; }, what, 5000);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await resetApp();
  await page.setInputFiles('input[type=file]', [FIX + 'sample.pdf']);
  await until(async () => (await page.locator('.card').count()) === 1, 'the card');

  let w; // the highlighted word
  await step('selecting text in the PDF offers the four colours and a Note button', async () => {
    await openPdf();
    w = await selectWord();
    for (const c of ['yellow', 'green', 'blue', 'pink']) ok(await dot(c).isVisible(), `${c} dot missing`);
    ok(await page.locator('.popup').getByRole('button', { name: 'Note' }).isVisible(), 'Note button missing');
  });

  await step('a yellow highlight is painted over the word, below the text layer, and saved with its page', async () => {
    await dot('yellow').click();
    await page.locator('.popup').waitFor({ state: 'hidden' });
    await until(async () => (await boxes()).length >= 1, 'a painted box');
    const [b] = await boxes();
    ok(covers(b, w), `box ${JSON.stringify(b)} does not cover the word ${JSON.stringify(w)}`);
    eq([b.bg, b.opacity, b.blend, b.note], ['rgb(255, 213, 74)', '0.6', 'multiply', false], 'light style');
    const below = await page.evaluate(() => {
      const tl = document.querySelector('.textLayer');
      const kids = [...tl.parentElement.children];
      return kids.findIndex((e) => e.classList.contains('sr-highlights')) < kids.indexOf(tl);
    });
    ok(below, 'the highlights are not below the text layer');
    ok(await page.evaluate(() => document.getSelection().isCollapsed), 'selection still active');
    const f = await saved((items) => items.length === 1, 'the annotations file');
    ok(f.items[0].kind === 'highlight' && f.items[0].color === 'yellow' && f.items[0].text === w.word, JSON.stringify(f.items[0]));
    ok(/^1@\d\.\d{4},\d\.\d{4},\d\.\d{4},\d\.\d{4}/.test(f.items[0].location), 'location ' + f.items[0].location);
    eq(f.items[0].chapter, '1 / 6', 'page label');
  });

  await step('the highlight survives a reload and is painted over the same word', async () => {
    await page.reload();
    await page.locator('.lib, .reader').first().waitFor();
    if (await page.locator('.lib').count()) await openPdf();
    await until(async () => (await chapter()) === '1 / 6', 'page 1 after the reload', 20000);
    await until(async () => (await boxes()).length >= 1, 'the box after reload');
    const [b] = await boxes();
    ok(covers(b, await pageWord([], w.word)), 'box moved after reload');
  });

  await step('a plain click on text away from the highlight does nothing', async () => {
    const other = await pageWord([w.word]);
    await page.mouse.click(other.cx, other.cy);
    await sleep(400);
    eq(await page.locator('.popup:not([hidden])').count(), 0, 'popup count after a plain click');
  });

  await step('tapping the highlight reopens its popup with the colour marked', async () => {
    const [b] = await boxes();
    await page.mouse.click(...centre(b));
    await page.locator('.popup:not([hidden]) .annotate').waitFor();
    eq(await dot('yellow').getAttribute('aria-pressed'), 'true', 'current colour marked');
    await page.keyboard.press('Escape');
  });

  await step('a note on the highlight is saved, painted as a note and shown when tapped', async () => {
    const [b] = await boxes();
    await page.mouse.click(...centre(b));
    await page.locator('.popup:not([hidden]) .annotate').waitFor();
    await page.locator('.popup').getByRole('button', { name: 'Note' }).click();
    const box = page.locator('.popup').getByLabel('Note', { exact: true });
    await box.fill('Lighthouse note');
    await box.press('Control+Enter');
    await page.locator('.popup').waitFor({ state: 'hidden' });
    const f = await saved((items) => items[0]?.note, 'the note saved');
    eq([f.items.length, f.items[0].kind, f.items[0].note], [1, 'note', 'Lighthouse note'], 'note item');
    await until(async () => (await boxes())[0]?.note, 'the note mark');
    const [nb] = await boxes();
    await page.mouse.click(...centre(nb));
    await page.locator('.popup .pop-annotation-note').waitFor();
    eq(await page.locator('.popup .pop-annotation-note').textContent(), 'Lighthouse note', 'note shown');
    await page.keyboard.press('Escape');
  });

  await step('the Annotations panel lists it with its page, and a jump goes to that page and back', async () => {
    await (await top('Annotations')).click();
    const sheet = page.locator('dialog.sheet-notes[open]');
    await until(async () => (await sheet.locator('.ann').count()) === 1, 'one item');
    const row = await sheet.locator('.ann').textContent();
    ok(row.includes('Note') && row.includes('1 / 6') && row.includes(w.word) && row.includes('Lighthouse note'), 'row: ' + row);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowRight');
    await until(async () => (await chapter()) === '2 / 6', 'page 2');
    await waitBoxes(0);
    await (await top('Annotations')).click();
    await sheet.locator('.ann-main').click();
    await until(async () => (await chapter()) === '1 / 6', 'back on page 1');
    await until(async () => (await boxes()).length >= 1, 'the highlight on page 1 again');
  });

  await step('deleting it in the panel removes the box and keeps a tombstone', async () => {
    await (await top('Annotations')).click();
    const sheet = page.locator('dialog.sheet-notes[open]');
    await sheet.getByRole('button', { name: 'Delete annotation' }).click();
    await sheet.locator('.notes-empty').waitFor();
    await waitBoxes(0);
    const f = await saved((items) => items.length === 1 && items[0].deleted, 'the tombstone');
    ok(f.items[0].deleted, 'tombstone');
    await page.keyboard.press('Escape');
  });

  await step('dark theme: a new highlight keeps its colour, and its blend and opacity suit the dark page', async () => {
    await (await top('Reading settings')).click();
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await page.keyboard.press('Escape');
    const d = await selectWord();
    await dot('green').click();
    await until(async () => (await boxes()).length >= 1, 'a dark box');
    const [b] = await boxes();
    eq([b.bg, b.opacity, b.blend], ['rgb(111, 220, 140)', '0.35', 'normal'], 'dark style');
    ok(covers(b, d), 'dark box not over the word');
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
