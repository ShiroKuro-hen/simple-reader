import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../types';
import { SORT_KEYS, parseSortKey, sortBooks } from './sort';

const book = (id: string, extra: Partial<BookMeta> = {}): BookMeta => ({ id, title: id, format: 'epub', size: 1, addedAt: 1, ...extra });
const ids = (bs: BookMeta[]) => bs.map((b) => b.id);

describe('sortBooks', () => {
  it('"added": newest first, ties by title', () => {
    const bs = [book('b', { addedAt: 5 }), book('a', { addedAt: 5 }), book('c', { addedAt: 9 }), book('d', { addedAt: 1 })];
    expect(ids(sortBooks(bs, 'added'))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('"title": natural order, ignoring case and accents', () => {
    const bs = ['Vol 10', 'vol 2', 'Zebra', 'Éclair', 'apple', 'Vol 1'].map((t) => book(t, { title: t }));
    expect(sortBooks(bs, 'title').map((b) => b.title)).toEqual(['apple', 'Éclair', 'Vol 1', 'vol 2', 'Vol 10', 'Zebra']);
  });

  it('"title": Japanese titles sort deterministically with Latin ones first', () => {
    const bs = ['吾輩は猫である', 'Alpha', 'ノルウェイの森', 'beta'].map((t) => book(t, { title: t }));
    const once = sortBooks(bs, 'title').map((b) => b.title);
    expect(once.slice(0, 2)).toEqual(['Alpha', 'beta']);
    expect(sortBooks([...bs].reverse(), 'title').map((b) => b.title)).toEqual(once);
  });

  it('"author": by author, books without one last, same author by title', () => {
    const bs = [
      book('1', { title: 'B', author: 'Zola' }),
      book('2', { title: 'Z' }),
      book('3', { title: 'A', author: 'zola' }),
      book('4', { title: 'M', author: 'Álvarez' }),
      book('5', { title: 'A', author: '  ' }),
    ];
    expect(ids(sortBooks(bs, 'author'))).toEqual(['4', '3', '1', '5', '2']);
  });

  it('"read": most recently read first, then unread by date added', () => {
    const bs = [book('old', { addedAt: 1 }), book('new', { addedAt: 9 }), book('mid', { addedAt: 5 }), book('read1', { addedAt: 2 }), book('read2', { addedAt: 3 })];
    const lastRead = new Map([['read1', 200], ['read2', 100]]);
    expect(ids(sortBooks(bs, 'read', lastRead))).toEqual(['read1', 'read2', 'new', 'mid', 'old']);
  });

  it('"read" without any progress is just "added"', () => {
    const bs = [book('a', { addedAt: 1 }), book('b', { addedAt: 2 })];
    expect(ids(sortBooks(bs, 'read'))).toEqual(['b', 'a']);
  });

  it('never mutates its input', () => {
    const bs = [book('a', { addedAt: 1 }), book('b', { addedAt: 2 })];
    sortBooks(bs, 'added');
    expect(ids(bs)).toEqual(['a', 'b']);
  });
});

describe('parseSortKey (a remembered choice may be junk)', () => {
  const cases: [unknown, string][] = [...SORT_KEYS.map((k): [unknown, string] => [k, k]), ['nope', 'added'], [null, 'added'], [undefined, 'added'], [3, 'added']];
  it.each(cases)('%j -> %s', (v, k) => expect(parseSortKey(v)).toBe(k));
});
