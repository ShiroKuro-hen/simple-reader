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
  it('reads the extension case-insensitively and only knows epub and pdf', () => {
    expect(formatOf('Book.EPUB')).toBe('epub');
    expect(formatOf('a.b.pdf')).toBe('pdf');
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
    expect(mergeSettings(null)).toEqual({ theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto' });
  });
  it('keeps valid saved values and fills the missing ones', () => {
    expect(mergeSettings({ theme: 'dark', fontSize: 140 })).toEqual({ theme: 'dark', fontSize: 140, furigana: 'off', layout: 'auto' });
  });
  it('remembers the one-page layout', () => {
    expect(mergeSettings({ layout: 'single' }).layout).toBe('single');
  });
  it('replaces garbage from a hand-edited or corrupt file', () => {
    expect(mergeSettings({ theme: 'neon', fontSize: 'big', furigana: 7, layout: 'triple' })).toEqual({ theme: 'light', fontSize: 100, furigana: 'off', layout: 'auto' });
  });
  it('clamps absurd font sizes', () => {
    expect(mergeSettings({ fontSize: 5 }).fontSize).toBe(50);
    expect(mergeSettings({ fontSize: 9000 }).fontSize).toBe(300);
  });
});
