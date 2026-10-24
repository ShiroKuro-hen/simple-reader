// Library organising in a real browser: favorites (the star), categories, "Continue reading", and adding a folder of
// page images as a series of comic volumes. Real app, real OPFS, real fixtures and real PNG files written to disk.
// Plain Playwright code like the other specs: run through e2e/run-annotations.mjs.
async (page, ctx = {}) => {
  const BASE = ctx.BASE ?? 'http://localhost:5199/';
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { deflateSync } = await import('node:zlib');
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
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  const gridTitles = () => page.locator('.grid .card-title').allTextContents();
  const shelfTitles = () => page.locator('.shelf-row .card-title').allTextContents();
  const chip = (label) => page.locator('.tag-chips .chip', { hasText: label });
  const search = page.locator('input[type=search]');
  const count = async () => (await page.locator('.lib-count').textContent()).trim();
  const star = (title, on) => page.getByRole('button', { name: `${on ? 'Remove' : 'Add'} ${title} ${on ? 'from' : 'to'} favorites`, exact: true });
  const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

  const LIGHT = 'The Lighthouse & the Sea';
  const PDF = 'Sample PDF Manual';
  const SERIES = 'Comic Pics';

  async function openFromLibrary(titlePart) {
    await page.locator('.grid').getByRole('button', { name: new RegExp(`^Open ${titlePart}`) }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to finish loading', 20000);
  }
  async function backToLibrary() {
    await page.keyboard.press('Tab'); // reveals the reader's chrome
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
    await until(async () => (await page.locator('.card').count()) > 0, 'library to list books');
  }
  // Books go in through the real storage path (addBook), then the library is reloaded to list them.
  async function seedBooks(names) {
    await page.evaluate(async (names) => {
      const { addBook } = await import('/src/storage/library.ts');
      for (const name of names) {
        const bytes = await (await fetch('/src/reader/fixtures/' + name)).arrayBuffer();
        await addBook(new File([bytes], name), {});
      }
    }, names);
    await page.reload();
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

  // A real PNG of one flat colour: zlib from node, the crc by hand.
  const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function png(w, h, [r, g, b]) {
    const row = Buffer.alloc(1 + w * 3); // filter byte 0, then RGB pixels
    for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
    const chunk = (type, data) => {
      const td = Buffer.concat([Buffer.from(type), data]);
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
  }

  // "Comic Pics": pages at the top, one volume per folder that holds pages (Vol 2/extras is one too), and files to ignore.
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-images-'));
  const ROOT_DIR = path.join(TMP, SERIES);
  for (const dir of ['Vol 1', 'Vol 2/extras', '__MACOSX']) fs.mkdirSync(path.join(ROOT_DIR, dir), { recursive: true });
  fs.writeFileSync(path.join(ROOT_DIR, 'cover.png'), png(60, 90, [200, 60, 60]));
  fs.writeFileSync(path.join(ROOT_DIR, '02.png'), png(60, 90, [60, 60, 200]));
  fs.writeFileSync(path.join(ROOT_DIR, 'Vol 1', '1.png'), png(60, 90, [60, 160, 90]));
  fs.writeFileSync(path.join(ROOT_DIR, 'Vol 1', '2.png'), png(60, 90, [90, 160, 60]));
  fs.writeFileSync(path.join(ROOT_DIR, 'Vol 2', '1.png'), png(60, 90, [160, 60, 160]));
  fs.writeFileSync(path.join(ROOT_DIR, 'Vol 2', 'extras', 'x.png'), png(60, 90, [60, 160, 160]));
  fs.writeFileSync(path.join(ROOT_DIR, '__MACOSX', '._junk.png'), Buffer.from('junk'));
  fs.writeFileSync(path.join(ROOT_DIR, 'notes.txt'), 'not a page');

  async function pickFolder(folder) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add folder' }).click()]);
    await chooser.setFiles(folder);
  }
  const folderDialog = () => page.getByRole('dialog', { name: /^Add folder/ });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await resetApp();
  await seedBooks(['book-en.epub', 'sample.pdf', 'book-ja.epub']);

  await step('favorites: the star adds a book, a Favorites chip appears first, and the chip filters like a category', async () => {
    await star(LIGHT, false).click();
    await until(async () => (await chip('Favorites').count()) === 1, 'Favorites chip');
    ok((await page.locator('.tag-chips .chip').first().textContent()).includes('Favorites'), 'Favorites is not the first chip');
    ok((await star(LIGHT, true).getAttribute('aria-pressed')) === 'true', 'star of a favorite is not pressed');
    await until(async () => (await focusedLabel()) === `Remove ${LIGHT} from favorites`, 'focus to stay on the star: ' + (await focusedLabel()));
    await chip('Favorites').click();
    await until(async () => (await gridTitles()).join() === LIGHT, 'only the favorite listed');
    ok((await count()) === '1 of 3 books', 'count with the Favorites filter: ' + (await count()));
    await star(LIGHT, true).click();
    await until(async () => (await chip('Favorites').count()) === 0, 'Favorites chip to vanish with its last book');
    ok((await gridTitles()).length === 3, 'selection was not dropped when the last favorite went');
  });

  await step('favorites: the star works from the keyboard with a visible focus ring', async () => {
    await star(PDF, false).focus();
    await page.keyboard.press('Enter');
    await until(async () => (await star(PDF, true).count()) === 1, 'star pressed by Enter');
    ok(await page.evaluate(() => document.activeElement.matches(':focus-visible')), 'focus is not visible');
    ok((await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)) !== 'none', 'no focus outline');
    await page.keyboard.press('Enter');
    await until(async () => (await star(PDF, false).count()) === 1, 'star unpressed by Enter');
  });

  await step('categories: the words say category; a new one is a chip that vanishes with its last book, and a selection of it is dropped', async () => {
    ok((await page.getByPlaceholder('Search title, author or category').count()) === 1, 'search placeholder does not say category');
    await page.getByRole('button', { name: `Edit categories of ${PDF}`, exact: true }).click();
    const dlg = page.getByRole('dialog', { name: `Categories of ${PDF}` });
    await dlg.waitFor();
    ok((await dlg.getByRole('heading', { name: 'Categories', exact: true }).count()) === 1, 'dialog heading is not Categories');
    await page.locator('.tag-input').fill('');
    await page.keyboard.press('Enter');
    ok(/Type a category first\./.test(await dlg.locator('.tag-error').textContent()), 'empty error does not say category');
    await page.locator('.tag-input').fill('to start');
    await page.keyboard.press('Enter');
    await until(async () => (await dlg.locator('.chip', { hasText: 'to start' }).count()) === 1, 'the new category in the sheet');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('dialog.tag-sheet').waitFor({ state: 'detached' });
    await until(async () => (await chip('to start').count()) === 1, 'the category chip');
    await chip('to start').click();
    await until(async () => (await gridTitles()).join() === PDF, 'only the categorised book listed');
    await page.getByRole('button', { name: `Edit categories of ${PDF}`, exact: true }).click();
    await page.getByRole('button', { name: 'Remove category to start', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('dialog.tag-sheet').waitFor({ state: 'detached' });
    await until(async () => (await chip('to start').count()) === 0, 'the category chip to vanish');
    await until(async () => (await gridTitles()).length === 3, 'the selection to be dropped and all books back');
  });

  await step('recents: opened books are in Continue reading, newest first, though no page was turned', async () => {
    ok((await page.locator('.shelf').count()) === 0, 'a shelf before anything was opened');
    await openFromLibrary('The Lighthouse');
    await backToLibrary();
    await openFromLibrary('Sample PDF');
    await backToLibrary();
    await until(async () => (await shelfTitles()).join() === [PDF, LIGHT].join(), 'the shelf newest first: ' + (await shelfTitles()).join(' | '));
    ok((await gridTitles()).length === 3, 'the grid lost books');
    ok((await page.locator('.shelf-card button.card-open').count()) === 2, 'shelf cards are not open buttons');
    ok((await page.locator('.shelf .card-remove, .shelf .card-fav, .shelf .card-tags').count()) === 0, 'the shelf has edit buttons');
  });

  await step('recents: the shelf is hidden while searching or filtering by category, and back once cleared; 360 px, no sideways scroll', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await search.fill('lighthouse');
    await until(async () => (await page.locator('.shelf').count()) === 0, 'no shelf while searching');
    await search.fill('');
    await until(async () => (await page.locator('.shelf').count()) === 1, 'shelf back after clearing the search');
    ok((await overflowX()) <= 0, 'the library scrolls sideways at 360 px');
    await star(LIGHT, false).click();
    await chip('Favorites').click();
    await until(async () => (await page.locator('.shelf').count()) === 0, 'no shelf while a category is selected');
    await chip('Favorites').click();
    await until(async () => (await page.locator('.shelf').count()) === 1, 'shelf back after the category is cleared');
    await star(LIGHT, true).click();
    await until(async () => (await chip('Favorites').count()) === 0, 'Favorites chip to vanish');
    const small = await page.evaluate(() => [...document.querySelectorAll('.grid .icon-btn')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map((b) => b.className));
    ok(small.length === 0, 'small card buttons at 360 px: ' + small.join(', '));
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('folder of images: subfolders and root pages make one series with one volume per folder; covers show; a volume opens at page 1', async () => {
    await pickFolder(ROOT_DIR);
    await folderDialog().waitFor();
    ok((await folderDialog().getByLabel('Image folders (4 volumes)').isChecked()) === true, 'the image folders row is not checked');
    ok((await folderDialog().getByText(`4 books will be added to "${SERIES}"`).count()) === 1, 'summary does not count the volumes');
    await folderDialog().getByRole('button', { name: 'Add', exact: true }).click();
    await until(async () => (await page.getByRole('button', { name: `Open series ${SERIES}, 4 volumes` }).count()) === 1, 'the series card');
    ok((await count()) === '7 books', 'library count after the folder: ' + (await count()));
    await until(() => page.evaluate(() => {
      const img = document.querySelector('.card.series img');
      return !!img && img.complete && img.naturalWidth > 0;
    }), 'the series cover to decode');
    await page.getByRole('button', { name: `Open series ${SERIES}, 4 volumes` }).click();
    await until(async () => (await gridTitles()).join('|') === [SERIES, 'extras', 'Vol 1', 'Vol 2'].join('|'), 'the four volumes in order: ' + (await gridTitles()).join('|'));
    await until(() => page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.grid .cover img')];
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    }), 'every volume cover to decode');
    await openFromLibrary('Vol 1');
    await until(async () => (await page.locator('.chapter').textContent()).trim() === '1 / 2', 'the first page of Vol 1 (2 pages)', 20000);
    await backToLibrary();
    if ((await page.locator('.series-back').count()) === 1) await page.locator('.series-back').click();
  });

  await step('folder of images: adding the same folder again does not duplicate its volumes', async () => {
    await pickFolder(ROOT_DIR);
    await folderDialog().waitFor();
    await folderDialog().getByRole('button', { name: 'Add', exact: true }).click();
    await until(async () => /Added 4 books to "Comic Pics"/.test(await toastText()), 'the second add to finish');
    await until(async () => (await count()) === '7 books', 'still seven books');
    ok((await page.getByRole('button', { name: `Open series ${SERIES}, 4 volumes` }).count()) === 1, 'the series changed after re-adding');
  });

  fs.rmSync(TMP, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
