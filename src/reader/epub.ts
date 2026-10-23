import '../vendor/foliate-js/view.js';
import { HIGHLIGHT_FILL, highlightStyle } from '../annotations/paint';
import type { Annotation, OpenBookOptions, ReaderHandle, ReaderSettings, TextSelection, TocItem } from '../types';
import { collapse } from '../vendor/foliate-js/epubcfi.js';
import { Overlayer } from '../vendor/foliate-js/overlayer.js';
import { loadEpub } from './epub-book';
import { readSelection, replayable } from './selection';
import { epubCss } from './theme';

const toToc = (items: any[] = []): TocItem[] =>
  items.map((i) => ({ label: i.label, href: i.href, ...(i.subitems?.length ? { children: toToc(i.subitems) } : {}) }));

/** foliate shows up to 2 columns on a wide window; 'single' caps it at one page. */
function setLayout(renderer: HTMLElement, s: ReaderSettings) {
  renderer.setAttribute('max-column-count', s.layout === 'single' ? '1' : '2');
}

/** foliate's overlay reads these two custom properties when it paints a highlight. */
function setHighlightStyle(view: HTMLElement, s: ReaderSettings) {
  const { opacity, blend } = highlightStyle(s.theme);
  view.style.setProperty('--overlayer-highlight-opacity', String(opacity));
  view.style.setProperty('--overlayer-highlight-blend-mode', blend);
}

export async function openEpub(blob: Blob, container: HTMLElement, opts: OpenBookOptions): Promise<ReaderHandle> {
  const book = await loadEpub(blob);
  const view: any = document.createElement('foliate-view');
  view.style.cssText = 'display:block;width:100%;height:100%';
  container.append(view);

  const selects = replayable<TextSelection>();
  const relocates = replayable<{ location: string; fraction: number; label?: string }>();
  let clicks: (id: string, rect: TextSelection['rect']) => void = () => {};
  let wanted = new Map<string, Annotation>(); // what should be painted, by id
  let current: { cfi: string; range?: Range; label?: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = opts.settings.writing;
  // Page turns, jumps and the re-load after a writing change run one after another: foliate loses its place
  // when a turn starts while a section is still loading.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  await view.open(book);
  view.renderer.setStyles(epubCss(opts.settings));
  setLayout(view.renderer, opts.settings);
  setHighlightStyle(view, opts.settings);

  const paint = (a: Annotation) => view.addAnnotation({ ...a, value: a.location }).catch(() => {}); // a CFI that no longer resolves is skipped
  view.addEventListener('draw-annotation', ({ detail: { draw, annotation } }: CustomEvent) =>
    draw(Overlayer.highlight, { color: HIGHLIGHT_FILL[annotation.color as Annotation['color']] }));
  // A section just got its overlay: paint what belongs to it.
  view.addEventListener('create-overlay', ({ detail: { index } }: CustomEvent<{ index: number }>) => {
    for (const a of wanted.values()) {
      try {
        if (view.resolveNavigation(a.location).index === index) void paint(a);
      } catch {
        /* unresolvable location */
      }
    }
  });
  view.addEventListener('show-annotation', ({ detail: { value, range } }: CustomEvent<{ value: string; range: Range }>) => {
    const id = [...wanted.values()].find((a) => a.location === value)?.id;
    if (!id) return;
    const frame = range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
    const r = range.getBoundingClientRect();
    clicks(id, { x: r.x + (frame?.left ?? 0), y: r.y + (frame?.top ?? 0), width: r.width, height: r.height });
  });

  view.addEventListener('load', ({ detail: { doc, index } }: CustomEvent<{ doc: Document; index: number }>) => {
    opts.onDocLoad?.(doc);
    // Debounced so the popup waits for the drag/handles to settle instead of firing per character.
    doc.addEventListener('selectionchange', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
        const sel = readSelection(doc, undefined, { x: frame?.left ?? 0, y: frame?.top ?? 0 });
        if (sel) selects.emit({ ...sel, location: locationOf(doc, index) });
      }, 250);
    });
  });
  /** The CFI range of the live selection in a section, if foliate can express it. */
  function locationOf(doc: Document, index: number): string | undefined {
    try {
      const sel = doc.getSelection();
      return sel?.rangeCount ? view.getCFI(index, sel.getRangeAt(0)) : undefined;
    } catch {
      return undefined;
    }
  }
  /** foliate reads the writing direction when a section loads, so a change re-loads the section where the reader is. */
  function reloadAtPosition(): Promise<void> {
    return serial(() => {
      if (!current) return Promise.resolve();
      // The first word on screen, as a point: a range CFI would scroll to its far edge and land on another page.
      const start = current.range?.cloneRange();
      start?.collapse(true);
      const { index } = view.resolveNavigation(current.cfi);
      const target = view.resolveNavigation(start ? view.getCFI(index, start) : current.cfi);
      return view.renderer.goTo({ ...target, reload: true });
    }).then(() => undefined, () => undefined);
  }
  view.addEventListener('relocate', ({ detail: d }: CustomEvent) => {
    current = { cfi: d.cfi, range: d.range, label: d.tocItem?.label };
    relocates.emit({ location: d.cfi, fraction: d.fraction, label: d.tocItem?.label });
  });

  await view.init({ lastLocation: opts.location, showTextStart: false });

  return {
    next: () => serial(() => view.next()),
    prev: () => serial(() => view.prev()),
    goTo: (target) => serial(() => view.goTo(target)),
    goToFraction: (f) => serial(() => view.goToFraction(f)),
    toc: toToc(book.toc),
    setSettings(s) {
      view.renderer.setStyles(epubCss(s));
      setLayout(view.renderer, s);
      setHighlightStyle(view, s);
      if (s.writing !== writing) {
        writing = s.writing;
        return reloadAtPosition(); // resolves once the section is shown again, when its direction is known
      }
    },
    setAnnotations(items) {
      const next = new Map(items.filter((a) => a.kind !== 'bookmark' && !a.deleted).map((a) => [a.id, a]));
      for (const [id, old] of wanted) if (next.get(id)?.location !== old.location) void view.deleteAnnotation({ value: old.location }).catch(() => {});
      const before = wanted;
      wanted = next;
      for (const [id, a] of next) {
        const old = before.get(id);
        if (!old || old.location !== a.location || old.color !== a.color) void paint(a);
      }
    },
    onAnnotationClick(cb) {
      clicks = cb;
    },
    here() {
      if (!current) throw new Error('The book has not reported a position yet');
      const text = current.range?.toString().replace(/\s+/g, ' ').trim().slice(0, 200) ?? '';
      return { location: collapse(current.cfi), text, label: current.label };
    },
    onSelect: selects.on,
    onRelocate: relocates.on,
    // Read now, not cached: foliate's direction is for the section on screen, which changes with every load.
    rtl: () => writing === 'book' && (view.renderer.direction.writingMode === 'vertical-rl' || view.renderer.direction.rtl),
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
