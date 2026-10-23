// A click or tap on a Japanese word in an EPUB section selects the whole word. The selection then goes through the
// usual selectionchange path, which opens the lookup; nothing here calls the lookup itself.
import { HAS_KANA, HAS_KANJI } from '../lookup/script';
import type { WordToken } from '../lookup/word-at';
import { toDomRange, wordAt } from '../lookup/word-at';
import { BLOCK, baseTextWalker } from './selection';

const isJapanese = (c: string) => HAS_KANJI.test(c) || HAS_KANA.test(c);

/** The caret the browser puts under a point: a text node and an offset in it (between two characters). */
function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The base-text character under (x, y) in the section document, or null when the point is not on Japanese base text. */
function japaneseAt(doc: Document, x: number, y: number): { node: Text; index: number } | null {
  const caret = caretAt(doc, x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const text = caret.node as Text;

  const reading = text.parentElement?.closest('rt, rp');
  if (reading) {
    // A reading stands for its base: the first character of the <ruby>'s base text.
    const ruby = reading.closest('ruby');
    const first = ruby ? (baseTextWalker(ruby).nextNode() as Text | null) : null;
    return first && isJapanese(first.data[0] ?? '') ? { node: first, index: 0 } : null;
  }

  // The caret sits between two characters, and at a text node's edge one of them is in the neighbouring node (a kanji
  // inside <ruby> next to the 。 after it): the browser then reports the NEXT node, so look at both sides. Of the two,
  // only a Japanese character can be a word, and it counts only when the point is on its box (a tap beside it is a tap on the page).
  let best: { node: Text; index: number } | null = null;
  let bestDistance = Infinity;
  for (const c of charsAround(text, caret.offset)) {
    if (!isJapanese(c.node.data[c.index]!)) continue;
    const r = doc.createRange();
    r.setStart(c.node, c.index);
    r.setEnd(c.node, c.index + 1);
    const q = r.getBoundingClientRect();
    const d = Math.hypot(Math.max(q.left - x, 0, x - q.right), Math.max(q.top - y, 0, y - q.bottom));
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return bestDistance === 0 ? best : null;
}

/** The characters on each side of a caret, crossing into the neighbouring base-text node at a node's edge. */
function charsAround(text: Text, offset: number): { node: Text; index: number }[] {
  const walker = baseTextWalker(text.ownerDocument.body);
  walker.currentNode = text;
  const out: { node: Text; index: number }[] = [];
  const before = offset > 0 ? text : (walker.previousNode() as Text | null);
  if (before?.length) out.push({ node: before, index: offset > 0 ? offset - 1 : before.length - 1 });
  walker.currentNode = text;
  const after = offset < text.length ? text : (walker.nextNode() as Text | null);
  if (after?.length) out.push({ node: after, index: offset < text.length ? offset : 0 });
  return out;
}

/**
 * Selects the word under (x, y), using the block's base text (readings left out). The page can be rewritten while the
 * tokenizer works (furigana replaces text nodes), so a vanished node means: look again at the same point, once.
 */
async function selectWordAt(doc: Document, x: number, y: number, retries = 1): Promise<void> {
  const hit = japaneseAt(doc, x, y);
  if (!hit) return;
  const block = hit.node.parentElement?.closest(BLOCK) ?? doc.body;
  const parts: Text[] = [];
  let offset = -1;
  let length = 0;
  const walker = baseTextWalker(block);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n === hit.node) offset = length + hit.index;
    parts.push(n);
    length += n.length;
  }
  if (offset < 0) return;
  try {
    // Imported here, not at the top: a book with no Japanese never loads the tokenizer or its dictionary.
    const { tokenize } = await import('../lookup/ja');
    const tokens = (await tokenize(parts.map((p) => p.data).join(''))) as WordToken[];
    if (!hit.node.isConnected) return retries > 0 ? selectWordAt(doc, x, y, retries - 1) : undefined;
    const word = wordAt(tokens, offset);
    const texts = parts.map((p) => p.data);
    const range = word && toDomRange(texts, word.start, word.end);
    const sel = doc.getSelection();
    // The user may have moved on while the tokenizer worked.
    if (!range || !sel?.isCollapsed || !hit.node.isConnected) return;
    sel.setBaseAndExtent(parts[range.startPart]!, range.startOffset, parts[range.endPart]!, range.endOffset);
  } catch {
    // Tokenizer not ready or failed: the reader still works by dragging.
  }
}

/**
 * Click-to-select for Japanese. Runs in the capture phase so it sees the click before the reader's own handlers.
 * `onAnnotation` says whether a point is on a highlight: those keep their own click (the colour menu).
 */
export function installWordSelect(doc: Document, onAnnotation: (e: MouseEvent) => boolean): void {
  // Warm the tokenizer once a section really holds Japanese, so the first click does not wait for its dictionary to download.
  // Delayed a little so it never competes with the first render; English-only books never get here.
  const text = doc.body?.textContent ?? '';
  if (HAS_KANJI.test(text) || HAS_KANA.test(text))
    setTimeout(() => void import('../lookup/ja').then((m) => m.preloadJapanese()).catch(() => {}), 1500);
  doc.addEventListener(
    'click',
    (e) => {
      if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if ((e.target as Element).closest?.('a, button, input') || onAnnotation(e)) return;
      if (!doc.getSelection()?.isCollapsed) return;
      const hit = japaneseAt(doc, e.clientX, e.clientY);
      if (!hit) return;
      // A tap on text is a text tap, not a tap on the empty page: the reader must not toggle its toolbars for it.
      if ((e as PointerEvent).pointerType !== 'mouse') e.stopPropagation();
      void selectWordAt(doc, e.clientX, e.clientY);
    },
    true,
  );
}
