import type { BookMeta, Progress, ReaderHandle, TocItem } from '../types';
import { getBookBlob, getProgress, saveProgress } from '../storage/library';
import { h, icon, iconButton, sheet, toast } from './dom';
import { createPopup } from './popup';
import { fractionFromSlider, keyAction, progressLabel, sliderPosition } from './reading';
import { createSettings, type App } from './settings';
import { debounce } from './timing';

const HIDE_AFTER_MS = 3500;

export function mountReader(root: HTMLElement, book: BookMeta, app: App, onBack: () => void): () => void {
  const ac = new AbortController();
  const docs = new Set<Document>(); // rendered EPUB documents, kept so furigana can be re-applied
  const popup = createPopup();
  const settings = createSettings(app);
  let handle: ReaderHandle | null = null;
  let disposed = false;
  let dragging = false;

  // --- chrome ---
  const stage = h('div', { class: 'stage' });
  const loading = h('div', { class: 'loading', role: 'status' }, h('div', { class: 'spinner' }), h('p', {}, 'Opening book...'));
  const chapter = h('span', { class: 'chapter' });
  const pct = h('span', { class: 'pct' }, '0%');
  const slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Reading progress', disabled: true });
  const toc = sheet('sheet-toc', 'Contents');
  const tocBtn = iconButton('list', 'Contents', () => toc.showModal());
  tocBtn.disabled = true;

  const top = h('header', { class: 'bar bar-top' },
    iconButton('back', 'Back to library', onBack),
    h('h1', { class: 'bar-title' }, book.title),
    tocBtn,
    iconButton('settings', 'Reading settings', settings.open));
  const bottom = h('footer', { class: 'bar bar-bottom' }, h('div', { class: 'bar-meta' }, chapter, pct), slider);

  const edge = (dir: -1 | 1) =>
    h('div', { class: `edge edge-${dir < 0 ? 'l' : 'r'}`, 'data-turn': dir < 0 ? 'prev' : 'next', 'aria-hidden': 'true', onclick: () => turn(dir) },
      dir < 0 ? icon('back') : icon('next'));
  const hot = (cls: string) => h('div', { class: `hot ${cls}`, 'aria-hidden': 'true', onpointerdown: showChrome, onpointermove: showChrome });

  const view = h('div', { class: 'reader' }, stage, loading, edge(-1), edge(1), hot('hot-top'), hot('hot-bottom'), top, bottom);
  root.replaceChildren(view, settings.el, toc);

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

  // A selection over furigana would otherwise include the <rt> readings in its text.
  function withoutRuby(text: string): string {
    for (const d of docs) {
      const s = d.getSelection();
      if (!s || s.isCollapsed || s.toString().trim() !== text) continue;
      const box = d.createElement('div');
      box.append(s.getRangeAt(0).cloneContents());
      box.querySelectorAll('rt, rp').forEach((n) => n.remove());
      return box.textContent?.trim() || text;
    }
    return text;
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
    try {
      await (await import('../lookup/index')).preloadJapanese();
    } catch {
      /* applyJapanese reports the failure */
    }
  }

  let mode = app.settings.furigana;
  const unsub = app.subscribe((s) => {
    handle?.setSettings(s);
    if (s.furigana === mode) return;
    mode = s.furigana;
    if (mode !== 'off') void preloadJapanese();
    for (const d of docs) d.defaultView ? void applyJapanese(d) : docs.delete(d);
  });

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
      const [{ openBook }, blob, saved] = await Promise.all([
        import('../reader/index'),
        getBookBlob(book.id),
        getProgress(book.id).catch(() => null),
      ]);
      if (disposed) return;
      if (app.settings.furigana !== 'off') void preloadJapanese();
      const opened = await openBook(blob, book.format, stage, {
        settings: app.settings,
        location: saved?.location,
        onDocLoad,
      });
      if (disposed) return opened.destroy();
      handle = opened;
      loading.remove();
      opened.onSelect((sel) => popup.show({ ...sel, text: withoutRuby(sel.text) }));
      let lastLocation = '';
      opened.onRelocate((p) => {
        if (p.location !== lastLocation) popup.hide(); // the reader may repeat a relocate without moving
        lastLocation = p.location;
        chapter.textContent = p.label ?? '';
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
