import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../types';
import { countLabel, libraryView } from './view';

const book = (id: string, extra: Partial<BookMeta> = {}): BookMeta => ({ id, title: id, format: 'epub', size: 1, addedAt: 1, ...extra });

describe('libraryView', () => {
  const books = [
    book('1', { title: 'Señal de humo', addedAt: 1, tags: ['novela'] }),
    book('2', { title: 'Smoke Signals', addedAt: 2, tags: ['novela', 'en'] }),
    book('3', { title: '吾輩は猫である', author: '夏目漱石', addedAt: 3, tags: ['古典'] }),
  ];
  const view = (query: string, tags: string[] = [], sort: 'added' | 'title' = 'added') => libraryView(books, { query, tags, sort });

  it('combines search, tags and sort', () => {
    expect(view('').books.map((b) => b.id)).toEqual(['3', '2', '1']);
    expect(view('', ['novela']).books.map((b) => b.id)).toEqual(['2', '1']);
    expect(view('sen', ['novela']).books.map((b) => b.id)).toEqual(['1']);
    expect(view('', ['novela'], 'title').books.map((b) => b.title)).toEqual(['Señal de humo', 'Smoke Signals']);
  });

  it('tells an empty library from a search with no results', () => {
    expect(libraryView([], { query: '', tags: [], sort: 'added' }).state).toBe('empty-library');
    expect(libraryView([], { query: 'x', tags: [], sort: 'added' }).state).toBe('empty-library');
    expect(view('zzz').state).toBe('no-results');
    expect(view('', ['nope']).state).toBe('no-results');
    expect(view('smoke').state).toBe('results');
    expect(view('').state).toBe('results');
  });

  it('reports shown and total', () => {
    expect(view('smoke')).toMatchObject({ shown: 1, total: 3 });
  });
});

describe('countLabel', () => {
  it.each([
    [0, 0, '0 books'],
    [1, 1, '1 book'],
    [40, 40, '40 books'],
    [12, 40, '12 of 40 books'],
    [0, 40, '0 of 40 books'],
    [1, 40, '1 of 40 books'],
  ])('%i of %i -> %s', (shown, total, label) => expect(countLabel(shown, total)).toBe(label));
});

describe('speed', () => {
  // A realistic big library: Latin with accents, Spanish, Japanese, tags, authors.
  const words = ['señal', 'humo', 'The', 'Lighthouse', 'Sea', 'journey', 'Ünïcode', 'moon', '吾輩', '猫', 'ノルウェイ', '森', 'ラーメン', 'Vol'];
  const many: BookMeta[] = Array.from({ length: 1000 }, (_, i) => {
    const title = [0, 1, 2, 3].map((k) => words[(i * 7 + k * 3) % words.length]).join(' ') + ` ${i}`;
    return book(`id-${i}`, { title, author: `Author ${words[i % words.length]} ${i % 37}`, addedAt: i, tags: i % 3 ? [`tag${i % 11}`, 'común'] : undefined });
  });

  it('filters, tag-filters and sorts 1000 books in well under 50 ms', () => {
    libraryView(many, { query: 'warm', tags: [], sort: 'title' }); // JIT warm-up, the first search of a session is not what we measure
    for (const [query, tags] of [['senal luna', []], ['猫 のるうぇい', []], ['journey', ['tag3', 'común']], ['', []], ['zzz', []]] as const) {
      const t0 = performance.now();
      const out = libraryView(many, { query, tags: [...tags], sort: 'title' });
      const ms = performance.now() - t0;
      expect(ms, `${query} ${tags}`).toBeLessThan(50);
      expect(out.total).toBe(1000);
    }
  });
});
