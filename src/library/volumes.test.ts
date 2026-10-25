import { describe, expect, it } from 'vitest';
import type { BookMeta, Progress } from '../types';
import { FINISHED, isRead, nextVolume, withReadMark } from './volumes';

const book = (id: string, extra: Partial<BookMeta> = {}): BookMeta => ({ id, title: id, format: 'cbz', size: 1, addedAt: 1, ...extra });
const progress = (fraction: number, extra: Partial<Progress> = {}): Progress => ({ bookId: 'b', location: '12', fraction, updatedAt: 5, ...extra });

describe('isRead: a book counts as read once its last pages are reached', () => {
  it.each([
    [undefined, false],
    [progress(0), false],
    [progress(0.5), false],
    [progress(FINISHED - 0.01), false],
    [progress(FINISHED), true],
    [progress(1), true],
  ])('%j -> %s', (p, want) => expect(isRead(p)).toBe(want));
});

describe('nextVolume: the volume after this one in its series', () => {
  const saga = [
    book('v10', { title: 'Saga Vol 10', series: 'Saga' }),
    book('v1', { title: 'Saga Vol 1', series: 'Saga' }),
    book('v2', { title: 'Saga Vol 2', series: 'saga' }), // the series name ignores case, as the library does
    book('other', { title: 'Other Vol 2', series: 'Other' }),
    book('alone', { title: 'Alone' }),
  ];

  it('goes by volume number, not by the order the books are listed in', () => {
    expect(nextVolume(saga, 'v1')?.id).toBe('v2');
    expect(nextVolume(saga, 'v2')?.id).toBe('v10');
  });

  it('is undefined after the last volume, for a book with no series and for an unknown book', () => {
    expect(nextVolume(saga, 'v10')).toBeUndefined();
    expect(nextVolume(saga, 'alone')).toBeUndefined();
    expect(nextVolume(saga, 'nope')).toBeUndefined();
  });

  it('never crosses into another series', () => {
    expect(nextVolume(saga, 'other')).toBeUndefined();
  });
});

describe('withReadMark: marking a book read or unread by hand', () => {
  it('read keeps the place the book was at and fills the bar', () => {
    expect(withReadMark(progress(0.3), 'b', true, 99)).toEqual({ bookId: 'b', location: '12', fraction: 1, updatedAt: 99 });
  });

  it('read works on a book that was never opened', () => {
    expect(withReadMark(null, 'b', true, 99)).toEqual({ bookId: 'b', location: '', fraction: 1, updatedAt: 99 });
  });

  it('unread puts the book back at the start', () => {
    expect(withReadMark(progress(1), 'b', false, 99)).toEqual({ bookId: 'b', location: '', fraction: 0, updatedAt: 99 });
  });
});
