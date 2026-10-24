import { describe, expect, it } from 'vitest';
import { fixtureFile } from '../reader/fixtures/load';
import type { BookMeta } from '../types';
import { extractText } from './book-text';
import { matchesIn } from '../reader/search-results';
import { bookHit, MAX_MATCHES, rankHits, scanBooks } from './text-search';

const book = (title: string, extra: Partial<BookMeta> = {}): BookMeta => ({ id: title, title, format: 'epub', size: 1, addedAt: 1, ...extra });
/** A hit for "x" in `text`, for a book called `title`. */
const hit = (title: string, text: string) => bookHit(book(title), text, 'x')!;

describe('bookHit', () => {
  it('is null when the book does not contain the query', () => {
    expect(bookHit(book('A'), 'the tide came in', 'comet')).toBeNull();
  });

  it('counts every match and keeps the first two as excerpts', () => {
    const found = bookHit(book('A'), 'harbour one, harbour two, harbour three', 'harbour');
    expect(found).toMatchObject({ count: 3, capped: false });
    expect(found?.excerpts.map((m) => m.match)).toEqual(['harbour', 'harbour']);
    expect(found?.excerpts[0]).toMatchObject({ pre: '', post: ' one, harbour two, harbour three' });
  });

  it('is case and accent insensitive, as the in-book search is', () => {
    expect(bookHit(book('A'), 'SEÑAL en el mar', 'senal')?.count).toBe(1);
  });

  it('stops counting at 50 and says so when there are more', () => {
    expect(bookHit(book('A'), 'ship '.repeat(MAX_MATCHES + 1), 'ship')).toMatchObject({ count: 50, capped: true });
  });

  it('does not say "50+" for exactly 50 matches', () => {
    expect(bookHit(book('A'), 'ship '.repeat(MAX_MATCHES), 'ship')).toMatchObject({ count: 50, capped: false });
  });
});

describe('rankHits', () => {
  it('puts the books with the most matches first, then by title', () => {
    const ranked = rankHits([hit('Alpha', 'x'), hit('Zeta', 'x x'), hit('Beta', 'x'), hit('Gamma', 'x x x')]);
    expect(ranked.map((h) => h.book.title)).toEqual(['Gamma', 'Zeta', 'Alpha', 'Beta']);
  });

  it('does not change the order it was given', () => {
    const input = [hit('B', 'x'), hit('A', 'x')];
    rankHits(input);
    expect(input.map((h) => h.book.title)).toEqual(['B', 'A']);
  });
});

describe('scanBooks', () => {
  const books = [book('A', { id: 'a' }), book('B', { id: 'b' }), book('C', { id: 'c' })];
  const texts: Record<string, string> = { a: 'the harbour at dusk', c: 'harbour again' };
  /** Book b is damaged: reading it throws. */
  const textOf = async (b: BookMeta) => {
    if (b.id === 'b') throw new Error('damaged');
    return texts[b.id]!;
  };
  const collect = async (list: BookMeta[], query: string, read = textOf) => {
    const steps = [];
    for await (const step of scanBooks(list, query, read)) steps.push(step);
    return steps;
  };

  it('reports progress before each book and at the end', async () => {
    const steps = await collect(books, 'harbour');
    expect(steps.map((s) => s.done)).toEqual([0, 1, 2, 3]);
    expect(steps.every((s) => s.total === 3)).toBe(true);
  });

  it('collects the matching books and counts the unreadable ones without stopping', async () => {
    const last = (await collect(books, 'harbour')).at(-1)!;
    expect(last.hits.map((h) => h.book.id)).toEqual(['a', 'c']);
    expect(last.unreadable).toBe(1);
  });

  it('reports one final step with nothing found for an empty list', async () => {
    expect(await collect([], 'harbour')).toEqual([{ done: 0, total: 0, hits: [], unreadable: 0 }]);
  });

  it('reads no further books once the consumer stops, so a newer query is not kept waiting', async () => {
    const read: string[] = [];
    for await (const step of scanBooks(books, 'x', async (b) => (read.push(b.id), 'x'))) {
      if (step.done === 1) break;
    }
    expect(read).toEqual(['a']);
  });

  it('counts a damaged real file as unreadable', async () => {
    const corrupt = [book('bad', { id: 'bad', format: 'pdf' })];
    const last = (await collect(corrupt, 'x', () => extractText(fixtureFile('corrupt.pdf'), 'pdf'))).at(-1)!;
    expect(last).toMatchObject({ done: 1, total: 1, hits: [], unreadable: 1 });
  });
});

describe('bookHit speed path', () => {
  const texts = [
    'The harbour master wrote the number down. HARBOUR again, and Harbour.',
    'Señal en el mar; la SEÑAL volvió. Capítulo 3: Señales del puerto.',
    '吾輩は猫である。名前はまだ無い。吾輩は猫。がぎぐ か と が は別',
    'İstanbul and straße and ﬁne ﬁsh', // the fold changes the length: the exact search answers instead
  ];
  const queries = ['harbour', 'senal', 'capitulo', '吾輩', 'が', 'か', 'istanbul', 'fine', 'nothing'];

  it('finds exactly what the exact search finds, with the same excerpts', () => {
    for (const text of texts) {
      for (const query of queries) {
        const exact = matchesIn(text, query);
        const fast = bookHit(book('A'), text, query);
        expect(fast?.count ?? 0, `${query} in ${text}`).toBe(Math.min(exact.length, MAX_MATCHES));
        expect(fast?.excerpts.map(({ pre, match, post }) => ({ pre, match, post })) ?? []).toEqual(
          exact.slice(0, 2).map(({ pre, match, post }) => ({ pre, match, post })),
        );
      }
    }
  });

  it('is fast on a big text', () => {
    const big = 'lorem ipsum dolor sit amet '.repeat(200_000) + 'needle';
    const t0 = performance.now();
    expect(bookHit(book('A'), big, 'needle')?.count).toBe(1);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
