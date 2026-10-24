// "Search inside books" in the library, in a real browser: the real app, real OPFS, real fixtures; nothing mocked.
// Plain Playwright code like the other specs: run through e2e/run-annotations.mjs.
async (page, ctx = {}) => {
  const BASE = ctx.BASE ?? 'http://localhost:5199/';
  const FIX = String(ctx.ROOT).split('\\').join('/').replace(/\/*$/, '/') + 'src/reader/fixtures/';
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  const step = async (name, fn) => {
    try { results.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { results.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
  };
  const until = async (fn, what, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  };

  const LIGHT = 'The Lighthouse & the Sea';
  const PDF = 'Sample PDF Manual';
  const COMIC = 'manga';
  const toggle = page.getByRole('button', { name: 'Search inside books', exact: true });
  const search = page.locator('.search-input');
  const status = async () => (await page.locator('.lib-count').textContent()).trim();
  const rows = () => page.locator('.book-hit');
  const rowTitles = () => page.locator('.book-hit-title').allTextContents();
  const gridTitles = () => page.locator('.grid .card-title').allTextContents();
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  /** The cached text files, by name, with the time each was last written. */
  const textFiles = () => page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('text').catch(() => null);
    const out = {};
    if (dir) for await (const [name, handle] of dir.entries()) out[name] = (await handle.getFile()).lastModified;
    return out;
  });

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
  /** The status line once a search has finished (it no longer says "Searching"). */
  const finished = () => until(async () => {
    const s = await status();
    return /match|No book|could not/.test(s) ? s : null;
  }, 'the search to finish');
  async function typeQuery(q) {
    await search.fill(q);
    return finished();
  }
  async function openFromResults(title) {
    await page.locator('.book-hit', { hasText: title }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'the book to open', 20000);
  }
  async function backToLibrary() {
    await page.keyboard.press('Escape'); // closes the search panel the reader opened
    await page.keyboard.press('Tab'); // reveals the reader's chrome
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
    await until(async () => (await page.locator('.card').count()) > 0, 'library to list books');
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await resetApp();
  await page.setInputFiles('input[type=file]', [FIX + 'sample.pdf', FIX + 'book-en.epub', FIX + 'manga.cbz']);
  await until(async () => (await page.locator('.card').count()) === 3, 'three cards');

  await step('the toggle is a button that says whether it is on', async () => {
    eq(await toggle.getAttribute('aria-pressed'), 'false', 'off at first');
    await toggle.click();
    eq(await toggle.getAttribute('aria-pressed'), 'true', 'on after a click');
    await until(async () => (await status()) === 'Type at least 2 characters to search inside books.', 'the hint for a short query');
  });

  await step('a word only in the PDF gives that book, its count and an excerpt with the match marked', async () => {
    await typeQuery('harbour');
    eq(await rowTitles(), [PDF], 'rows');
    eq(await page.locator('.book-hit-count').allTextContents(), ['6 matches'], 'count of the six pages');
    eq(await page.locator('.book-hit-excerpt mark').first().textContent(), 'harbour', 'marked match');
    ok((await page.locator('.book-hit-excerpt').first().textContent()).includes('The harbour master'), 'excerpt text');
    ok((await page.locator('.book-hit .cover').count()) === 1, 'no cover on the row');
    eq(await status(), '1 book matches.', 'status');
  });

  await step('a word in no book says so, and the comic is never searched', async () => {
    eq(await typeQuery('zzqxw'), 'No book contains “zzqxw”.', 'status with no match');
    eq(await rows().count(), 0, 'rows for no match');
    eq(await typeQuery(COMIC), `No book contains “${COMIC}”.`, 'the comic title is not text');
  });

  await step('the EPUB is searched too, and more than 50 matches show as 50+', async () => {
    await typeQuery('tide');
    eq(await rowTitles(), [LIGHT], 'rows');
    eq(await page.locator('.book-hit-count').allTextContents(), ['50+ matches'], 'capped count');
    eq((await page.locator('.book-hit-excerpt').allTextContents()).length, 2, 'two excerpts shown');
  });

  await step('the text is cached: one file per readable book, and a later search does not write it again', async () => {
    await typeQuery('harbour');
    const before = await textFiles();
    eq(Object.keys(before).length, 2, 'cached text files (EPUB and PDF, not the comic)');
    await typeQuery('tide');
    eq(await textFiles(), before, 'cache rewritten by a later search');
  });

  await step('a new query replaces the old one: no result of the old query is left', async () => {
    await search.fill('storm'); // the scan for this may or may not have started yet
    await typeQuery('harbour');
    eq(await rowTitles(), [PDF], 'rows of the newer query');
  });

  await step('a result opens the book with the search panel open, the query filled and the matches listed', async () => {
    await openFromResults(PDF);
    await until(() => page.locator('dialog.sheet-search[open]').count().then((n) => n === 1), 'the search panel to open');
    eq(await page.locator('dialog.sheet-search input').inputValue(), 'harbour', 'query in the panel');
    await until(async () => (await page.locator('dialog.sheet-search .search-status').textContent()).trim() === '6 results', 'six matches listed');
    eq(await page.locator('dialog.sheet-search .search-hit').count(), 6, 'match rows in the panel');
    await backToLibrary();
  });

  await step('the keyboard opens a result too', async () => {
    await toggle.click();
    await typeQuery('storm');
    await rows().first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'the book to open', 20000);
    await until(() => page.locator('dialog.sheet-search[open]').count().then((n) => n === 1), 'the search panel to open');
    eq(await page.locator('dialog.sheet-search input').inputValue(), 'storm', 'query after the keyboard open');
    await backToLibrary();
  });

  await step('a narrow screen (360 px) does not scroll sideways', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await toggle.click(); // the library was left and came back with the toggle off
    await typeQuery('harbour');
    eq(await rowTitles(), [PDF], 'rows at 360 px');
    ok((await overflowX()) <= 0, 'the page scrolls sideways at 360 px');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('toggling off brings back the normal grid and its filters', async () => {
    await search.fill('');
    await toggle.click();
    eq(await toggle.getAttribute('aria-pressed'), 'false', 'off');
    eq((await gridTitles()).length, 3, 'all books in the grid');
    eq(await status(), '3 books', 'normal count');
    await search.fill('Lighthouse');
    eq(await gridTitles(), [LIGHT], 'the title filter works again');
    eq(await status(), '1 of 3 books', 'filtered count');
    await search.fill('');
  });

  await step('removing a book removes its cached text too', async () => {
    await page.getByRole('button', { name: `Remove ${PDF}`, exact: true }).click();
    await page.locator('.card.confirming .confirm .danger').click();
    await until(async () => Object.keys(await textFiles()).length === 1, 'the PDF text to be removed');
    await until(async () => (await page.locator('.card').count()) === 2, 'the PDF card to leave the grid');
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
