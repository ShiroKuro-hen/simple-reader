// Page-side helpers for run.mjs. Exposes the real modules on window.sr; the assertions live in run.mjs.
import * as annotations from '../../annotations/model';
import { openBook } from '../index';
import { readSelection } from '../selection';
import * as mangaNav from '../manga-nav';
import { storageContract } from '../../storage/contract';
import { createLibrary } from '../../storage/library';
import { opfsStorage } from '../../storage/opfs';
import type { BookFormat, ReaderHandle, TextSelection, ViewSettings } from '../../types';
import { openComicArchive } from '../comic-archive';
import { storeRar5 } from '../fixtures/store-rar';

const LIGHT: ViewSettings = { theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, webtoon: false, writing: 'book' };

export interface Session {
  handle: ReaderHandle;
  docs: Document[];
  relocs: { location: string; fraction: number; label?: string }[];
  selects: TextSelection[];
}

const fixture = async (name: string) => new File([await (await fetch(`/src/reader/fixtures/${name}`)).blob()], name);
const waitFor = async (cond: () => boolean, what: string, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 30));
  }
};

type Opts = { settings?: ViewSettings; location?: string };

/** As the library does: the name picks the format, and .cbr is a comic whatever its container (zip or rar). */
const formatFor = (name: string): BookFormat => (name.endsWith('.pdf') ? 'pdf' : /\.cb[zr]$/.test(name) ? 'cbz' : 'epub');

async function openFile(file: File, format: BookFormat, o: Opts): Promise<Session> {
  const host = document.getElementById('host')!;
  const docs: Document[] = [];
  const handle = await openBook(file, format, host, {
    settings: o.settings ?? LIGHT,
    location: o.location,
    onDocLoad: (d) => docs.push(d),
  });
  const s: Session = { handle, docs, relocs: [], selects: [] };
  // Registered after open on purpose: the first relocation must be replayed.
  handle.onRelocate((p) => s.relocs.push(p));
  handle.onSelect((p) => s.selects.push(p));
  await waitFor(() => s.relocs.length > 0, 'first relocate');
  (window as any).session = s;
  return s;
}

async function openFixture(name: string, o: Opts = {}): Promise<Session> {
  return openFile(await fixture(name), formatFor(name), o);
}

/** A fixture's bytes under another file name, to check that the bytes (not the name) decide the container. */
async function openFixtureAs(name: string, asName: string, o: Opts = {}): Promise<Session> {
  return openFile(new File([await fixture(name)], asName), formatFor(asName), o);
}

/** The six manga pages, read out of manga.cbz, as a name -> bytes map in archive order. */
async function mangaPages(): Promise<Record<string, Uint8Array>> {
  const archive = await openComicArchive(await fixture('manga.cbz'));
  try {
    const files: Record<string, Uint8Array> = {};
    for (const n of archive.names) files[n] = new Uint8Array(await (await archive.read(n)).arrayBuffer());
    return files;
  } finally {
    await archive.close();
  }
}

/** Archives built in the page, so no RAR binary is committed for the tests. */
const RECIPES: Record<string, () => Promise<Uint8Array<ArrayBuffer>>> = {
  'manga-rar': async () => storeRar5(await mangaPages()),
  'rar-no-images': async () => storeRar5({ 'notes.txt': new TextEncoder().encode('no pages here') }),
  'rar-damaged': async () => {
    const bytes = storeRar5({ '1.png': new TextEncoder().encode('one') });
    bytes[13] = bytes[13]! ^ 0xff; // the main header's type byte: its CRC no longer matches
    return bytes;
  },
};

async function openBuilt(recipe: string, asName: string, o: Opts = {}): Promise<Session> {
  return openFile(new File([await RECIPES[recipe]!()], asName), formatFor(asName), o);
}

/** The file the runner put into #pick (Playwright setInputFiles), opened as a comic. */
async function openPicked(o: Opts = {}): Promise<Session> {
  return openFile((document.getElementById('pick') as HTMLInputElement).files![0]!, 'cbz', o);
}

/** Host-viewport rectangle of the first occurrence of `needle` in the visible EPUB section or PDF text layer. */
function rectOf(s: Session, needle: string) {
  const doc = s.docs.length ? s.docs[s.docs.length - 1]! : document;
  const root = s.docs.length ? doc.body : document.querySelector('.textLayer')!;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const i = n.data.indexOf(needle);
    if (i < 0) continue;
    const range = doc.createRange();
    range.setStart(n, i);
    range.setEnd(n, i + needle.length);
    const r = range.getBoundingClientRect();
    const f = doc.defaultView?.frameElement?.getBoundingClientRect();
    return { x: r.x + (f?.left ?? 0), y: r.y + (f?.top ?? 0), width: r.width, height: r.height };
  }
  return null;
}

/** The <g> of every annotation foliate currently draws, over all loaded sections. */
(window as any).gs = (): SVGGElement[] =>
  (document.querySelector('foliate-view') as any).renderer
    .getContents()
    .flatMap((c: any) => (c.overlayer ? [...c.overlayer.element.querySelectorAll('g')] : []));

/** Selects across a paragraph with furigana (the readings are real <rt> elements) and returns readSelection's answer. */
function selectAcrossRuby() {
  const p = document.createElement('p');
  p.innerHTML = '今日は<ruby>漢<rt>かん</rt></ruby>字を<ruby>読<rt>よ</rt></ruby>む。次の文です。';
  document.body.append(p);
  const range = document.createRange();
  range.setStart(p.childNodes[0]!, 1);
  range.setEnd(p.childNodes[4]!, 1);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const out = readSelection(document);
  sel.removeAllRanges();
  p.remove();
  return out;
}

(window as any).sr = {
  selectAcrossRuby,
  annotations,
  mangaNav,
  storageContract,
  opfsStorage,
  createLibrary,
  openFixture,
  openFixtureAs,
  openBuilt,
  openPicked,
  rectOf,
  waitFor,
  fixture,
  async runContractCase(name: string, ns: string) {
    await storageContract[name]!(opfsStorage(), ns);
  },
  contractNames: Object.keys(storageContract),
};
(window as any).srReady = true;
