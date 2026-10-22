// Adds <ruby> to the kanji of an EPUB section document, and takes it away again.
import type { FuriganaMode } from '../types';
import { tokenize } from './ja';
import { rubyHtml } from './ruby';
import { HAS_KANJI } from './script';

const MARK = 'data-sr-furi';
const ORIGINAL = 'data-sr-orig';
const SKIP = `script,style,noscript,textarea,ruby,rt,rp`;
const SLICE_MS = 12;

const runs = new WeakMap<Document, number>();
const nextFrame = () => new Promise<void>((r) => setTimeout(r));

/**
 * 'furigana' / 'romaji' wrap each text node that holds kanji in <span data-sr-furi>, keeping the original
 * string in data-sr-orig; 'off' puts the original text nodes back. Only text nodes are replaced, so links
 * and markup survive. Safe to call repeatedly; a newer call cancels an older one still working.
 */
export async function applyFurigana(doc: Document, mode: FuriganaMode): Promise<void> {
  const run = (runs.get(doc) ?? 0) + 1;
  runs.set(doc, run);
  const body = doc.body;
  if (!body) return;

  for (const span of body.querySelectorAll(`span[${MARK}]`)) {
    if (mode === 'off' || span.getAttribute(MARK) !== mode) span.replaceWith(doc.createTextNode(span.getAttribute(ORIGINAL) ?? ''));
  }
  if (mode === 'off') return;

  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (HAS_KANJI.test(n.nodeValue ?? '') && !n.parentElement?.closest(SKIP)) nodes.push(n as Text);
  }

  let sliceStart = performance.now();
  for (const node of nodes) {
    if (runs.get(doc) !== run) return; // superseded
    if (!node.isConnected) continue;
    const html = rubyHtml(await tokenize(node.data), mode);
    if (runs.get(doc) !== run || !node.isConnected) return;
    if (!html.includes('<ruby>')) continue;
    const span = doc.createElement('span');
    span.setAttribute(MARK, mode);
    span.setAttribute(ORIGINAL, node.data);
    span.innerHTML = html;
    node.replaceWith(span);
    if (performance.now() - sliceStart > SLICE_MS) {
      await nextFrame();
      sliceStart = performance.now();
    }
  }
}
