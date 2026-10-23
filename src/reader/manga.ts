// Comic archives (.cbz zip, .cbr rar) of page images, shown one spread at a time. Pages are decoded from the zip
// only while they are near the current spread, so a long book never sits fully decoded in memory.
import type { OpenBookOptions, ReaderHandle, ReaderSettings } from '../types';
import { openComicArchive } from './comic-archive';
import { displayOrder, pagesToKeep, sortPageNames, spreadOf, stepPage } from './manga-nav';
import { fractionOfPage, pageFromFraction, parsePage } from './pdf-nav';
import { replayable } from './selection';
import { loadUnrarWasm } from './rar-wasm';
import { THEMES } from './theme';

/** 'auto' shows two pages side by side once the window is at least this many times wider than tall. */
const SPREAD_RATIO = 1.1;
/** Pages kept decoded beyond the spread, ahead and behind it. */
const AHEAD = 3;
const BEHIND = 1;

export async function openCbz(blob: Blob, container: HTMLElement, opts: OpenBookOptions): Promise<ReaderHandle> {
  const archive = await openComicArchive(blob, { wasm: loadUnrarWasm });
  const names = sortPageNames(archive.names);
  if (names.length === 0) {
    await archive.close();
    throw new Error('no pages: the archive holds no images');
  }
  const total = names.length;

  const root = document.createElement('div');
  root.className = 'sr-manga';
  root.style.cssText = 'width:100%;height:100%;overflow:auto;display:flex;box-sizing:border-box';
  container.append(root);
  const spreadEl = document.createElement('div');
  root.append(spreadEl);

  const relocates = replayable<{ location: string; fraction: number; label?: string }>();
  let settings: ReaderSettings = opts.settings;
  let page = parsePage(opts.location, total); // normalised to the first page of its spread on each render
  let double = false; // whether the spread on screen shows two pages
  let renderId = 0; // a newer render supersedes older ones still loading
  let destroyed = false;
  const urls = new Map<number, string>(); // object URLs of the decoded window, by page number

  /** Two pages side by side only in 'auto' layout and only when the window is wide. */
  const wantsDouble = () =>
    settings.layout === 'auto' && root.clientHeight > 0 && root.clientWidth >= SPREAD_RATIO * root.clientHeight;

  const loadPage = (p: number) => archive.read(names[p - 1]!);

  async function render() {
    if (destroyed) return;
    const id = ++renderId;
    double = wantsDouble();
    page = spreadOf(page, total, double)[0]!;
    const spread = spreadOf(page, total, double);
    const keep = pagesToKeep(page, total, double, AHEAD, BEHIND);

    // Revoke before loading, so the number of live object URLs never exceeds the window.
    for (const [p, url] of urls) {
      if (keep.includes(p)) continue;
      URL.revokeObjectURL(url);
      urls.delete(p);
    }
    const missing = keep.filter((p) => !urls.has(p));
    let blobs: Blob[];
    try {
      blobs = await Promise.all(missing.map(loadPage));
    } catch (err) {
      if (id === renderId) throw err;
      return; // superseded, or closed while loading
    }
    if (id !== renderId) return;
    missing.forEach((p, i) => urls.set(p, URL.createObjectURL(blobs[i]!)));

    // Decode before swapping, so the frame never shows an empty spread.
    const imgs = displayOrder(spread, settings.rtl).map((p) => {
      const img = document.createElement('img');
      img.src = urls.get(p)!;
      img.alt = `Page ${p}`;
      img.draggable = false;
      img.style.cssText = `display:block;width:${100 / spread.length}%;height:auto;max-height:100%;min-width:0;object-fit:contain;user-select:none`;
      return img;
    });
    await Promise.all(imgs.map((img) => img.decode().catch(() => {}))); // a broken page still shows its alt text
    if (id !== renderId) return;

    // Zoom by the font-size setting; above 100% the root scrolls.
    const zoom = settings.fontSize; // percent of the window, as a size
    spreadEl.style.cssText = `display:flex;align-items:center;justify-content:center;flex:none;margin:auto;width:${zoom}%;height:${zoom}%`;
    spreadEl.replaceChildren(...imgs);
    root.style.background = THEMES[settings.theme].bg;
    relocates.emit({ location: String(page), fraction: fractionOfPage(page, total), label: `${page} / ${total}` });
  }

  const go = (target: number) => {
    if (destroyed) return Promise.resolve();
    const next = spreadOf(target, total, wantsDouble())[0]!;
    if (next === page) return Promise.resolve();
    page = next;
    root.scrollTo(0, 0);
    return render();
  };

  // Resizes fire in bursts; the spread is only redrawn when 'auto' flips between one and two pages.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!destroyed && wantsDouble() !== double) void render();
    }, 150);
  });
  ro.observe(root);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderId++;
    clearTimeout(resizeTimer);
    ro.disconnect();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    relocates.clear();
    root.remove();
    void archive.close();
  }

  try {
    await render();
  } catch (err) {
    destroy();
    throw err;
  }

  return {
    next: () => go(stepPage(page, total, wantsDouble(), 1)),
    prev: () => go(stepPage(page, total, wantsDouble(), -1)),
    goTo: (target) => go(parsePage(target, total)),
    goToFraction: (f) => go(pageFromFraction(f, total)),
    toc: [],
    setSettings(s) {
      const redraw = s.layout !== settings.layout || s.fontSize !== settings.fontSize || s.rtl !== settings.rtl;
      settings = s;
      root.style.background = THEMES[s.theme].bg;
      if (redraw) void render();
    },
    onSelect() {},
    onRelocate: relocates.on,
    // Comics have no text to select, highlight or link: the view's annotation features stay off.
    setAnnotations() {},
    onAnnotationClick() {},
    here: () => ({ location: String(page), text: '', label: `Page ${page}` }),
    rtl: () => settings.rtl,
    destroy,
  };
}
