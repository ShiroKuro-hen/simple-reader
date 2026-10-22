// Opt-in: highlight on a late chapter of a real, large EPUB and find it again after a reload.
// The book is only read in place through REAL_EPUB (a local path): never copied into the repo, never bundled, and
// removed again from the browser profile at the end. Book text is never printed (only a word length and numbers).
//   REAL_EPUB="C:/path/book.epub" node e2e/run-annotations.mjs
async (page, env = {}) => {
  const path = env.REAL_EPUB;
  if (!path) return { skipped: 'REAL_EPUB is not set: skipping the real-book annotation check (it is opt-in).' };
  const BASE = env.BASE ?? 'http://localhost:5199/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, what, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  };
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const out = { checks: [], metrics: {} };
  const check = async (name, fn) => {
    try { out.checks.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { out.checks.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
  };
  const painted = () => page.evaluate(() =>
    (document.querySelector('foliate-view')?.renderer?.getContents() ?? []).flatMap((c) =>
      c.overlayer ? [...c.overlayer.element.querySelectorAll('g')].map((g) => ({
        fill: g.getAttribute('fill'),
        boxes: [...g.querySelectorAll('rect')].map((r) => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }),
      })) : []));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(BASE);
  await page.evaluate(async () => {
    localStorage.clear();
    const d = await navigator.storage.getDirectory();
    for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true });
  });
  await page.goto(BASE + '#');
  await page.reload();
  await page.locator('.lib').waitFor();
  await page.setInputFiles('input[type=file]', [path]);
  await page.locator('.card').first().waitFor({ timeout: 120000 });

  let point, chapter;
  await check('open at a late chapter and highlight a visible word', async () => {
    await page.locator('.card-open').first().click();
    await until(async () => (await page.locator('.chapter').first().textContent().catch(() => ''))?.trim(), 'first position', 60000);
    await page.mouse.move(640, 20);
    await page.getByRole('button', { name: 'Contents' }).click();
    const n = await page.locator('dialog[open] .toc-item').count();
    ok(n >= 10, `only ${n} contents entries`);
    await page.locator('dialog[open] .toc-item').nth(Math.floor(n * 0.8)).click();
    await until(async () => parseInt(await page.locator('.pct').first().textContent()) >= 60, 'a late position', 60000);
    await sleep(800);
    chapter = (await page.locator('.chapter').first().textContent()).trim();
    const vp = page.viewportSize();
    point = await until(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
        if (!box) continue;
        const hit = await f.evaluate(({ ox, oy, vw, vh }) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const m of n.textContent.matchAll(/[A-Za-z]{6,}/g)) {
              const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
              const q = r.getBoundingClientRect();
              if (ox + q.x > 190 && ox + q.x + q.width < vw - 190 && oy + q.y > 100 && oy + q.y + q.height < vh - 100) return { x: ox + q.x + q.width / 2, y: oy + q.y + q.height / 2, len: m[0].length };
            }
          }
          return null;
        }, { ox: box.x, oy: box.y, vw: vp.width, vh: vp.height }).catch(() => null);
        if (hit) return hit;
      }
      return null;
    }, 'a word on screen');
    await page.mouse.dblclick(point.x, point.y);
    await page.locator('.popup:not([hidden]) .annotate').waitFor({ timeout: 8000 });
    await page.locator('.popup').getByRole('button', { name: 'Highlight pink' }).click();
    await until(async () => (await painted()).length === 1, 'the highlight to be painted');
    return `chapter at ${await page.locator('.pct').first().textContent()}, word of ${point.len} letters`;
  });

  await check('after a reload the book resumes there and the highlight is painted on the same word', async () => {
    await sleep(1200); // progress and annotations are saved on a short delay
    await page.reload();
    await until(async () => (await page.locator('.chapter').first().textContent().catch(() => ''))?.trim() === chapter, 'the same chapter', 60000);
    await until(async () => (await painted()).length === 1, 'the highlight after reload', 30000);
    const [g] = await painted();
    ok(g.fill === '#ff8fc2', 'colour ' + g.fill);
    ok(g.boxes.some((b) => point.x >= b.x - 1 && point.x <= b.x + b.width + 1 && point.y >= b.y - 1 && point.y <= b.y + b.height + 1), 'highlight is not on the same word');
  });

  await check('the panel lists it with its chapter and jumping from far away returns to it', async () => {
    await page.mouse.move(640, 20);
    await page.getByRole('button', { name: 'Annotations' }).click();
    const rows = await page.locator('dialog.sheet-notes[open] .ann').count();
    ok(rows === 1, 'rows ' + rows);
    ok((await page.locator('dialog.sheet-notes[open] .ann-meta').textContent()).includes(chapter.slice(0, 20)), 'chapter in the row');
    await page.keyboard.press('Escape');
    await page.mouse.move(640, 20);
    await page.getByRole('button', { name: 'Contents' }).click();
    await page.locator('dialog[open] .toc-item').nth(2).click();
    await until(async () => (await painted()).length === 0, 'to leave the highlight', 30000);
    await page.mouse.move(640, 20);
    await page.getByRole('button', { name: 'Annotations' }).click();
    await page.locator('dialog.sheet-notes[open] .ann-main').click();
    await until(async () => (await painted()).length === 1, 'to be back at the highlight', 60000);
  });

  await page.goto(BASE + '#');
  await page.evaluate(async () => {
    localStorage.clear();
    const d = await navigator.storage.getDirectory();
    for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true });
  });
  const failed = out.checks.filter((c) => !c.ok);
  return { passed: out.checks.length - failed.length, failed: failed.length, ...out };
}
