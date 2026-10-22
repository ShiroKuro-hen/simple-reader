import type { BookMeta, Progress } from '../types';
import { parseSortKey, SORT_KEYS, type SortKey } from '../library/sort';
import { addTag, cleanTags, MAX_TAG_LENGTH, MAX_TAGS, removeTag, tagCounts, type AddResult } from '../library/tags';
import { countLabel, libraryView } from '../library/view';
import type { InstallPrompt } from '../pwa/install';
import { addBook, getProgress, listBooks, removeBook, setTags } from '../storage/library';
import { coverInitial, titleHue } from './cover';
import { h, icon, iconButton, sheet, toast } from './dom';
import { libIcon } from './library-icons';
import { bookLabel } from './reading';
import { createSettings, type App } from './settings';

const isBook = (f: File) => /\.(epub|pdf)$/i.test(f.name) || /^application\/(epub\+zip|pdf)$/.test(f.type);

const SORT_KEY = 'sr.sort';
const SORT_LABELS: Record<SortKey, string> = { added: 'Recently added', title: 'Title', author: 'Author', read: 'Recently read' };
const TAG_ERRORS: Record<Extract<AddResult, { ok: false }>['reason'], string> = {
  empty: 'Type a tag first.',
  'too-long': `Tags can be up to ${MAX_TAG_LENGTH} characters.`,
  invalid: 'That tag has characters that are not allowed.',
  duplicate: 'That tag is already on this book.',
  'too-many': `A book can have up to ${MAX_TAGS} tags.`,
};

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
  let loaded = false;
  let query = '';
  let selected: string[] = [];
  let sort = storedSort();

  const input = h('input', {
    type: 'file', accept: '.epub,.pdf,application/epub+zip,application/pdf', multiple: true, hidden: true,
    onchange: () => {
      void addFiles([...(input.files ?? [])]);
      input.value = ''; // lets the same file be picked again
    },
  });
  const addLabel = h('span', {}, 'Add books');
  const addBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, icon('plus'), addLabel);
  const installBtn = h('button', { class: 'btn install-btn', type: 'button', hidden: true,
    onclick: () => void install?.prompt() }, libIcon('download'), h('span', { class: 'btn-label' }, 'Install app'));
  const syncInstall = () => { installBtn.hidden = !install?.available(); };
  syncInstall();
  const unsubInstall = install?.subscribe(syncInstall);

  // Search, sort, tag chips and the count are created once so typing never loses focus; render() only refills them.
  const search = h('input', { class: 'search-input', type: 'search', placeholder: 'Search title, author or tag', 'aria-label': 'Search your library',
    autocomplete: 'off', spellcheck: 'false',
    oninput: () => { query = search.value; render(); } });
  const sortSel = h('select', { class: 'sort-select', 'aria-label': 'Sort by',
    onchange: () => {
      sort = parseSortKey(sortSel.value);
      try { localStorage.setItem(SORT_KEY, sort); } catch { /* the choice just won't survive a restart */ }
      render();
    } }, ...SORT_KEYS.map((k) => h('option', { value: k }, SORT_LABELS[k])));
  sortSel.value = sort;
  const tools = h('div', { class: 'lib-tools', hidden: true },
    h('label', { class: 'search' }, libIcon('search'), search), h('label', { class: 'sort' }, sortSel));
  const chips = h('div', { class: 'tag-chips', role: 'group', 'aria-label': 'Filter by tag', hidden: true });
  const count = h('p', { class: 'lib-count', role: 'status', 'aria-live': 'polite', hidden: true });
  const results = h('div', { class: 'lib-results' });
  const main = h('main', { class: 'lib-main' }, tools, chips, count, results);
  const lib = h('div', { class: 'lib' },
    h('header', { class: 'lib-head' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('book')), h('h1', {}, 'simple-reader')),
      h('div', { class: 'lib-actions' }, installBtn, addBtn, iconButton('settings', 'Settings', settings.open)),
    ),
    main,
    h('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, 'Drop to add to your library'),
    input,
  );
  root.replaceChildren(lib, settings.el);

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

  async function addFiles(files: File[]) {
    const ok = files.filter(isBook);
    if (files.length > ok.length) toast(ok.length ? `Skipped ${files.length - ok.length} unsupported file(s).` : 'Only EPUB and PDF files are supported.', 'error');
    if (!ok.length) return;
    addBtn.disabled = true;
    addLabel.textContent = 'Adding...';
    let added = 0;
    for (const f of ok) {
      try {
        await addBook(f);
        added++;
      } catch {
        toast(`Couldn't add "${f.name}". The file may be damaged.`, 'error');
      }
    }
    addBtn.disabled = false;
    addLabel.textContent = 'Add books';
    if (added) toast(`Added ${added} book${added === 1 ? '' : 's'}`);
    await refresh();
  }

  async function refresh() {
    try {
      books = await listBooks();
      const found = await Promise.all(books.map((b) => getProgress(b.id).catch(() => null)));
      progress.clear();
      found.forEach((p, i) => p && progress.set(books[i]!.id, p));
    } catch {
      books = [];
      toast("Couldn't read your library.", 'error');
    }
    loaded = true;
    render();
  }

  const clearFilters = () => {
    query = search.value = '';
    selected = [];
    render();
  };

  function render() {
    if (!loaded) return;
    const counts = tagCounts(books);
    selected = selected.filter((t) => counts.some((c) => c.tag === t)); // a tag nobody carries any more cannot stay selected
    const lastRead = new Map([...progress].filter(([, p]) => p.fraction > 0).map(([id, p]) => [id, p.updatedAt]));
    const view = libraryView(books, { query, tags: selected, sort }, lastRead);

    tools.hidden = count.hidden = view.state === 'empty-library';
    chips.hidden = !counts.length;
    chips.replaceChildren(...counts.map(({ tag, count: n }) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(selected.includes(tag)),
        onclick: () => { selected = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]; render(); } },
        tag, h('small', {}, String(n)))));
    count.textContent = countLabel(view.shown, view.total);

    if (view.state === 'empty-library') {
      results.replaceChildren(
        h('section', { class: 'empty' },
          h('div', { class: 'drop' },
            h('span', { class: 'drop-icon' }, icon('book')),
            h('h2', {}, 'Drop EPUB or PDF files here'),
            h('p', {}, 'Your books stay on this device. Nothing is uploaded.'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, 'Choose files'),
            h('p', { class: 'hint' }, 'Already have a backup? ',
              h('button', { class: 'link', type: 'button', onclick: settings.open }, 'Restore it from Settings')),
          )),
      );
    } else if (view.state === 'no-results') {
      results.replaceChildren(
        h('section', { class: 'no-results' },
          h('h2', {}, 'No results'),
          h('p', {}, query.trim() ? `No book matches "${query.trim()}"${selected.length ? ' with those tags' : ''}.` : 'No book has all of those tags.'),
          h('button', { class: 'btn', type: 'button', onclick: clearFilters }, 'Clear search and filters')),
      );
    } else {
      results.replaceChildren(h('ul', { class: 'grid' }, ...view.books.map(card)));
    }
  }

  function card(b: BookMeta) {
    const open = h('button', { class: 'card-open', type: 'button', 'aria-label': `Open ${b.title}`, onclick: () => onOpen(b.id) });
    const p = progress.get(b.id);
    const fill = h('i', { style: `transform:scaleX(${p && p.fraction > 0 ? Math.min(1, p.fraction) : 0})` });
    if (p && p.fraction > 0) open.setAttribute('aria-label', bookLabel(b.title, p.fraction));
    const cover = b.cover
      ? h('img', { src: b.cover, alt: '', loading: 'lazy' })
      : h('div', { class: 'cover-ph', style: `--h:${titleHue(b.title)}` },
          h('span', {}, coverInitial(b.title)), h('small', {}, b.format.toUpperCase()));
    const tags = cleanTags(b.tags);
    open.append(
      h('div', { class: 'cover' }, cover),
      h('p', { class: 'card-title' }, b.title),
      h('p', { class: 'card-author' }, b.author ?? ' '),
      ...(tags.length ? [h('p', { class: 'card-tagline' }, tags.map((t) => `#${t}`).join(' '))] : []),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, fill),
    );

    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const li = h('li', { class: 'card', 'data-book': b.id }, open);
    const toggle = (on: boolean) => {
      li.classList.toggle('confirming', on);
      (on ? cancel : li.querySelector<HTMLElement>('.card-remove'))?.focus();
    };
    cancel.onclick = () => toggle(false);
    li.append(
      iconButton('trash', `Remove ${b.title}`, () => toggle(true), 'card-remove'),
      h('button', { class: 'icon-btn card-tags', type: 'button', 'aria-label': `Edit tags of ${b.title}`, title: 'Edit tags', onclick: () => editTags(b) }, libIcon('tag')),
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

  /** A small dialog to add and remove one book's tags. Every change is saved at once; the library behind it refreshes. */
  function editTags(b: BookMeta) {
    let tags = cleanTags(b.tags);
    const list = h('ul', { class: 'tag-list' });
    const error = h('p', { class: 'tag-error', role: 'alert' });
    const field = h('input', { class: 'tag-input', type: 'text', 'aria-label': 'New tag', placeholder: 'Add a tag', autocomplete: 'off', list: 'tag-suggestions' });
    const dlg = sheet('tag-sheet', `Tags of ${b.title}`);

    async function save(next: string[]) {
      try {
        tags = cleanTags((await setTags(b.id, next)).tags);
        error.textContent = '';
      } catch {
        error.textContent = "Couldn't save the tags.";
        return;
      }
      draw();
      await refresh();
    }
    function draw() {
      list.replaceChildren(...(tags.length
        ? tags.map((t) => h('li', {}, h('span', { class: 'chip static' }, t,
            h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove tag ${t}`, onclick: () => void save(removeTag(tags, t)) }, '×'))))
        : [h('li', { class: 'tag-none' }, 'No tags yet.')]));
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
        h('h2', {}, 'Tags'),
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
    unsubInstall?.();
    settings.dispose();
    root.replaceChildren();
  };
}
