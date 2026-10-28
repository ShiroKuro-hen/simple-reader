import type { BookFormat, BookMeta, Progress } from '../types';
import { chooseFormats, packVolume, planFolderImport, seriesNameFor, type FolderPlan, type ImageVolume } from '../library/folder-import';
import { setPendingFind } from '../library/pending-find';
import { recentBooks } from '../library/recent';
import { fold } from '../library/search';
import { parseSortKey, SORT_KEYS, type SortKey } from '../library/sort';
import { type BookHit, rankHits, scanBooks, type ScanStep } from '../library/text-search';
import { addTag, cleanTags, FAVORITES, isFavorite, liveSelection, MAX_TAG_LENGTH, MAX_TAGS, removeTag, tagCounts, toggleFavorite, type AddResult } from '../library/tags';
import { countLabel, libraryView } from '../library/view';
import type { InstallPrompt } from '../pwa/install';
import { excerptParts } from '../reader/search-results';
import { addBook, cloudIds, getBookText, getProgress, listBooks, removeBook, saveProgress, setTags } from '../storage/library';
import { coverInitial, titleHue } from './cover';
import { h, icon, iconButton, sheet, toast } from './dom';
import type { Entry } from '../library/series';
import { isRead, withReadMark } from '../library/volumes';
import { isConfigured, loadR2 } from '../sync/config';
import { storage } from '../storage/index';
import { libIcon } from './library-icons';
import { bookLabel } from './reading';
import { createSettings, type App } from './settings';
import type { PickedFile } from '../native/incoming';
import { debounce } from './timing';

type SeriesEntry = Extract<Entry, { kind: 'series' }>;
/** One thing to add: a picked file, or a comic packed from a folder of images (packed only when its turn comes). */
type Item = { name: string; load: () => File | Promise<File> };

const FORMAT_NAMES: Record<BookFormat, string> = { epub: 'EPUB', pdf: 'PDF', cbz: 'Comics (CBZ/CBR)' };

const isBook = (f: File) => /\.(epub|pdf|cbz|cbr)$/i.test(f.name) || /^application\/(epub\+zip|pdf|vnd\.comicbook\+zip|vnd\.comicbook-rar|x-cbz|x-cbr)$/.test(f.type);
const fileItem = (f: File): Item => ({ name: f.name, load: () => f });
const volumeItem = (v: ImageVolume, files: readonly File[]): Item => ({ name: `${v.name}.cbz`, load: () => packVolume(v, files) });

const SORT_KEY = 'sr.sort';
const SORT_LABELS: Record<SortKey, string> = { added: 'Recently added', title: 'Title', author: 'Author', read: 'Recently read' };
const TAG_ERRORS: Record<Extract<AddResult, { ok: false }>['reason'], string> = {
  empty: 'Type a category first.',
  'too-long': `Categories can be up to ${MAX_TAG_LENGTH} characters.`,
  invalid: 'That category has characters that are not allowed.',
  duplicate: 'That category is already on this book.',
  'too-many': `A book can have up to ${MAX_TAGS} categories.`,
};

const SHOW_CLOUD_KEY = 'sr.showcloud';
function storedShowCloud(): boolean {
  try {
    return localStorage.getItem(SHOW_CLOUD_KEY) === 'on';
  } catch {
    return false;
  }
}

function storedSort(): SortKey {
  try {
    return parseSortKey(localStorage.getItem(SORT_KEY));
  } catch {
    return 'added';
  }
}

export function mountLibrary(root: HTMLElement, app: App, onOpen: (id: string) => void, install?: InstallPrompt): () => void {
  const ac = new AbortController();
  const settings = createSettings(app, { onRestored: () => void refresh() });
  let books: BookMeta[] = [];
  const progress = new Map<string, Progress>();
  /** Books that came down from the cloud; every other book was added from a file on this device. */
  let cloud = new Set<string>();
  /** "Show cloud books" is on: books that are only in the bucket are listed too, and downloaded when opened. Kept between visits. */
  let showCloud = storedShowCloud();
  /** The books the bucket has and this device lacks, read when the switch is turned on (or the library opens with it on). */
  let cloudOnly: BookMeta[] = [];
  let loadingCloud = false;
  let loaded = false;
  let query = '';
  let selected: string[] = [];
  let sort = storedSort();
  /** Lower-cased name of the series whose volumes are listed; session only, never stored. */
  let openSeries: string | null = null;
  /** "Search inside books" is on: the search box then looks in the text of EPUB and PDF books. Session only. */
  let finding = false;
  /** Each scan takes a number; a scan whose number is no longer the current one stops. */
  let scanId = 0;
  /** Progress and matches of the scan for the current query; null until one has started. */
  let scan: ScanStep | null = null;

  const input = h('input', {
    type: 'file', accept: '.epub,.pdf,.cbz,.cbr,application/epub+zip,application/pdf,application/vnd.comicbook+zip,application/vnd.comicbook-rar,application/x-cbr', multiple: true, hidden: true,
    onchange: () => {
      void addFiles([...(input.files ?? [])]);
      input.value = ''; // lets the same file be picked again
    },
  });
  const addLabel = h('span', {}, 'Add books');
  const addBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, icon('plus'), addLabel);
  // A folder picker is made on each click rather than kept in the page, so `input[type=file]` still means the book picker.
  let folderPicker: HTMLInputElement | undefined;
  const addFolderBtn = h('button', { class: 'btn', type: 'button', onclick: () => pickFolder() }, 'Add folder');
  const installBtn = h('button', { class: 'btn install-btn', type: 'button', hidden: true,
    onclick: () => void install?.prompt() }, libIcon('download'), h('span', { class: 'btn-label' }, 'Install app'));
  const syncInstall = () => { installBtn.hidden = !install?.available(); };
  syncInstall();
  const unsubInstall = install?.subscribe(syncInstall);

  // Search, sort, category chips and the count are created once so typing never loses focus; render() only refills them.
  const search = h('input', { class: 'search-input', type: 'search', placeholder: 'Search title, author or category', 'aria-label': 'Search your library',
    autocomplete: 'off', spellcheck: 'false',
    oninput: () => { query = search.value; if (finding) { stopScan(); scheduleScan(); } render(); } });
  const sortSel = h('select', { class: 'sort-select', 'aria-label': 'Sort by',
    onchange: () => {
      sort = parseSortKey(sortSel.value);
      try { localStorage.setItem(SORT_KEY, sort); } catch { /* the choice just won't survive a restart */ }
      render();
    } }, ...SORT_KEYS.map((k) => h('option', { value: k }, SORT_LABELS[k])));
  sortSel.value = sort;
  const findBtn = h('button', { class: 'btn find-toggle', type: 'button', 'aria-pressed': 'false', onclick: () => toggleFinding() },
    icon('book'), 'Search inside books');
  const cloudBtn = h('button', { class: 'btn find-toggle', type: 'button', 'aria-pressed': String(showCloud), hidden: true, onclick: () => void toggleCloud() },
    libIcon('cloud'), 'Show cloud books');
  const sortLabel = h('label', { class: 'sort' }, sortSel);
  const tools = h('div', { class: 'lib-tools', hidden: true },
    h('label', { class: 'search' }, libIcon('search'), search), findBtn, cloudBtn, sortLabel);
  const chips = h('div', { class: 'tag-chips', role: 'group', 'aria-label': 'Filter by category', hidden: true });
  const count = h('p', { class: 'lib-count', role: 'status', 'aria-live': 'polite', hidden: true });
  const results = h('div', { class: 'lib-results' });
  const main = h('main', { class: 'lib-main' }, tools, chips, count, results);
  const lib = h('div', { class: 'lib' },
    h('header', { class: 'lib-head' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('book')), h('h1', {}, 'simple-reader')),
      h('div', { class: 'lib-actions' }, installBtn, addFolderBtn, addBtn, iconButton('settings', 'Settings', settings.open)),
    ),
    main,
    h('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, 'Drop to add to your library'),
    input,
  );
  root.replaceChildren(lib, settings.el);
  if (window.SRIntent) {
    window.__srFolder = () => void addPickedFolder();
    void addPickedFolder(); // a folder picked while the system restarted the app
  }

  // --- drag & drop anywhere on the page ---
  let depth = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
  const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: string, fn: (e: DragEvent) => void) =>
    t.addEventListener(type, fn as EventListener, { signal: ac.signal });
  on(lib, 'dragenter', (e) => { if (hasFiles(e)) { depth++; lib.classList.add('dragging'); } });
  on(lib, 'dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; lib.classList.remove('dragging'); } });
  on(lib, 'dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  on(lib, 'drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    lib.classList.remove('dragging');
    void addFiles([...(e.dataTransfer?.files ?? [])]);
  });

  /** Adds items one by one behind the busy "Add books" button; a failing item is reported and the rest still go in. */
  async function addBooks(items: Item[], series?: string): Promise<number> {
    addBtn.disabled = true;
    let added = 0;
    try {
      for (const [i, item] of items.entries()) {
        addLabel.textContent = series ? `Adding ${i + 1} of ${items.length}...` : 'Adding...';
        try {
          await addBook(await item.load(), series ? { series } : {});
          added++;
        } catch {
          toast(`Couldn't add "${item.name}". The file may be damaged.`, 'error');
        }
      }
    } finally {
      addBtn.disabled = false;
      addLabel.textContent = 'Add books';
    }
    return added;
  }

  async function addFiles(files: File[]) {
    const ok = files.filter(isBook);
    if (files.length > ok.length) toast(ok.length ? `Skipped ${files.length - ok.length} unsupported file(s).` : 'Only EPUB, PDF, CBZ and CBR files are supported.', 'error');
    if (!ok.length) return;
    const added = await addBooks(ok.map(fileItem));
    if (added) toast(`Added ${added} book${added === 1 ? '' : 's'}`);
    await refresh();
  }

  /**
   * Android: the native folder picker leaves the books of the folder for the page to take, also when the system restarted
   * the app while the picker was open. They all go in as one series named after the folder.
   */
  async function addPickedFolder() {
    const { fetchFile } = await import('../native/incoming');
    const files = JSON.parse(window.SRIntent!.takeFolder()) as PickedFile[];
    const plan = planFolderImport(files.map((f) => f.path));
    if (!plan.books.length) return;
    const items = plan.books.map((b) => {
      const name = b.path.split('/').pop()!;
      return { name, load: () => fetchFile(window.SRIntent!, files[b.index]!.id, name, '') };
    });
    await addFolder(items, plan.folder);
  }

  function pickFolder() {
    if (window.SRIntent) return window.SRIntent.pickFolder();
    folderPicker?.remove();
    const picker = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true,
      onchange: () => {
        const files = [...(picker.files ?? [])];
        picker.remove();
        const plan = planFolderImport(files.map((f) => f.webkitRelativePath));
        if (!plan.books.length && !plan.volumes.length) {
          toast('No EPUB, PDF, CBZ, CBR or image files in that folder.', 'error');
          return;
        }
        openFolderDialog(files, plan);
      } });
    folderPicker = picker;
    lib.append(picker);
    picker.click();
  }

  /** Names the series after the folder and picks what to add; nothing is added until "Add" is pressed. */
  function openFolderDialog(files: File[], plan: FolderPlan) {
    const folder = plan.folder;
    const dlg = sheet('folder-sheet', `Add folder "${folder}"`);
    const nameInput = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', required: true });
    nameInput.value = folder;
    const summary = h('p', { class: 'folder-summary', role: 'status', 'aria-live': 'polite' });
    const addSubmit = h('button', { class: 'btn primary', type: 'submit' }, 'Add');
    const boxes = (['epub', 'pdf', 'cbz'] as BookFormat[]).map((format) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = plan.counts[format] > 0;
      box.disabled = plan.counts[format] === 0;
      box.addEventListener('change', update);
      return { format, box, label: h('label', { class: 'folder-format' }, box, `${FORMAT_NAMES[format]} (${plan.counts[format]})`) };
    });
    const images = h('input', { type: 'checkbox' });
    images.checked = plan.volumes.length > 0;
    images.disabled = plan.volumes.length === 0;
    images.addEventListener('change', update);
    const chosenFormats = () => new Set(boxes.filter((b) => b.box.checked).map((b) => b.format));

    function update() {
      const chosen = chosenFormats();
      const picked = chosen.size > 0 || images.checked;
      const n = chooseFormats(plan, chosen).length + (images.checked ? plan.volumes.length : 0);
      const series = seriesNameFor(nameInput.value, folder);
      addSubmit.disabled = !picked || !series;
      summary.textContent = !picked
        ? 'Choose at least one format'
        : !series ? 'Type a series name'
        : `${n} book${n === 1 ? '' : 's'} will be added to "${series}"`;
    }
    nameInput.addEventListener('input', update);

    const form = h('form', { class: 'folder-form', onsubmit: (e: Event) => {
      e.preventDefault();
      const series = seriesNameFor(nameInput.value, folder);
      if (addSubmit.disabled || !series) return;
      const items = [
        ...chooseFormats(plan, chosenFormats()).map((b) => fileItem(files[b.index]!)),
        ...(images.checked ? plan.volumes.map((v) => volumeItem(v, files)) : []),
      ];
      dlg.close();
      void addFolder(items, series);
    } },
      h('h2', {}, `Add folder "${folder}"`),
      h('label', { class: 'field' }, h('span', {}, 'Series name'), nameInput),
      h('fieldset', { class: 'formats' }, h('legend', {}, 'Contents'), ...boxes.map((b) => b.label),
        h('label', { class: 'folder-format' }, images, `Image folders (${volumes(plan.volumes.length)})`)),
      summary,
      h('div', { class: 'folder-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        addSubmit),
    );
    dlg.append(form);
    dlg.addEventListener('close', () => {
      dlg.remove();
      addFolderBtn.focus();
    });
    lib.append(dlg);
    update();
    dlg.showModal();
    nameInput.focus();
  }

  async function addFolder(items: Item[], series: string) {
    const added = await addBooks(items, series);
    const failed = items.length - added;
    const message = [added ? `Added ${added} book${added === 1 ? '' : 's'} to "${series}".` : '', failed ? `${failed} failed.` : '']
      .filter(Boolean).join(' ');
    if (message) toast(message, failed ? 'error' : 'info');
    await refresh();
  }

  async function refresh() {
    try {
      books = await listBooks();
      cloud = await cloudIds().catch(() => new Set<string>());
      const found = await Promise.all(books.map((b) => getProgress(b.id).catch(() => null)));
      progress.clear();
      found.forEach((p, i) => p && progress.set(books[i]!.id, p));
    } catch {
      books = [];
      toast("Couldn't read your library.", 'error');
    }
    loaded = true;
    render();
    if (showCloud && !cloudOnly.length) void loadCloud();
  }

  const clearFilters = () => {
    query = search.value = '';
    selected = [];
    stopScan();
    render();
  };

  /** Ends the running scan and drops what it found. */
  function stopScan() {
    scanId++;
    scan = null;
  }

  // Like the in-book search, a scan waits for a pause in typing.
  const scheduleScan = debounce(() => void runScan(), 400);

  /** Reads each EPUB and PDF in turn (the text is cached after the first time) and shows the matches of the query. */
  async function runScan() {
    const id = ++scanId;
    const q = query.trim();
    scan = null;
    if (!finding || fold(q).length < 2) return render();
    try {
      const { extractText } = await import('../library/book-text'); // pdf.js is big: only loaded for a search
      if (id !== scanId) return;
      const targets = books.filter((b) => b.format !== 'cbz'); // comics have no text
      for await (const step of scanBooks(targets, q, (b) => getBookText(b.id, (blob) => extractText(blob, b.format)))) {
        if (id !== scanId) return;
        scan = step;
        render();
      }
    } catch {
      if (id === scanId) toast("Couldn't search inside books.", 'error');
    }
  }

  /** Turns the cloud list on or off; on, it reads what the bucket has that this device lacks. */
  async function toggleCloud() {
    showCloud = !showCloud;
    cloudBtn.setAttribute('aria-pressed', String(showCloud));
    try { localStorage.setItem(SHOW_CLOUD_KEY, showCloud ? 'on' : 'off'); } catch { /* the choice just won't survive a restart */ }
    render();
    if (showCloud) await loadCloud();
  }

  async function loadCloud() {
    if (loadingCloud || !isConfigured(loadR2())) return;
    loadingCloud = true;
    try {
      const { listCloudBooks } = await import('../sync/r2');
      cloudOnly = await listCloudBooks(loadR2(), new Set(books.map((b) => b.id)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't read the cloud.", 'error');
    } finally {
      loadingCloud = false;
    }
    render();
  }

  /** Downloads a book that is only in the bucket, then opens it. */
  async function downloadAndOpen(b: BookMeta) {
    toast(`Downloading ${b.title}…`);
    try {
      const { downloadCloudBook } = await import('../sync/r2');
      await downloadCloudBook(loadR2(), storage, b);
    } catch (e) {
      return toast(e instanceof Error ? e.message : "Couldn't download that book.", 'error');
    }
    cloudOnly = cloudOnly.filter((c) => c.id !== b.id);
    onOpen(b.id);
  }

  function toggleFinding() {
    finding = !finding;
    findBtn.setAttribute('aria-pressed', String(finding));
    stopScan();
    if (finding) scheduleScan();
    render();
  }

  /** What the scan is doing, or what it found, for the status line. */
  function findStatus(): string {
    const q = query.trim();
    if (fold(q).length < 2) return 'Type at least 2 characters to search inside books.';
    if (!scan) return 'Searching…';
    if (scan.done < scan.total) return `Searching ${scan.done} of ${scan.total} books…`;
    const found = scan.hits.length
      ? `${scan.hits.length} ${scan.hits.length === 1 ? 'book matches' : 'books match'}`
      : `No book contains “${q}”`;
    const failed = scan.unreadable ? `${scan.unreadable} ${scan.unreadable === 1 ? 'book' : 'books'} could not be read` : '';
    return [found, failed].filter(Boolean).join('. ') + '.';
  }

  function hitList(hits: BookHit[]) {
    return h('ul', { class: 'book-hits' }, ...hits.map((hit) => h('li', {}, bookHitButton(hit))));
  }

  /** One book found by the scan: its cover, title, match count and the first excerpts. Opens the book at the query. */
  function bookHitButton(hit: BookHit) {
    const q = query.trim();
    const n = hit.capped ? `${hit.count}+` : String(hit.count);
    return h('button', { class: 'book-hit', type: 'button', onclick: () => { setPendingFind(hit.book.id, q); onOpen(hit.book.id); } },
      h('div', { class: 'cover book-hit-cover' }, coverOf(hit.book)),
      h('div', { class: 'book-hit-body' },
        h('p', { class: 'book-hit-title' }, hit.book.title),
        h('p', { class: 'book-hit-count' }, `${n} ${hit.count === 1 && !hit.capped ? 'match' : 'matches'}`),
        ...hit.excerpts.map((m) => {
          const { pre, match, post } = excerptParts(m);
          return h('p', { class: 'book-hit-excerpt' }, pre, h('mark', {}, match), post);
        })));
  }

  function render() {
    if (!loaded) return;
    const hunting = finding && fold(query).length >= 2;
    const counts = tagCounts(books);
    selected = liveSelection(selected, books); // a category nobody carries any more cannot stay selected
    const lastRead = new Map([...progress].filter(([, p]) => p.fraction > 0).map(([id, p]) => [id, p.updatedAt]));
    const bucketSet = isConfigured(loadR2());
    cloudBtn.hidden = !bucketSet;
    const here = new Set(books.map((b) => b.id));
    const shown = showCloud && bucketSet ? [...books, ...cloudOnly.filter((b) => !here.has(b.id))] : books;
    const view = libraryView(shown, { query, tags: selected, sort }, lastRead);
    // The open series is dropped when it no longer has a visible volume (removed, or filtered out): back to the library.
    const series = openSeries === null ? undefined : view.entries.find((e): e is SeriesEntry => e.kind === 'series' && e.name.toLowerCase() === openSeries);
    if (!series) openSeries = null;

    tools.hidden = count.hidden = view.state === 'empty-library';
    chips.hidden = finding || !counts.length;
    sortLabel.hidden = finding;
    chips.replaceChildren(...counts.map(({ tag, count: n }) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(selected.includes(tag)),
        onclick: () => { selected = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]; render(); } },
        ...(tag === FAVORITES ? [libIcon('star'), 'Favorites'] : [tag]), h('small', {}, String(n)))));
    count.textContent = finding ? findStatus() : countLabel(view.shown, view.total);

    if (view.state === 'empty-library') {
      results.replaceChildren(
        h('section', { class: 'empty' },
          h('div', { class: 'drop' },
            h('span', { class: 'drop-icon' }, icon('book')),
            h('h2', {}, 'Drop EPUB, PDF, CBZ or CBR files here'),
            h('p', {}, 'Your books stay on this device. Nothing is uploaded.'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, 'Choose files'),
            h('p', { class: 'hint' }, 'Already have a backup? ',
              h('button', { class: 'link', type: 'button', onclick: settings.open }, 'Restore it from Settings')),
          )),
      );
    } else if (hunting) {
      results.replaceChildren(...(scan && scan.done === scan.total ? [hitList(rankHits(scan.hits))] : []));
    } else if (view.state === 'no-results') {
      results.replaceChildren(
        h('section', { class: 'no-results' },
          h('h2', {}, 'No results'),
          h('p', {}, query.trim() ? `No book matches "${query.trim()}"${selected.length ? ' with those categories' : ''}.` : 'No book has all of those categories.'),
          h('button', { class: 'btn', type: 'button', onclick: clearFilters }, 'Clear search and filters')),
      );
    } else if (series) {
      results.replaceChildren(
        h('div', { class: 'series-head' },
          iconButton('back', 'Back to library', closeSeries, 'series-back'),
          h('h2', {}, series.name)),
        h('ul', { class: 'grid' }, ...series.books.map((b) => card(b))));
    } else {
      // "Continue reading" only on the plain library: no search text, no category and no open series.
      const recent = !query.trim() && !selected.length ? recentBooks(books.filter((b) => !isRead(progress.get(b.id))), new Map([...progress].map(([id, p]): [string, number] => [id, p.updatedAt]))) : [];
      results.replaceChildren(
        ...(recent.length ? [h('section', { class: 'shelf', 'aria-labelledby': 'shelf-title' },
          h('h2', { id: 'shelf-title' }, 'Continue reading'),
          h('ul', { class: 'shelf-row' }, ...recent.map((b) => card(b, true))))] : []),
        h('ul', { class: 'grid' }, ...view.entries.map((e) => (e.kind === 'book' ? card(e.book) : seriesCard(e)))));
    }
  }

  function showSeries(key: string) {
    openSeries = key;
    render();
    results.querySelector<HTMLElement>('.series-back')?.focus();
  }

  function closeSeries() {
    const key = openSeries;
    openSeries = null;
    render();
    results.querySelector<HTMLElement>(`[data-series="${CSS.escape(key ?? '')}"] .card-open`)?.focus();
  }

  const volumes = (n: number) => `${n} volume${n === 1 ? '' : 's'}`;

  function coverOf(b: BookMeta) {
    return b.cover
      ? h('img', { src: b.cover, alt: '', loading: 'lazy' })
      : h('div', { class: 'cover-ph', style: `--h:${titleHue(b.title)}` },
          h('span', {}, coverInitial(b.title)), h('small', {}, b.format.toUpperCase()));
  }

  /** A series folder in the library: its first volume's cover, the series name, and how many volumes it has. */
  function seriesCard(s: SeriesEntry) {
    const key = s.name.toLowerCase();
    const open = h('button', { class: 'card-open', type: 'button', 'aria-label': `Open series ${s.name}, ${volumes(s.books.length)}`, onclick: () => showSeries(key) },
      h('div', { class: 'cover' }, coverOf(s.books[0]!)),
      h('p', { class: 'card-title' }, s.name),
      h('p', { class: 'card-author' }, volumes(s.books.length)));
    return h('li', { class: 'card series', 'data-series': key }, open);
  }

  /** The band along the bottom of a cover: an icon and the word for where the book came from. */
  function originStrip(origin: 'local' | 'cloud' | 'cloud-only') {
    const [icon, word] = origin === 'local' ? (['device', 'This device'] as const) : origin === 'cloud' ? (['cloud', 'Cloud'] as const) : (['download', 'Cloud only'] as const);
    return h('div', { class: 'card-origin', 'data-origin': origin }, libIcon(icon), word);
  }

  /** A book in the grid, or (`shelf`) a lighter card on the "Continue reading" row, which has no edit buttons. */
  function card(b: BookMeta, shelf = false) {
    const away = !books.some((x) => x.id === b.id); // only in the bucket: nothing on this device to edit yet
    if (away) return cloudOnlyCard(b);
    const p = progress.get(b.id);
    // The shelf repeats books of the grid: its name differs so each button is still one unambiguous book.
    const label = p && p.fraction > 0 ? bookLabel(b.title, p.fraction) : `Open ${b.title}`;
    const open = h('button', { class: 'card-open', type: 'button', 'aria-label': shelf ? label.replace(/^Open/, 'Continue reading') : label, onclick: () => onOpen(b.id) });
    const fill = h('i', { style: `transform:scaleX(${p && p.fraction > 0 ? Math.min(1, p.fraction) : 0})` });
    const tags = cleanTags(b.tags).filter((t) => t !== FAVORITES); // the star already says it
    open.append(
      h('div', { class: 'cover' }, coverOf(b), originStrip(cloud.has(b.id) ? 'cloud' : 'local')),
      h('p', { class: 'card-title' }, b.title),
      h('p', { class: 'card-author' }, b.author ?? ' '),
      ...(tags.length ? [h('p', { class: 'card-tagline' }, tags.map((t) => `#${t}`).join(' '))] : []),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, fill),
    );
    if (shelf) return h('li', { class: 'shelf-card' }, open);

    const fav = isFavorite(b);
    const star = h('button', { class: 'icon-btn card-fav', type: 'button', 'aria-pressed': String(fav),
      'aria-label': `${fav ? 'Remove' : 'Add'} ${b.title} ${fav ? 'from' : 'to'} favorites`, title: fav ? 'Remove from favorites' : 'Add to favorites',
      onclick: () => void setFavorite(b) }, libIcon('star'));
    const done = isRead(p);
    const readBtn = h('button', { class: 'icon-btn card-read', type: 'button', 'aria-pressed': String(done),
      'aria-label': `Mark ${b.title} as ${done ? 'unread' : 'read'}`, title: done ? 'Mark as unread' : 'Mark as read',
      onclick: () => void setRead(b) }, libIcon('check'));
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const li = h('li', { class: 'card', 'data-book': b.id }, open);
    const toggle = (on: boolean) => {
      li.classList.toggle('confirming', on);
      (on ? cancel : li.querySelector<HTMLElement>('.card-remove'))?.focus();
    };
    cancel.onclick = () => toggle(false);
    li.append(
      star,
      readBtn,
      iconButton('trash', `Remove ${b.title}`, () => toggle(true), 'card-remove'),
      h('button', { class: 'icon-btn card-tags', type: 'button', 'aria-label': `Edit categories of ${b.title}`, title: 'Edit categories', onclick: () => editTags(b) }, libIcon('tag')),
      h('div', { class: 'confirm' },
        h('p', {}, 'Remove from your library?'),
        cancel,
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          try {
            await removeBook(b.id);
            toast('Book removed');
          } catch {
            toast("Couldn't remove the book.", 'error');
          }
          await refresh();
        } }, 'Remove')),
    );
    return li;
  }

  /** Stars or unstars a book. The refresh redraws the card, so focus goes back to its star. */
  async function setFavorite(b: BookMeta) {
    const r = toggleFavorite(b.tags);
    if (!r.ok) return toast(TAG_ERRORS[r.reason], 'error');
    try {
      await setTags(b.id, r.tags);
    } catch {
      return toast("Couldn't save the categories.", 'error');
    }
    await refresh();
    main.querySelector<HTMLElement>(`[data-book="${b.id}"] .card-fav`)?.focus();
  }

  /** A book that is only in the bucket: its cover and title, and one button that downloads it and opens it. */
  function cloudOnlyCard(b: BookMeta) {
    const open = h('button', { class: 'card-open', type: 'button', 'aria-label': `Download ${b.title}`, onclick: () => void downloadAndOpen(b) },
      h('div', { class: 'cover' }, coverOf(b), originStrip('cloud-only')),
      h('p', { class: 'card-title' }, b.title),
      h('p', { class: 'card-author' }, b.author ?? ' '));
    return h('li', { class: 'card', 'data-book': b.id }, open);
  }

  /** Marks a book read, or puts it back to unread. The refresh redraws the card, so focus goes back to its button. */
  async function setRead(b: BookMeta) {
    try {
      await saveProgress(withReadMark(progress.get(b.id) ?? null, b.id, !isRead(progress.get(b.id)), Date.now()));
    } catch {
      return toast("Couldn't save that.", 'error');
    }
    await refresh();
    main.querySelector<HTMLElement>(`[data-book="${b.id}"] .card-read`)?.focus();
  }

  /** A small dialog to add and remove one book's categories. Every change is saved at once; the library behind it refreshes. */
  function editTags(b: BookMeta) {
    let tags = cleanTags(b.tags);
    const list = h('ul', { class: 'tag-list' });
    const error = h('p', { class: 'tag-error', role: 'alert' });
    const field = h('input', { class: 'tag-input', type: 'text', 'aria-label': 'New category', placeholder: 'Add a category', autocomplete: 'off', list: 'tag-suggestions' });
    const dlg = sheet('tag-sheet', `Categories of ${b.title}`);

    async function save(next: string[]) {
      try {
        tags = cleanTags((await setTags(b.id, next)).tags);
        error.textContent = '';
      } catch {
        error.textContent = "Couldn't save the categories.";
        return;
      }
      draw();
      await refresh();
    }
    function draw() {
      list.replaceChildren(...(tags.length
        ? tags.map((t) => h('li', {}, h('span', { class: 'chip static' }, t,
            h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove category ${t}`, onclick: () => void save(removeTag(tags, t)) }, '×'))))
        : [h('li', { class: 'tag-none' }, 'No categories yet.')]));
    }
    async function add() {
      // "a, b" adds both; if any one is refused nothing is saved, so the user fixes the text once.
      const parts = field.value.split(',').filter((s, _, all) => s.trim() || all.every((x) => !x.trim()));
      let next = tags;
      for (const part of parts) {
        const r = addTag(next, part);
        if (!r.ok) { error.textContent = TAG_ERRORS[r.reason]; field.focus(); return; }
        next = r.tags;
      }
      field.value = '';
      await save(next);
      field.focus();
    }
    draw();
    dlg.append(
      h('form', { class: 'tag-form', onsubmit: (e: Event) => { e.preventDefault(); void add(); } },
        h('h2', {}, 'Categories'),
        h('p', { class: 'tag-book' }, b.title),
        list,
        h('div', { class: 'tag-add' }, field, h('button', { class: 'btn primary', type: 'submit' }, 'Add')),
        error,
        h('datalist', { id: 'tag-suggestions' }, ...tagCounts(books).map(({ tag }) => h('option', { value: tag }))),
        h('div', { class: 'tag-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Done'))),
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      main.querySelector<HTMLElement>(`[data-book="${b.id}"] .card-tags`)?.focus();
    });
    lib.append(dlg);
    dlg.showModal();
    field.focus();
  }

  void refresh();
  return () => {
    ac.abort();
    finding = false; // a scan still waiting for its pause must not start once the library is gone
    stopScan();
    unsubInstall?.();
    settings.dispose();
    root.replaceChildren();
  };
}
