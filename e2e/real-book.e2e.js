// Opt-in check with a real, large EPUB. NOT part of the default run and never bundled: the book is
// only referenced through the REAL_EPUB environment variable (a local path), is never copied into
// the repo, and never leaves the machine (it goes into the browser's own local storage, and this
// script deletes it again at the end).
//
// Usage: same runner as app.e2e.js, called with an env object:
//   await (eval(source))(page, { REAL_EPUB: 'C:/path/to/book.epub' })
// Without REAL_EPUB it returns { skipped: ... } and does nothing.
//
// It reports numbers (import time, first-page time, TOC size, page-turn speed, resume) and never
// prints book text beyond the single word it selects.
async (page, env = {}) => {
  const path = env.REAL_EPUB;
  if (!path) return { skipped: 'REAL_EPUB is not set: skipping the real-book check (it is opt-in).' };

  const BASE = 'http://localhost:5199/';
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
  const pct = async () => (await page.locator('.pct').first().textContent()).trim();
  const out = { checks: [], metrics: {} };
  const check = async (name, fn) => {
    try { const note = await fn(); out.checks.push({ name, ok: true, note: note ?? '' }); }
    catch (e) { out.checks.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
  };
  const ms = async (fn) => { const t = Date.now(); const v = await fn(); return [Date.now() - t, v]; };

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

  await check('import (hash, metadata, cover)', async () => {
    const [t] = await ms(async () => {
      await page.setInputFiles('input[type=file]', [path]);
      await page.locator('.card').first().waitFor({ timeout: 120000 });
    });
    out.metrics.importMs = t;
    const hasCover = (await page.locator('.cover img').count()) === 1;
    const title = (await page.locator('.card-title').first().textContent()).trim();
    out.metrics.title = title;
    out.metrics.hasCover = hasCover;
    if (!title) throw new Error('empty title');
    return `${t} ms, cover: ${hasCover}`;
  });

  await check('open: time to first page', async () => {
    const [t] = await ms(async () => {
      await page.locator('.card-open').first().click();
      await until(async () => (await page.locator('.chapter').first().textContent().catch(() => ''))?.trim(), 'first position', 60000);
    });
    out.metrics.firstPageMs = t;
    return `${t} ms`;
  });

  let tocCount = 0;
  await check('contents: many entries, jump to a late chapter', async () => {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Contents' }).click();
    tocCount = await page.locator('dialog[open] .toc-item').count();
    out.metrics.tocEntries = tocCount;
    if (tocCount < 10) throw new Error(`only ${tocCount} entries`);
    const target = page.locator('dialog[open] .toc-item').nth(Math.floor(tocCount * 0.8));
    const [t] = await ms(async () => {
      await target.click();
      await until(async () => parseInt(await pct()) >= 60, 'a late position', 60000);
    });
    out.metrics.jumpMs = t;
    return `${tocCount} entries, jump took ${t} ms, now at ${await pct()}`;
  });

  // In a 17 MB book one page is far below 1%, so the % label can't show a turn. Fingerprint the visible text
  // instead (kept in memory only, never printed).
  const pageFingerprint = async () => {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
      if (!box) continue;
      const fp = await f.evaluate(({ ox, vw }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const r = document.createRange(); r.selectNodeContents(n);
          const q = r.getBoundingClientRect();
          if (ox + q.x > 0 && ox + q.x < vw && q.width > 0) return n.textContent.trim().slice(0, 40) + '@' + Math.round(ox + q.x);
        }
        return null;
      }, { ox: box.x, vw: page.viewportSize().width }).catch(() => null);
      if (fp) return fp;
    }
    return null;
  };
  await check('page-turn speed (10 x ArrowRight)', async () => {
    const times = [];
    for (let i = 0; i < 10; i++) {
      const before = await pageFingerprint();
      const t = Date.now();
      await page.keyboard.press('ArrowRight');
      await until(async () => { const now = await pageFingerprint(); return now && now !== before; }, 'turn', 5000);
      times.push(Date.now() - t);
      await sleep(150);
    }
    out.metrics.turnMs = times;
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    out.metrics.turnAvgMs = avg;
    return `avg ${avg} ms (max ${Math.max(...times)})`;
  });

  await check('resume after reload lands on the same position', async () => {
    await sleep(1200);
    const before = { pct: await pct(), chapter: (await page.locator('.chapter').first().textContent()).trim() };
    const [t] = await ms(async () => {
      await page.reload();
      await until(async () => (await pct()) === before.pct && (await page.locator('.chapter').first().textContent()).trim() === before.chapter, 'same position', 60000);
    });
    out.metrics.resumeMs = t;
    return `${before.pct} restored in ${t} ms`;
  });

  await check('selection popup on real prose reaches loading -> result|error', async () => {
    await sleep(500);
    const vp = page.viewportSize();
    const edge = 164;
    const w = await until(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
        if (!box) continue;
        const hit = await f.evaluate(({ ox, oy, vw, vh, m0 }) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const m of n.textContent.matchAll(/[A-Za-z]{6,}/g)) {
              const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
              const q = r.getBoundingClientRect();
              if (ox + q.x > m0 && ox + q.x + q.width < vw - m0 && oy + q.y > 90 && oy + q.y + q.height < vh - 90) return { x: ox + q.x + q.width / 2, y: oy + q.y + q.height / 2, len: m[0].length };
            }
          }
          return null;
        }, { ox: box.x, oy: box.y, vw: vp.width, vh: vp.height, m0: edge }).catch(() => null);
        if (hit) return hit;
      }
      return null;
    }, 'a word on screen', 30000);
    await page.mouse.dblclick(w.x, w.y);
    await page.locator('.popup:not([hidden])').waitFor({ timeout: 8000 });
    const state = await until(async () => { const s = await page.locator('.popup').getAttribute('data-state'); return s !== 'loading' && s; }, 'lookup to settle', 25000);
    if (!['result', 'error'].includes(state)) throw new Error('state ' + state);
    await page.keyboard.press('Escape');
    return `state: ${state}`;
  });

  // Leave nothing behind in the browser profile.
  await page.goto(BASE + '#');
  await page.evaluate(async () => {
    localStorage.clear();
    const d = await navigator.storage.getDirectory();
    for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true });
  });

  const failed = out.checks.filter((c) => !c.ok);
  return { passed: out.checks.length - failed.length, failed: failed.length, ...out };
}
