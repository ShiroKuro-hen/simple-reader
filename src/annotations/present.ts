import type { Annotation } from '../types';
import { previewText } from './model';

const LABEL = { highlight: 'Highlight', note: 'Note', bookmark: 'Bookmark' } as const;

/** What the annotations list says about one item. Pure, so the wording is tested without a DOM. */
export function describeAnnotation(a: Annotation) {
  const label = LABEL[a.kind];
  const where = a.chapter?.trim() ?? '';
  const quote = previewText(a.text, 200);
  const jump = `Go to ${label.toLowerCase()}${where ? ` in ${where}` : ''}${quote ? `: ${previewText(quote, 60)}` : ''}`;
  return { label, quote, where, jump, ...(a.note ? { note: a.note } : {}) };
}
