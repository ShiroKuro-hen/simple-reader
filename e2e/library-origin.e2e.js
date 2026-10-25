// Where each book came from, shown as a strip on its cover: a file added on this device, or a book that came down from
// the cloud. Real app, real OPFS and the real storage path (addBook), like the other library specs.
// Run through e2e/run-annotations.mjs.
async (page, ctx = {}) => {
  const BASE = ctx.BASE ?? 'http://localhost:5199/';
  const results = [];
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const step = async (name, fn) => {
    try { results.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { results.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
  };

  const LIGHT = 'The Lighthouse & the Sea';
  const NEKO = '吾輩は猫である';
  const strip = (title) => page.locator('.grid .card', { hasText: title }).locator('.card-origin');

  async function seed(books) {
    await page.evaluate(async (books) => {
      const { addBook } = await import('/src/storage/library.ts');
      for (const [name, fromCloud] of books) {
        const bytes = await (await fetch('/src/reader/fixtures/' + name)).arrayBuffer();
        await addBook(new File([bytes], name), { fromCloud });
      }
    }, books);
    await page.reload();
    await page.locator('.lib').waitFor();
    await page.locator('.grid .card').first().waitFor();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE);
  await page.evaluate(async () => {
    localStorage.clear();
    const d = await navigator.storage.getDirectory();
    for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true });
  });
  await page.goto(BASE + '#');
  await page.reload();
  await page.locator('.lib').waitFor();
  await seed([['book-en.epub', false], ['book-ja.epub', true]]);

  await step('every cover has a strip saying where the book came from', async () => {
    ok((await strip(LIGHT).textContent()).trim() === 'This device', 'local strip: ' + (await strip(LIGHT).textContent()));
    ok((await strip(NEKO).textContent()).trim() === 'Cloud', 'cloud strip: ' + (await strip(NEKO).textContent()));
    ok((await strip(LIGHT).getAttribute('data-origin')) === 'local' && (await strip(NEKO).getAttribute('data-origin')) === 'cloud', 'data-origin');
    ok((await strip(LIGHT).locator('svg').count()) === 1 && (await strip(NEKO).locator('svg').count()) === 1, 'each strip has an icon');
  });

  await step('the strip is a band along the bottom edge of the cover, inside it', async () => {
    for (const title of [LIGHT, NEKO]) {
      const card = page.locator('.grid .card', { hasText: title });
      const cover = await card.locator('.cover').boundingBox();
      const band = await strip(title).boundingBox();
      ok(Math.abs(band.width - cover.width) <= 1, `${title}: band ${band.width} wide, cover ${cover.width}`);
      ok(Math.abs(band.y + band.height - (cover.y + cover.height)) <= 1, `${title}: band is not on the bottom edge`);
      ok(band.height > 14 && band.height < cover.height / 4, `${title}: band height ${band.height}`);
    }
  });

  await step('the strip does not change what the card button is called or what a click does', async () => {
    ok((await page.getByRole('button', { name: `Open ${LIGHT}`, exact: true }).count()) === 1, 'card name changed');
    await strip(NEKO).click();
    await page.locator('.reader').waitFor();
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
