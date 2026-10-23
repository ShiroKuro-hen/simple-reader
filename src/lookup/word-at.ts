// Pure offset maths for a Japanese click: which morphological token holds a character, and where that token sits in the DOM text.
export interface WordToken {
  surface_form: string;
  /** 1-based, as kuromoji reports it. */
  word_position: number;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface DomRange {
  startPart: number;
  startOffset: number;
  endPart: number;
  endOffset: number;
}

const NOT_A_WORD = /^[\p{P}\p{S}\s]+$/u;

/** [start, end) of the token holding `offset` (0-based), or null on punctuation, whitespace or outside the text. */
export function wordAt(tokens: readonly WordToken[], offset: number): TextRange | null {
  const token = tokens.find((t) => {
    const start = t.word_position - 1;
    return offset >= start && offset < start + t.surface_form.length;
  });
  if (!token || NOT_A_WORD.test(token.surface_form)) return null;
  const start = token.word_position - 1;
  return { start, end: start + token.surface_form.length };
}

/**
 * Maps [start, end) of the text joined from `parts` (consecutive base text nodes, no separator) back to DOM
 * positions. A start on a boundary goes to the start of the next part, an end on one to the end of the previous.
 */
export function toDomRange(parts: readonly string[], start: number, end: number): DomRange | null {
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (start < 0 || end > total || end <= start) return null;
  let from0: { part: number; offset: number } | undefined;
  let to0: { part: number; offset: number } | undefined;
  let base = 0;
  parts.forEach((p, part) => {
    const from = base;
    const to = base + p.length;
    base = to;
    if (!from0 && start >= from && start < to) from0 = { part, offset: start - from };
    if (!to0 && end > from && end <= to) to0 = { part, offset: end - from };
  });
  return from0 && to0 ? { startPart: from0.part, startOffset: from0.offset, endPart: to0.part, endOffset: to0.offset } : null;
}
