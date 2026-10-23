import { bookmarkOn, createAnnotation, editAnnotation, mergeAnnotationFiles, previewText, putAnnotation, removeAnnotation, upsertMark } from '../annotations';
import type { Annotation, BookMeta, HighlightColor, Progress, ReaderHandle, TextSelection, TocItem } from '../types';
import { getAnnotations, getBookBlob, getProgress, saveAnnotations, saveProgress } from '../storage/library';
import { createAnnotationsPanel } from './annotations-panel';
import { h, icon, iconButton, sheet, toast } from './dom';
import { createPopup } from './popup';
import { fractionFromSlider, keyAction, progressLabel, sliderPosition } from './reading';
import { createSettings, type App } from './settings';
import { debounce } from './timing';

const HIDE_AFTER_MS = 3500;

export function mountReader(root: HTMLElement, book: BookMeta, app: App, onBack: () => void): () => void {
  const ac = new AbortController();
  const docs = new Set<Document>(); // rendered EPUB documents, kept so furigana can be re-applied
  const settings = createSettings(app, { comic: book.format === 'cbz', epub: book.format === 'epub' });
  let handle: ReaderHandle | null = null;
  let items: Annotation[] = []; // every highlight, note and bookmark of this book, tombstones included
  let where = { location: '', label: '' }; // the last reported position
  let writing: Promise<unknown> = Promise.resolve(); // saves run one after the other
  let disposed = false;
  let dragging = false;

  // --- annotations ---
  function clearSelection() {
    for (const d of docs) d.getSelection()?.removeAllRanges();
    document.getSelection()?.removeAllRanges();
  }
  function commit(next: Annotation[]) {
    items = next;
    handle?.setAnnotations(items);
    panel.render(items);
    showBookmarkState();
    // Merge with the file first: a restore or sync may have changed it since this book was opened.
    writing = writing
      .then(async () => saveAnnotations(mergeAnnotationFiles(await getAnnotations(book.id), { bookId: book.id, items: next })))
      .catch(() => toast("Couldn't save your annotations.", 'error'));
  }
  const edit = (id: string, patch: { note?: string; color?: HighlightColor }) => {
    const a = items.find((i) => i.id === id);
    if (a) commit(putAnnotation(items, editAnnotation(a, patch, Date.now())));
  };
  const mark = (sel: TextSelection, extra: { color?: HighlightColor; note?: string }) => {
    if (!sel.location) return;
    commit(upsertMark(items, { bookId: book.id, kind: extra.note ? 'note' : 'highlight', location: sel.location, text: sel.text, chapter: where.label, ...extra }, Date.now()));
    clearSelection();
  };
  const popup = createPopup({
    highlight: (sel, color) => mark(sel, { color }),
    note: (sel, note) => mark(sel, { note }),
    update: edit,
    remove: (id) => commit(removeAnnotation(items, id, Date.now())),
  });
  const panel = createAnnotationsPanel(book, {
    jump: (a) => {
      panel.close();
      handle?.goTo(a.location).catch(() => toast("Couldn't jump there.", 'error'));
    },
    setNote: (id, note) => edit(id, { note }),
    remove: (id) => commit(removeAnnotation(items, id, Date.now())),
  });

  // --- chrome ---
  const stage = h('div', { class: 'stage' });
  const loading = h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), h('p', {}, 'Opening book...'));
  const chapter = h('span', { class: 'chapter' });
  const pct = h('span', { class: 'pct' }, '0%');
  const slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Reading progress', disabled: true });
  const toc = sheet('sheet-toc', 'Contents');
  const tocBtn = iconButton('list', 'Contents', () => toc.showModal());
  tocBtn.disabled = true;

  const bookmarkBtn = iconButton('bookmark', 'Add bookmark', () => toggleBookmark());
  bookmarkBtn.disabled = true;
  bookmarkBtn.setAttribute('aria-pressed', 'false');
  const notesBtn = iconButton('pencil', 'Annotations', () => {
    popup.hide();
    panel.render(items);
    panel.open();
  });

  const top = h('header', { class: 'bar bar-top' },
    iconButton('back', 'Back to library', onBack),
    h('h1', { class: 'bar-title' }, book.title),
    bookmarkBtn,
    notesBtn,
    tocBtn,
    iconButton('settings', 'Reading settings', settings.open));
  const bottom = h('footer', { class: 'bar bar-bottom' }, h('div', { class: 'bar-meta' }, chapter, pct), slider);

  // Right-to-left pages (comics, vertical Japanese) turn the other way, so the left edge goes forward.
  // Read at each use: the book's direction is known once it renders, and the setting can change while reading.
  const flipped = () => handle?.rtl() ?? false;
  const edgeL = h('div', { class: 'edge edge-l', 'aria-hidden': 'true', onclick: () => turn(flipped() ? 1 : -1) });
  const edgeR = h('div', { class: 'edge edge-r', 'aria-hidden': 'true', onclick: () => turn(flipped() ? -1 : 1) });
  function drawEdges() {
    const f = flipped();
    edgeL.dataset.turn = f ? 'next' : 'prev';
    edgeR.dataset.turn = f ? 'prev' : 'next';
    edgeL.replaceChildren(icon(f ? 'next' : 'back'));
    edgeR.replaceChildren(icon(f ? 'back' : 'next'));
  }
  drawEdges();
  const hot = (cls: string) => h('div', { class: `hot ${cls}`, 'aria-hidden': 'true', onpointerdown: showChrome, onpointermove: showChrome });

  const view = h('div', { class: 'reader' }, stage, loading, edgeL, edgeR, hot('hot-top'), hot('hot-bottom'), top, bottom);
  root.replaceChildren(view, settings.el, toc, panel.el);

  // --- auto-hiding chrome ---
  let hideTimer = 0;
  const dialogOpen = () => !!view.parentElement?.querySelector('dialog[open]');
  const busy = () =>
    dialogOpen() ||
    [top, bottom].some((b) => (matchMedia('(hover: hover)').matches && b.matches(':hover')) || b.querySelector(':focus-visible'));
  function showChrome() {
    view.classList.remove('chrome-hidden');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => (busy() ? showChrome() : view.classList.add('chrome-hidden')), HIDE_AFTER_MS);
  }
  function toggleChrome() {
    if (view.classList.contains('chrome-hidden')) return showChrome();
    clearTimeout(hideTimer);
    view.classList.add('chrome-hidden');
  }
  addEventListener('pointermove', (e) => e.pointerType === 'mouse' && showChrome(), { signal: ac.signal });
  showChrome();

  // --- navigation ---
  function turn(dir: -1 | 1) {
    popup.hide();
    (dir > 0 ? handle?.next() : handle?.prev())?.catch(() => {});
  }

  function onKey(e: KeyboardEvent) {
    const action = keyAction({
      key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
      targetTag: (e.target as Element | null)?.tagName, dialogOpen: dialogOpen(), popupOpen: popup.open,
      rtl: flipped(),
    });
    if (!action) return;
    if (action === 'show-chrome') return showChrome(); // never swallow Tab
    e.preventDefault();
    if (action === 'next') turn(1);
    else if (action === 'prev') turn(-1);
    else if (action === 'close-popup') popup.hide();
    else toggleChrome();
  }
  addEventListener('keydown', onKey, { signal: ac.signal });

  // Foliate renders each section in an iframe: its events never reach our document.
  function onDocLoad(doc: Document) {
    docs.add(doc);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('pointerdown', () => popup.hide());
    doc.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && showChrome());
    doc.addEventListener('click', (e) => {
      // Touch: a tap in the middle of the page toggles the chrome.
      if ((e as PointerEvent).pointerType !== 'mouse' && doc.getSelection()?.isCollapsed) toggleChrome();
    });
    void applyJapanese(doc);
  }

  // --- Japanese reading ---
  let japaneseWarned = false;
  async function applyJapanese(doc: Document) {
    try {
      const { applyFurigana } = await import('../lookup/index');
      await applyFurigana(doc, app.settings.furigana);
    } catch {
      if (!japaneseWarned) toast("Couldn't load the Japanese dictionary. Furigana needs a connection the first time.", 'error');
      japaneseWarned = true;
    }
  }
  async function preloadJapanese() {
    if (book.format === 'cbz') return; // comics have no text to read furigana on
    try {
      await (await import('../lookup/index')).preloadJapanese();
    } catch {
      /* applyJapanese reports the failure */
    }
  }

  let mode = app.settings.furigana;
  const unsub = app.subscribe((s) => {
    drawEdges();
    // A book that re-loads for a new writing direction turns its edges over once it is shown again.
    void Promise.resolve(handle?.setSettings(s)).then(drawEdges, () => {});
    if (s.furigana === mode) return;
    mode = s.furigana;
    if (mode !== 'off') void preloadJapanese();
    for (const d of docs) d.defaultView ? void applyJapanese(d) : docs.delete(d);
  });

  // --- bookmarks ---
  function showBookmarkState() {
    const on = !!bookmarkOn(items, where.location);
    bookmarkBtn.classList.toggle('on', on);
    bookmarkBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Remove bookmark' : 'Add bookmark';
    bookmarkBtn.setAttribute('aria-label', label);
    bookmarkBtn.title = label;
  }
  function toggleBookmark() {
    if (!handle) return;
    const existing = bookmarkOn(items, where.location);
    if (existing) {
      commit(removeAnnotation(items, existing.id, Date.now()));
      return toast('Bookmark removed.');
    }
    const here = handle.here();
    commit(putAnnotation(items, createAnnotation({ bookId: book.id, kind: 'bookmark', location: here.location, text: previewText(here.text, 120), chapter: here.label }, Date.now())));
    toast('Bookmark added.');
  }

  // --- progress ---
  const persist = debounce((p: Progress) => void saveProgress(p).catch(() => {}), 700);
  addEventListener('pagehide', persist.flush, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => document.hidden && persist.flush(), { signal: ac.signal });

  slider.addEventListener('pointerdown', () => (dragging = true));
  slider.addEventListener('input', () => {
    pct.textContent = progressLabel(fractionFromSlider(+slider.value));
    slider.style.setProperty('--fill', `${+slider.value / 10}%`);
  });
  slider.addEventListener('change', () => {
    dragging = false;
    popup.hide();
    handle?.goToFraction(fractionFromSlider(+slider.value)).catch(() => {});
  });

  function buildToc(items: TocItem[]) {
    const entry = (it: TocItem, depth: number): HTMLElement[] => [
      h('button', {
        class: 'toc-item', type: 'button', style: `--d:${depth}`,
        onclick: () => {
          toc.close();
          handle?.goTo(it.href).catch(() => toast("Couldn't jump there.", 'error'));
        },
      }, it.label.trim() || 'Untitled'),
      ...(it.children ?? []).flatMap((c) => entry(c, depth + 1)),
    ];
    toc.replaceChildren(h('div', { class: 'toc' },
      h('div', { class: 'set-head' }, h('h2', {}, 'Contents'), iconButton('close', 'Close contents', () => toc.close())),
      h('nav', { 'aria-label': 'Table of contents' }, ...items.flatMap((i) => entry(i, 0)))));
  }

  function showFraction(fraction: number) {
    pct.textContent = progressLabel(fraction);
    slider.value = String(sliderPosition(fraction));
    slider.style.setProperty('--fill', `${sliderPosition(fraction) / 10}%`);
  }

  // --- open ---
  void (async () => {
    try {
      const [{ openBook }, blob, saved, notes] = await Promise.all([
        import('../reader/index'),
        getBookBlob(book.id),
        getProgress(book.id).catch(() => null),
        getAnnotations(book.id).catch(() => ({ bookId: book.id, items: [] as Annotation[] })),
      ]);
      if (disposed) return;
      if (app.settings.furigana !== 'off') void preloadJapanese();
      const opened = await openBook(blob, book.format, stage, {
        settings: app.settings,
        location: saved?.location,
        onDocLoad,
        getBars: () => ({ top: top.offsetHeight, bottom: bottom.offsetHeight }),
      });
      if (disposed) return opened.destroy();
      handle = opened;
      loading.remove();
      items = notes.items;
      opened.setAnnotations(items);
      opened.onAnnotationClick((id, rect) => {
        const a = items.find((i) => i.id === id && !i.deleted);
        if (a) popup.showAnnotation(a, rect);
      });
      opened.onSelect((sel) => popup.show(sel)); // readSelection leaves the furigana readings out
      let lastLocation = '';
      opened.onRelocate((p) => {
        drawEdges(); // a new section may turn the other way (vertical text)
        if (p.location !== lastLocation) popup.hide(); // the reader may repeat a relocate without moving
        lastLocation = p.location;
        chapter.textContent = p.label ?? '';
        where = { location: p.location, label: p.label ?? '' };
        bookmarkBtn.disabled = false;
        showBookmarkState();
        if (!dragging) showFraction(p.fraction);
        persist({ bookId: book.id, location: p.location, fraction: p.fraction, updatedAt: Date.now() });
      });
      slider.disabled = false;
      if (opened.toc.length) {
        buildToc(opened.toc);
        tocBtn.disabled = false;
      } else tocBtn.title = 'This book has no contents list';
    } catch {
      if (disposed) return;
      toast("Couldn't open this book. The file may be damaged or unsupported.", 'error');
      onBack();
    }
  })();

  return () => {
    disposed = true;
    ac.abort();
    clearTimeout(hideTimer);
    unsub();
    persist.flush();
    handle?.destroy();
    popup.dispose();
    settings.dispose();
    root.replaceChildren();
  };
}
