// End-to-end walk through the real app in a real browser (real OPFS, real foliate-js, real pdf.js,
// real lookup providers - nothing is mocked). Plain Playwright code: no test runner needed.
//
//   npm run dev -- --port 5199        # in one terminal
//   run this file's function with a Playwright `page`, e.g. the Playwright MCP tool
//   browser_run_code_unsafe { filename: "e2e/app.e2e.js" }, or: await (eval(src))(page)
//
// Lookup results come from live providers, so the popup assertions check its *states*
// (loading -> result | error), never provider text.
async (page) => {
  const BASE = 'http://localhost:5199/';
  const FIX = 'C:/Users/CLL36/Desktop/simple-reader/src/reader/fixtures/';
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
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
  const text = (sel) => page.locator(sel).first().textContent();
  const pct = async () => (await text('.pct')).trim();
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  const waitPageChange = async (before) => until(async () => (await pct()) !== before && (await pct()), 'page to turn', 5000);

  // The iframe foliate rendered the visible section into.
  async function bookFrame() {
    return until(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const el = await f.frameElement().catch(() => null);
        const b = el && (await el.boundingBox().catch(() => null));
        if (b && b.width > 100 && b.x < 1200 && b.x + b.width > 0 && (await f.evaluate(() => !!document.querySelector('p')).catch(() => false))) return { f, b };
      }
      return null;
    }, 'a rendered book page', 15000);
  }
  // A word that is really on screen: the iframe is wider than the viewport (columns), so filter by host coordinates.
  async function visibleWord() {
    const vp = page.viewportSize();
    const edge = Math.min(140, Math.max(44, vp.width * 0.12)) + 20; // the page-turn zones swallow clicks
    let lastErr = '';
    return until(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
        if (!box) continue;
        const w = await f.evaluate(({ ox, oy, vw, vh, m0 }) => {
          for (const p of document.querySelectorAll('p')) {
            const t = p.firstChild;
            if (!t || t.nodeType !== 3) continue;
            for (const m of t.textContent.matchAll(/[A-Za-z]{5,}/g)) {
              const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
              const q = r.getBoundingClientRect();
              if (ox + q.x > m0 && ox + q.x + q.width < vw - m0 && oy + q.y > 90 && oy + q.y + q.height < vh - 90) return { x: ox + q.x + q.width / 2, y: oy + q.y + q.height / 2, word: m[0] };
            }
          }
          return null;
        }, { ox: box.x, oy: box.y, vw: vp.width, vh: vp.height, m0: edge }).catch((e) => { lastErr = String(e.message).slice(0, 120); return null; });
        if (w) return w;
        lastErr = JSON.stringify(await f.evaluate(({ ox, oy }) => [...document.querySelectorAll('p')].slice(0, 40).map((p) => { const q = p.getBoundingClientRect(); return [Math.round(ox + q.x), Math.round(oy + q.y), Math.round(q.width), (p.firstChild || {}).nodeType]; }).filter((r) => r[0] > -50 && r[0] < 1300), { ox: box.x, oy: box.y }).catch(() => 'x'));
      }
      return null;
    }, 'a word visible on screen', 25000).catch(async (e) => {
      const boxes = [];
      for (const f of page.frames()) if (f !== page.mainFrame()) boxes.push(await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null));
      throw new Error(e.message + ' vp=' + JSON.stringify(vp) + ' frames=' + JSON.stringify(boxes) + ' pct=' + (await pct()) + ' err=' + lastErr);
    });
  }
  async function pressUntilTurn(key, before) {
    // foliate ignores a turn while it is still settling (e.g. loading the next section): retry like a user would
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press(key);
      const now = await until(async () => (await pct()) !== before && (await pct()), '', 1200).catch(() => null);
      if (now) return now;
    }
    throw new Error(key + ' did not turn the page (stayed at ' + before + ')');
  }
  async function openFromLibrary(titlePart) {
    const card = titlePart ? page.getByRole('button', { name: new RegExp(`^Open ${titlePart}`) }) : page.locator('.card-open').first();
    await card.click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to finish loading', 20000);
  }
  async function backToLibrary() {
    await page.keyboard.press('Tab'); // reveals the chrome
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
    await until(async () => (await page.locator('.card').count()) > 0, 'library to list books');
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

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' }); // deterministic: no page-turn or UI animation
  await resetApp();

  await step('empty library shows the drop zone, no horizontal scroll', async () => {
    await page.getByRole('heading', { name: 'Drop EPUB or PDF files here' }).waitFor();
    ok((await overflowX()) <= 0, 'page scrolls horizontally');
    ok((await page.locator('.grid').count()) === 0, 'grid should not exist when empty');
  });

  await step('add EPUB + PDF with the file picker', async () => {
    await page.setInputFiles('input[type=file]', [FIX + 'book-en.epub', FIX + 'sample.pdf']);
    await until(async () => (await page.locator('.card').count()) === 2, 'two cards');
    ok((await page.locator('.card-title', { hasText: 'The Lighthouse & the Sea' }).count()) === 1, 'EPUB title missing');
    ok((await page.locator('.card-author', { hasText: 'Ada Marlowe' }).count()) === 1, 'author missing');
    ok((await page.locator('.cover img').count()) >= 1, 'EPUB cover not shown');
    ok((await page.locator('.cover-ph').count()) >= 0, 'ok');
  });

  await step('corrupt EPUB -> error toast, library intact, no crash', async () => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setInputFiles('input[type=file]', [FIX + 'corrupt.epub']);
    await until(async () => (await page.locator('.toast.error').count()) > 0, 'error toast');
    ok((await page.locator('.card').count()) === 2, 'corrupt book was added');
    ok(errors.length === 0, 'uncaught page error: ' + errors[0]);
    return await toastText();
  });

  await step('unsupported file type -> friendly toast', async () => {
    await page.setInputFiles('input[type=file]', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await until(async () => /Only EPUB and PDF/.test(await toastText()), 'unsupported toast');
  });

  await step('add by drag & drop (and the overlay appears while dragging)', async () => {
    const sawOverlay = await page.evaluate(async (url) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'book-ja.epub', { type: 'application/epub+zip' }));
      const lib = document.querySelector('.lib');
      const fire = (type) => lib.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire('dragenter');
      fire('dragover');
      const shown = lib.classList.contains('dragging') && getComputedStyle(lib.querySelector('.drop-overlay')).display !== 'none';
      fire('drop');
      return shown;
    }, '/src/reader/fixtures/book-ja.epub');
    ok(sawOverlay, 'drop overlay not shown');
    await until(async () => (await page.locator('.card').count()) === 3, 'third card after drop');
    ok((await page.locator('.lib.dragging').count()) === 0, 'overlay stuck');
  });

  await step('open EPUB: loading state, chrome, 0%', async () => {
    await openFromLibrary('The Lighthouse');
    await page.getByRole('heading', { name: 'The Lighthouse & the Sea' }).waitFor();
    ok(parseInt(await pct()) <= 20, 'expected the first page, got ' + (await pct()));
    ok((await page.getByRole('slider', { name: 'Reading progress' }).isEnabled()), 'slider disabled');
  });

  await step('turn pages: ArrowRight, PageDown, Space, edge click, ArrowLeft, PageUp, Shift+Space', async () => {
    await until(async () => (await text('.chapter')).trim() !== '', 'the first reported position');
    let p = await pct();
    const seen = [p];
    for (const key of ['ArrowRight', 'PageDown', 'Space']) { p = await pressUntilTurn(key, p); seen.push(p); }
    await page.locator('.edge-r').click();
    p = await waitPageChange(p).catch(() => { throw new Error('edge click did not turn the page: ' + seen.join(' ')); }); seen.push(p);
    const forward = p;
    for (const key of ['ArrowLeft', 'PageUp', 'Shift+Space']) { p = await pressUntilTurn(key, p); seen.push(p); }
    await page.locator('.edge-l').click().catch(() => {});
    ok(parseInt(p) < parseInt(forward), 'did not go back');
    return seen.join(' ');
  });

  await step('keys also work with focus inside the book iframe', async () => {
    const { f } = await bookFrame();
    await f.evaluate(() => document.body.focus());
    let p = await pct();
    for (let i = 0; i < 4; i++) { // retry: foliate drops a turn requested while it is settling
      await f.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
      if (await until(async () => (await pct()) !== p, '', 1200).catch(() => false)) return;
    }
    throw new Error('ArrowRight inside the book iframe did not turn the page');
  });

  await step('slider jumps to ~50% and Contents lists chapters', async () => {
    await page.evaluate(() => {
      const s = document.querySelector('input[type=range]');
      s.value = '500';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(async () => { const n = parseInt(await pct()); return n >= 40 && n <= 60; }, 'about 50%');
    await page.keyboard.press('Tab'); // chrome visible
    await page.getByRole('button', { name: 'Contents' }).click();
    ok((await page.locator('dialog[open] .toc-item').count()) === 3, 'expected 3 chapters');
    await page.getByRole('button', { name: 'Chapter Three' }).click();
    ok((await page.locator('dialog[open]').count()) === 0, 'contents sheet stayed open');
    await until(async () => /Three/.test(await text('.chapter')), 'chapter label to say Three');
  });

  await step('chrome auto-hides, mouse move brings it back', async () => {
    await page.mouse.move(640, 400);
    await sleep(4800);
    ok(await page.locator('.reader.chrome-hidden').count(), 'chrome did not hide');
    ok(!(await page.locator('.bar-top').isVisible()), 'top bar still visible');
    await page.mouse.move(600, 420);
    await until(async () => !(await page.locator('.reader.chrome-hidden').count()), 'chrome to return', 2000);
  });

  let beforeReload;
  await step('resume: reload reopens the same page', async () => {
    await page.keyboard.press('ArrowRight');
    await sleep(1200); // > progress debounce
    beforeReload = { pct: await pct(), chapter: (await text('.chapter')).trim() };
    await page.reload();
    await page.locator('.reader').waitFor();
    await bookFrame(); // wait for the real content, not just the label
    await until(async () => (await pct()) === beforeReload.pct && (await text('.chapter')).trim() === beforeReload.chapter, `resume at ${beforeReload.pct} ${beforeReload.chapter}`, 20000);
    return JSON.stringify(beforeReload);
  });

  await step('selection -> popup: loading then result|error, placed inside viewport, Esc closes', async () => {
    const w = await visibleWord();
    await page.mouse.dblclick(w.x, w.y);
    await page.locator('.popup:not([hidden])').waitFor({ timeout: 5000 });
    const seen = [await page.locator('.popup').getAttribute('data-state')];
    const state = await until(async () => { const s = await page.locator('.popup').getAttribute('data-state'); return s !== 'loading' && s; }, 'lookup to settle', 20000);
    seen.push(state);
    const box = await page.locator('.popup').boundingBox();
    ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800, 'popup outside viewport ' + JSON.stringify(box));
    ok(['result', 'error'].includes(state), 'unexpected state ' + state);
    ok(await page.locator('.pop-word').first().isVisible(), 'selected word not shown');
    if (state === 'error') ok(/check your connection/.test(await text('.popup')), 'error text missing');
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('.popup:not([hidden])').count()) === 0, 'popup to close');
    return `${w.word}: ${seen.join(' -> ')}`;
  });

  await step('very long selection -> hint, no lookup', async () => {
    const { f } = await bookFrame();
    await f.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.body); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.locator('.popup:not([hidden])').waitFor({ timeout: 5000 });
    await until(async () => (await page.locator('.popup').getAttribute('data-state')) === 'too-long', 'too-long state');
    await page.mouse.click(5, 5); // outside click closes
    await until(async () => (await page.locator('.popup:not([hidden])').count()) === 0, 'outside click to close');
  });

  await step('settings: theme, text size, Japanese mode persist and apply to the book', async () => {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Reading settings' }).click();
    const { f } = await bookFrame();
    const fs0 = await f.evaluate(() => parseFloat(getComputedStyle(document.querySelector('p')).fontSize));
    const bg0 = await f.evaluate(() => getComputedStyle(document.body).color);
    await page.getByRole('button', { name: 'Dark theme' }).click();
    ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'app theme not dark');
    ok((await page.evaluate(() => localStorage.getItem('sr.theme'))) === 'dark', 'theme not remembered');
    await until(async () => (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(20, 20, 22)', 'app background to turn dark');
    await page.getByRole('button', { name: 'Larger text' }).click();
    await page.getByRole('button', { name: 'Larger text' }).click();
    ok((await text('.size-val')) === '120%', 'size label ' + (await text('.size-val')));
    const fs1 = await until(async () => { const v = await (await bookFrame()).f.evaluate(() => parseFloat(getComputedStyle(document.querySelector('p')).fontSize)); return v > fs0 && v; }, 'book text to grow');
    const col1 = await (await bookFrame()).f.evaluate(() => getComputedStyle(document.body).color);
    ok(col1 !== bg0, 'book colours did not follow the theme');
    await page.getByRole('button', { name: 'Sepia theme' }).click();
    ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'sepia', 'sepia');
    await page.keyboard.press('Escape'); // native dialog closes
    ok((await page.locator('dialog[open]').count()) === 0, 'settings did not close on Esc');
    await page.reload();
    await page.locator('.reader').waitFor();
    await until(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === 'sepia', 'sepia after reload');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Reading settings' }).click();
    ok((await text('.size-val')) === '120%', 'font size lost on reload: ' + (await text('.size-val')));
    await page.keyboard.press('Escape');
    return `${fs0}px -> ${fs1}px`;
  });

  await step('backup panel: four fields, both buttons, keys only in localStorage, status on missing fields', async () => {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Reading settings' }).click();
    for (const l of ['Account ID', 'Bucket', 'Access key ID', 'Secret access key']) await page.getByLabel(l).waitFor();
    ok((await page.getByLabel('Secret access key').getAttribute('type')) === 'password', 'secret not masked');
    await page.getByLabel('Account ID').fill('acct123');
    ok(JSON.parse(await page.evaluate(() => localStorage.getItem('sr.r2'))).accountId === 'acct123', 'not stored in localStorage');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await until(async () => /Fill in all four fields/.test(await text('.status')), 'validation message');
    await page.getByLabel('Bucket').fill('b'); await page.getByLabel('Access key ID').fill('k'); await page.getByLabel('Secret access key').fill('s');
    await page.getByRole('button', { name: 'Restore' }).click();
    await until(async () => /Restore failed/.test(await text('.status')), 'failure status (no real bucket)', 20000);
    ok(await page.locator('.cors').isVisible(), 'CORS hint missing');
    ok((await page.locator('.cors pre').textContent()).length > 20, 'CORS text empty');
    await page.keyboard.press('Escape');
  });

  await step('Japanese book: furigana mode adds <ruby>, Off removes it', async () => {
    await backToLibrary();
    await openFromLibrary(); // first card is the newest = the Japanese book
    const { f } = await bookFrame();
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Reading settings' }).click();
    await page.getByRole('button', { name: 'Furigana', exact: true }).click();
    const rubies = () => bookFrame().then(({ f }) => f.evaluate(() => document.querySelectorAll('ruby').length)).catch(() => 0);
    const n = await until(rubies, 'ruby elements (needs the Japanese dictionary)', 40000);
    await page.getByRole('button', { name: 'Romaji' }).click();
    await sleep(1500);
    await page.getByRole('button', { name: 'Off', exact: true }).click();
    await until(async () => (await rubies()) === 0, 'ruby removed when Off', 10000);
    await page.keyboard.press('Escape');
    return `${n} <ruby> elements with Furigana`;
  });

  await step('back to library shows progress; remove asks first, cancel keeps, confirm removes', async () => {
    await backToLibrary();
    ok((await page.locator('.card').count()) === 3, 'expected 3 cards, got ' + (await page.locator('.card').count()) + ' on ' + page.url());
    const label = await page.locator('.card-open').nth(1).getAttribute('aria-label').catch(() => '');
    const hasProgress = await page.locator('.card-open[aria-label*="% read"]').count();
    ok(hasProgress >= 1, 'no card reports progress');
    await page.getByRole('button', { name: /^Remove / }).first().click();
    ok(await page.locator('.card.confirming').count(), 'confirm panel missing');
    await page.locator('.card.confirming').getByRole('button', { name: 'Cancel' }).click();
    ok((await page.locator('.card').count()) === 3, 'cancel removed a book');
    await page.getByRole('button', { name: /^Remove / }).first().click();
    await page.locator('.card.confirming .confirm .danger').click();
    await until(async () => (await page.locator('.card').count()) === 2, 'card removed');
    return label;
  });

  await step('PDF opens and pages turn', async () => {
    await page.locator('.card:not(:has(.card-title:text("Lighthouse"))) .card-open').first().click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'pdf to load', 20000);
    const before = await pct();
    await page.keyboard.press('ArrowRight');
    await waitPageChange(before);
    await page.keyboard.press('ArrowLeft');
  });

  await step('mobile 390x844: no horizontal scroll, 44px targets, popup is a bottom sheet', async () => {
    await backToLibrary();
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    ok((await overflowX()) <= 0, 'library scrolls horizontally on phone');
    const small = await page.evaluate(() => [...document.querySelectorAll('.lib button, .lib .icon-btn')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map((b) => b.className + ':' + b.textContent.trim()));
    ok(small.length === 0, 'small targets: ' + small.join(', '));
    await page.getByRole('button', { name: /^Open The Lighthouse/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to load', 20000);
    ok((await overflowX()) <= 0, 'reader scrolls horizontally on phone');
    const isEpub = await page.locator('.reader iframe, .reader foliate-view').count();
    if (isEpub) {
      const w = await visibleWord();
      await page.mouse.dblclick(w.x, w.y);
      await page.locator('.popup:not([hidden])').waitFor({ timeout: 5000 });
      let box;
      await until(async () => { box = await page.locator('.popup').boundingBox(); return Math.abs(box.y + box.height - 844) < 1; }, 'the sheet to rest on the bottom edge', 4000)
        .catch(() => { throw new Error('popup is not a bottom sheet: ' + JSON.stringify(box)); });
      ok(Math.abs(box.x) < 1 && Math.abs(box.width - 390) < 1, 'sheet is not full width: ' + JSON.stringify(box));
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('theme default follows prefers-color-scheme until the user picks', async () => {
    await page.evaluate(() => localStorage.removeItem('sr.theme'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(BASE + '#');
    await page.reload();
    await page.locator('.lib').waitFor();
    ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'system dark not followed');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Light theme' }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('.lib').waitFor();
    ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'explicit pick lost to system scheme');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
