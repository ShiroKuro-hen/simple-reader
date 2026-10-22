// Pure text rule behind TextSelection.context: which sentence surrounds a selection.
const MAX_CONTEXT = 400;
const END = /[.!?。！？]/;

/**
 * The sentence(s) around text[start, end), whitespace collapsed. Falls back to a window
 * around the selection when no punctuation is near.
 * ponytail: splits on . ! ? 。！？ so "Mr. Smith" cuts early; use Intl.Segmenter if that bites.
 */
export function sentenceAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !END.test(text[from - 1]!)) from--;
  let to = end;
  while (to < text.length && !END.test(text[to - 1] ?? '')) to++;
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const sentence = clean(text.slice(from, to));
  if (sentence.length <= MAX_CONTEXT) return sentence;
  const pad = Math.floor((MAX_CONTEXT - (end - start)) / 2);
  return clean(text.slice(Math.max(0, start - pad), end + pad)).slice(0, MAX_CONTEXT);
}
