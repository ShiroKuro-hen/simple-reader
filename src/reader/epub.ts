import '../vendor/foliate-js/view.js';
import type { OpenBookOptions, ReaderHandle, ReaderSettings, TextSelection, TocItem } from '../types';
import { loadEpub } from './epub-book';
import { readSelection, replayable } from './selection';
import { epubCss } from './theme';

const toToc = (items: any[] = []): TocItem[] =>
  items.map((i) => ({ label: i.label, href: i.href, ...(i.subitems?.length ? { children: toToc(i.subitems) } : {}) }));

/** foliate shows up to 2 columns on a wide window; 'single' caps it at one page. */
function setLayout(renderer: HTMLElement, s: ReaderSettings) {
  renderer.setAttribute('max-column-count', s.layout === 'single' ? '1' : '2');
}

export async function openEpub(blob: Blob, container: HTMLElement, opts: OpenBookOptions): Promise<ReaderHandle> {
  const book = await loadEpub(blob);
  const view: any = document.createElement('foliate-view');
  view.style.cssText = 'display:block;width:100%;height:100%';
  container.append(view);

  const selects = replayable<TextSelection>();
  const relocates = replayable<{ location: string; fraction: number; label?: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  await view.open(book);
  view.renderer.setStyles(epubCss(opts.settings));
  setLayout(view.renderer, opts.settings);

  view.addEventListener('load', ({ detail: { doc } }: CustomEvent<{ doc: Document }>) => {
    opts.onDocLoad?.(doc);
    // Debounced so the popup waits for the drag/handles to settle instead of firing per character.
    doc.addEventListener('selectionchange', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
        const sel = readSelection(doc, undefined, { x: frame?.left ?? 0, y: frame?.top ?? 0 });
        if (sel) selects.emit(sel);
      }, 250);
    });
  });
  view.addEventListener('relocate', ({ detail: d }: CustomEvent) =>
    relocates.emit({ location: d.cfi, fraction: d.fraction, label: d.tocItem?.label }),
  );

  await view.init({ lastLocation: opts.location, showTextStart: false });

  return {
    next: () => view.next(),
    prev: () => view.prev(),
    goTo: (target) => view.goTo(target),
    goToFraction: (f) => view.goToFraction(f),
    toc: toToc(book.toc),
    setSettings(s) {
      view.renderer.setStyles(epubCss(s));
      setLayout(view.renderer, s);
    },
    onSelect: selects.on,
    onRelocate: relocates.on,
    destroy() {
      clearTimeout(timer);
      selects.clear();
      relocates.clear();
      view.close(); // closes the paginator, which revokes section URLs
      book.destroy?.();
      view.remove();
    },
  };
}
