// Automatic sync of the reading position in a real browser: opening a book picks up a newer position from the bucket,
// leaving it sends the new one up, and the switch in Settings turns it off. The bucket is a small S3 stand-in behind
// Playwright's network layer (list, get, put and CORS); the app signs and sends real requests to it.
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

  // --- the bucket ---
  const HOST = 'http://fake-r2.test';
  const store = new Map();
  let requests = 0;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,HEAD', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'ETag' };
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    requests++;
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

  const chapter = async () => (await page.locator('.chapter').first().textContent()).trim();
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
  async function openComic() {
    await page.locator('.grid').getByRole('button', { name: /^Open Saga/ }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'the book to load', 20000);
  }
  async function leave() {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await resetApp();
  const id = await page.evaluate(async (cfg) => {
    localStorage.setItem('sr.r2', JSON.stringify(cfg));
    const { addBook } = await import('/src/storage/library.ts');
    const { storeZip } = await import('/src/storage/store-zip.ts');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const files = {};
    for (let i = 1; i <= 60; i++) files[`${i}.png`] = png;
    return (await addBook(new File([storeZip(files)], 'Saga 1.cbz'), {})).id;
  }, { accountId: 'acc', bucket: 'shelf', accessKeyId: 'AKIA_TEST', secretAccessKey: 'secret-test', endpoint: HOST });
  await page.reload();
  await page.locator('.grid .card').first().waitFor();
  store.set(`progress/${id}.json`, Buffer.from(JSON.stringify({ bookId: id, location: '40', fraction: 40 / 60, updatedAt: Date.now() + 500 })));

  await step('opening a book picks up a newer position from the bucket and says so', async () => {
    await openComic();
    const label = await chapter();
    ok(/^(39|40|41) \/ 60$/.test(label), 'opened at ' + label);
    await until(async () => (await page.locator('.toast', { hasText: 'another device' }).count()) > 0, 'the toast');
  });

  await step('leaving the book sends the new position to the bucket', async () => {
    await sleep(1500); // let the book settle after opening: its first position is reported late
    await page.evaluate(() => {
      const s = document.querySelector('input[type=range][aria-label="Reading progress"]');
      s.value = '900';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(async () => /^(5[3-5]) \/ 60$/.test(await chapter()), 'the jump');
    await leave();
    const sent = await until(() => {
      const body = store.get(`progress/${id}.json`);
      const p = body && JSON.parse(body.toString());
      return p && Number(p.location) >= 53 ? p : null;
    }, 'the new position in the bucket');
    ok(sent.bookId === id, 'wrong book');
  });

  await step('the switch in Settings turns it off, and a book then opens without touching the bucket', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const box = page.getByLabel('Sync reading position and notes automatically');
    ok(await box.isChecked(), 'on by default once a bucket is set up');
    await box.uncheck();
    ok((await page.evaluate(() => localStorage.getItem('sr.autosync'))) === 'off', 'the choice was not kept');
    await page.keyboard.press('Escape');
    requests = 0;
    await openComic();
    await sleep(1500);
    await leave();
    await sleep(1500);
    ok(requests === 0, `${requests} requests to the bucket while auto sync was off`);
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
}
