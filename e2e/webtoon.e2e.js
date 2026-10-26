// Webtoon mode in a real browser: a comic opened as one vertical strip (real app, real OPFS, real CBZ built in the page).
// Runs inside e2e/run-annotations.mjs: plain Playwright code, nothing mocked.
async (page, ctx = {}) => {
  const BASE = ctx.BASE ?? 'http://localhost:5199/';
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

  const label = async () => (await page.locator('.chapter').first().textContent()).trim(); // "2 / 6"
  const pageNo = async () => Number((await label()).split(' / ')[0]);
  const scrollTop = () => page.evaluate(() => document.querySelector('.sr-manga').scrollTop);
  const chrome = async () => { await page.mouse.move(640, 20); await page.mouse.move(600, 24); };
  async function topButton(name) { await chrome(); return page.locator('.bar-top').getByRole('button', { name }); }
  async function openBook(title) {
    await page.getByRole('button', { name: new RegExp(`^Open ${title}`) }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to load', 20000);
    await until(async () => /^\d+ \/ \d+$/.test(await label()), 'the page label', 20000);
  }
  async function backToLibrary() {
    await (await topButton('Back to library')).click();
    await page.locator('.lib').waitFor();
  }
  /** Turns the webtoon setting on or off from the settings sheet, then waits for the view to change. */
  async function setWebtoon(on) {
    await (await topButton('Reading settings')).click();
    const box = page.getByRole('checkbox', { name: 'Vertical scroll (webtoon)' });
    if ((await box.isChecked()) !== on) await box.click();
    eq(await box.isChecked(), on, 'webtoon checkbox');
    await page.keyboard.press('Escape');
    await until(async () => !(await page.locator('dialog[open]').count()), 'settings closed');
    await until(async () => (await page.locator('.sr-strip').count()) === (on ? 1 : 0), on ? 'the strip' : 'the spread', 8000);
  }

  // ---- real comics, built in the page with the repo's zip writer: 6 tall pages, and 40 short ones ----
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE);
  await page.locator('.lib').waitFor();
  const built = await page.evaluate(async () => {
    const { storeZip } = await import('/src/storage/store-zip.ts');
    const pages = async (count, w, h) => {
      const files = {};
      for (let n = 1; n <= count; n++) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d');
        x.fillStyle = `hsl(${(n * 47) % 360} 55% 75%)`;
        x.fillRect(0, 0, w, h);
        x.fillStyle = '#222';
        x.font = `bold ${Math.round(h / 3)}px sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(String(n), w / 2, h / 2);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        files[`${String(n).padStart(3, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
      }
      return files;
    };
    const base64 = (bytes) => {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return {
      tall: base64(storeZip(await pages(6, 600, 1200))), // 2 : 1 pages, 2560 px tall at the 1280 px window
      many: base64(storeZip(await pages(40, 600, 300))), // 1 : 2 pages, 640 px tall
    };
  });
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-webtoon-'));
  fs.writeFileSync(path.join(DIR, 'Tall Strip.cbz'), Buffer.from(built.tall, 'base64'));
  fs.writeFileSync(path.join(DIR, 'Many Pages.cbz'), Buffer.from(built.many, 'base64'));
  await page.setInputFiles('input[type=file]', [path.join(DIR, 'Tall Strip.cbz'), path.join(DIR, 'Many Pages.cbz')]);
  await until(async () => (await page.locator('.card').count()) === 2, 'two cards');

  await step('the webtoon setting is off by default, and its toggle sits with the comic settings', async () => {
    await openBook('Tall Strip');
    ok((await page.locator('.sr-strip').count()) === 0, 'a strip is shown by default');
    eq(await page.locator('.sr-manga img').first().getAttribute('alt'), 'Page 1', 'paged first page');
    await (await topButton('Reading settings')).click();
    const box = page.getByRole('checkbox', { name: 'Vertical scroll (webtoon)' });
    ok(await box.isVisible(), 'webtoon toggle hidden for a comic');
    eq(await box.isChecked(), false, 'webtoon starts off');
    ok(await page.getByRole('checkbox', { name: 'Right to left' }).isVisible(), 'right to left hidden while paged');
    await page.keyboard.press('Escape');
    await backToLibrary();
  });

  await step('webtoon on: every page is in one scrolling column, each as wide as the window', async () => {
    await openBook('Tall Strip');
    await setWebtoon(true);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.sr-manga');
      const column = root.querySelector('.sr-strip');
      const slots = [...column.children].map((s) => s.getBoundingClientRect());
      return {
        inRoot: column.parentElement === root,
        pages: slots.length,
        scrollable: root.scrollHeight > root.clientHeight,
        fullWidth: Math.round(column.getBoundingClientRect().width) === root.clientWidth,
        contiguous: slots.every((r, i) => i === 0 || Math.abs(r.top - slots[i - 1].bottom) < 1),
      };
    });
    eq(m, { inRoot: true, pages: 6, scrollable: true, fullWidth: true, contiguous: true }, 'strip');
    await (await topButton('Reading settings')).click();
    ok(!(await page.getByRole('group', { name: 'Page layout' }).isVisible()), 'page layout still shown in the strip');
    ok(!(await page.getByRole('checkbox', { name: 'Right to left' }).isVisible()), 'right to left still shown in the strip');
    await page.keyboard.press('Escape');
  });

  await step('scrolling changes the "page X / Y" label', async () => {
    await page.mouse.move(640, 400);
    eq(await label(), '1 / 6', 'starts on page 1');
    await page.mouse.wheel(0, 4000);
    await until(async () => (await label()) === '2 / 6', 'page 2 after scrolling');
  });

  await step('next() moves about a screen (PageDown), and the arrow keys still scroll natively', async () => {
    await page.mouse.click(640, 400); // the strip takes focus, so the arrow keys scroll it
    const a = await scrollTop();
    await page.keyboard.press('PageDown');
    await until(async () => (await scrollTop()) !== a, 'PageDown to scroll');
    const screen = (await scrollTop()) - a;
    ok(Math.abs(screen - 720) <= 2, `PageDown moved ${screen} px, expected about 720 (90% of the 800 px window)`);
    const b = await scrollTop();
    await page.keyboard.press('ArrowDown');
    await until(async () => (await scrollTop()) !== b, 'ArrowDown to scroll natively');
    const arrow = (await scrollTop()) - b;
    ok(arrow > 0 && arrow < 200, `ArrowDown moved ${arrow} px, expected a small native step`);
    return `PageDown ${screen} px, ArrowDown ${arrow} px`;
  });

  await step('the progress survives closing and reopening the book', async () => {
    const before = await label();
    await sleep(900); // the progress save is debounced
    await backToLibrary();
    await openBook('Tall Strip');
    await until(async () => (await label()) === before, 'the saved page', 8000);
    ok((await page.locator('.sr-strip').count()) === 1, 'reopened in the strip');
    return `reopened at ${before}`;
  });

  await step('switching webtoon off returns to the paged spread on the same page; on again keeps it', async () => {
    const before = await label(); // page 2 starts a two-page spread, so the paged view shows this same page
    await setWebtoon(false);
    await until(async () => (await label()) === before, 'the same page in the spread');
    const n = Number(before.split(' / ')[0]);
    const alts = await until(async () => {
      const a = await page.locator('.sr-manga img').evaluateAll((els) => els.map((e) => e.alt));
      return a.length && a; // the spread decodes its pages after it is drawn
    }, 'the paged spread');
    ok(alts.includes(`Page ${n}`), `spread shows ${alts}, not Page ${n}`);
    await setWebtoon(true);
    eq(await label(), before, 'label after switching back on');
  });

  await step('a long book keeps only a window of its pages decoded, and the others keep their height', async () => {
    await backToLibrary();
    await openBook('Many Pages');
    await until(async () => (await page.locator('.sr-strip img[src]').count()) > 0, 'the first pages to decode');
    const near = await page.locator('.sr-strip img[src]').count();
    ok(near >= 1 && near <= 8, `${near} of 40 pages decoded at the top`);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 9000);
    await until(async () => (await pageNo()) >= 12, 'scrolled into the book');
    await sleep(400);
    const far = await page.evaluate(() => {
      const slots = [...document.querySelector('.sr-strip').children];
      return {
        decoded: document.querySelectorAll('.sr-strip img[src]').length,
        firstDecoded: !!slots[0].querySelector('img'),
        firstHeight: slots[0].style.height,
        width: document.querySelector('.sr-manga').clientWidth,
      };
    });
    ok(far.decoded >= 1 && far.decoded <= 8, `${far.decoded} of 40 pages decoded after scrolling`);
    eq(far.firstDecoded, false, 'page 1 still decoded far below it');
    ok(Math.abs(parseFloat(far.firstHeight) - far.width / 2) < 1, `page 1 placeholder is ${far.firstHeight}, expected half the column width`);
    return `${near} decoded at the top, ${far.decoded} after scrolling`;
  });

  await step('the progress slider jumps to a page, and the right edge tap turns a screen', async () => {
    await page.evaluate(() => {
      const s = document.querySelector('input[type=range]');
      s.value = '500';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(async () => (await label()) === '20 / 40', 'page 20 from the slider');
    const a = await scrollTop();
    await page.locator('.edge-r').click();
    await until(async () => (await scrollTop()) !== a, 'the edge tap to scroll');
    const d = (await scrollTop()) - a;
    ok(Math.abs(d - 720) <= 2, `edge tap moved ${d} px, expected about 720`);
  });

  await step('at a 360 px phone width the strip fills the screen, with no sideways scroll', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await sleep(500);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.sr-manga');
      return { overflow: root.scrollWidth - root.clientWidth, width: Math.round(document.querySelector('.sr-strip').getBoundingClientRect().width), window: root.clientWidth };
    });
    eq([m.overflow, m.width], [0, m.window], 'phone strip: no sideways scroll, the strip as wide as the window');
    ok(m.window >= 340 && m.window <= 360, `window is ${m.window} px`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await sleep(500);
  });

  await step('a text size above 100% makes the strip wider than the window, so it scrolls sideways', async () => {
    await (await topButton('Reading settings')).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Larger text' }).click();
    await page.keyboard.press('Escape');
    await until(async () => (await page.locator('.sr-manga').evaluate((r) => r.scrollWidth - r.clientWidth)) > 0, 'sideways scroll');
    const w = await page.locator('.sr-strip').evaluate((c) => c.getBoundingClientRect().width / c.parentElement.clientWidth);
    ok(Math.abs(w - 1.5) < 0.02, `strip is ${w.toFixed(2)} of the window, expected 1.5`);
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
};
