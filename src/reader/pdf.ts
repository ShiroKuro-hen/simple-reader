import 'pdfjs-dist/web/pdf_viewer.css';
import type { OpenBookOptions, ReaderHandle, ReaderSettings, TextSelection, TocItem } from '../types';
import { fractionOfPage, pageFromFraction, parsePage } from './pdf-nav';
import { pdfjs } from './pdfjs';
import { readSelection, replayable } from './selection';
import { THEMES } from './theme';

const PAD = 16;

export async function openPdf(blob: Blob, container: HTMLElement, opts: OpenBookOptions): Promise<ReaderHandle> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    // Needs node_modules/pdfjs-dist/cmaps copied to public/pdfjs/cmaps; without it only CJK-encoded PDFs degrade.
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
  });
  const pdf = await task.promise;
  const total = pdf.numPages;

  const scroller = document.createElement('div');
  scroller.className = 'sr-pdf';
  scroller.style.cssText = `width:100%;height:100%;overflow:auto;scrollbar-gutter:stable;display:flex;box-sizing:border-box;padding:${PAD}px`;
  const pageEl = document.createElement('div');
  pageEl.style.cssText = 'position:relative;margin:0 auto;flex:none';
  const textLayerEl = document.createElement('div');
  textLayerEl.className = 'textLayer';
  pageEl.append(textLayerEl);
  scroller.append(pageEl);
  container.append(scroller);

  const selects = replayable<TextSelection>();
  const relocates = replayable<{ location: string; fraction: number; label?: string }>();
  let settings: ReaderSettings = opts.settings;
  let page = parsePage(opts.location, total);
  let canvas: HTMLCanvasElement | undefined;
  let fittedWidth = scroller.clientWidth; // container width the current page is fitted to
  let renderId = 0; // a newer render supersedes older ones still awaiting pdf.js
  let renderTask: { cancel(): void } | undefined;
  let textLayer: { cancel(): void } | undefined;

  function style() {
    scroller.style.background = THEMES[settings.theme].bg;
    // Invert only the bitmap so the invisible text layer keeps normal selection colours.
    if (canvas) canvas.style.filter = settings.theme === 'dark' ? 'invert(1) hue-rotate(180deg)' : '';
  }

  async function render() {
    const id = ++renderId; console.log("RENDER", id, scroller.clientWidth, fittedWidth);
    renderTask?.cancel();
    textLayer?.cancel();
    const p = await pdf.getPage(page);
    if (id !== renderId) return;
    // Fit to the container width, then zoom by the font-size setting.
    fittedWidth = scroller.clientWidth;
    const fit = (fittedWidth - PAD * 2) / p.getViewport({ scale: 1 }).width;
    const scale = Math.max(0.1, fit) * (settings.fontSize / 100);
    const viewport = p.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;

    // Draw off-screen and swap afterwards, so a re-render does not flash an empty page.
    const next = document.createElement('canvas');
    next.width = Math.floor(viewport.width * dpr);
    next.height = Math.floor(viewport.height * dpr);
    next.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px`;
    const rt = p.render({ canvas: next, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    renderTask = rt;
    try {
      await rt.promise;
    } catch {
      return; // cancelled by a newer render
    }
    if (id !== renderId) return;

    canvas?.remove();
    canvas = next;
    pageEl.prepend(next);
    style();
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;
    pageEl.style.setProperty('--scale-factor', String(scale));
    pageEl.style.setProperty('--total-scale-factor', String(scale));
    textLayerEl.replaceChildren();
    const tl = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: textLayerEl, viewport });
    textLayer = tl;
    await tl.render().catch(() => {});
    if (id === renderId) relocates.emit({ location: String(page), fraction: fractionOfPage(page, total), label: `${page} / ${total}` });
  }

  const go = async (n: number) => {
    const target = Math.min(total, Math.max(1, Math.round(n)));
    if (target === page && canvas) return;
    page = target;
    scroller.scrollTop = 0;
    await render();
  };

  // Resizes fire in bursts; re-fit once the size settles.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const ro = new ResizeObserver(() => {
    if (scroller.clientWidth === fittedWidth) return; // also skips the observer's initial callback, which would wipe a fresh selection
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scroller.clientWidth !== fittedWidth && void render(), 150);
  });
  ro.observe(scroller);

  // pdf.js css uses .selecting to stop Chromium from jumping the selection across gaps.
  const startSel = () => textLayerEl.classList.add('selecting');
  const endSel = () => textLayerEl.classList.remove('selecting');
  textLayerEl.addEventListener('pointerdown', startSel);
  document.addEventListener('pointerup', endSel);

  let selTimer: ReturnType<typeof setTimeout> | undefined;
  const onSelChange = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const anchor = document.getSelection()?.anchorNode;
      if (!anchor || !textLayerEl.contains(anchor)) return;
      const sel = readSelection(document, textLayerEl, undefined, " ");
      if (sel) selects.emit(sel);
    }, 250);
  };
  document.addEventListener('selectionchange', onSelChange);

  const toc = await outlineToToc(pdf);
  await render();

  return {
    next: () => go(page + 1),
    prev: () => go(page - 1),
    goTo: (target) => go(parsePage(target, total)),
    goToFraction: (f) => go(pageFromFraction(f, total)),
    toc,
    setSettings(s) {
      const rescale = s.fontSize !== settings.fontSize;
      settings = s;
      style();
      if (rescale) void render();
    },
    onSelect: selects.on,
    onRelocate: relocates.on,
    rtl: () => false,
    // PDF highlights are not in v1: only bookmarks (a page number), which the view keeps itself.
    setAnnotations() {},
    onAnnotationClick() {},
    here: () => ({
      location: String(page),
      text: (textLayerEl.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      label: `Page ${page}`,
    }),
    destroy() {
      renderId++;
      renderTask?.cancel();
      textLayer?.cancel();
      clearTimeout(resizeTimer);
      clearTimeout(selTimer);
      ro.disconnect();
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('pointerup', endSel);
      selects.clear();
      relocates.clear();
      scroller.remove();
      void task.destroy();
    },
  };
}

/** Outline entries become page-number hrefs; entries that do not resolve to a page are dropped. */
async function outlineToToc(pdf: any): Promise<TocItem[]> {
  const convert = async (items: any[]): Promise<TocItem[]> => {
    const out = await Promise.all(
      items.map(async (i): Promise<TocItem | null> => {
        try {
          const dest = typeof i.dest === 'string' ? await pdf.getDestination(i.dest) : i.dest;
          const href = String((await pdf.getPageIndex(dest[0])) + 1);
          const children = i.items?.length ? await convert(i.items) : undefined;
          return { label: i.title, href, ...(children?.length ? { children } : {}) };
        } catch {
          return null;
        }
      }),
    );
    return out.filter((x): x is TocItem => !!x);
  };
  return convert((await pdf.getOutline()) ?? []);
}
