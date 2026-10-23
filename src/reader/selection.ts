import type { TextSelection } from '../types';
import { sentenceAround } from './sentence';

export const BLOCK = 'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, td, div, body';
/** Furigana readings: never part of a selection, its text or its context. */
const READING = 'rt, rp';

/**
 * Reads the live selection of `doc` as a TextSelection, or null if it is empty.
 * `block` is the element whose text gives the context (default: the nearest paragraph-like
 * ancestor); `joiner` goes between text nodes (PDF text layers need a space, EPUB inline tags must not get one); `offset` is where `doc`'s viewport sits in the host viewport (iframe origin).
 */
export function readSelection(doc: Document, block?: Element, offset = { x: 0, y: 0 }, joiner = ''): TextSelection | null {
  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const text = withoutReadings(range, sel.toString().trim());
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

/** The selected text with the readings taken out. toString() keeps them when the range covers <rt>. */
function withoutReadings(range: Range, raw: string): string {
  const root = range.commonAncestorContainer;
  const el = root instanceof Element ? root : root.parentElement;
  if (!el || ![...el.querySelectorAll(READING)].some((n) => range.intersectsNode(n))) return raw;
  const box = el.ownerDocument.createElement('div');
  box.append(range.cloneContents());
  box.querySelectorAll(READING).forEach((n) => n.remove());
  return box.textContent?.trim() || raw;
}

/** Walks the base text of `root`: a reading element is skipped together with its text. */
export function baseTextWalker(root: Element): TreeWalker {
  return root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.TEXT_NODE
        ? NodeFilter.FILTER_ACCEPT
        : (n as Element).matches(READING) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
}

/** Text of the block plus the selected range's character offsets in it (start is -1 if nothing inside is selected). */
function flatten(container: Element, range: Range, joiner: string) {
  const walker = baseTextWalker(container);
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
