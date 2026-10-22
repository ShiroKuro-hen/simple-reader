import type { TextSelection } from '../types';
import { sentenceAround } from './sentence';

const BLOCK = 'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, td, div, body';

/**
 * Reads the live selection of `doc` as a TextSelection, or null if it is empty.
 * `block` is the element whose text gives the context (default: the nearest paragraph-like
 * ancestor); `joiner` goes between text nodes (PDF text layers need a space, EPUB inline tags must not get one); `offset` is where `doc`'s viewport sits in the host viewport (iframe origin).
 */
export function readSelection(doc: Document, block?: Element, offset = { x: 0, y: 0 }, joiner = ''): TextSelection | null {
  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const text = sel.toString().trim();
  if (!text) return null;

  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const container = block ?? el?.closest(BLOCK) ?? doc.body;
  const { text: blockText, start, end } = flatten(container, range, joiner);

  const r = range.getBoundingClientRect();
  return {
    text,
    context: start < 0 ? text : sentenceAround(blockText, start, end),
    rect: { x: r.x + offset.x, y: r.y + offset.y, width: r.width, height: r.height },
  };
}

/** Text of the block plus the selected range's character offsets in it (start is -1 if nothing inside is selected). */
function flatten(container: Element, range: Range, joiner: string) {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text = '';
  let start = -1;
  let end = -1;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (text) text += joiner;
    const base = text.length;
    text += n.data;
    if (!range.intersectsNode(n)) continue;
    const from = n === range.startContainer ? range.startOffset : 0;
    const to = n === range.endContainer ? range.endOffset : n.length;
    if (to <= from) continue;
    if (start < 0) start = base + from;
    end = base + to;
  }
  return { text, start, end };
}

/** Small multi-callback emitter that replays the last value to late subscribers. */
export function replayable<T>() {
  const subs: ((v: T) => void)[] = [];
  let last: T | undefined;
  return {
    emit(v: T) {
      last = v;
      subs.forEach((cb) => cb(v));
    },
    on(cb: (v: T) => void) {
      subs.push(cb);
      if (last !== undefined) queueMicrotask(() => cb(last!));
    },
    clear() {
      subs.length = 0;
    },
  };
}
