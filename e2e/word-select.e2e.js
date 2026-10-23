// Click and tap on Japanese words in EPUB sections, in a real Chromium: the real kuromoji tokenizer and dictionary, real foliate-js.
//   node e2e/run-annotations.mjs            # runs this file with the other specs (touch is enabled for it)
// Lookup results come from live providers, so the popup is checked for its heading, never for provider text.
async (page, env = {}) => {
  const BASE = env.BASE ?? 'http://localhost:5199/';
  const FIX = String(env.ROOT ?? 'C:/Users/CLL36/Desktop/simple-reader').split('\\').join('/').replace(/\/*$/, '/') + 'src/reader/fixtures/';
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

  const dictRequests = [];
  page.on('request', (r) => { if (/\/dict\//.test(r.url())) dictRequests.push(r.url()); });

  const frames = () => page.frames().filter((f) => f !== page.mainFrame());
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
  async function openFromLibrary(titlePart) {
    await page.getByRole('button', { name: new RegExp(`^Open ${titlePart}`) }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to load', 20000);
    await until(async () => (await page.locator('.chapter').first().textContent()).trim(), 'first position', 20000);
  }
  async function backToLibrary() {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.locator('.lib').waitFor();
  }
  /** Closes the popup and clears every selection, so the next click starts clean. */
  async function reset() {
    await page.keyboard.press('Escape');
    for (const f of frames()) await f.evaluate(() => document.getSelection()?.removeAllRanges()).catch(() => {});
    await page.locator('.popup').waitFor({ state: 'hidden' }).catch(() => {});
  }
  /** Everything selected in the book frames, as one string. */
  const selected = async () =>
    (await Promise.all(frames().map((f) => f.evaluate(() => document.getSelection()?.toString() ?? '').catch(() => '')))).join('');
  /** Like `until` for a selection, but a timeout reports what was selected instead (CI diagnosis). */
  async function untilSelected(expected, what, ms = 8000, at = null) {
    try {
      await until(async () => (await selected()) === expected, what, ms);
    } catch (e) {
      let extra = '';
      if (at)
        extra = ' | ' + JSON.stringify(await Promise.all(frames().map(async (f) => {
          const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
          if (!box) return null;
          return f.evaluate(({ x, y }) => {
            const c = document.caretPositionFromPoint?.(x, y);
            const n = c?.offsetNode;
            const el = document.elementFromPoint(x, y);
            const rect = [];
            if (n && n.nodeType === 3)
              for (const i of [c.offset - 1, c.offset]) {
                if (i < 0 || i >= n.length) continue;
                const r = document.createRange();
                r.setStart(n, i);
                r.setEnd(n, i + 1);
                const q = r.getBoundingClientRect();
                rect.push({ i, ch: n.data[i], l: Math.round(q.left), r: Math.round(q.right), t: Math.round(q.top), b: Math.round(q.bottom) });
              }
            return {
              wm: getComputedStyle(document.body).writingMode, pt: [Math.round(x), Math.round(y)], el: el ? el.tagName : null,
              caret: c ? { type: n.nodeType, parent: n.parentElement?.tagName, off: c.offset, txt: (n.data || '').slice(0, 10) } : null, rect,
            };
          }, { x: at.x - box.x, y: at.y - box.y }).catch((err) => String(err));
        })));
      throw new Error(`${e.message} (selected: ${JSON.stringify(await selected())})${extra}`);
    }
  }
  const popupWord = async () => (await page.locator('.popup:not([hidden]) .pop-word').textContent({ timeout: 8000 })).trim();

  /**
   * Host-page centre of one character of `needle`, found in the base text (or in the readings with `reading`).
   * Only characters inside the visible column, clear of the page-turn zones and the bars, qualify.
   */
  async function charAt(needle, { index = 0, reading = false, edge = 170 } = {}) {
    return until(async () => {
      const vp = page.viewportSize();
      for (const f of frames()) {
        const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
        if (!box) continue;
        const p = await f.evaluate(({ needle, index, reading, ox, oy, vw, vh, edge }) => {
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (!!n.parentElement.closest('rt, rp') === reading ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
          });
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            for (let i = n.data.indexOf(needle); i >= 0; i = n.data.indexOf(needle, i + 1)) {
              const k = i + index;
              if (k >= n.data.length) continue;
              const r = document.createRange();
              r.setStart(n, k);
              r.setEnd(n, k + 1);
              const q = r.getBoundingClientRect();
              const x = ox + q.x + q.width / 2;
              const y = oy + q.y + q.height / 2;
              if (q.width > 0 && x > edge && x < vw - edge && y > 110 && y < vh - 110) return { x, y, w: q.width, h: q.height };
            }
          }
          return null;
        }, { needle, index, reading, ox: box.x, oy: box.y, vw: vp.width, vh: vp.height, edge }).catch(() => null);
        if (p) return p;
      }
      return null;
    }, `"${needle}" on screen`, 25000);
  }
  /** Turns the Furigana setting on and waits until the readings exist. */
  async function turnFuriganaOn() {
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Reading settings' }).click();
    await page.getByRole('button', { name: 'Furigana', exact: true }).click();
    await until(async () => (await Promise.all(frames().map((f) => f.evaluate(() => document.querySelectorAll('rt').length).catch(() => 0)))).some((n) => n > 0), 'readings (needs the dictionary)', 40000);
    await page.keyboard.press('Escape');
  }
  const painted = () => page.evaluate(() =>
    (document.querySelector('foliate-view')?.renderer?.getContents() ?? []).flatMap((c) =>
      c.overlayer ? [...c.overlayer.element.querySelectorAll('rect')] : []));
  const chromeHidden = () => page.locator('.reader').evaluate((el) => el.classList.contains('chrome-hidden'));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await resetApp();
  await page.setInputFiles('input[type=file]', [FIX + 'book-en.epub', FIX + 'book-ja.epub', FIX + 'book-ja-vertical.epub']);
  await until(async () => (await page.locator('.card').count()) === 3, 'three cards', 15000);

  // ---- English: nothing is selected and the dictionary is never touched ----
  await step('English text: a click selects nothing and loads no dictionary', async () => {
    await openFromLibrary('The Lighthouse');
    const before = dictRequests.length;
    const p = await charAt('keeper', { index: 0 });
    await page.mouse.click(p.x, p.y);
    await sleep(800);
    eq(await selected(), '', 'selection after a click on English');
    eq(dictRequests.length, before, 'dictionary requests after a click on English');
    await backToLibrary();
  });

  // ---- horizontal Japanese, furigana on (generated <ruby>) ----
  await step('kanji with furigana: a click on the second character selects the whole word and opens the lookup', async () => {
    await openFromLibrary('吾輩は猫である');
    await turnFuriganaOn();
    const p = await charAt('名前', { index: 1 });
    await page.mouse.click(p.x, p.y);
    await untilSelected('名前', 'the word 名前 selected', 40000);
    eq(await popupWord(), '名前', 'lookup heading');
    await reset();
  });

  await step('clicking the furigana selects the same word as its base', async () => {
    const p = await charAt('なまえ', { index: 1, reading: true });
    await page.mouse.click(p.x, p.y);
    await untilSelected('名前', 'the base word selected', 8000);
    await reset();
  });

  await step('a kana particle is selected when the tokenizer makes it a word; punctuation selects nothing', async () => {
    const particle = await charAt('はまだ', { index: 0 });
    await page.mouse.click(particle.x, particle.y);
    await untilSelected('は', 'the particle selected', 8000);
    await reset();
    const stop = await charAt('。', { index: 0 });
    await page.mouse.click(stop.x, stop.y);
    await sleep(800);
    eq(await selected(), '', 'selection after a click on 。');
    await reset();
  });

  await step('a drag from a kanji to past 無 has no reading in it, and the lookup gets that text', async () => {
    const from = await charAt('名前', { index: 0 });
    const to = await charAt('無', { index: 0 });
    await page.mouse.move(from.x - from.w / 2 + 2, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x + to.w * 0.3, to.y, { steps: 12 });
    await page.mouse.up();
    await until(async () => (await selected()) !== '', 'a drag selection', 8000);
    const text = await selected();
    ok(!text.includes('なまえ'), `reading inside the drag selection: ${text}`);
    eq(text, '名前はまだ無', 'drag selection text');
    eq(await popupWord(), '名前はまだ無', 'lookup text');
    await reset();
  });

  await step('a drag that starts on a reading has no reading in it', async () => {
    const from = await charAt('なまえ', { index: 0, reading: true });
    const to = await charAt('無', { index: 0 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x + to.w * 0.3, to.y, { steps: 12 });
    await page.mouse.up();
    await sleep(600);
    const text = await selected();
    ok(!text.includes('なまえ') && text.includes('無'), `drag from a reading: ${JSON.stringify(text)}`);
    await reset();
  });

  await step('a click on a link selects nothing', async () => {
    // Every loaded section gets the link: the one on screen is not necessarily frames()[0].
    for (const f of frames()) await f.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.data.includes('名前') && !n.parentElement.closest('rt, rp') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
      });
      const n = w.nextNode();
      if (!n) return;
      const a = document.createElement('a');
      a.href = '#';
      n.parentNode.insertBefore(a, n);
      a.append(n);
    });
    const p = await charAt('名前', { index: 0 });
    await page.mouse.click(p.x, p.y);
    await sleep(800);
    eq(await selected(), '', 'selection after a click on a link');
    await reset();
  });

  await step('tapping an existing highlight still opens the colour menu and selects nothing', async () => {
    const p = await charAt('猫', { index: 0 });
    await page.mouse.click(p.x, p.y);
    await untilSelected('猫', 'word for the highlight', 8000);
    await page.locator('.popup').getByRole('button', { name: 'Highlight green' }).click();
    await until(async () => (await painted()).length > 0, 'the highlight painted', 8000);
    await reset();
    const again = await charAt('猫', { index: 0 });
    await page.mouse.click(again.x, again.y);
    await page.locator('.popup:not([hidden]) .annotate').waitFor({ timeout: 8000 });
    eq(await selected(), '', 'selection after tapping the highlight');
    await reset();
  });
  await backToLibrary();

  // ---- vertical Japanese (native ruby in the book) ----
  await step('vertical text: a click selects the kanji word, and a click on its reading selects the same word', async () => {
    await openFromLibrary('縦書きの本');
    const p = await charAt('景色', { index: 1 });
    await page.mouse.click(p.x, p.y);
    await untilSelected('景色', 'the word 景色', 40000, p);
    await reset();
    const r = await charAt('けしき', { index: 1, reading: true });
    await page.mouse.click(r.x, r.y);
    await untilSelected('景色', 'the base word from the reading', 8000);
    await reset();
  });

  await step('vertical text: a click on a particle selects it', async () => {
    const p = await charAt('の', { index: 0 });
    await page.mouse.click(p.x, p.y);
    await untilSelected('の', 'の selected', 8000);
    await reset();
  });

  await step('vertical text: a click on the edge of a kanji, right next to the 。 that follows it, still selects the word', async () => {
    // Where one text node ends and the next begins the browser reports the caret in the NEXT node; the kanji must still win.
    const p = await charAt('景色', { index: 1 });
    const edge = { x: p.x, y: p.y + p.h / 2 - 0.5 };
    await page.mouse.click(edge.x, edge.y);
    await untilSelected('景色', 'the word 景色 from its lower edge', 40000, edge);
    await reset();
  });

  await step('touch: a tap on a word selects it and leaves the toolbars alone; a tap on blank page toggles them', async () => {
    const before = await chromeHidden();
    const p = await charAt('景色', { index: 1 });
    await page.touchscreen.tap(p.x, p.y);
    await untilSelected('景色', 'tap selects 景色', 40000, p);
    eq(await chromeHidden(), before, 'toolbars after a tap on a word');
    await reset();
    const spot = await until(async () => {
      const vp = page.viewportSize();
      for (const f of frames()) {
        const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
        if (!box) continue;
        const hit = await f.evaluate((o) => {
          for (let y = 120; y < o.vh - 120; y += 15)
            for (let x = 180; x < o.vw - 180; x += 15) {
              const el = document.elementFromPoint(x - o.ox, y - o.oy);
              if (el === document.documentElement || el === document.body) return { x, y };
            }
          return null;
        }, { ox: box.x, oy: box.y, vw: vp.width, vh: vp.height }).catch(() => null);
        if (hit) return hit;
      }
      return null;
    }, 'a blank spot on the page', 8000);
    const hidden = await chromeHidden();
    await page.touchscreen.tap(spot.x, spot.y);
    await until(async () => (await chromeHidden()) !== hidden, 'a tap on blank page toggles the toolbars', 4000);
    eq(await selected(), '', 'selection after a tap on blank page');
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results };
};
