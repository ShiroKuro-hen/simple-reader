import { describe, expect, it } from 'vitest';
import type { Annotation } from '../types';
import { describeAnnotation } from './present';

const base: Annotation = {
  id: 'a', bookId: 'b', kind: 'highlight', location: '1', text: 'The lighthouse keeper', color: 'blue', createdAt: 1, updatedAt: 1,
};

describe('describeAnnotation', () => {
  it.each([
    ['a highlight', base, { label: 'Highlight', quote: 'The lighthouse keeper', where: '', jump: 'Go to highlight: The lighthouse keeper' }],
    [
      'a note in a chapter',
      { ...base, kind: 'note' as const, note: 'why?', chapter: 'Chapter One' },
      { label: 'Note', quote: 'The lighthouse keeper', note: 'why?', where: 'Chapter One', jump: 'Go to note in Chapter One: The lighthouse keeper' },
    ],
    ['a bookmark with the words of its page', { ...base, kind: 'bookmark' as const, text: 'Rain on   the\nglass' }, { label: 'Bookmark', quote: 'Rain on the glass', where: '', jump: 'Go to bookmark: Rain on the glass' }],
    ['a bookmark on an empty page', { ...base, kind: 'bookmark' as const, text: '', chapter: 'Page 4' }, { label: 'Bookmark', quote: '', where: 'Page 4', jump: 'Go to bookmark in Page 4' }],
  ])('%s', (_name, a, want) => {
    expect(describeAnnotation(a)).toEqual(want);
  });

  it('shortens a long quote to one line but keeps the whole note', () => {
    const d = describeAnnotation({ ...base, text: 'word '.repeat(100), kind: 'note', note: 'n '.repeat(100).trim() });
    expect(d.quote.length).toBeLessThanOrEqual(200);
    expect(d.quote.endsWith('…')).toBe(true);
    expect(d.note).toBe('n '.repeat(100).trim());
  });
});
