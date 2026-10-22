import { describe, expect, it } from 'vitest';
import type { Annotation, BookMeta } from '../types';
import { exportFilename, exportJson, exportMarkdown } from './export';

const book: BookMeta = { id: 'b1', title: 'The Lighthouse & the Sea', author: 'Ada Marlowe', format: 'epub', size: 1, addedAt: 1 };
let n = 0;
const item = (over: Partial<Annotation>): Annotation => ({
  id: `id${++n}`, bookId: 'b1', kind: 'highlight', location: 'epubcfi(/6/4!/4/2,/1:0,/1:5)', text: 'text',
  color: 'yellow', createdAt: 1000 + n, updatedAt: 1000 + n, ...over,
});
const CH1 = 'epubcfi(/6/4!/4/2,/1:0,/1:5)';
const CH1_LATER = 'epubcfi(/6/4!/4/8,/1:0,/1:5)';
const CH2 = 'epubcfi(/6/6!/4/2,/1:0,/1:5)';

describe('exportMarkdown', () => {
  const items = [
    item({ location: CH2, chapter: 'Chapter Two', text: 'A storm arrived without warning.', color: 'blue', note: 'Foreshadowing?', kind: 'note' }),
    item({ location: CH1, chapter: 'Chapter One', text: 'The lighthouse keeper climbed the spiral stairs.', color: 'yellow' }),
    item({ location: CH1_LATER, chapter: 'Chapter One', text: 'Second thought', color: 'pink' }),
    item({ location: 'epubcfi(/6/6!/4/9/1:0)', chapter: 'Chapter Two', kind: 'bookmark', text: 'Rain on the glass, steady and cold.' }),
    item({ location: 'epubcfi(/6/4!/4/6/1:0)', chapter: 'Chapter One', kind: 'bookmark', text: '' }),
  ];

  it('writes the whole note: header, chapters in book order, quotes with colour markers, notes, bookmarks', () => {
    expect(exportMarkdown(book, items)).toBe(
      [
        '# The Lighthouse & the Sea',
        '',
        '*Ada Marlowe*',
        '',
        '3 highlights (1 with a note) · 2 bookmarks',
        '',
        '## Chapter One',
        '',
        '> 🟨 The lighthouse keeper climbed the spiral stairs.',
        '',
        '> 🩷 Second thought',
        '',
        '## Chapter Two',
        '',
        '> 🟦 A storm arrived without warning.',
        '',
        '**Note:** Foreshadowing?',
        '',
        '## Bookmarks',
        '',
        '- Chapter One',
        '- Chapter Two: “Rain on the glass, steady and cold.”',
        '',
      ].join('\n'),
    );
  });

  it('is identical for the same items in any input order, and every item appears exactly once', () => {
    const md = exportMarkdown(book, items);
    expect(exportMarkdown(book, [...items].reverse())).toBe(md);
    expect(exportMarkdown(book, [...items, ...items])).toBe(md);
    expect(md.match(/storm arrived/g)).toHaveLength(1);
  });

  it('keeps one copy when the same highlight reached two devices under different ids', () => {
    const twin = { ...items[1]!, id: 'other-device', updatedAt: 99999 };
    expect(exportMarkdown(book, [...items, twin])).toBe(exportMarkdown(book, items));
  });

  it('skips deleted items and items of another book', () => {
    const md = exportMarkdown(book, [...items, item({ text: 'GONE', deleted: true }), item({ text: 'FOREIGN', bookId: 'other' })]);
    expect(md).not.toMatch(/GONE|FOREIGN/);
  });

  it('says so when there is nothing to export', () => {
    expect(exportMarkdown(book, [])).toBe('# The Lighthouse & the Sea\n\n*Ada Marlowe*\n\nNo highlights, notes or bookmarks yet.\n');
    expect(exportMarkdown(book, [item({ deleted: true })])).toContain('No highlights');
  });

  it('puts highlights without a chapter under "Other" and leaves out an unknown author', () => {
    const md = exportMarkdown({ ...book, author: undefined }, [item({ text: 'loose', chapter: undefined })]);
    expect(md).toBe('# The Lighthouse & the Sea\n\n1 highlight\n\n## Other\n\n> 🟨 loose\n');
  });

  it('keeps multi-line quotes inside one blockquote and multi-line notes as separate lines', () => {
    const md = exportMarkdown(book, [item({ text: 'line one\n\nline two', kind: 'note', note: 'first\nsecond', chapter: 'C' })]);
    expect(md).toContain('> 🟨 line one\n>\n> line two\n\n**Note:** first  \nsecond\n');
  });

  it('escapes Markdown syntax in quotes, notes, titles and chapters so they cannot turn into structure', () => {
    const nasty = item({
      chapter: '# Chapter *1*',
      text: '# not a heading\n- not a list\n1. not numbered\n> not nested\n<script>alert(1)</script> *bold* _it_ [link](http://x) `code` ~~s~~ a\\b &amp; ---',
      kind: 'note',
      note: '## also **not** bold',
    });
    const md = exportMarkdown({ ...book, title: '[Title] <b>*' }, [nasty]);
    expect(md).toContain('# \\[Title\\] \\<b>\\*\n');
    expect(md).toContain('## # Chapter \\*1\\*\n');
    expect(md).toContain('> 🟨 # not a heading\n> \\- not a list\n> 1\\. not numbered\n> \\> not nested\n');
    expect(md).toContain('\\<script>alert(1)\\</script> \\*bold\\* \\_it\\_ \\[link\\](http://x) \\`code\\` \\~\\~s\\~\\~ a\\\\b \\&amp; ---');
    expect(md).toContain('**Note:** ## also \\*\\*not\\*\\* bold');
    expect(md.split('\n').filter((l) => /^#{1,6} /.test(l))).toEqual(['# \\[Title\\] \\<b>\\*', '## # Chapter \\*1\\*']);
  });

  it('keeps Japanese and emoji text as is', () => {
    const md = exportMarkdown({ ...book, title: '吾輩は猫である' }, [item({ text: '吾輩は猫である。名前はまだ無い。😀', chapter: '一' })]);
    expect(md).toContain('# 吾輩は猫である');
    expect(md).toContain('> 🟨 吾輩は猫である。名前はまだ無い。😀');
  });

  it('orders PDF items by page number', () => {
    const pdf = { ...book, format: 'pdf' as const };
    const md = exportMarkdown(pdf, [10, 9, 2].map((p) => item({ kind: 'bookmark', location: String(p), chapter: `Page ${p}`, text: '' })));
    expect(md.match(/Page \d+/g)).toEqual(['Page 2', 'Page 9', 'Page 10']);
  });

  it('can state when it was exported', () => {
    expect(exportMarkdown(book, [], { exportedAt: Date.UTC(2026, 9, 22, 23, 59) })).toContain('Exported 2026-10-22');
  });
});

describe('exportJson', () => {
  it('lists the live items in reading order with the book that owns them', () => {
    const a = item({ location: CH2, text: 'later' });
    const b = item({ location: CH1, text: 'earlier' });
    const out = JSON.parse(exportJson(book, [a, b, item({ deleted: true })]));
    expect(out.book).toEqual({ id: 'b1', title: 'The Lighthouse & the Sea', author: 'Ada Marlowe', format: 'epub' });
    expect(out.annotations.map((x: Annotation) => x.text)).toEqual(['earlier', 'later']);
  });
});

describe('exportFilename', () => {
  it.each([
    ['The Lighthouse & the Sea', 'md', 'The Lighthouse & the Sea-notes.md'],
    ['a/b\\c:d*e?f"g<h>i|j', 'md', 'a b c d e f g h i j-notes.md'],
    ['   ', 'md', 'book-notes.md'],
    ['', 'json', 'book-notes.json'],
    ['x'.repeat(200), 'md', `${'x'.repeat(80)}-notes.md`],
    ['吾輩は猫である', 'md', '吾輩は猫である-notes.md'],
    ['CON', 'md', 'CON-notes.md'],
    ['dots...', 'md', 'dots-notes.md'],
  ])('%j -> %j', (title, ext, out) => {
    expect(exportFilename({ ...book, title }, ext as 'md' | 'json')).toBe(out);
  });
});
