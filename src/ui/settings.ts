import type { FuriganaMode, PageLayout, R2Config, ReaderSettings, TextDirection, Theme } from '../types';
import { storage } from '../storage/index';
import { h, iconButton, icon, sheet, toast } from './dom';
import { MAX_FONT, MIN_FONT, stepFontSize } from './reading';

/** Shared app state: one settings object, changed only through `update`. */
export interface App {
  settings: ReaderSettings;
  update(patch: Partial<ReaderSettings>, remember?: boolean): void;
  subscribe(cb: (s: ReaderSettings) => void): () => void;
}

const R2_KEY = 'sr.r2';
const EMPTY_R2: R2Config = { accountId: '', bucket: '', accessKeyId: '', secretAccessKey: '' };

// Credentials live only in localStorage; they are never logged or put in error text.
function loadR2(): R2Config {
  try {
    return { ...EMPTY_R2, ...JSON.parse(localStorage.getItem(R2_KEY) ?? '{}') };
  } catch {
    return { ...EMPTY_R2 };
  }
}
function saveR2(c: R2Config) {
  try {
    localStorage.setItem(R2_KEY, JSON.stringify(c));
  } catch {
    /* private mode: the user just retypes it next time */
  }
}

const THEMES: [Theme, string][] = [['light', 'Light'], ['dark', 'Dark'], ['sepia', 'Sepia']];
const LAYOUTS: [PageLayout, string][] = [['auto', 'Auto'], ['single', 'One page']];
const MODES: [FuriganaMode, string][] = [['off', 'Off'], ['furigana', 'Furigana'], ['romaji', 'Romaji']];

const WRITINGS: [TextDirection, string][] = [['book', 'As in the book'], ['horizontal', 'Horizontal (left to right)']];

export function createSettings(app: App, opts: { onRestored?: () => void; comic?: boolean; epub?: boolean } = {}) {
  const dlg = sheet('sheet-settings', 'Settings');

  // --- appearance ---
  const themeBtns = THEMES.map(([t, name]) =>
    h('button', { class: `swatch sw-${t}`, type: 'button', 'aria-label': `${name} theme`, onclick: () => app.update({ theme: t }) },
      h('span', { class: 'aa' }, 'Aa'), h('small', {}, name)),
  );

  const sizeLabel = h('output', { class: 'size-val', 'aria-live': 'polite' });
  const step = (d: 1 | -1) => () => app.update({ fontSize: stepFontSize(app.settings.fontSize, d) });
  const smaller = h('button', { class: 'btn', type: 'button', 'aria-label': 'Smaller text', onclick: step(-1) }, h('span', { class: 'a-sm' }, 'A'));
  const larger = h('button', { class: 'btn', type: 'button', 'aria-label': 'Larger text', onclick: step(1) }, h('span', { class: 'a-lg' }, 'A'));

  const layoutBtns = LAYOUTS.map(([l, name]) =>
    h('button', { type: 'button', onclick: () => app.update({ layout: l }) }, name),
  );
  const modeBtns = MODES.map(([m, name]) =>
    h('button', { type: 'button', onclick: () => app.update({ furigana: m }) }, name),
  );
  const rtlBox = h('input', { type: 'checkbox', onchange: (e: Event) => app.update({ rtl: (e.target as HTMLInputElement).checked }) });
  const writingBtns = WRITINGS.map(([w, name]) =>
    h('button', { type: 'button', onclick: () => app.update({ writing: w }) }, name),
  );

  // --- backup ---
  const cfg = loadR2();
  const field = (key: keyof R2Config, label: string, type = 'text') =>
    h('label', { class: 'field' }, h('span', {}, label),
      h('input', {
        type, value: cfg[key], autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
        oninput: (e: Event) => { cfg[key] = (e.target as HTMLInputElement).value.trim(); saveR2(cfg); },
      }));
  const status = h('p', { class: 'status', role: 'status' });
  const corsPre = h('pre', {});
  const hint = h('details', { class: 'cors', hidden: true },
    h('summary', {}, 'Having trouble? CORS setup'),
    corsPre,
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(corsPre.textContent ?? ''); toast('Copied'); } catch { toast("Couldn't copy - select the text instead", 'error'); }
    } }, icon('copy'), 'Copy'));
  const pushBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => run('push') }, 'Back up now');
  const pullBtn = h('button', { class: 'btn', type: 'button', onclick: () => run('pull') }, 'Restore');
  const importBtn = h('button', { class: 'btn', type: 'button', onclick: () => run('import') }, 'Import folders');
  const busyBtns = [pushBtn, pullBtn, importBtn];

  function say(text: string, isError = false) {
    status.textContent = text;
    status.classList.toggle('err', isError);
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function run(kind: 'push' | 'pull' | 'import') {
    if (Object.values(cfg).some((v) => !v)) return say('Fill in all four fields first.', true);
    busyBtns.forEach((b) => (b.disabled = true));
    say(kind === 'push' ? 'Backing up...' : kind === 'pull' ? 'Restoring...' : 'Importing...');
    try {
      const r2 = await import('../sync/r2');
      if (kind === 'push') {
        const { uploaded } = await r2.pushToR2(cfg, storage);
        say(uploaded ? `Backed up ${plural(uploaded, 'file')}.` : 'Everything is already backed up.');
      } else if (kind === 'pull') {
        const { downloaded } = await r2.pullFromR2(cfg, storage);
        say(downloaded ? `Restored ${plural(downloaded, 'file')}.` : 'Nothing new to restore.');
        if (downloaded) opts.onRestored?.();
      } else {
        const { addBook } = await import('../storage/library');
        const { books, series, failed } = await r2.importSeriesFolders(
          cfg,
          (file, name) => addBook(file, { series: name }),
          (done, total) => say(`Importing ${done} / ${total}...`),
        );
        if (books + failed.length === 0) say('Nothing to import.');
        else {
          const text = `Imported ${plural(books, 'book')} in ${plural(series, 'series')}.`;
          say(failed.length ? `${text} ${failed.length} failed, first: ${failed[0]}.` : text, failed.length > 0);
        }
        if (books) opts.onRestored?.();
      }
      hint.hidden = true;
    } catch (e) {
      const label = kind === 'push' ? 'Backup' : kind === 'pull' ? 'Restore' : 'Import';
      say(`${label} failed: ${e instanceof Error ? e.message : 'unknown error'}`, true);
      corsPre.textContent = (await import('../sync/r2')).describeCors();
      hint.hidden = false;
      hint.open = true;
    } finally {
      busyBtns.forEach((b) => (b.disabled = false));
    }
  }

  dlg.append(
    h('div', { class: 'set' },
      h('div', { class: 'set-head' }, h('h2', {}, 'Settings'), iconButton('close', 'Close settings', () => dlg.close())),
      h('section', {}, h('h3', {}, 'Theme'), h('div', { class: 'swatches' }, ...themeBtns)),
      h('section', {}, h('h3', {}, 'Text size'), h('div', { class: 'size-row' }, smaller, sizeLabel, larger)),
      h('section', {}, h('h3', {}, 'Page layout'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Page layout' }, ...layoutBtns),
        h('p', { class: 'note' }, 'Auto shows two pages side by side on a wide window. PDFs always show one page.')),
      h('section', { hidden: !opts.comic }, h('h3', {}, 'Comics'),
        h('label', {}, rtlBox, ' Right to left')),
      h('section', { hidden: !opts.epub }, h('h3', {}, 'Text direction'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Text direction' }, ...writingBtns),
        h('p', { class: 'note' }, 'Vertical books keep their direction unless you choose horizontal.')),
      h('section', {}, h('h3', {}, 'Japanese reading'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Japanese reading' }, ...modeBtns)),
      h('section', {},
        h('h3', {}, 'Backup (Cloudflare R2)'),
        h('p', { class: 'note' }, 'Copies your library, progress and settings to your own bucket. Keys stay in this browser.'),
        h('div', { class: 'fields' },
          field('accountId', 'Account ID'), field('bucket', 'Bucket'),
          field('accessKeyId', 'Access key ID'), field('secretAccessKey', 'Secret access key', 'password')),
        h('div', { class: 'row' }, pushBtn, pullBtn, importBtn),
        h('p', { class: 'note' }, 'Reads folders in your bucket, e.g. Series name/Vol 1.epub, and adds them as a series.'),
        status, hint),
    ),
  );

  function sync(s: ReaderSettings) {
    THEMES.forEach(([t], i) => themeBtns[i]!.setAttribute('aria-pressed', String(s.theme === t)));
    LAYOUTS.forEach(([l], i) => layoutBtns[i]!.setAttribute('aria-pressed', String(s.layout === l)));
    MODES.forEach(([m], i) => modeBtns[i]!.setAttribute('aria-pressed', String(s.furigana === m)));
    rtlBox.checked = s.rtl;
    WRITINGS.forEach(([w], i) => writingBtns[i]!.setAttribute('aria-pressed', String(s.writing === w)));
    sizeLabel.textContent = `${s.fontSize}%`;
    smaller.disabled = s.fontSize <= MIN_FONT;
    larger.disabled = s.fontSize >= MAX_FONT;
  }
  sync(app.settings);
  const unsub = app.subscribe(sync);

  return {
    el: dlg,
    open: () => dlg.showModal(),
    dispose() {
      unsub();
      dlg.remove();
    },
  };
}
