// In-book search in PDFs through the real app in a real Chromium (pdf.js text layer, real OPFS; nothing mocked).
//   node e2e/run-annotations.mjs            # runs this file with the other specs
// or call the function yourself with a Playwright `page` and `{ BASE, ROOT }`.
// A painted match is a .sr-search-hit box the reader lays over the page, in the search colour (SEARCH_FILL).
async (page, env = {}) => {
  const BASE = env.BASE ?? 'http://localhost:5199/';
  const FIX = String(env.ROOT).split('\\').join('/').replace(/\/*$/, '/') + 'src/reader/fixtures/';
  const SEARCH_RGB = 'rgb(255, 159, 28)'; // SEARCH_FILL in src/annotations/paint.ts
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
  const chrome = async () => {
    const { width } = page.viewportSize();
    await page.mouse.move(width / 2, 20);
    await page.mouse.move(width / 2, 24);
  };
  const top = async (name) => { await chrome(); return page.locator('.bar-top').getByRole('button', { name }); };
  const chapter = async () => (await page.locator('.chapter').first().textContent()).trim();
  async function openPdf() {
    await page.getByRole('button', { name: /^Open Sample PDF/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'pdf to load', 20000);
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

  const openPanel = () => page.locator('dialog.sheet-search[open]').count().then((n) => n === 1);
  const panel = page.locator('dialog.sheet-search');
  const input = () => panel.getByRole('searchbox', { name: 'Search in book' });
  const status = () => panel.getByRole('status').textContent().then((t) => t.trim());
  const rows = () => panel.locator('.search-hit');
  const headings = () => panel.locator('.search-group h3').allTextContents();
  /** The painted matches on the page on screen: the box and its colour and blend. */
  const matchBoxes = () => page.evaluate(() => [...document.querySelectorAll('.sr-search-hit')].map((el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: b.x, y: b.y, width: b.width, height: b.height, bg: cs.backgroundColor, opacity: cs.opacity, blend: cs.mixBlendMode };
  }));
  const waitBoxes = (n) => until(async () => (await matchBoxes()).length === n, `${n} painted match(es)`);
  /** The text-layer line that contains `text`, as a viewport box. */
  const lineBox = (text) => page.evaluate((t) => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes(t));
    if (!span) return null;
    const b = span.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }, text);
  /** Whether a box is drawn over the middle of a line. */
  const over = (box, line) => {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return line !== null && cx >= line.x && cx <= line.x + line.width && cy >= line.y && cy <= line.y + line.height;
  };

  /** Opens the search from the top bar and waits until its input has focus. */
  async function openSearch() {
    await (await top('Search in book')).click();
    await until(openPanel, 'the search panel to open');
    await until(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search in book'), 'the input to have focus');
  }
  /** Types a query and waits for the status to show its outcome. */
  async function search(query) {
    await input().fill(query);
    return until(async () => { const s = await status(); return s && s !== 'Searching…' ? s : null; }, `a result for "${query}"`, 15000);
  }
  async function closePanel() {
    await page.keyboard.press('Escape');
    await until(async () => !(await openPanel()), 'the panel to close', 5000);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await resetApp();
  await page.setInputFiles('input[type=file]', [FIX + 'sample.pdf', FIX + 'manga.cbz']);
  await until(async () => (await page.locator('.card').count()) === 2, 'two cards');

  await step('the search button is in the top bar of a PDF, and not of a comic', async () => {
    await openPdf();
    eq(await page.locator('.bar-top').getByRole('button', { name: 'Search in book' }).count(), 1, 'PDF search buttons');
    await backToLibrary();
    await page.getByRole('button', { name: /^Open manga/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'comic to load', 20000);
    eq(await page.locator('.bar-top').getByRole('button', { name: 'Search in book' }).count(), 0, 'comic search buttons');
    await backToLibrary();
  });

  await step('a word on page 3 gives one result under "Page 3"', async () => {
    await page.getByRole('button', { name: /^Open Sample PDF/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => (await page.locator('.textLayer span').count()) > 0, 'the text layer', 10000);
    await openSearch();
    eq(await search('Page 3'), '1 result', 'status for Page 3');
    eq(await headings(), ['Page 3'], 'headings');
    ok((await rows().first().textContent()).includes('Page 3'), 'the row shows the match');
    await closePanel();
  });

  await step('a word on every page gives a result per page, in page order', async () => {
    await openSearch();
    eq(await search('harbour'), '6 results', 'status for harbour');
    eq(await headings(), ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6'], 'headings in order');
    eq(await panel.locator('.search-group .search-hit').count(), 6, 'rows inside their page groups');
  });

  await step('a click jumps to the page and paints the match in the search colour over the word', async () => {
    await panel.locator('.search-group:has(h3:text-is("Page 3")) .search-hit').first().click();
    await until(async () => (await chapter()) === '3 / 6', 'page 3', 15000);
    await waitBoxes(1);
    const [b] = await matchBoxes();
    eq([b.bg, b.opacity, b.blend], [SEARCH_RGB, '0.6', 'multiply'], 'search style on a light page');
    ok(over(b, await lineBox('harbour master')), 'the box is not over the word: ' + JSON.stringify(b));
    ok(await openPanel(), 'the panel should stay open on a wide window');
  });

  await step('a result on another page moves there and paints only that page\'s matches', async () => {
    await panel.locator('.search-group:has(h3:text-is("Page 5")) .search-hit').first().click();
    await until(async () => (await chapter()) === '5 / 6', 'page 5', 15000);
    await waitBoxes(1);
    ok(over((await matchBoxes())[0], await lineBox('harbour master')), 'the box is over the page 5 match');
  });

  await step('a word that is not in the book says No results and paints nothing', async () => {
    eq(await search('zzqx'), 'No results', 'status for a missing word');
    eq(await rows().count(), 0, 'rows for a missing word');
    await waitBoxes(0);
  });

  await step('a new query replaces the results and the old matches', async () => {
    await search('harbour');
    await waitBoxes(1);
    eq(await search('Page 5'), '1 result', 'status for Page 5');
    // The page shows one "harbour" match; an old one left behind would make two boxes here.
    await waitBoxes(1);
    ok(over((await matchBoxes())[0], await lineBox('Page 5 heading.')), 'the box is over "Page 5"');
  });

  await step('Esc closes the panel, clears the matches and gives focus back to the search button', async () => {
    await page.keyboard.press('Escape');
    await until(async () => !(await openPanel()), 'the panel to close', 5000);
    await waitBoxes(0);
    eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search in book', 'focus after closing');
  });

  await step('Ctrl+F opens the search with its input focused instead of the browser find', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+f');
    await until(openPanel, 'the panel to open from Ctrl+F', 5000);
    await until(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search in book'), 'the input to have focus');
    await closePanel();
  });

  await step('dark theme: the matches stay visible on the dark page', async () => {
    await (await top('Reading settings')).click();
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await page.keyboard.press('Escape');
    await openSearch();
    eq(await search('Page 2'), '1 result', 'status for Page 2 in the dark theme');
    await page.locator('.search-group:has(h3:text-is("Page 2")) .search-hit').first().click();
    await until(async () => (await chapter()) === '2 / 6', 'page 2', 15000);
    await waitBoxes(1);
    const [b] = await matchBoxes();
    eq([b.bg, b.opacity, b.blend], [SEARCH_RGB, '0.35', 'normal'], 'search style on a dark page');
    ok(over(b, await lineBox('Page 2 heading.')), 'dark box not over the word');
    await page.keyboard.press('Escape');
    await until(async () => (await matchBoxes()).length === 0, 'the dark matches to clear', 5000);
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
