// Page-side helpers for run.mjs. Exposes the real modules on window.sr; the assertions live in run.mjs.
import * as annotations from '../../annotations/model';
import { openBook } from '../index';
import { storageContract } from '../../storage/contract';
import { createLibrary } from '../../storage/library';
import { opfsStorage } from '../../storage/opfs';
import type { BookFormat, ReaderHandle, ReaderSettings, TextSelection } from '../../types';

const LIGHT: ReaderSettings = { theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto' };

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

async function openFixture(name: string, o: { settings?: ReaderSettings; location?: string } = {}): Promise<Session> {
  const host = document.getElementById('host')!;
  const file = await fixture(name);
  const docs: Document[] = [];
  const handle = await openBook(file, name.endsWith('.pdf') ? 'pdf' : ('epub' as BookFormat), host, {
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

(window as any).sr = {
  annotations,
  storageContract,
  opfsStorage,
  createLibrary,
  openFixture,
  rectOf,
  waitFor,
  fixture,
  async runContractCase(name: string, ns: string) {
    await storageContract[name]!(opfsStorage(), ns);
  },
  contractNames: Object.keys(storageContract),
};
(window as any).srReady = true;
