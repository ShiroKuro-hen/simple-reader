// In-book search in EPUB through the real app in a real Chromium: real foliate-js search, real book files; nothing mocked.
//   node e2e/run-annotations.mjs            # runs this file with the other specs
// or call the function yourself with a Playwright `page` and `{ BASE, ROOT }`.
// Matches are checked by the search colour (SEARCH_FILL in src/annotations/paint.ts) and by where they are on screen.
async (page, env = {}) => {
  const BASE = env.BASE ?? 'http://localhost:5199/';
  const FIX = String(env.ROOT).split('\\').join('/').replace(/\/*$/, '/') + 'src/reader/fixtures/';
  const SEARCH_FILL = '#ff9f1c';
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
  async function openFromLibrary(titlePart) {
    await page.getByRole('button', { name: new RegExp(`^Open ${titlePart}`) }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to load', 20000);
    await until(async () => (await page.locator('.chapter').first().textContent()).trim(), 'first position', 20000);
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
  /** The matches drawn on the loaded sections: one entry per match, each a list of boxes in the host viewport. */
  const searchMarks = () => page.evaluate((fill) => (document.querySelector('foliate-view')?.renderer?.getContents() ?? []).flatMap((c) =>
    c.overlayer ? [...c.overlayer.element.querySelectorAll(`g[fill="${fill}"]`)].map((g) => [...g.querySelectorAll('rect')].map((r) => {
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    })) : []), SEARCH_FILL);
  /** Whether some match has a box inside the window. */
  const matchOnScreen = async () => {
    const { width, height } = page.viewportSize();
    return (await searchMarks()).some((m) => m.some((b) => b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height));
  };
  const pct = async () => (await page.locator('.pct').first().textContent()).trim();

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
  await page.setInputFiles('input[type=file]', [FIX + 'book-en.epub', FIX + 'book-ja.epub', FIX + 'sample.pdf', FIX + 'manga.cbz']);
  await until(async () => (await page.locator('.card').count()) === 4, 'four cards');

  await step('the search button is in the top bar of an EPUB and a PDF, and not of a comic', async () => {
    await openFromLibrary('The Lighthouse');
    eq(await page.locator('.bar-top').getByRole('button', { name: 'Search in book' }).count(), 1, 'EPUB search buttons');
    await backToLibrary();
    await page.getByRole('button', { name: /^Open Sample PDF/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'pdf to load', 20000);
    eq(await page.locator('.bar-top').getByRole('button', { name: 'Search in book' }).count(), 1, 'PDF search buttons');
    await backToLibrary();
    await page.getByRole('button', { name: /^Open manga/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'comic to load', 20000);
    eq(await page.locator('.bar-top').getByRole('button', { name: 'Search in book' }).count(), 0, 'comic search buttons');
    await backToLibrary();
  });

  await step('typing finds matches grouped under chapter headings and says how many', async () => {
    await openFromLibrary('The Lighthouse');
    await openSearch();
    eq(await input().getAttribute('type'), 'search', 'input type');
    // The panel must not pick up the library's search-box styles (it once became one huge flex row).
    const box = await input().evaluate((e) => ({ w: e.getBoundingClientRect().width, panelH: e.closest('dialog').getBoundingClientRect().height }));
    ok(box.w > 200 && box.panelH <= 2000, 'panel layout: ' + JSON.stringify(box));
    const s = await search('Paragraph 17');
    ok(/^\d+ results?$/.test(s), 'status: ' + s);
    const n = await rows().count();
    eq(n, parseInt(s, 10), 'rows against the status');
    eq(await rows().first().evaluate((e) => e.tagName), 'BUTTON', 'row element');
    const heads = await panel.locator('.search-group h3').allTextContents();
    ok(heads.includes('Chapter One') && heads.includes('Chapter Two'), 'chapter headings: ' + heads);
    eq(await panel.locator('.search-group .search-hit').count(), n, 'rows inside their chapter group');
    return s;
  });

  await step('clicking a result jumps there: the progress moves and the match is highlighted on screen', async () => {
    const before = await pct();
    await panel.locator('.search-group:has(h3:text-is("Chapter Two")) .search-hit').first().click();
    await until(async () => (await pct()) !== before, 'the progress to move', 15000);
    await until(matchOnScreen, 'a visible highlight of the match', 15000);
    ok(await openPanel(), 'the panel should stay open on a wide window');
    return `${before} -> ${await pct()}`;
  });

  await step('a one-letter query searches nothing; a word that is not in the book says No results', async () => {
    await input().fill('a');
    await sleep(450); // a negative check: longer than the 300 ms typing delay, so a search would have shown by now
    eq(await status(), '', 'status for one letter');
    eq(await rows().count(), 0, 'rows for one letter');
    eq((await searchMarks()).length, 0, 'highlights for one letter');
    eq(await search('zzqx'), 'No results', 'status for a missing word');
    eq(await rows().count(), 0, 'rows for a missing word');
  });

  await step('a new query replaces the results and the old highlights', async () => {
    await search('Paragraph 17');
    ok((await searchMarks()).length >= 1, 'no highlight for Paragraph 17');
    eq(await search('storm'), '1 result', 'status for storm');
    eq(await rows().count(), 1, 'rows for storm');
    ok((await rows().first().textContent()).includes('storm'), 'the one row is the storm match');
    // "Paragraph 17" is once in each chapter, so an old highlight left behind would show up here as a second match.
    eq((await searchMarks()).length, 1, 'matches drawn after the new query');
  });

  await step('Esc closes the panel, clears the highlights and gives focus back to the search button', async () => {
    await page.keyboard.press('Escape');
    await until(async () => !(await openPanel()), 'the panel to close', 5000);
    await until(async () => (await searchMarks()).length === 0, 'the highlights to clear', 5000);
    eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search in book', 'focus after closing');
  });

  await step('Ctrl+F opens the search with its input focused instead of the browser find', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+f');
    await until(openPanel, 'the panel to open from Ctrl+F', 5000);
    await until(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search in book'), 'the input to have focus');
    await closePanel();
  });

  await step('a Japanese query finds its match', async () => {
    await backToLibrary();
    await openFromLibrary('吾輩');
    await openSearch();
    // 吾輩 is once in each of the first two chapters.
    eq(await search('吾輩'), '2 results', 'status for 吾輩');
    const excerpts = await rows().allTextContents();
    ok(excerpts.every((t) => t.includes('吾輩は')), 'excerpts: ' + excerpts);
    await closePanel();
  });

  await step('phone 360x740: the panel fits, no horizontal scroll, touch targets are 44 px, a result closes the panel', async () => {
    await backToLibrary();
    await openFromLibrary('The Lighthouse');
    await page.setViewportSize({ width: 360, height: 740 });
    await sleep(600); // the reader re-lays out after the resize, which is debounced
    ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'the page scrolls horizontally');
    const button = await (await top('Search in book')).boundingBox();
    ok(button.x >= 0 && button.x + button.width <= 360.5, 'search button outside the window: ' + JSON.stringify(button));
    await openSearch();
    await search('Paragraph 17');
    const box = await panel.boundingBox();
    ok(box.x >= 0 && box.x + box.width <= 360.5, 'panel outside the window: ' + JSON.stringify(box));
    const sizes = await page.evaluate(() => ({
      input: document.querySelector('dialog.sheet-search input').getBoundingClientRect().height,
      close: document.querySelector('dialog.sheet-search .icon-btn').getBoundingClientRect().height,
      rows: [...document.querySelectorAll('dialog.sheet-search .search-hit')].map((e) => e.getBoundingClientRect().height),
    }));
    ok(sizes.input >= 44 && sizes.close >= 44, 'input or close button under 44 px: ' + JSON.stringify(sizes));
    ok(sizes.rows.length > 0 && sizes.rows.every((h) => h >= 44), 'result rows under 44 px: ' + JSON.stringify(sizes.rows));
    await rows().first().click();
    await until(async () => !(await openPanel()), 'the panel to close after a result on a narrow window', 5000);
    await until(matchOnScreen, 'the match to stay highlighted after the panel closes', 8000); // the jump may still be moving the page
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
