// Highlights, notes and bookmarks through the real app in a real Chromium (real OPFS, foliate-js, pdf.js; nothing mocked).
//   node e2e/run-annotations.mjs            # starts the dev server and a browser, runs this file
// or call the function yourself with a Playwright `page` whose context has clipboard permissions and
// `{ BASE: 'http://localhost:5199/' }`. Lookup results come from live providers, so only the popup's own
// annotate row is asserted, never provider text.
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
  const pct = async () => (await page.locator('.pct').first().textContent()).trim();
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  // ---- helpers ----
  const chrome = async () => { await page.mouse.move(640, 20); await page.mouse.move(600, 24); };
  const top = async (name) => { await chrome(); return page.locator('.bar-top').getByRole('button', { name }); };
  async function openFromLibrary(titlePart) {
    await page.getByRole('button', { name: new RegExp(`^Open ${titlePart}`) }).click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'book to load', 20000);
    await until(async () => (await page.locator('.chapter').first().textContent()).trim(), 'first position', 20000);
  }
  async function backToLibrary() {
    await (await top('Back to library')).click();
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
  /** The EPUB overlay: one entry per painted annotation with its colour and boxes (host viewport). */
  const painted = () => page.evaluate(() =>
    (document.querySelector('foliate-view')?.renderer?.getContents() ?? []).flatMap((c) =>
      c.overlayer ? [...c.overlayer.element.querySelectorAll('g')].map((g) => ({
        fill: g.getAttribute('fill'),
        boxes: [...g.querySelectorAll('rect')].map((r) => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }),
      })) : []));
  const waitPainted = (n, ms) => until(async () => (await painted()).length === n, `${n} painted highlight(s)`, ms);
  const onPoint = (g, p) => g.boxes.some((b) => p.x >= b.x - 1 && p.x <= b.x + b.width + 1 && p.y >= b.y - 1 && p.y <= b.y + b.height + 1);
  /** The annotations file of the open book, read from the real OPFS. */
  const file = () => page.evaluate(async () => {
    const d = await navigator.storage.getDirectory();
    try {
      const dir = await d.getDirectoryHandle('annotations');
      for await (const [name, h] of dir.entries()) return JSON.parse(await (await h.getFile()).text());
    } catch { /* none yet */ }
    return null;
  });
  const saved = async (pred, what) => until(async () => { const f = await file(); return f && pred(f.items) && f; }, what, 5000);

  // A word that is really on screen (the iframe is wider than the viewport), away from the page-turn zones.
  async function visibleWord(skip = []) {
    const vp = page.viewportSize();
    const edge = Math.min(140, Math.max(44, vp.width * 0.12)) + 20;
    return until(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const box = await (await f.frameElement().catch(() => null))?.boundingBox().catch(() => null);
        if (!box) continue;
        const w = await f.evaluate(({ ox, oy, vw, vh, m0, skip }) => {
          for (const p of document.querySelectorAll('p')) {
            const t = p.firstChild;
            if (!t || t.nodeType !== 3) continue;
            for (const m of t.textContent.matchAll(/[A-Za-z]{5,}/g)) {
              if (skip.includes(m[0])) continue;
              const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
              const q = r.getBoundingClientRect();
              if (ox + q.x > m0 && ox + q.x + q.width < vw - m0 && oy + q.y > 90 && oy + q.y + q.height < vh - 90) return { x: ox + q.x + q.width / 2, y: oy + q.y + q.height / 2, word: m[0] };
            }
          }
          return null;
        }, { ox: box.x, oy: box.y, vw: vp.width, vh: vp.height, m0: edge, skip }).catch(() => null);
        if (w) return w;
      }
      return null;
    }, 'a word visible on screen', 25000);
  }
  async function selectWord(skip) {
    const w = await visibleWord(skip);
    await page.mouse.dblclick(w.x, w.y);
    await page.locator('.popup:not([hidden]) .annotate').waitFor({ timeout: 8000 });
    return w;
  }
  const dot = (color) => page.locator('.popup').getByRole('button', { name: `Highlight ${color}` });

  /** Real pixels: screenshot the first painted highlight; the commonest colour is the tinted paper, the farthest one the glyphs. */
  async function highlightPixels() {
    const [g] = await painted();
    const b = g.boxes[0];
    const png = await page.screenshot({ clip: { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) } });
    return page.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const lum = (r, g, b) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const counts = new Map();
      for (let i = 0; i < px.length; i += 4) { const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]; counts.set(k, (counts.get(k) ?? 0) + 1); }
      const paper = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const pl = lum(paper >> 16, (paper >> 8) & 255, paper & 255);
      let far = paper, best = 0;
      for (const k of counts.keys()) { const d = Math.abs(lum(k >> 16, (k >> 8) & 255, k & 255) - pl); if (d > best) { best = d; far = k; } }
      const fl = lum(far >> 16, (far >> 8) & 255, far & 255);
      return { paper: [paper >> 16, (paper >> 8) & 255, paper & 255], contrast: (Math.max(pl, fl) + 0.05) / (Math.min(pl, fl) + 0.05) };
    }, png.toString('base64'));
  }
  const plain = { light: [255, 255, 255], dark: [18, 18, 18], sepia: [244, 236, 216] };

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await resetApp();
  await page.setInputFiles('input[type=file]', [FIX + 'book-en.epub', FIX + 'sample.pdf']);
  await until(async () => (await page.locator('.card').count()) === 2, 'two cards');

  let word; // the word highlighted in the first steps
  let bookId;

  await step('selecting a word offers four colours and a Note button next to the lookup', async () => {
    await openFromLibrary('The Lighthouse');
    word = await selectWord();
    for (const c of ['yellow', 'green', 'blue', 'pink']) ok(await dot(c).isVisible(), `${c} dot missing`);
    ok(await page.locator('.popup').getByRole('button', { name: 'Note' }).isVisible(), 'Note button missing');
    ok((await page.locator('.popup .pop-word').textContent()).trim() === word.word, 'lookup heading is not the selected word');
    const sizes = await page.locator('.popup .dot').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    ok(sizes.every((s) => s >= 36), 'dots too small: ' + sizes);
  });

  await step('a colour dot highlights exactly that word, closes the popup and clears the selection', async () => {
    await dot('green').click();
    await page.locator('.popup').waitFor({ state: 'hidden' });
    await waitPainted(1);
    const [g] = await painted();
    eq(g.fill, '#6fdc8c', 'colour');
    ok(onPoint(g, word), 'highlight does not cover the word');
    const selected = await page.evaluate(() => [...document.querySelectorAll('iframe')].some((f) => f.contentDocument?.getSelection()?.toString()));
    ok(!selected, 'selection still active');
    const f = await saved((items) => items.length === 1, 'the annotations file');
    bookId = f.bookId;
    ok(f.items[0].kind === 'highlight' && f.items[0].color === 'green' && f.items[0].text === word.word, JSON.stringify(f.items[0]));
    ok(f.items[0].chapter === 'Chapter One', 'chapter label missing');
  });

  await step('the highlight survives leaving the book, and a full reload', async () => {
    await backToLibrary();
    await openFromLibrary('The Lighthouse');
    await waitPainted(1, 10000);
    await page.reload();
    await page.locator('.lib, .reader').first().waitFor();
    if (await page.locator('.lib').count()) await openFromLibrary('The Lighthouse');
    await waitPainted(1, 10000);
    const [g] = await painted();
    ok(onPoint(g, word), 'highlight moved after reload');
  });

  await step('tapping the highlight offers colour change; the new colour is painted and saved', async () => {
    await page.mouse.click(word.x, word.y);
    await page.locator('.popup:not([hidden]) .annotate').waitFor();
    eq(await dot('green').getAttribute('aria-pressed'), 'true', 'current colour marked');
    await dot('blue').click();
    await until(async () => (await painted())[0]?.fill === '#6cb6ff', 'blue paint');
    await saved((items) => items[0].color === 'blue', 'blue saved');
  });

  await step('a note: Note button, type, Ctrl+Enter; it is saved on the highlight and shown when tapped again', async () => {
    await page.mouse.click(word.x, word.y);
    await page.locator('.popup:not([hidden]) .annotate').waitFor();
    await page.locator('.popup').getByRole('button', { name: 'Note' }).click();
    const box = page.locator('.popup').getByLabel('Note', { exact: true });
    await box.fill('Remember the lamp & the *tea*');
    await box.press('Control+Enter');
    await page.locator('.popup').waitFor({ state: 'hidden' });
    const f = await saved((items) => items[0].note, 'the note saved');
    eq([f.items.length, f.items[0].kind, f.items[0].note], [1, 'note', 'Remember the lamp & the *tea*'], 'note item');
    await page.mouse.click(word.x, word.y);
    await page.locator('.popup .pop-annotation-note').waitFor();
    eq(await page.locator('.popup .pop-annotation-note').textContent(), 'Remember the lamp & the *tea*', 'note shown');
    await page.keyboard.press('Escape');
  });

  await step('bookmark button toggles per page: on here, off on the next page, on again when back, off on click', async () => {
    const btn = await top('Add bookmark');
    eq(await btn.getAttribute('aria-pressed'), 'false', 'starts off');
    await btn.click();
    const on = (await top('Remove bookmark'));
    await on.waitFor();
    eq(await on.getAttribute('aria-pressed'), 'true', 'on after click');
    await saved((items) => items.some((i) => i.kind === 'bookmark' && !i.deleted && i.text), 'bookmark saved with page text');
    const before = await pct();
    let p = before;
    for (let i = 0; i < 4 && p === before; i++) { await page.keyboard.press('ArrowRight'); p = await until(async () => (await pct()) !== before && (await pct()), '', 1500).catch(() => before); }
    ok(p !== before, 'could not turn the page');
    await (await top('Add bookmark')).waitFor();
    for (let i = 0; i < 4 && (await pct()) !== before; i++) { await page.keyboard.press('ArrowLeft'); await sleep(900); }
    await (await top('Remove bookmark')).waitFor({ timeout: 5000 });
    await (await top('Remove bookmark')).click();
    await (await top('Add bookmark')).waitFor();
    await saved((items) => items.filter((i) => i.kind === 'bookmark').every((i) => i.deleted), 'bookmark tombstoned');
    await (await top('Add bookmark')).click(); // leave one bookmark for the panel
    await (await top('Remove bookmark')).waitFor();
  });

  await step('annotations panel lists everything with chapter, colour, quote and note; jump goes there', async () => {
    await (await top('Annotations')).click();
    const items = page.locator('dialog.sheet-notes[open] .ann');
    await until(async () => (await items.count()) === 2, 'two items');
    const noteRow = await page.locator('dialog.sheet-notes[open] .ann-k-note .ann-note').first().textContent().catch(() => '');
    const rows = await items.allTextContents();
    const mine = rows.find((t) => t.includes('Remember the lamp')) ?? '';
    ok(mine.includes('Note') && mine.includes('Chapter One') && mine.includes(word.word) && noteRow.startsWith('Remember'), 'note row: ' + rows.join(' | '));
    ok(rows.some((t) => t.startsWith('Bookmark')), 'bookmark row: ' + rows.join(' | '));
    ok(await page.locator('dialog.sheet-notes[open] .ann-k-bookmark').count() === 1, 'one bookmark row');
    const stripe = await page.locator('dialog.sheet-notes[open] .ann-k-note').evaluate((el) => getComputedStyle(el).borderLeftColor);
    eq(stripe, 'rgb(108, 182, 255)', 'blue stripe');
    await page.keyboard.press('Escape');
    // move far away, come back through the panel
    await page.evaluate(() => { const s = document.querySelector('input[type=range]'); s.value = '900'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(async () => parseInt(await pct()) > 60, 'far page');
    await waitPainted(0, 10000);
    await (await top('Annotations')).click();
    await page.locator('dialog.sheet-notes[open] .ann-k-note .ann-main').click();
    await page.locator('dialog.sheet-notes[open]').waitFor({ state: 'detached' }).catch(() => {});
    await until(async () => parseInt(await pct()) < 30, 'back near the highlight');
    await waitPainted(1, 10000);
  });

  await step('editing a note from the panel, and deleting items (bookmark, then the note) leaves tombstones and the empty message', async () => {
    await (await top('Annotations')).click();
    const sheet = page.locator('dialog.sheet-notes[open]');
    await sheet.getByRole('button', { name: 'Edit note' }).click();
    const box = sheet.getByLabel('Note', { exact: true });
    eq(await box.inputValue(), 'Remember the lamp & the *tea*', 'prefilled');
    await box.fill('Edited from the panel');
    await box.press('Control+Enter');
    await until(async () => (await sheet.locator('.ann-note').textContent().catch(() => '')) === 'Edited from the panel', 'edited note shown');
    await saved((items) => items[0].note === 'Edited from the panel', 'edited note saved');
    await sheet.getByRole('button', { name: 'Remove bookmark' }).click();
    await until(async () => (await sheet.locator('.ann').count()) === 1, 'one item left');
    await sheet.getByRole('button', { name: 'Delete annotation' }).click();
    await sheet.locator('.notes-empty').waitFor();
    ok((await sheet.locator('.notes-empty').textContent()).includes('No highlights'), 'empty state text');
    ok(await sheet.getByRole('button', { name: 'Export' }).isDisabled(), 'Export should be disabled when empty');
    await waitPainted(0);
    const f = await saved((items) => items.length >= 2 && items.every((i) => i.deleted), 'tombstones');
    ok(f.items.every((i) => i.updatedAt >= i.createdAt), 'timestamps');
    await page.keyboard.press('Escape');
  });

  let exportedMd;
  await step('Export downloads <title>-notes.md with the real content, Copy puts the same text on the clipboard', async () => {
    // rebuild: a yellow highlight with a note, a pink one, and a bookmark
    const w1 = await selectWord();
    await dot('yellow').click();
    await waitPainted(1);
    await page.mouse.click(w1.x, w1.y);
    await page.locator('.popup .annotate').waitFor();
    await page.locator('.popup').getByRole('button', { name: 'Note' }).click();
    await page.locator('.popup').getByLabel('Note', { exact: true }).fill('first\nsecond # line');
    await page.keyboard.press('Control+Enter');
    const w2 = await selectWord([w1.word]);
    await dot('pink').click();
    await waitPainted(2);
    await (await top('Add bookmark')).click();
    await saved((items) => items.filter((i) => !i.deleted).length === 3, 'three live items');
    await (await top('Annotations')).click();
    const sheet = page.locator('dialog.sheet-notes[open]');
    const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Export' }).click()]);
    eq(dl.suggestedFilename(), 'The Lighthouse & the Sea-notes.md', 'file name');
    const { readFile } = await import('node:fs/promises');
    exportedMd = await readFile(await dl.path(), 'utf8');
    const lines = exportedMd.split('\n');
    eq(lines[0], '# The Lighthouse & the Sea', 'title');
    eq(lines[2], '*Ada Marlowe*', 'author');
    ok(/^Exported \d{4}-\d{2}-\d{2} · 2 highlights \(1 with a note\) · 1 bookmark$/.test(lines[4]), 'summary line: ' + lines[4]);
    ok(exportedMd.includes('## Chapter One\n'), 'chapter heading');
    ok(exportedMd.includes(`> 🟨 ${w1.word}\n\n**Note:** first  \nsecond # line\n`), 'yellow quote with its note: ' + exportedMd);
    ok(exportedMd.includes(`> 🩷 ${w2.word}\n`), 'pink quote');
    ok(/## Bookmarks\n\n- Chapter One: “Chapter One The lighthouse/.test(exportedMd), 'bookmark list');
    await sheet.getByRole('button', { name: 'Copy' }).click();
    await until(async () => /Copied/.test(await page.locator('.toast').allTextContents().then((t) => t.join(' '))), 'copy toast');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    eq(clip.replaceAll('\r\n', '\n'), exportedMd, 'clipboard equals the file (Windows may turn \\n into \\r\\n)');
    await page.keyboard.press('Escape');
  });

  await step('dark theme: highlight colour, blend and the page text keep a readable contrast (computed)', async () => {
    await (await top('Reading settings')).click();
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await page.keyboard.press('Escape');
    await sleep(500);
    const r = await page.evaluate(() => {
      const view = document.querySelector('foliate-view');
      const c = view.renderer.getContents()[0];
      const g = c.overlayer.element.querySelector('g');
      const cs = getComputedStyle(g);
      const bodyCs = c.doc.defaultView.getComputedStyle(c.doc.body);
      const htmlCs = c.doc.defaultView.getComputedStyle(c.doc.documentElement);
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const fill = hex(g.getAttribute('fill'));
      const o = parseFloat(cs.opacity);
      const mix = (px) => px.map((v, i) => (1 - o) * v + o * (cs.mixBlendMode === 'multiply' ? (v * fill[i]) / 255 : fill[i]));
      const lum = (c) => { const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const text = mix(rgb(c.doc.defaultView.getComputedStyle(c.doc.querySelector('p')).color));
      const paper = mix(rgb(htmlCs.backgroundColor));
      const [hi, lo] = [lum(text), lum(paper)].sort((a, b) => b - a);
      return { blend: cs.mixBlendMode, opacity: o, contrast: (hi + 0.05) / (lo + 0.05), plain: rgb(htmlCs.backgroundColor) };
    });
    eq([r.blend, r.opacity], ['normal', 0.35], 'dark blend');
    ok(r.contrast >= 4.5, 'contrast ' + r.contrast.toFixed(2));
    const px = await highlightPixels();
    ok(px.contrast >= 4.5, 'rendered pixels: contrast ' + px.contrast.toFixed(2));
    ok(px.paper.join() !== plain.dark.join(), 'the highlight is not visible: paper is still ' + px.paper);
    return `computed ${r.contrast.toFixed(1)}:1, rendered ${px.contrast.toFixed(1)}:1, paper ${px.paper}`;
  });

  await step('light and sepia: multiply blend, still readable (real rendered pixels)', async () => {
    const notes = [];
    for (const [name, theme] of [['Sepia theme', 'sepia'], ['Light theme', 'light']]) {
      await (await top('Reading settings')).click();
      await page.getByRole('button', { name }).click();
      await page.keyboard.press('Escape');
      await sleep(400);
      const blend = await page.evaluate(() => getComputedStyle(document.querySelector('foliate-view').renderer.getContents()[0].overlayer.element.querySelector('g')).mixBlendMode);
      eq(blend, 'multiply', theme + ' blend');
      const px = await highlightPixels();
      ok(px.contrast >= 4.5, theme + ' rendered pixels: contrast ' + px.contrast.toFixed(2));
      ok(px.paper.join() !== plain[theme].join(), theme + ': the highlight is not visible, paper is ' + px.paper);
      notes.push(`${theme} ${px.contrast.toFixed(1)}:1`);
    }
    return notes.join(', ');
  });

  await step('phone 360x740: no horizontal scroll, top bar fits, popup and panel fit the width', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await sleep(600);
    ok((await overflowX()) <= 0, 'reader scrolls horizontally');
    await chrome();
    const bar = await page.locator('.bar-top button').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [e.getAttribute('aria-label'), Math.round(b.x), Math.round(b.right), Math.round(b.width), Math.round(b.height)]; }));
    ok(bar.every(([, x, r, w, h]) => x >= 0 && r <= 360 && w >= 40 && h >= 40), 'top bar: ' + JSON.stringify(bar));
    await selectWord([word.word]);
    const pop = await page.locator('.popup').boundingBox();
    ok(pop.x >= 0 && pop.x + pop.width <= 360.5, 'popup outside the viewport: ' + JSON.stringify(pop));
    const dots = await page.locator('.popup .dot').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return b.right <= 360 && b.width >= 36; }));
    ok(dots.length === 4 && dots.every(Boolean), 'dots: ' + dots);
    await dot('blue').click();
    await (await top('Annotations')).click();
    const sheetBox = await page.locator('dialog.sheet-notes[open]').boundingBox();
    ok(sheetBox.x >= 0 && sheetBox.width <= 360.5, 'panel box ' + JSON.stringify(sheetBox));
    ok((await overflowX()) <= 0, 'panel scrolls horizontally');
    const rowsOverflow = await page.locator('dialog.sheet-notes[open]').evaluate((d) => d.scrollWidth - d.clientWidth);
    ok(rowsOverflow <= 0, 'panel content wider than the panel by ' + rowsOverflow);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('keyboard: the bookmark button and panel are reachable by Tab', async () => {
    await page.keyboard.press('Tab');
    const names = [];
    for (let i = 0; i < 8; i++) { names.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))); await page.keyboard.press('Tab'); }
    ok(names.includes('Annotations') && (names.includes('Add bookmark') || names.includes('Remove bookmark')), 'tab order: ' + names.join(', '));
  });

  await step('PDF: bookmark by page persists and jumps; selecting text offers no highlight row', async () => {
    await backToLibrary();
    await page.locator('.card:not(:has(.card-title:text("Lighthouse"))) .card-open').first().click();
    await page.locator('.reader').waitFor();
    await until(async () => !(await page.locator('.loading').count()), 'pdf to load', 20000);
    await page.keyboard.press('ArrowRight');
    await until(async () => (await pct()) !== '17%', 'page 2');
    await (await top('Add bookmark')).click();
    await (await top('Remove bookmark')).waitFor();
    await page.keyboard.press('ArrowRight');
    await (await top('Add bookmark')).waitFor();
    await (await top('Annotations')).click();
    const sheet = page.locator('dialog.sheet-notes[open]');
    const text = await sheet.locator('.ann').allTextContents();
    ok(text.length === 1 && /Bookmark/.test(text[0]) && /Page 2/.test(text[0]), 'rows: ' + text);
    await sheet.locator('.ann-main').click();
    await (await top('Remove bookmark')).waitFor({ timeout: 8000 });
    // a PDF selection shows the lookup but not the highlight row
    await page.keyboard.press('Escape');
    const word = await page.evaluate(() => {
      const tl = document.querySelector('.textLayer');
      for (const span of tl.querySelectorAll('span')) {
        const m = /[A-Za-z]{5,}/.exec(span.textContent);
        if (!m) continue;
        const r = document.createRange(); r.setStart(span.firstChild, m.index); r.setEnd(span.firstChild, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (b.width > 0 && b.y > 90) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      return null;
    });
    await page.mouse.dblclick(word.x, word.y);
    await page.locator('.popup:not([hidden])').waitFor({ timeout: 8000 });
    eq(await page.locator('.popup .dot').count(), 0, 'no dots on PDF');
  });

  const failed = results.filter((r) => !r.ok);
  return { passed: results.length - failed.length, failed: failed.length, results, bookId };
}
