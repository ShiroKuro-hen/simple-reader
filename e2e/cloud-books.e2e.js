// Books that are only in the bucket, shown in the library and downloaded when opened. Real app and OPFS; the bucket is a
// small S3 stand-in behind Playwright's network layer (list, get, put and CORS), like in autosync.e2e.js.
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
  const until = async (fn, what, ms = 10000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  };

  const HOST = 'http://fake-r2.test';
  const store = new Map();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,HEAD', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'ETag' };
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (req.method() === 'PUT') {
      store.set(key, req.postDataBuffer() ?? Buffer.alloc(0));
      return route.fulfill({ status: 200, headers: cors, body: '' });
    }
    if (!key) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`;
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/xml' }, body: xml });
    }
    const body = store.get(key);
    return body ? route.fulfill({ status: 200, headers: cors, body }) : route.fulfill({ status: 404, headers: cors, body: 'not found' });
  });

  const CLOUD = 'Cloud Saga';
  const LOCAL = 'Local Saga';
  const CFG = { accountId: 'acc', bucket: 'shelf', accessKeyId: 'AKIA_TEST', secretAccessKey: 'secret-test', endpoint: HOST };
  const cloudBtn = () => page.getByRole('button', { name: 'Show cloud books', exact: true });
  const strip = (title) => page.locator('.grid .card', { hasText: title }).locator('.card-origin');
  const titles = () => page.locator('.grid .card-title').allTextContents();

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

  // A comic of 60 tiny pages, as bytes the page can add (the local book) and the bucket can serve (the cloud one).
  const zipBytes = await page.evaluate(async () => {
    const { storeZip } = await import('/src/storage/store-zip.ts');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const files = {};
    for (let i = 1; i <= 60; i++) files[`${i}.png`] = png;
    return Array.from(storeZip(files));
  });
  const cloudId = 'c'.repeat(64);
  store.set(`books/${cloudId}.cbz`, Buffer.from(zipBytes));
  store.set(`meta/${cloudId}.json`, Buffer.from(JSON.stringify({ id: cloudId, title: CLOUD, format: 'cbz', size: zipBytes.length, addedAt: 1 })));
  // The local book: other pages, so another book. The bucket holds it too, and it must not show twice.
  const localId = await page.evaluate(async () => {
    const { addBook } = await import('/src/storage/library.ts');
    const { storeZip } = await import('/src/storage/store-zip.ts');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const files = {};
    for (let i = 1; i <= 7; i++) files[`${i}.png`] = png;
    return (await addBook(new File([storeZip(files)], 'Local Saga.cbz'), {})).id;
  });
  store.set(`books/${localId}.cbz`, Buffer.from('x'));
  store.set(`meta/${localId}.json`, Buffer.from(JSON.stringify({ id: localId, title: LOCAL, format: 'cbz', size: 1, addedAt: 1 })));
  await page.reload();
  await page.locator('.grid .card').first().waitFor();

  await step('without a bucket set up there is no cloud button', async () => {
    ok((await cloudBtn().count()) === 0, 'the button shows with no bucket');
    await page.evaluate((cfg) => localStorage.setItem('sr.r2', JSON.stringify(cfg)), CFG);
    await page.reload();
    await page.locator('.grid .card').first().waitFor();
    await cloudBtn().waitFor();
    ok((await cloudBtn().getAttribute('aria-pressed')) === 'false', 'on by itself');
    ok(JSON.stringify(await titles()) === JSON.stringify([LOCAL]), JSON.stringify(await titles()));
  });

  await step('turning it on lists the books that are only in the bucket, marked "Cloud only"', async () => {
    await cloudBtn().click();
    await until(async () => (await titles()).includes(CLOUD), 'the cloud book');
    ok((await strip(CLOUD).textContent()).trim() === 'Cloud only', 'strip: ' + (await strip(CLOUD).textContent()));
    ok((await strip(CLOUD).getAttribute('data-origin')) === 'cloud-only', 'data-origin');
    ok((await strip(LOCAL).getAttribute('data-origin')) === 'local', 'the local book changed');
    ok((await page.locator('.grid .card-title', { hasText: LOCAL }).count()) === 1, 'the local book shows twice');
    ok((await cloudBtn().getAttribute('aria-pressed')) === 'true', 'not pressed');
  });

  await step('a cloud-only book has no edit buttons, since it is not on this device yet', async () => {
    const card = page.locator('.grid .card', { hasText: CLOUD });
    ok((await card.locator('.card-fav, .card-remove, .card-tags, .card-read').count()) === 0, 'edit buttons on a cloud-only card');
  });

  await step('opening it downloads it, opens it, and it is then a normal book from the cloud', async () => {
    await page.getByRole('button', { name: `Download ${CLOUD}`, exact: true }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'the book to load', 20000);
    ok((await page.locator('.bar-title').textContent()) === CLOUD, 'wrong book');
    ok((await page.locator('.chapter').first().textContent()).trim() === '1 / 60', 'not on the first page');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
    await page.locator('.grid .card').first().waitFor();
    ok((await strip(CLOUD).getAttribute('data-origin')) === 'cloud', 'still cloud-only: ' + (await strip(CLOUD).getAttribute('data-origin')));
    ok((await page.locator('.grid .card', { hasText: CLOUD }).locator('.card-fav').count()) === 1, 'no edit buttons after the download');
  });

  await step('the choice is kept after a reload, and turning it off hides what is not here', async () => {
    await page.reload();
    await page.locator('.grid .card').first().waitFor();
    ok((await cloudBtn().getAttribute('aria-pressed')) === 'true', 'not kept');
    await cloudBtn().click();
    ok((await cloudBtn().getAttribute('aria-pressed')) === 'false', 'still on');
    ok((await titles()).length === 2, 'the books on this device went away: ' + JSON.stringify(await titles()));
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
