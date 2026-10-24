import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../types';
import { RECENT_LIMIT, recentBooks } from './recent';

const book = (id: string): BookMeta => ({ id, title: id, format: 'epub', size: 1, addedAt: 1 });
const ids = (bs: BookMeta[]) => bs.map((b) => b.id);

describe('recentBooks', () => {
  const books = ['a', 'b', 'c', 'd'].map(book);

  it('lists the opened books newest first', () => {
    expect(ids(recentBooks(books, new Map([['a', 10], ['c', 30], ['b', 20]])))).toEqual(['c', 'b', 'a']);
  });

  it('leaves out books that were never opened', () => {
    expect(ids(recentBooks(books, new Map([['d', 5]])))).toEqual(['d']);
    expect(recentBooks(books, new Map())).toEqual([]);
  });

  it('ignores opened ids whose book no longer exists', () => {
    expect(ids(recentBooks(books, new Map([['gone', 99], ['a', 1]])))).toEqual(['a']);
  });

  it('shows at most 8 books by default, the newest ones', () => {
    const many = Array.from({ length: 12 }, (_, i) => book(`b${i}`));
    const out = recentBooks(many, new Map(many.map((b, i) => [b.id, i])));
    expect(RECENT_LIMIT).toBe(8);
    expect(out).toHaveLength(8);
    expect(ids(out)).toEqual(['b11', 'b10', 'b9', 'b8', 'b7', 'b6', 'b5', 'b4']);
  });

  it('takes a limit', () => expect(ids(recentBooks(books, new Map([['a', 1], ['b', 2], ['c', 3]]), 2))).toEqual(['c', 'b']));

  it('breaks ties by id, the same way every time', () => {
    expect(ids(recentBooks([book('b'), book('a'), book('c')], new Map([['a', 5], ['b', 5], ['c', 5]])))).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array and leaves the input alone', () => {
    const input = [...books];
    recentBooks(input, new Map([['a', 1]]));
    expect(input).toEqual(books);
  });
});
