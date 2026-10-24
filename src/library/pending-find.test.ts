import { describe, expect, it } from 'vitest';
import { setPendingFind, takePendingFind } from './pending-find';

describe('pending find', () => {
  it('hands the query to the book it was set for, once', () => {
    setPendingFind('book-a', 'harbour');
    expect(takePendingFind('book-a')).toBe('harbour');
    expect(takePendingFind('book-a')).toBeNull();
  });

  it('gives nothing to another book, and forgets the query anyway', () => {
    setPendingFind('book-a', 'harbour');
    expect(takePendingFind('book-b')).toBeNull();
    expect(takePendingFind('book-a')).toBeNull();
  });

  it('gives nothing when nothing was set', () => {
    expect(takePendingFind('book-a')).toBeNull();
  });
});
