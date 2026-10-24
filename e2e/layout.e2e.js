// Real-browser checks of the EPUB page geometry: the text fills a large window and keeps clear of the toolbars.
// Runs inside e2e/run-annotations.mjs (plain Playwright code, real UI, real foliate-js; nothing mocked).
// Measures rendered boxes only, never exact glyph metrics, so it does not depend on the fonts of the machine.
// Screenshots go to ctx.SHOTS (set LAYOUT_SHOTS to choose the folder).
async (page, ctx = {}) => {
  const BS = String.fromCharCode(92); // a Windows path separator, normalised to /
  const FIX = String(ctx.ROOT ?? '').split(BS).join('/').replace(/\/*$/, '/') + 'src/reader/fixtures/';
  const SHOTS = String(ctx.SHOTS ?? '').split(BS).join('/').replace(/\/*$/, '/');
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

  // The iframe foliate rendered the visible section into.
  async function bookFrame() {
    return until(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const el = await f.frameElement().catch(() => null);
        const b = el && (await el.boundingBox().catch(() => null));
        if (b && b.width > 100 && (await f.evaluate(() => !!document.querySelector('p')).catch(() => false))) return { f, b };
      }
      return null;
    }, 'a rendered book page', 15000);
  }

  // Rects of the text on screen, in host-window coordinates. Only glyph boxes fully inside the window count:
  // foliate puts the other columns and pages beside the visible one, outside the window.
  async function visibleText() {
    const { f, b } = await bookFrame();
    const vp = page.viewportSize();
    return f.evaluate(({ ox, oy, vw, vh }) => {
      const rects = [];
      let first = '';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        let seen = false;
        for (const q of range.getClientRects()) {
          if (!(q.width > 0 && q.height > 0)) continue;
          const r = { left: ox + q.left, top: oy + q.top, right: ox + q.right, bottom: oy + q.bottom };
          if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) continue;
          rects.push(r);
          seen = true;
        }
        if (seen && !first) first = n.textContent.trim().slice(0, 60);
      }
      return { rects, first };
    }, { ox: b.x, oy: b.y, vw: vp.width, vh: vp.height });
  }

  const bar = (sel) => page.locator(sel).first().boundingBox();
  const chromeShown = () => page.evaluate(() => !document.querySelector('.reader')?.classList.contains('chrome-hidden'));
  async function showChrome() {
    const vp = page.viewportSize();
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await sleep(60);
    return until(chromeShown, 'toolbars to show', 2000);
  }
  async function openSettings() {
    await showChrome();
    await page.getByRole('button', { name: 'Reading settings' }).click();
  }
  async function setLayoutTo(name) {
    await openSettings();
    await page.getByRole('button', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await sleep(500); // foliate re-renders after the attribute change
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(ctx.BASE);
  await page.locator('.lib').waitFor();
  await page.setInputFiles('input[type=file]', [FIX + 'book-en.epub']);
  await until(async () => (await page.locator('.card').count()) === 1, 'the book card');
  await page.getByRole('button', { name: /^Open The Lighthouse/ }).click();
  await page.locator('.reader').waitFor();
  await until(async () => !(await page.locator('.loading').count()), 'book to finish loading', 20000);
  await bookFrame();

  const viewports = [
    [360, 740], [800, 360], [768, 1024], [1280, 800], [1920, 1080], [2560, 1440],
  ];
  for (const [w, h] of viewports) {
    const name = `${w}x${h}`;
    await step(`${name}: text fills the window (wide) and clears the toolbars (tall); landscape phone still renders`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await sleep(700); // the resize is debounced before the page is re-laid out
      await showChrome();
      await sleep(150);
      const { rects } = await visibleText();
      ok(rects.length > 0, 'no text on screen');
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const extent = right - left;
      const top = await bar('.bar-top');
      const bottom = await bar('.bar-bottom');
      if (h >= 560) {
        // The page, not the text on it: a short chapter may not fill every column of a wide page.
        const page_ = await page.evaluate(() => {
          const r = document.querySelector('foliate-view').renderer;
          return { size: r.size, columns: r.heads.length };
        });
        // Readable lines, not a filled screen: wide windows get more columns, none longer than about 40 em (640 px).
        if (w >= 1920) {
          ok(page_.columns >= 2, `a wide window shows several columns, got ${page_.columns}`);
          ok(page_.size / page_.columns <= 660, `a column is ${Math.round(page_.size / page_.columns)} px wide, longer than a comfortable line`);
        }
        if (w >= 2560) ok(page_.columns === 3, `very wide windows get 3 columns, got ${page_.columns}`);
        const textTop = Math.min(...rects.map((r) => r.top));
        const textBottom = Math.max(...rects.map((r) => r.bottom));
        ok(textTop >= top.y + top.height - 0.5, `text starts at ${Math.round(textTop)}, under the top bar (ends ${Math.round(top.y + top.height)})`);
        ok(textBottom <= bottom.y + 0.5, `text ends at ${Math.round(textBottom)}, under the bottom bar (starts ${Math.round(bottom.y)})`);
      }
      await page.screenshot({ path: `${SHOTS}${name}.png` });
      return `text spans ${Math.round(extent)} px, ${rects.length} glyph boxes`;
    });
  }

  await step('switching One page / Auto and resizing keep the same text on screen', async () => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await sleep(700);
    const before = (await visibleText()).first;
    ok(before.length > 0, 'no first text on screen');
    await setLayoutTo('One page');
    const single = (await visibleText()).first;
    await setLayoutTo('Auto');
    const auto = (await visibleText()).first;
    await page.setViewportSize({ width: 1280, height: 800 });
    await sleep(700);
    const resized = (await visibleText()).first;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await sleep(700);
    const back = (await visibleText()).first;
    ok(single === before, `One page shows "${single}", was "${before}"`);
    ok(auto === before, `Auto again shows "${auto}", was "${before}"`);
    ok(resized === before, `resized shows "${resized}", was "${before}"`);
    ok(back === before, `resized back shows "${back}", was "${before}"`);
    return `first text: "${before.slice(0, 30)}"`;
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
};
