// Reading through a series in a real browser: volumes in number order (full-width digits too), marking a volume read
// by hand, and the "next volume" offer at the end of one. Real app, real OPFS, real comic archives built in the page.
// Run through e2e/run-annotations.mjs.
async (page, ctx = {}) => {
  const BASE = ctx.BASE ?? 'http://localhost:5199/';
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
  const titles = () => page.locator('.grid .card-title').allTextContents();
  const readBtn = (title, on) => page.getByRole('button', { name: `Mark ${title} as ${on ? 'unread' : 'read'}`, exact: true });

  // Three volumes (long enough that the last spread is past 97%) whose titles only order right by their number: "２" < "１０" although "１０" sorts before "２" as text.
  async function seed() {
    await page.evaluate(async () => {
      const { addBook } = await import('/src/storage/library.ts');
      const { storeZip } = await import('/src/storage/store-zip.ts');
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      for (const [title, pages] of [['Saga １０', 62], ['Saga ２', 61], ['Saga １', 60]]) {
        const files = {};
        for (let i = 1; i <= pages; i++) files[`${i}.png`] = png;
        await addBook(new File([storeZip(files)], `${title}.cbz`), { series: 'Saga' });
      }
    });
    await page.reload();
    await page.locator('.lib').waitFor();
    await page.locator('.card.series').waitFor();
  }
  async function openSeries() {
    await page.locator('.card.series .card-open').click();
    await page.locator('.series-head').waitFor();
  }
  async function openVolume(title) {
    await page.locator('.grid').getByRole('button', { name: new RegExp(`^Open ${title}(?![０-９0-9])`) }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'the volume to load', 20000);
  }
  async function toEnd() {
    await page.evaluate(() => {
      const s = document.querySelector('input[type=range][aria-label="Reading progress"]');
      s.value = '1000';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
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
  await seed();
  await openSeries();

  await step('the volumes of a series are listed by their number', async () => {
    const got = await titles();
    ok(JSON.stringify(got) === JSON.stringify(['Saga １', 'Saga ２', 'Saga １０']), JSON.stringify(got));
  });

  await step('a volume can be marked read by hand, and stays marked after a reload', async () => {
    await readBtn('Saga １', false).click();
    await readBtn('Saga １', true).waitFor();
    ok((await readBtn('Saga １', true).getAttribute('aria-pressed')) === 'true', 'not pressed');
    await page.reload();
    await page.locator('.lib').waitFor();
    await page.locator('.card.series').waitFor();
    await openSeries();
    await readBtn('Saga １', true).waitFor();
    await readBtn('Saga ２', false).waitFor();
  });

  await step('a volume marked read is not offered under "Continue reading"', async () => {
    await page.locator('.series-back').click();
    await page.locator('.card.series').waitFor();
    ok((await page.locator('.shelf-row .card-title').count()) === 0, 'the read volume is on the shelf');
    await openSeries();
    await readBtn('Saga １', true).click();
    await readBtn('Saga １', false).waitFor();
  });

  await step('finishing a volume offers the next one, and the offer opens it', async () => {
    await openVolume('Saga １');
    ok((await page.locator('.next-volume').count()) === 0, 'offered before the end');
    await toEnd();
    const offer = page.getByRole('button', { name: 'Next: Saga ２', exact: true });
    await offer.waitFor();
    await offer.click();
    await until(async () => (await page.locator('.bar-title').textContent()) === 'Saga ２', 'the next volume to open', 20000);
  });

  await step('the last volume of the series offers nothing', async () => {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
    await page.locator('.card.series').waitFor();
    await openSeries();
    await openVolume('Saga １０');
    await toEnd();
    await sleep(800);
    ok((await page.locator('.next-volume').count()) === 0, 'offered after the last volume');
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
