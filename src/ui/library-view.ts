import type { BookMeta } from '../types';
import { addBook, getProgress, listBooks, removeBook } from '../storage/library';
import { coverInitial, titleHue } from './cover';
import { h, icon, iconButton, toast } from './dom';
import { bookLabel } from './reading';
import { createSettings, type App } from './settings';

const isBook = (f: File) => /\.(epub|pdf)$/i.test(f.name) || /^application\/(epub\+zip|pdf)$/.test(f.type);

export function mountLibrary(root: HTMLElement, app: App, onOpen: (id: string) => void): () => void {
  const ac = new AbortController();
  const settings = createSettings(app, { onRestored: () => void refresh() });
  let books: BookMeta[] = [];
  let loaded = false;

  const input = h('input', {
    type: 'file', accept: '.epub,.pdf,application/epub+zip,application/pdf', multiple: true, hidden: true,
    onchange: () => {
      void addFiles([...(input.files ?? [])]);
      input.value = ''; // lets the same file be picked again
    },
  });
  const addLabel = h('span', {}, 'Add books');
  const addBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, icon('plus'), addLabel);
  const main = h('main', { class: 'lib-main' });
  const lib = h('div', { class: 'lib' },
    h('header', { class: 'lib-head' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('book')), h('h1', {}, 'simple-reader')),
      h('div', { class: 'lib-actions' }, addBtn, iconButton('settings', 'Settings', settings.open)),
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
      books = (await listBooks()).sort((a, b) => b.addedAt - a.addedAt);
    } catch {
      books = [];
      toast("Couldn't read your library.", 'error');
    }
    loaded = true;
    render();
  }

  function render() {
    if (!loaded) return;
    if (!books.length) {
      main.replaceChildren(
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
      return;
    }
    main.replaceChildren(h('ul', { class: 'grid' }, ...books.map(card)));
  }

  function card(b: BookMeta) {
    const open = h('button', { class: 'card-open', type: 'button', 'aria-label': `Open ${b.title}`, onclick: () => onOpen(b.id) });
    const fill = h('i', { style: 'transform:scaleX(0)' });
    const cover = b.cover
      ? h('img', { src: b.cover, alt: '', loading: 'lazy' })
      : h('div', { class: 'cover-ph', style: `--h:${titleHue(b.title)}` },
          h('span', {}, coverInitial(b.title)), h('small', {}, b.format.toUpperCase()));
    open.append(
      h('div', { class: 'cover' }, cover),
      h('p', { class: 'card-title' }, b.title),
      h('p', { class: 'card-author' }, b.author ?? ' '),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, fill),
    );
    getProgress(b.id).then((p) => {
      if (!p || p.fraction <= 0) return;
      fill.style.transform = `scaleX(${Math.min(1, p.fraction)})`;
      open.setAttribute('aria-label', bookLabel(b.title, p.fraction));
    }).catch(() => {});

    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const li = h('li', { class: 'card' }, open);
    const toggle = (on: boolean) => {
      li.classList.toggle('confirming', on);
      (on ? cancel : li.querySelector<HTMLElement>('.card-remove'))?.focus();
    };
    cancel.onclick = () => toggle(false);
    li.append(
      iconButton('trash', `Remove ${b.title}`, () => toggle(true), 'card-remove'),
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

  void refresh();
  return () => {
    ac.abort();
    settings.dispose();
    root.replaceChildren();
  };
}
