import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../types';
import { groupBySeries, seriesFromKey, volumeOrder } from './series';

const book = (id: string, extra: Partial<BookMeta> = {}): BookMeta => ({ id, title: id, format: 'epub', size: 1, addedAt: 1, ...extra });
const ids = (bs: readonly BookMeta[]) => bs.map((b) => b.id);

describe('seriesFromKey', () => {
  it.each([
    ['Lord of the Mysteries/Vol 01.epub', { series: 'Lord of the Mysteries', file: 'Vol 01.epub' }],
    ['Saga/part.PDF', { series: 'Saga', file: 'part.PDF' }],
    ['Comics/Vol 1.CBZ', { series: 'Comics', file: 'Vol 1.CBZ' }],
    ['Saga/Book/Vol 2.epub', { series: 'Saga', file: 'Vol 2.epub' }], // nested: the first folder is the series
  ])('%j -> %j', (key, out) => expect(seriesFromKey(key)).toEqual(out));

  it('keeps unicode and spaces untouched', () => {
    expect(seriesFromKey('  吾輩は猫である  / 第 1 巻 ü.epub')).toEqual({ series: '  吾輩は猫である  ', file: ' 第 1 巻 ü.epub' });
  });

  it.each([
    ['Vol 1.epub', 'root-level file'],
    ['books/abc.epub', 'the app\'s own books folder'],
    ['meta/abc.json', 'the app\'s own meta folder'],
    ['progress/abc.json', 'the app\'s own progress folder'],
    ['annotations/abc.json', 'the app\'s own annotations folder'],
    ['settings.json', 'the settings file'],
    ['Saga/', 'a directory marker'],
    ['Saga/notes.txt', 'not a book format'],
    ['Saga/cover.jpg', 'an image'],
    ['Saga/Vol 1', 'no extension'],
    ['/Vol 1.epub', 'an empty first segment'],
  ])('%j is not a series book (%s)', (key) => expect(seriesFromKey(key)).toBeNull());
});

describe('volumeOrder', () => {
  it('orders numbers naturally: Vol 2 before Vol 10', () => {
    const bs = ['Vol 10', 'Vol 2', 'Vol 1'].map((t) => book(t, { title: t }));
    expect(volumeOrder(bs).map((b) => b.title)).toEqual(['Vol 1', 'Vol 2', 'Vol 10']);
  });

  it('ignores case', () => {
    const bs = ['b', 'A', 'c'].map((t) => book(t, { title: t }));
    expect(volumeOrder(bs).map((b) => b.title)).toEqual(['A', 'b', 'c']);
  });

  it('breaks title ties by addedAt, oldest first', () => {
    const bs = [book('late', { title: 'Vol 1', addedAt: 9 }), book('early', { title: 'Vol 1', addedAt: 2 })];
    expect(ids(volumeOrder(bs))).toEqual(['early', 'late']);
  });

  it('returns a new array and never mutates its input', () => {
    const bs = [book('b', { title: 'Vol 2' }), book('a', { title: 'Vol 1' })];
    const out = volumeOrder(bs);
    expect(out).not.toBe(bs);
    expect(ids(bs)).toEqual(['b', 'a']);
  });

  it('handles empty input', () => {
    expect(volumeOrder([])).toEqual([]);
  });
});

describe('groupBySeries', () => {
  it('collapses a series into one entry placed where its first member appears', () => {
    const bs = [
      book('a', { title: 'Vol 1', series: 'Saga' }),
      book('solo'),
      book('b', { title: 'Vol 2', series: 'Saga' }),
      book('other', { series: 'Other' }),
    ];
    const entries = groupBySeries(bs);
    expect(entries.map((e) => e.kind)).toEqual(['series', 'book', 'series']);
    expect(entries[0]).toEqual({ kind: 'series', name: 'Saga', books: [bs[0], bs[2]] });
    expect(entries[1]).toEqual({ kind: 'book', book: bs[1] });
  });

  it('keeps the input order of everything else', () => {
    const bs = [book('x'), book('y', { series: 'S' }), book('z'), book('w', { series: 'T' }), book('v')];
    const names = groupBySeries(bs).map((e) => (e.kind === 'book' ? e.book.id : e.name));
    expect(names).toEqual(['x', 'S', 'z', 'T', 'v']);
  });

  it('merges series names case-insensitively and ignoring surrounding spaces, showing the first spelling', () => {
    const bs = [
      book('a', { title: 'Vol 1', series: 'Lord of the Mysteries' }),
      book('b', { title: 'Vol 2', series: '  lord OF the mysteries ' }),
    ];
    const entries = groupBySeries(bs);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'series', name: 'Lord of the Mysteries' });
    expect(entries[0]).toMatchObject({ books: [bs[0], bs[1]] });
  });

  it('ignores blank series names', () => {
    const bs = [book('a', { series: '' }), book('b', { series: '   ' }), book('c', { series: undefined })];
    expect(groupBySeries(bs)).toEqual(bs.map((b) => ({ kind: 'book', book: b })));
  });

  it('keeps a series with a single book as a series entry', () => {
    const only = book('only', { series: 'Lonely' });
    expect(groupBySeries([only])).toEqual([{ kind: 'series', name: 'Lonely', books: [only] }]);
  });

  it('orders the volumes of a series naturally', () => {
    const bs = [
      book('10', { title: 'Vol 10', series: 'S' }),
      book('2', { title: 'Vol 2', series: 'S' }),
    ];
    expect(groupBySeries(bs)).toEqual([{ kind: 'series', name: 'S', books: [bs[1], bs[0]] }]);
  });

  it('returns nothing for empty input and does not mutate it', () => {
    expect(groupBySeries([])).toEqual([]);
    const bs = [book('b', { title: 'Vol 2', series: 'S' }), book('a', { title: 'Vol 1', series: 'S' })];
    groupBySeries(bs);
    expect(ids(bs)).toEqual(['b', 'a']);
  });
});
