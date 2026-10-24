import { describe, expect, it } from 'vitest';
import type { BookMeta } from '../types';
import { FAVORITES, MAX_TAGS, MAX_TAG_LENGTH, addTag, cleanTags, filterByTags, isFavorite, liveSelection, normalizeTag, removeTag, tagCounts, toggleFavorite } from './tags';

const book = (id: string, tags?: string[]): BookMeta => ({ id, title: id, format: 'epub', size: 1, addedAt: 1, tags });

describe('normalizeTag', () => {
  it.each([
    [' Ficción ', 'ficción'], // lowercase, trimmed, accents kept (they are the user's words)
    ['Sci   Fi', 'sci fi'], // inner whitespace collapses
    ['Sci\tFi\n', 'sci fi'],
    ['ＳＦ', 'sf'], // full-width
    ['古典', '古典'],
    ['カタカナ', 'カタカナ'], // kana are not rewritten in what is stored
    ['x'.repeat(MAX_TAG_LENGTH), 'x'.repeat(MAX_TAG_LENGTH)],
    ['古'.repeat(MAX_TAG_LENGTH), '古'.repeat(MAX_TAG_LENGTH)], // length counts characters, not bytes
    ['😀'.repeat(MAX_TAG_LENGTH), '😀'.repeat(MAX_TAG_LENGTH)], // ... nor UTF-16 units
  ])('accepts %j as %j', (raw, tag) => expect(normalizeTag(raw)).toEqual({ ok: true, tag }));

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['\n\t', 'empty'],
    ['x'.repeat(MAX_TAG_LENGTH + 1), 'too-long'],
    ['😀'.repeat(MAX_TAG_LENGTH + 1), 'too-long'],
    ['a,b', 'invalid'], // the comma separates tags in the editor
    ['a\u0000b', 'invalid'],
  ])('rejects %j (%s)', (raw, reason) => expect(normalizeTag(raw)).toEqual({ ok: false, reason }));
});

describe('addTag / removeTag', () => {
  it('adds a normalised tag at the end and does not mutate the input', () => {
    const before = ['a'];
    expect(addTag(before, ' B ')).toEqual({ ok: true, tags: ['a', 'b'] });
    expect(before).toEqual(['a']);
  });
  it('starts from nothing', () => expect(addTag(undefined, 'x')).toEqual({ ok: true, tags: ['x'] }));
  it('refuses a duplicate whatever its case', () => expect(addTag(['ficción'], 'FICCIÓN')).toEqual({ ok: false, reason: 'duplicate' }));
  it('keeps señal and senal apart: they are different words to their owner', () =>
    expect(addTag(['senal'], 'señal')).toEqual({ ok: true, tags: ['senal', 'señal'] }));
  it('refuses the tag after the last allowed one', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(addTag(full, 'one more')).toEqual({ ok: false, reason: 'too-many' });
    expect(addTag(full.slice(1), 'one more').ok).toBe(true);
  });
  it('reports a bad tag before a duplicate or full list', () => expect(addTag(['a'], '')).toEqual({ ok: false, reason: 'empty' }));

  it('removes whatever the case and leaves the rest in order', () => expect(removeTag(['a', 'b', 'c'], ' B ')).toEqual(['a', 'c']));
  it('removing a tag that is not there changes nothing', () => expect(removeTag(['a'], 'z')).toEqual(['a']));
  it('removing the last tag leaves an empty list', () => expect(removeTag(['a'], 'a')).toEqual([]));
  it('copes with no tags at all', () => expect(removeTag(undefined, 'a')).toEqual([]));
});

describe('cleanTags (metadata comes from files that may be edited or synced)', () => {
  it('keeps valid tags, drops junk and duplicates, preserves order', () =>
    expect(cleanTags([' A', 'a', '', 5, null, 'b', 'B ', 'x,y'])).toEqual(['a', 'b']));
  it.each([[undefined], [null], ['text'], [{}], [[]]])('%j -> []', (v) => expect(cleanTags(v)).toEqual([]));
  it('caps the list', () => expect(cleanTags(Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS));
});

describe('tagCounts / filterByTags', () => {
  const books = [book('1', ['novela', 'sci fi']), book('2', ['novela']), book('3'), book('4', ['古典', 'novela']), book('5', ['sci fi'])];

  it('counts books per tag, most used first, ties alphabetical', () =>
    expect(tagCounts(books)).toEqual([
      { tag: 'novela', count: 3 },
      { tag: 'sci fi', count: 2 },
      { tag: '古典', count: 1 },
    ]));
  it('counts nothing for an untagged library', () => expect(tagCounts([book('x')])).toEqual([]));
  it('lists favorites first, even when it is the least used', () =>
    expect(tagCounts([book('1', ['novela']), book('2', ['novela', 'favorites']), book('3', ['sci fi'])]).map((c) => c.tag)).toEqual(['favorites', 'novela', 'sci fi']));

  it('no selection keeps every book', () => expect(filterByTags(books, [])).toHaveLength(5));
  it('one tag', () => expect(filterByTags(books, ['sci fi']).map((b) => b.id)).toEqual(['1', '5']));
  it('several tags must all be present', () => expect(filterByTags(books, ['novela', 'sci fi']).map((b) => b.id)).toEqual(['1']));
  it('selected tags are compared normalised', () => expect(filterByTags(books, [' NOVELA ']).map((b) => b.id)).toEqual(['1', '2', '4']));
  it('an unknown tag selects nothing', () => expect(filterByTags(books, ['nope'])).toEqual([]));
  it('books without tags never match a selection', () => expect(filterByTags([book('3')], ['novela'])).toEqual([]));
});

describe('favorites', () => {
  it('is the reserved category "favorites"', () => expect(FAVORITES).toBe('favorites'));
  it('isFavorite reads the category from the book', () => {
    expect(isFavorite(book('a', ['favorites']))).toBe(true);
    expect(isFavorite(book('a', ['novela']))).toBe(false);
    expect(isFavorite(book('a'))).toBe(false);
  });
  it('toggleFavorite adds it at the end, then removes it and keeps the other categories', () => {
    expect(toggleFavorite(['novela'])).toEqual({ ok: true, tags: ['novela', 'favorites'] });
    expect(toggleFavorite(['novela', 'favorites'])).toEqual({ ok: true, tags: ['novela'] });
    expect(toggleFavorite(undefined)).toEqual({ ok: true, tags: ['favorites'] });
  });
  it('cannot add favorites to a book that is already full, but can remove it', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(toggleFavorite(full)).toEqual({ ok: false, reason: 'too-many' });
    expect(toggleFavorite([...full.slice(1), 'favorites']).ok).toBe(true);
  });
});

describe('categories that nobody carries any more', () => {
  it('a category disappears from the list when its last book is removed', () => {
    const lib = [book('a', ['to start']), book('b', ['sci fi'])];
    expect(tagCounts(lib).map((c) => c.tag)).toEqual(['sci fi', 'to start']);
    expect(tagCounts(lib.filter((b) => b.id !== 'a')).map((c) => c.tag)).toEqual(['sci fi']);
  });
  it('a category disappears when it is removed from its last book', () => {
    const lib = [book('a', ['to start']), book('b', ['sci fi'])];
    lib[0] = { ...lib[0]!, tags: removeTag(lib[0]!.tags, 'to start') };
    expect(tagCounts(lib).map((c) => c.tag)).toEqual(['sci fi']);
  });
  it('a selected category that nobody carries is dropped from the selection, the rest keep their order', () => {
    const lib = [book('b', ['sci fi']), book('c', ['novela'])];
    expect(liveSelection(['novela', 'to start', 'sci fi'], lib)).toEqual(['novela', 'sci fi']);
    expect(liveSelection(['to start'], [])).toEqual([]);
  });
});
