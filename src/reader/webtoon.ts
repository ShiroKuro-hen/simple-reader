// Webtoon mode for comics: every page in one vertical column, each as wide as the column (the zoom sets that width).
// Only the pages near the view are decoded. Every other page keeps a placeholder as tall as its last known height.
import { currentPage, pageHeights, pagesToDecode, pageTop, scrollStep } from './webtoon-nav';

export interface Strip {
  /** Scrolls so that `page` is at the top of the view. */
  show(page: number): void;
  /** Moves by about a screen; at either end nothing happens. */
  step(dir: 1 | -1): void;
  /** Sets the column width, a percentage of the window, and keeps the page on screen. */
  zoom(percent: number): void;
  destroy(): void;
}

export interface StripOptions {
  total: number;
  /** The bytes of one page, 1-based. */
  read(page: number): Promise<Blob>;
  /** Percent of the window's width. */
  zoom: number;
  /** The page to start on. */
  page: number;
  /** Called whenever the page the reader is on changes. */
  onPage(page: number): void;
}

export function openStrip(root: HTMLElement, opts: StripOptions): Strip {
  const column = document.createElement('div');
  column.className = 'sr-strip';
  column.style.cssText = `flex:none;align-self:flex-start;margin:0 auto;width:${opts.zoom}%`;
  const slots = Array.from({ length: opts.total }, () => document.createElement('div'));
  column.append(...slots);
  root.append(column);
  // The strip keeps its own anchor in layout(), so the browser must not shift it too. Focus lets the arrow keys scroll it.
  root.style.overflowAnchor = 'none';
  root.style.outline = 'none';
  root.tabIndex = -1;
  root.focus({ preventScroll: true });

  const ratios: (number | undefined)[] = Array.from({ length: opts.total }); // height / width, once a page is decoded
  let heights: number[] = [];
  const shown = new Map<number, string>(); // object URLs of the decoded pages
  const loading = new Set<number>();
  let want = new Set<number>(); // the pages the view needs decoded now
  let reported = 0;
  let destroyed = false;

  /** Applies `change`, then the heights for the new width, keeping the page at the top edge where it was. */
  function apply(change: () => void) {
    const old = heights;
    const at = currentPage(old, root.scrollTop, 0);
    const share = old[at - 1] ? (root.scrollTop - pageTop(old, at)) / old[at - 1]! : 0;
    change();
    heights = pageHeights(ratios, column.clientWidth);
    heights.forEach((h, i) => (slots[i]!.style.height = `${h}px`));
    root.scrollTop = pageTop(heights, at) + share * (heights[at - 1] ?? 0);
  }

  function layout(change: () => void) {
    apply(change);
    onScroll();
  }

  function onScroll() {
    if (destroyed) return;
    const page = currentPage(heights, root.scrollTop, root.clientHeight);
    if (page !== reported) {
      reported = page;
      opts.onPage(page);
    }
    updateWindow();
  }

  function updateWindow() {
    want = new Set(pagesToDecode(heights, root.scrollTop, root.clientHeight));
    for (const p of [...shown.keys()]) if (!want.has(p)) drop(p);
    for (const p of want) if (!shown.has(p) && !loading.has(p)) void fill(p);
  }

  function drop(p: number) {
    slots[p - 1]!.replaceChildren();
    URL.revokeObjectURL(shown.get(p)!);
    shown.delete(p);
  }

  /** Decodes page `p` and shows it, unless the view no longer needs it by then. A page that fails to read keeps its placeholder. */
  async function fill(p: number) {
    loading.add(p);
    const blob = await opts.read(p).catch(() => null);
    loading.delete(p);
    if (!blob || destroyed) return;
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${p}`;
    img.draggable = false;
    img.style.cssText = 'display:block;width:100%;height:auto;user-select:none';
    await img.decode().catch(() => {}); // a broken page still shows its alt text
    if (destroyed || !want.has(p)) {
      URL.revokeObjectURL(url);
      return;
    }
    shown.set(p, url);
    slots[p - 1]!.replaceChildren(img);
    if (img.naturalWidth) layout(() => (ratios[p - 1] = img.naturalHeight / img.naturalWidth));
  }

  function show(page: number) {
    root.scrollTop = pageTop(heights, page);
    onScroll();
  }

  const ro = new ResizeObserver(() => layout(() => {}));
  ro.observe(root);
  root.addEventListener('scroll', onScroll, { passive: true });
  apply(() => {});
  show(opts.page);

  return {
    show,
    step(dir) {
      root.scrollTop = scrollStep(root.scrollTop, root.clientHeight, root.scrollHeight - root.clientHeight, dir);
    },
    zoom(percent) {
      layout(() => (column.style.width = `${percent}%`));
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
      root.removeEventListener('scroll', onScroll);
      for (const url of shown.values()) URL.revokeObjectURL(url);
      shown.clear();
      column.remove();
      root.style.overflowAnchor = '';
      root.style.outline = '';
      root.removeAttribute('tabindex');
    },
  };
}
