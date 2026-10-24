import { describe, expect, it } from 'vitest';
import { formatOf, mergeSettings, newestFirst, sha256Hex, titleFromFilename } from './domain';
import type { BookMeta } from '../types';

describe('sha256Hex', () => {
  const hex = async (s: string) => sha256Hex(new TextEncoder().encode(s));
  it('matches the published SHA-256 test vectors', async () => {
    expect(await hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('formatOf', () => {
  it('reads the extension case-insensitively and knows epub, pdf, cbz and cbr', () => {
    expect(formatOf('Book.EPUB')).toBe('epub');
    expect(formatOf('a.b.pdf')).toBe('pdf');
    expect(formatOf('Vol 1.CBZ')).toBe('cbz');
    expect(formatOf('Vol 1.cbr')).toBe('cbz'); // a RAR comic is still one cbz book
    expect(formatOf('Vol 2.CBR')).toBe('cbz');
    expect(formatOf('archive.zip')).toBeNull();
    expect(formatOf('notes.txt')).toBeNull();
    expect(formatOf('epub')).toBeNull();
  });
});

describe('titleFromFilename', () => {
  it('drops only the last extension and turns underscores into spaces', () => {
    expect(titleFromFilename('My_Great_Book.epub')).toBe('My Great Book');
    expect(titleFromFilename('report.v2.pdf')).toBe('report.v2');
    expect(titleFromFilename('日本語の本.pdf')).toBe('日本語の本');
    expect(titleFromFilename('plain')).toBe('plain');
  });
});

describe('newestFirst', () => {
  const book = (id: string, addedAt: number) => ({ id, addedAt }) as BookMeta;
  it('orders by addedAt descending without mutating the input', () => {
    const input = [book('old', 1), book('new', 3), book('mid', 2)];
    expect(newestFirst(input).map((b) => b.id)).toEqual(['new', 'mid', 'old']);
    expect(input.map((b) => b.id)).toEqual(['old', 'new', 'mid']);
  });
});

describe('mergeSettings', () => {
  it('fills the defaults when nothing was saved', () => {
    expect(mergeSettings(null)).toEqual({ theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, webtoon: false });
  });
  it('keeps valid saved values and fills the missing ones', () => {
    expect(mergeSettings({ theme: 'dark', fontSize: 140 })).toEqual({ theme: 'dark', fontSize: 140, furigana: 'off', layout: 'auto', rtl: true, webtoon: false });
  });
  it('remembers the one-page layout', () => {
    expect(mergeSettings({ layout: 'single' }).layout).toBe('single');
  });
  it('replaces garbage from a hand-edited or corrupt file', () => {
    expect(mergeSettings({ theme: 'neon', fontSize: 'big', furigana: 7, layout: 'triple' })).toEqual({ theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, webtoon: false });
  });
  it('clamps absurd font sizes', () => {
    expect(mergeSettings({ fontSize: 5 }).fontSize).toBe(50);
    expect(mergeSettings({ fontSize: 9000 }).fontSize).toBe(300);
  });
  it('defaults comics to right to left', () => {
    expect(mergeSettings(null).rtl).toBe(true);
  });
  it('keeps a saved boolean rtl, true or false', () => {
    expect(mergeSettings({ rtl: false }).rtl).toBe(false);
    expect(mergeSettings({ rtl: true }).rtl).toBe(true);
  });
  it('falls back to right to left for a non-boolean rtl', () => {
    expect(mergeSettings({ rtl: 'false' }).rtl).toBe(true);
    expect(mergeSettings({ rtl: 0 }).rtl).toBe(true);
    expect(mergeSettings({ rtl: undefined }).rtl).toBe(true);
    expect(mergeSettings({ rtl: { on: false } }).rtl).toBe(true);
  });
  it('keeps a saved webtoon boolean and defaults it to off', () => {
    expect(mergeSettings({ webtoon: true }).webtoon).toBe(true);
    expect(mergeSettings({ webtoon: false }).webtoon).toBe(false);
    expect(mergeSettings({ webtoon: 'yes' }).webtoon).toBe(false);
    expect(mergeSettings({ rtl: false }).webtoon).toBe(false);
  });
  it('gives an old settings file without rtl the right-to-left default', () => {
    expect(mergeSettings({ theme: 'dark', fontSize: 120, furigana: 'romaji', layout: 'single' })).toEqual({
      theme: 'dark',
      fontSize: 120,
      furigana: 'romaji',
      layout: 'single',
      rtl: true,
      webtoon: false,
    });
  });
  it('ignores a text direction saved by an older version: it is per book now', () => {
    expect(mergeSettings({ theme: 'dark', writing: 'horizontal' })).toEqual({ theme: 'dark', fontSize: 100, furigana: 'off', layout: 'auto', rtl: true, webtoon: false });
    expect(mergeSettings({ writing: 'horizontal' })).not.toHaveProperty('writing');
  });
});
