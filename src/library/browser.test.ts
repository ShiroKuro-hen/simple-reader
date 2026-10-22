// Library search, tags and sorting in a real Chromium: a real production build, real OPFS, the real EPUB/PDF fixtures.
// Skipped (not failed) when Playwright is not found. REAL_EPUB=<path to your own .epub> adds a check on a real book
// (read in place by the browser's file chooser, never copied).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as support from '../../e2e/support.mjs';

const pw: any = await support.loadPlaywright();
const FIX = fileURLToPath(new URL('../reader/fixtures/', import.meta.url));
const REAL_EPUB = (globalThis as any).process.env.REAL_EPUB as string | undefined;

describe.skipIf(!pw)('library search, tags and sort in a real browser', { timeout: 90_000 }, () => {
  let tmp = '';
  let server: { url: string; close(): Promise<void> };
  let browser: any;
  let page: any;
  const errors: string[] = [];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sr-lib-'));
    await support.buildApp(join(tmp, 'dist'));
    server = await support.servePreview(join(tmp, 'dist'));
    browser = await support.launchChromium(pw);
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    page = await context.newPage();
    page.on('pageerror', (e: Error) => errors.push(String(e)));
    await page.goto(server.url);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  const titles = (): Promise<string[]> => page.locator('.card-title').allTextContents();
  const count = async () => (await page.locator('.lib-count').textContent()).trim();
  const search = async (q: string) => {
    await page.fill('input[type=search]', q);
  };
  const tagButton = (title: string) => page.getByRole('button', { name: `Edit tags of ${title}` });
  const chip = (tag: string) => page.locator('.tag-chips .chip', { hasText: tag });
  const waitTitles = (expected: string[]) => expect.poll(titles, { timeout: 10_000 }).toEqual(expected);

  /** Adds tags in the dialog of `title`; returns the error text shown (if any) and leaves the dialog open. */
  async function typeTag(text: string) {
    await page.fill('.tag-input', text);
    await page.keyboard.press('Enter');
  }
  const dialogTags = () => page.locator('.tag-list .chip.static').allTextContents();

  it('imports real books and shows them with a count and no tag chips yet', async () => {
    await page.setInputFiles('input[type=file]', ['book-en.epub', 'book-ja.epub', 'sample.pdf', 'corrupt.pdf'].map((f) => FIX + f));
    await expect.poll(() => page.locator('.card').count(), { timeout: 30_000 }).toBe(4);
    expect(await count()).toBe('4 books');
    expect(await page.locator('.tag-chips').isVisible()).toBe(false);
  });

  it('searches title, author and Japanese text, ignoring case and accents', async () => {
    for (const [q, expected] of [
      ['lighthouse', ['The Lighthouse & the Sea']],
      ['LIGHTHOUSE', ['The Lighthouse & the Sea']],
      ['marlowé', ['The Lighthouse & the Sea']], // author, accent-insensitive
      ['pat doe', ['Sample PDF Manual']],
      ['猫', ['吾輩は猫である']],
      ['漱石', ['吾輩は猫である']],
      ['吾輩 猫', ['吾輩は猫である']],
      ['corrupt', ['corrupt']],
    ] as const) {
      await search(q);
      await waitTitles([...expected]);
    }
    await search('lighthouse');
    await waitTitles(['The Lighthouse & the Sea']);
    expect(await count()).toBe('1 of 4 books');
  });

  it('says "No results" and clears everything with one button', async () => {
    await search('zzzz');
    await page.getByRole('heading', { name: 'No results' }).waitFor();
    expect(await count()).toBe('0 of 4 books');
    expect(await page.locator('.card').count()).toBe(0);
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect.poll(() => page.locator('.card').count()).toBe(4);
    expect(await page.inputValue('input[type=search]')).toBe('');
  });

  it('edits tags in a dialog: validation, duplicates, comma-separated input, removal', async () => {
    await tagButton('The Lighthouse & the Sea').click();
    await page.locator('dialog.tag-sheet[open]').waitFor();

    await typeTag('');
    expect(await page.locator('.tag-error').textContent()).toMatch(/Type a tag/);
    await typeTag('x'.repeat(31));
    expect(await page.locator('.tag-error').textContent()).toMatch(/up to 30/);

    await typeTag(' Ficción , SciFi ');
    await expect.poll(dialogTags).toEqual(['ficción×', 'scifi×']); // lowercase, trimmed, both added
    expect(await page.inputValue('.tag-input')).toBe('');

    await typeTag('FICCIÓN');
    await expect.poll(() => page.locator('.tag-error').textContent()).toMatch(/already/);
    expect(await dialogTags()).toEqual(['ficción×', 'scifi×']); // nothing was added or lost

    await page.getByRole('button', { name: 'Remove tag scifi' }).click();
    await expect.poll(dialogTags).toEqual(['ficción×']);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('dialog.tag-sheet').waitFor({ state: 'detached' });
  });

  it('shows tag chips with counts, filters by them and finds tagged books by search', async () => {
    await chip('ficción').waitFor();
    expect((await chip('ficción').textContent())!.replace(/\s/g, '')).toBe('ficción1');
    expect(await page.locator('.card-tagline').allTextContents()).toEqual(['#ficción']);

    await chip('ficción').click();
    await waitTitles(['The Lighthouse & the Sea']);
    expect(await chip('ficción').getAttribute('aria-pressed')).toBe('true');
    expect(await count()).toBe('1 of 4 books');
    await chip('ficción').click();
    await expect.poll(() => page.locator('.card').count()).toBe(4);

    await search('ficcion'); // tags are searched too, without the accent
    await waitTitles(['The Lighthouse & the Sea']);
    await search('');
  });

  it('combines tags (all must match) and drops a selected tag that no book carries any more', async () => {
    await tagButton('Sample PDF Manual').click();
    await typeTag('ficción, manual');
    await expect.poll(dialogTags).toEqual(['ficción×', 'manual×']);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('dialog.tag-sheet').waitFor({ state: 'detached' });

    await chip('ficción').click();
    await expect.poll(async () => (await titles()).sort()).toEqual(['Sample PDF Manual', 'The Lighthouse & the Sea']);
    await chip('manual').click();
    await waitTitles(['Sample PDF Manual']);

    // Remove "manual" from the only book that has it while it is selected: the filter must not strand the user on an empty view.
    await tagButton('Sample PDF Manual').click();
    await page.getByRole('button', { name: 'Remove tag manual' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('dialog.tag-sheet').waitFor({ state: 'detached' });
    await expect.poll(async () => (await titles()).sort()).toEqual(['Sample PDF Manual', 'The Lighthouse & the Sea']);
    expect(await chip('manual').count()).toBe(0);
    await chip('ficción').click();
  });

  it('keeps tags (with updatedAt) after a reload, in the stored metadata', async () => {
    await page.reload();
    await expect.poll(() => page.locator('.card').count()).toBe(4);
    expect(await page.locator('.card-tagline').allTextContents()).toEqual(expect.arrayContaining(['#ficción']));
    const metas: any[] = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const meta = await root.getDirectoryHandle('meta');
      const out: any[] = [];
      for await (const [name, h] of (meta as any).entries()) out.push(JSON.parse(await (await h.getFile()).text()));
      return out;
    });
    const tagged = metas.filter((m) => m.tags?.length);
    expect(tagged.map((m) => m.title).sort()).toEqual(['Sample PDF Manual', 'The Lighthouse & the Sea']);
    for (const m of tagged) {
      expect(m.tags).toEqual(['ficción']);
      expect(m.updatedAt).toBeGreaterThan(m.addedAt);
    }
    expect(metas.find((m) => m.title === '吾輩は猫である').updatedAt).toBeUndefined();
  });

  it('sorts by title and by author, and remembers the choice', async () => {
    await page.selectOption('select[aria-label="Sort by"]', 'title');
    await waitTitles(['corrupt', 'Sample PDF Manual', 'The Lighthouse & the Sea', '吾輩は猫である']);
    await page.selectOption('select[aria-label="Sort by"]', 'author');
    // Ada Marlowe, Pat Doe, 夏目漱石, then the book without an author
    await waitTitles(['The Lighthouse & the Sea', 'Sample PDF Manual', '吾輩は猫である', 'corrupt']);
    await page.reload();
    await expect.poll(() => page.locator('.card').count()).toBe(4);
    expect(await page.inputValue('select[aria-label="Sort by"]')).toBe('author');
  });

  it('"Recently read" puts the book you just read first', async () => {
    await page.selectOption('select[aria-label="Sort by"]', 'read');
    await page.locator('button.card-open[aria-label^="Open 吾輩は猫である"]').click();
    await page.locator('.reader').waitFor();
    await expect.poll(async () => (await page.locator('.chapter').first().textContent())?.trim(), { timeout: 20_000 }).toBeTruthy();
    const pct = () => page.locator('.pct').first().textContent();
    const first = await pct();
    for (let i = 0; i < 12 && (await pct()) === first; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
    }
    expect(await pct()).not.toBe(first);
    await page.waitForTimeout(600); // progress is saved shortly after a page turn
    await page.evaluate(() => (location.hash = ''));
    await page.locator('.card').first().waitFor();
    await expect.poll(async () => (await titles())[0], { timeout: 10_000 }).toBe('吾輩は猫である');
  });

  it('fits a 360 px phone: no sideways scroll, search and tag dialog usable', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => (location.hash = ''));
    await page.locator('.card').first().waitFor();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const box = await page.locator('input[type=search]').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);

    await tagButton('Sample PDF Manual').click();
    const dlg = await page.locator('dialog.tag-sheet[open]').boundingBox();
    expect(dlg.x).toBeGreaterThanOrEqual(0);
    expect(dlg.x + dlg.width).toBeLessThanOrEqual(360);
    await page.getByRole('button', { name: 'Done' }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1000, height: 760 });
  });

  it('removing a book that carried the only selected tag does not strand the view', async () => {
    await chip('ficción').click();
    await expect.poll(async () => (await titles()).sort()).toEqual(['Sample PDF Manual', 'The Lighthouse & the Sea']);
    for (const title of ['Sample PDF Manual', 'The Lighthouse & the Sea']) {
      await page.getByRole('button', { name: `Remove ${title}` }).click();
      await page.locator('.card.confirming .btn.danger').click();
      await expect.poll(() => page.locator('.card', { hasText: title }).count()).toBe(0);
    }
    await expect.poll(() => page.locator('.card').count()).toBe(2); // the filter is gone with its last tag
    expect(await count()).toBe('2 books');
  });

  it('raised no uncaught page errors', () => expect(errors).toEqual([]));
});

describe.skipIf(!pw || !REAL_EPUB)('a real book of your own (opt-in: REAL_EPUB)', { timeout: 120_000 }, () => {
  it('is imported, found by the first word of its title and tagged', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sr-real-'));
    await support.buildApp(join(tmp, 'dist'));
    const server = await support.servePreview(join(tmp, 'dist'));
    const browser = await support.launchChromium(pw);
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(server.url);
      await page.setInputFiles('input[type=file]', REAL_EPUB!);
      await page.locator('.card').first().waitFor({ timeout: 60_000 });
      const title: string = (await page.locator('.card-title').first().textContent())!;
      const word = title.split(/\s+/)[0]!;
      await page.fill('input[type=search]', word);
      expect(await page.locator('.card').count()).toBe(1);
      await page.getByRole('button', { name: /^Edit tags of/ }).click();
      await page.fill('.tag-input', 'web novel');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Done' }).click();
      await page.fill('input[type=search]', 'web novel');
      expect(await page.locator('.card').count()).toBe(1);
    } finally {
      await browser.close();
      await server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
